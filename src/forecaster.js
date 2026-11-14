/**
 * Capacity Forecaster & AIOps Advisor Core Engine.
 * Zero-dependency ES module implementing Holt's Damped Double Exponential Smoothing,
 * trailing-holdout cross-validation (MAE/RMSE), threshold breach estimation,
 * and multi-metric joint root-cause diagnosis.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Parses CSV telemetry in either multi-metric format
 * (`timestamp,cpu,memory,network`) or single-metric NAB format (`timestamp,value`).
 */
export function parseCsvTelemetry(csvText) {
  const lines = String(csvText || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 12) {
    throw new Error('CSV must contain a header row and at least 11 data points.');
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const timeIdx = headers.findIndex((h) =>
    ['timestamp', 'time', 'date', 'datetime', 'ts'].includes(h)
  );
  const cpuIdx = headers.findIndex((h) =>
    ['cpu', 'cpu_pct', 'cpu_utilization', 'cpu_percent'].includes(h)
  );
  const memIdx = headers.findIndex((h) =>
    ['memory', 'mem', 'mem_pct', 'memory_utilization', 'ram'].includes(h)
  );
  const netIdx = headers.findIndex((h) =>
    ['network', 'net', 'network_in', 'bandwidth', 'net_pct'].includes(h)
  );
  const valueIdx = headers.findIndex((h) => h === 'value');

  const isSingleValue = cpuIdx === -1 && memIdx === -1 && netIdx === -1 && valueIdx !== -1;

  if (!isSingleValue && cpuIdx === -1 && memIdx === -1 && netIdx === -1) {
    throw new Error(
      'Unrecognized CSV header. Expected "timestamp,cpu,memory,network" or "timestamp,value".'
    );
  }

  const rawRows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const tsRaw = timeIdx >= 0 ? cols[timeIdx] : `Point ${i}`;
    const parsedTime = Date.parse(tsRaw.replace(' ', 'T'));

    if (isSingleValue) {
      const val = Number.parseFloat(cols[valueIdx]);
      if (Number.isFinite(val)) {
        rawRows.push({
          timestamp: tsRaw,
          epochMs: Number.isFinite(parsedTime) ? parsedTime : null,
          rawVal: val,
        });
      }
    } else {
      const cpu = cpuIdx >= 0 ? Number.parseFloat(cols[cpuIdx]) : NaN;
      const memory = memIdx >= 0 ? Number.parseFloat(cols[memIdx]) : NaN;
      const network = netIdx >= 0 ? Number.parseFloat(cols[netIdx]) : NaN;
      if ([cpu, memory, network].some(Number.isFinite)) {
        rawRows.push({
          timestamp: tsRaw,
          epochMs: Number.isFinite(parsedTime) ? parsedTime : null,
          cpu: Number.isFinite(cpu) ? cpu : 0,
          memory: Number.isFinite(memory) ? memory : 0,
          network: Number.isFinite(network) ? network : 0,
        });
      }
    }
  }

  if (rawRows.length < 11) {
    throw new Error('Could not parse enough valid numeric rows (minimum 11 required).');
  }

  const stepMinutes = inferStepMinutes(rawRows);
  let normalizedScale = null;

  const rows = rawRows.map((row, idx) => {
    const epochMs =
      row.epochMs !== null
        ? row.epochMs
        : Date.UTC(2026, 0, 1) + idx * stepMinutes * 60 * 1000;

    if (isSingleValue) {
      return { ...row, epochMs };
    }
    return {
      timestamp: row.timestamp,
      epochMs,
      cpu: clamp(row.cpu, 0, 100),
      memory: clamp(row.memory, 0, 100),
      network: row.network,
    };
  });

  if (isSingleValue) {
    const maxRaw = Math.max(...rows.map((r) => r.rawVal));
    const scale = maxRaw > 100 ? maxRaw * 1.2 : 100;
    normalizedScale = maxRaw > 100 ? scale : null;
    return {
      rows: rows.map((r) => {
        const pct = clamp((r.rawVal / scale) * 100, 0, 100);
        return {
          timestamp: r.timestamp,
          epochMs: r.epochMs,
          cpu: pct,
          memory: clamp(pct * 0.65 + 18, 0, 100),
          network: clamp(pct * 0.55 + 12, 0, 100),
        };
      }),
      metadata: {
        mode: 'single-metric',
        stepMinutes,
        normalizedScale,
      },
    };
  }

  const maxNet = Math.max(...rows.map((r) => r.network));
  if (maxNet > 100) {
    normalizedScale = maxNet * 1.2;
    for (const row of rows) {
      row.network = clamp((row.network / normalizedScale) * 100, 0, 100);
    }
  } else {
    for (const row of rows) {
      row.network = clamp(row.network, 0, 100);
    }
  }

  return {
    rows,
    metadata: {
      mode: 'multi-metric',
      stepMinutes,
      normalizedScale,
    },
  };
}

function inferStepMinutes(rows) {
  const diffs = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].epochMs !== null && rows[i - 1].epochMs !== null) {
      const diffMin = (rows[i].epochMs - rows[i - 1].epochMs) / 60000;
      if (diffMin > 0 && diffMin <= 1440) {
        diffs.push(diffMin);
      }
    }
  }
  if (diffs.length === 0) return 5;
  diffs.sort((a, b) => a - b);
  return Math.max(1, Math.round(diffs[Math.floor(diffs.length / 2)]));
}

/**
 * Runs Damped Holt's Linear Trend smoothing on a numeric series.
 */
function runHoltSmoothing(values, alpha, beta, phi) {
  const n = values.length;
  const initWindow = Math.min(6, Math.max(2, Math.floor(n * 0.15)));
  let level = values[0];
  let trend = (values[initWindow - 1] - values[0]) / Math.max(1, initWindow - 1);
  const fitted = [values[0]];
  const residuals = [];

  for (let t = 1; t < n; t += 1) {
    const forecastOneStep = level + phi * trend;
    fitted.push(forecastOneStep);
    residuals.push(values[t] - forecastOneStep);

    const prevLevel = level;
    level = alpha * values[t] + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
  }

  return { level, trend, fitted, residuals };
}

/**
 * Tunes (alpha, beta) via trailing-holdout RMSE minimization and produces
 * a horizon forecast with 95% confidence bounds and accuracy metrics.
 */
export function forecastSeries(points, options = {}) {
  const {
    horizonHours = 12,
    stepMinutes = 5,
    threshold = 85,
    growthMultiplier = 1.0,
    scaleFactor = 1.0,
    damping = 0.985,
  } = options;

  const values = points.map((p) => clamp(p.value, 0, 100));
  const n = values.length;
  if (n < 6) {
    throw new Error('At least 6 points are required to forecast.');
  }

  const holdoutSize = Math.min(18, Math.max(4, Math.floor(n * 0.2)));
  const train = values.slice(0, n - holdoutSize);
  const test = values.slice(n - holdoutSize);

  const alphas = [0.15, 0.25, 0.4, 0.55];
  const betas = [0.02, 0.05, 0.1, 0.18];

  let bestParams = { alpha: 0.25, beta: 0.05, rmse: Infinity, mae: Infinity };

  for (const alpha of alphas) {
    for (const beta of betas) {
      const fit = runHoltSmoothing(train, alpha, beta, damping);
      let sqErr = 0;
      let absErr = 0;
      for (let h = 1; h <= holdoutSize; h += 1) {
        const dampFactor = geometricSum(damping, h);
        const pred = clamp(fit.level + dampFactor * fit.trend, 0, 100);
        const err = test[h - 1] - pred;
        sqErr += err * err;
        absErr += Math.abs(err);
      }
      const rmse = Math.sqrt(sqErr / holdoutSize);
      const mae = absErr / holdoutSize;
      if (rmse < bestParams.rmse) {
        bestParams = { alpha, beta, rmse, mae };
      }
    }
  }

  const fullFit = runHoltSmoothing(values, bestParams.alpha, bestParams.beta, damping);

  // Estimate macro OLS slope over the trailing ~50% window so short periodic
  // ripples near NOW do not invert a genuine multi-hour capacity trend.
  const recentCount = Math.min(n, Math.max(12, Math.floor(n * 0.5)));
  const recentSlice = values.slice(n - recentCount);
  const olsSlopePerStep = ordinaryLeastSquaresSlope(recentSlice);

  // Blend damped Holt trend and trailing OLS slope for stability against noise.
  const blendedStepSlope = 0.4 * fullFit.trend + 0.6 * olsSlopePerStep;
  const effectiveStepSlope = blendedStepSlope * growthMultiplier;

  const sigma = computeResidualStd(fullFit.residuals);
  const horizonSteps = Math.max(6, Math.round((horizonHours * 60) / stepMinutes));
  const lastEpochMs = points[n - 1].epochMs;
  const lastVal = values[n - 1];
  const anchorLevel = 0.55 * lastVal + 0.45 * fullFit.level;

  const forecast = [];
  for (let h = 1; h <= horizonSteps; h += 1) {
    const dampSum = geometricSum(damping, h);
    const rawProjected = (anchorLevel + dampSum * effectiveStepSlope) * scaleFactor;
    const yhat = clamp(rawProjected, 0, 100);
    const spread = 1.96 * sigma * Math.sqrt(1 + 0.08 * h) * scaleFactor;
    const upper = clamp(rawProjected + spread, 0, 100);
    const lower = clamp(rawProjected - spread, 0, 100);
    const epochMs = lastEpochMs + h * stepMinutes * 60 * 1000;

    forecast.push({
      step: h,
      epochMs,
      timestamp: formatUtcShort(epochMs),
      yhat,
      upper,
      lower,
    });
  }

  const breach = estimateBreach(lastVal * scaleFactor, forecast, threshold, stepMinutes);
  const stepsPerHour = 60 / stepMinutes;
  const slopePerHour = effectiveStepSlope * scaleFactor * stepsPerHour;
  const anomalies = detectHistoricalAnomalies(points, values, fullFit.fitted, scaleFactor);

  return {
    current: lastVal,
    scaledCurrent: lastVal * scaleFactor,
    slopePerHour,
    forecast,
    breach,
    anomalies,
    backtest: {
      mae: bestParams.mae,
      rmse: bestParams.rmse,
      alpha: bestParams.alpha,
      beta: bestParams.beta,
      holdoutSize,
    },
    sigma,
  };
}

/**
 * Flags abrupt telemetry spikes using Median Absolute Deviation (MAD) over
 * one-step Holt residuals so isolated spikes do not mask earlier precursors.
 */
function detectHistoricalAnomalies(points, values, fitted, scaleFactor) {
  const residuals = [];
  for (let i = 1; i < values.length; i += 1) {
    residuals.push(values[i] - fitted[i]);
  }
  if (residuals.length < 6) return [];

  const sortedAbs = residuals.map((r) => Math.abs(r)).sort((a, b) => a - b);
  const medianAbs = sortedAbs[Math.floor(sortedAbs.length / 2)];
  const madSigma = Math.max(1.2, 1.4826 * medianAbs);

  const anomalies = [];
  for (let i = 1; i < values.length; i += 1) {
    const res = values[i] - fitted[i];
    const zScore = res / madSigma;
    if (Math.abs(zScore) >= 3.4 && Math.abs(res) >= 6) {
      anomalies.push({
        index: i,
        timestamp: points[i].timestamp,
        value: values[i] * scaleFactor,
        zScore: Number(zScore.toFixed(1)),
      });
    }
  }
  return anomalies;
}

function geometricSum(phi, steps) {
  if (Math.abs(1 - phi) < 1e-6) return steps;
  return (phi * (1 - Math.pow(phi, steps))) / (1 - phi);
}

function ordinaryLeastSquaresSlope(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += arr[i];
    sumXY += i * arr[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function computeResidualStd(residuals) {
  if (residuals.length < 2) return 1.5;
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const variance =
    residuals.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (residuals.length - 1);
  return Math.max(0.75, Math.sqrt(variance));
}

function estimateBreach(currentScaled, forecast, threshold, stepMinutes) {
  if (currentScaled >= threshold) {
    return {
      status: 'breached',
      expectedHours: 0,
      worstCaseHours: 0,
      breachIndex: 0,
      breachPoint: forecast[0] || null,
      peakProjected: Math.max(currentScaled, ...forecast.map((f) => f.yhat)),
      peakUpper: Math.max(currentScaled, ...forecast.map((f) => f.upper)),
    };
  }

  let expectedIdx = -1;
  let worstIdx = -1;
  let peakProjected = currentScaled;
  let peakUpper = currentScaled;

  for (let i = 0; i < forecast.length; i += 1) {
    const pt = forecast[i];
    if (pt.yhat > peakProjected) peakProjected = pt.yhat;
    if (pt.upper > peakUpper) peakUpper = pt.upper;
    if (expectedIdx === -1 && pt.yhat >= threshold) expectedIdx = i;
    if (worstIdx === -1 && pt.upper >= threshold) worstIdx = i;
  }

  const toHours = (idx) =>
    idx === -1 ? null : Number((((idx + 1) * stepMinutes) / 60).toFixed(1));

  const expectedHours = toHours(expectedIdx);
  const worstCaseHours = toHours(worstIdx);

  let status = 'healthy';
  if (expectedHours !== null) {
    status = expectedHours <= 4 ? 'critical' : 'warning';
  } else if (worstCaseHours !== null) {
    status = 'warning';
  }

  return {
    status,
    expectedHours,
    worstCaseHours,
    breachIndex: expectedIdx,
    breachPoint: expectedIdx >= 0 ? forecast[expectedIdx] : null,
    peakProjected,
    peakUpper,
  };
}

/**
 * Joint multi-metric Capacity Advisor that diagnoses root-cause signatures
 * and recommends prioritized scaling & cost-optimization actions.
 */
export function analyzeClusterCapacity(forecasts, options = {}) {
  const { threshold = 85, baseReplicas = 3, addedReplicas = 0 } = options;
  const { cpu, memory, network } = forecasts;

  const entries = [
    { key: 'cpu', label: 'CPU', data: cpu },
    { key: 'memory', label: 'Memory', data: memory },
    { key: 'network', label: 'Network', data: network },
  ];

  const breachedNow = entries.filter((e) => e.data.breach.status === 'breached');
  const expectedBreaches = entries
    .filter((e) => e.data.breach.expectedHours !== null && e.data.breach.expectedHours > 0)
    .sort((a, b) => a.data.breach.expectedHours - b.data.breach.expectedHours);
  const worstCaseOnly = entries.filter(
    (e) =>
      e.data.breach.expectedHours === null && e.data.breach.worstCaseHours !== null
  );

  let overallStatus = 'HEALTHY';
  let signature = 'Balanced Headroom';
  let summary =
    'All telemetry dimensions stay safely below the SLA threshold across the forecast horizon.';
  const recommendations = [];

  const isMemoryLeak =
    memory.slopePerHour > 0.6 &&
    (memory.breach.expectedHours !== null || memory.scaledCurrent > threshold - 18) &&
    cpu.breach.expectedHours === null &&
    cpu.scaledCurrent < threshold - 18 &&
    memory.slopePerHour > Math.max(0.8, cpu.slopePerHour * 1.8);

  const isIdleCluster =
    cpu.scaledCurrent < 28 &&
    memory.scaledCurrent < 32 &&
    network.scaledCurrent < 25 &&
    expectedBreaches.length === 0 &&
    worstCaseOnly.length === 0 &&
    Math.max(cpu.slopePerHour, memory.slopePerHour, network.slopePerHour) < 0.25;

  const isDualSurge =
    cpu.slopePerHour > 0.45 &&
    network.slopePerHour > 0.4 &&
    (cpu.breach.expectedHours !== null || network.breach.expectedHours !== null);

  if (breachedNow.length > 0) {
    overallStatus = 'CRITICAL';
    const names = breachedNow.map((b) => b.label).join(' & ');
    signature = `Active ${names} Saturation`;
    summary = `${names} already exceeds the ${threshold}% SLA limit. Immediate load shedding or capacity expansion is required to prevent dropped requests.`;
    recommendations.push({
      priority: 'P0 · Immediate',
      title: `Scale out ${baseReplicas} -> ${baseReplicas + 2} replicas`,
      detail: `Adds ~40% immediate headroom to absorb live ${names} pressure and eliminate request queuing.`,
      impact: 'Restores utilization below ~62%',
    });
    recommendations.push({
      priority: 'P1 · 15 mins',
      title: 'Enable rate limiting & shed non-critical jobs',
      detail: 'Defer background batch workers and throttle bursty callers while new nodes warm up.',
      impact: 'Cuts peak load 15–25%',
    });
  } else if (isMemoryLeak) {
    overallStatus = memory.breach.expectedHours <= 4 ? 'CRITICAL' : 'WARNING';
    signature = 'Memory Leak Signature';
    const eta =
      memory.breach.expectedHours !== null
        ? `in ~${memory.breach.expectedHours}h`
        : 'within the 95% confidence band';
    summary = `Memory is climbing (+${memory.slopePerHour.toFixed(2)}%/hr) toward ${threshold}% ${eta} while CPU remains calm (${cpu.scaledCurrent.toFixed(1)}%). Adding vCPUs alone will not resolve an unbounded heap/cache leak.`;
    recommendations.push({
      priority: 'P0 · Next 1 hr',
      title: 'Schedule rolling pod/worker restart before breach',
      detail: `Trigger zero-downtime rolling drain before memory crosses ${threshold}% to avoid sudden OOMKills.`,
      impact: 'Prevents unplanned OOM outage',
    });
    recommendations.push({
      priority: 'P1 · Engineering',
      title: 'Capture heap snapshot & cap in-memory caches',
      detail: 'Inspect retained objects / unclosed buffers and enforce max-heap TTL or eviction policies.',
      impact: 'Eliminates monotonic slope',
    });
  } else if (isDualSurge) {
    overallStatus =
      expectedBreaches[0]?.data.breach.expectedHours <= 4 ? 'CRITICAL' : 'WARNING';
    signature = 'Compounding Compute & Network Surge';
    const first = expectedBreaches[0];
    summary = `Correlated traffic growth is pushing both CPU (+${cpu.slopePerHour.toFixed(2)}%/hr) and Network (+${network.slopePerHour.toFixed(2)}%/hr). First SLA breach (${first.label}) is projected in ~${first.data.breach.expectedHours}h.`;
    recommendations.push({
      priority: 'P0 · Proactive',
      title: `Pre-warm autoscaling (+${Math.max(2, addedReplicas || 2)} nodes)`,
      detail: `Scale before the ${Math.max(0.5, first.data.breach.expectedHours - 1).toFixed(1)}h mark so new instances pass health checks ahead of peak load.`,
      impact: 'Shifts breach out >12h',
    });
    recommendations.push({
      priority: 'P1 · Architecture',
      title: 'Offload static/cacheable reads to CDN + Brotli',
      detail: 'Reduces origin CPU serialization and outbound network payload size simultaneously.',
      impact: 'Saves 20–35% egress & CPU',
    });
  } else if (expectedBreaches.length > 0) {
    const first = expectedBreaches[0];
    overallStatus = first.data.breach.expectedHours <= 4 ? 'CRITICAL' : 'WARNING';
    signature = `${first.label} Saturation Trajectory`;
    summary = `${first.label} is trending upward (+${first.data.slopePerHour.toFixed(2)}%/hr) and is projected to cross ${threshold}% in ~${first.data.breach.expectedHours}h (worst-case 95% CI: ~${first.data.breach.worstCaseHours ?? first.data.breach.expectedHours}h).`;
    recommendations.push({
      priority: 'P0 · Proactive',
      title:
        first.key === 'network'
          ? 'Enable compression & upgrade ingress bandwidth tier'
          : `Scale ${first.label.toLowerCase()}-bound tier (+2 instances)`,
      detail: `Act at least 45 minutes prior to the ${first.data.breach.expectedHours}h window to absorb forecasting uncertainty.`,
      impact: `Extends runway past ${threshold}% limit`,
    });
    recommendations.push({
      priority: 'P2 · Observability',
      title: `Set predictive pre-alert at ${Math.max(60, threshold - 12)}%`,
      detail: 'Alert on sustained slope rather than static threshold to avoid reactive paging.',
      impact: '+2h early warning lead time',
    });
  } else if (worstCaseOnly.length > 0) {
    const first = worstCaseOnly[0];
    overallStatus = 'WARNING';
    signature = `Tail-Risk Variance (${first.label})`;
    summary = `Median trajectory stays safe, but residual volatility puts ${first.label} 95% upper confidence bound across ${threshold}% in ~${first.data.breach.worstCaseHours}h.`;
    recommendations.push({
      priority: 'P1 · Watchlist',
      title: 'Keep 1 warm standby instance in HPA pool',
      detail: 'Protects against sudden burst variance without paying for full static over-provisioning.',
      impact: 'Covers 95% CI tail spikes',
    });
  } else if (isIdleCluster) {
    overallStatus = 'OVER-PROVISIONED';
    signature = 'Idle Headroom · Cost Optimization';
    summary = `Peak utilization across CPU (${cpu.scaledCurrent.toFixed(1)}%), Memory (${memory.scaledCurrent.toFixed(1)}%), and Network (${network.scaledCurrent.toFixed(1)}%) sits well below 35% with flat demand.`;
    recommendations.push({
      priority: 'P1 · FinOps',
      title: `Downsize cluster floor (${baseReplicas} -> ${Math.max(1, baseReplicas - 1)} nodes) or smaller SKU`,
      detail: 'Move from compute-heavy instances to burstable/right-sized nodes while keeping 45%+ safety buffer.',
      impact: 'Est. 35–45% monthly savings',
    });
    recommendations.push({
      priority: 'P2 · Scheduling',
      title: 'Consolidate non-prod & batch workloads',
      detail: 'Co-locate low-CPU services or enable scale-to-zero during off-peak hours.',
      impact: 'Eliminates idle compute waste',
    });
  } else {
    recommendations.push({
      priority: 'P2 · Maintain',
      title: 'Keep current replica baseline & monitor trend drift',
      detail: `Cluster operates inside optimal efficiency band (peak projected ${Math.max(cpu.breach.peakProjected, memory.breach.peakProjected, network.breach.peakProjected).toFixed(1)}%).`,
      impact: 'Zero action required',
    });
  }

  const recommendedAdd = computeRecommendedReplicas(
    entries,
    threshold,
    baseReplicas,
    addedReplicas,
    isMemoryLeak,
    isIdleCluster
  );

  return {
    overallStatus,
    signature,
    summary,
    recommendations,
    earliestBreach: expectedBreaches[0] || breachedNow[0] || null,
    recommendedAdd,
  };
}

function computeRecommendedReplicas(
  entries,
  threshold,
  baseReplicas,
  addedReplicas,
  isMemoryLeak,
  isIdleCluster
) {
  if (isMemoryLeak || isIdleCluster) return 0;
  const currentTotal = baseReplicas + addedReplicas;
  const targetCeiling = Math.max(45, threshold - 6);
  const computeNetUpper = Math.max(
    entries.find((e) => e.key === 'cpu')?.data.breach.peakUpper || 0,
    entries.find((e) => e.key === 'network')?.data.breach.peakUpper || 0
  );
  const computeNetPeak = Math.max(
    entries.find((e) => e.key === 'cpu')?.data.breach.peakProjected || 0,
    entries.find((e) => e.key === 'network')?.data.breach.peakProjected || 0
  );
  if (computeNetPeak < threshold && computeNetUpper < threshold) return 0;
  const neededTotal = Math.ceil((currentTotal * Math.max(computeNetPeak, computeNetUpper)) / targetCeiling);
  return clamp(neededTotal - baseReplicas, 1, 6);
}

/**
 * Generates a structured Capacity Advisor LLM prompt (Option #3 integration)
 * pre-populated with live forecast metrics so users can copy-paste into any AI assistant.
 */
export function buildAdvisorPrompt(forecasts, analysis, context) {
  const { scenarioTitle, threshold, horizonHours, baseReplicas, addedReplicas } = context;
  const fmtMetric = (name, m) => {
    const eta =
      m.breach.expectedHours === 0
        ? 'ALREADY BREACHED'
        : m.breach.expectedHours !== null
        ? `${m.breach.expectedHours}h (95% CI worst-case: ${m.breach.worstCaseHours ?? m.breach.expectedHours}h)`
        : `No breach within ${horizonHours}h (peak projected: ${m.breach.peakProjected.toFixed(1)}%)`;
    return `- ${name}: current=${m.scaledCurrent.toFixed(1)}%, slope=${m.slopePerHour >= 0 ? '+' : ''}${m.slopePerHour.toFixed(2)}%/hr, backtest_RMSE=${m.backtest.rmse.toFixed(2)}%, time_to_${threshold}%=${eta}`;
  };

  return `You are a Principal Site Reliability Engineer (SRE) and FinOps Capacity Advisor.
Analyze the following telemetry & time-series forecast and produce concrete, zero-downtime scaling and cost-optimization decisions.

## Cluster Context
- Workload Profile: ${scenarioTitle}
- Active Replicas: ${baseReplicas + addedReplicas} (baseline ${baseReplicas} + ${addedReplicas} simulated)
- SLA Threshold: ${threshold}%
- Forecast Horizon: ${horizonHours} hours
- Automated Pre-Diagnosis: ${analysis.overallStatus} — ${analysis.signature}

## Resource Telemetry & Forecasts
${fmtMetric('CPU Utilization', forecasts.cpu)}
${fmtMetric('Memory Utilization', forecasts.memory)}
${fmtMetric('Network Bandwidth', forecasts.network)}

## Required Output
1. Root-Cause Assessment: Distinguish traffic growth vs. resource leaks vs. over-provisioning.
2. Scaling Action Plan: Exact horizontal/vertical actions, timing before breach, and rollback trigger.
3. Cost & Reliability Trade-off: Quantify risk of inaction vs. over-scaling.`;
}

function formatUtcShort(epochMs) {
  const d = new Date(epochMs);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}
