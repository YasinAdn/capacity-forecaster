import {
  analyzeClusterCapacity,
  buildAdvisorPrompt,
  forecastSeries,
  parseCsvTelemetry,
} from './forecaster.js';
import { loadScenario, NAB_REPO_URL, rowsToCsvText, SCENARIOS } from './datasets.js';
import {
  METRIC_COLORS,
  renderComparisonChart,
  renderMainChart,
  renderMiniSparkline,
} from './chart.js';

const METRICS = [
  { key: 'cpu', label: 'CPU Utilization', shortLabel: 'CPU', color: METRIC_COLORS.cpu.line },
  { key: 'memory', label: 'Memory Utilization', shortLabel: 'Memory', color: METRIC_COLORS.memory.line },
  { key: 'network', label: 'Network Bandwidth', shortLabel: 'Network', color: METRIC_COLORS.network.line },
];

const BASE_REPLICAS = 3;

const state = {
  scenarioId: 'traffic-surge',
  scenarioTitle: SCENARIOS[0].title,
  scenarioSubtitle: SCENARIOS[0].subtitle,
  scenarioBadge: SCENARIOS[0].badge,
  sourceNote: SCENARIOS[0].sourceNote,
  datasetUrl: SCENARIOS[0].datasetUrl,
  stepMinutes: 5,
  rows: [],
  activeMetric: 'cpu',
  chartMode: 'single',
  threshold: 85,
  horizonHours: 12,
  growthMultiplier: 1.0,
  addedReplicas: 0,
  lastForecasts: null,
  lastAnalysis: null,
};

const els = {
  scenarioSelect: document.getElementById('scenarioSelect'),
  csvUpload: document.getElementById('csvUpload'),
  downloadCsvBtn: document.getElementById('downloadCsvBtn'),
  openPromptBtn: document.getElementById('openPromptBtn'),
  closePromptBtn: document.getElementById('closePromptBtn'),
  copyPromptBtn: document.getElementById('copyPromptBtn'),
  promptModal: document.getElementById('promptModal'),
  promptPreview: document.getElementById('promptPreview'),
  statusBadge: document.getElementById('globalStatusBadge'),
  scenarioBadge: document.getElementById('scenarioBadge'),
  scenarioSubtitle: document.getElementById('scenarioSubtitle'),
  sourceNote: document.getElementById('sourceNote'),
  datasetCitationLink: document.getElementById('datasetCitationLink'),
  metricCards: document.getElementById('metricCards'),
  chartTitle: document.getElementById('chartTitle'),
  chartLegend: document.getElementById('chartLegend'),
  anomalyPill: document.getElementById('anomalyPill'),
  modeSingleBtn: document.getElementById('modeSingleBtn'),
  modeCompareBtn: document.getElementById('modeCompareBtn'),
  chartContainer: document.getElementById('mainChart'),
  chartTooltip: document.getElementById('chartTooltip'),
  backtestStrip: document.getElementById('backtestStrip'),
  thresholdSlider: document.getElementById('thresholdSlider'),
  thresholdValue: document.getElementById('thresholdValue'),
  horizonSlider: document.getElementById('horizonSlider'),
  horizonValue: document.getElementById('horizonValue'),
  growthSlider: document.getElementById('growthSlider'),
  growthValue: document.getElementById('growthValue'),
  replicaSlider: document.getElementById('replicaSlider'),
  replicaValue: document.getElementById('replicaValue'),
  resetSimBtn: document.getElementById('resetSimBtn'),
  simImpactBanner: document.getElementById('simImpactBanner'),
  advisorSignature: document.getElementById('advisorSignature'),
  advisorSummary: document.getElementById('advisorSummary'),
  riskMatrix: document.getElementById('riskMatrix'),
  applyFixBtn: document.getElementById('applyFixBtn'),
  advisorRecommendations: document.getElementById('advisorRecommendations'),
  toast: document.getElementById('toast'),
};

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('visible');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => els.toast.classList.remove('visible'), 2600);
}

function populateScenarioDropdown() {
  els.scenarioSelect.innerHTML = '';
  for (const s of SCENARIOS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.title;
    els.scenarioSelect.appendChild(opt);
  }
}

async function selectScenario(id) {
  const data = await loadScenario(id);
  state.scenarioId = data.id;
  state.scenarioTitle = data.title;
  state.scenarioSubtitle = data.subtitle;
  state.scenarioBadge = data.badge;
  state.sourceNote = data.sourceNote;
  state.datasetUrl = data.datasetUrl;
  state.stepMinutes = data.stepMinutes;
  state.rows = data.rows;
  state.activeMetric = id === 'memory-leak' ? 'memory' : 'cpu';
  recomputeAndRender();
}

function getScaleFactor(metricKey, addedReplicas = state.addedReplicas) {
  if (addedReplicas === 0) return 1.0;
  if (metricKey === 'memory') {
    return BASE_REPLICAS / (BASE_REPLICAS + addedReplicas * 0.6);
  }
  return BASE_REPLICAS / (BASE_REPLICAS + addedReplicas);
}

function computeForecastSet(addedReplicas) {
  const forecasts = {};
  for (const m of METRICS) {
    const seriesPoints = state.rows.map((r) => ({
      timestamp: r.timestamp,
      epochMs: r.epochMs,
      value: r[m.key],
    }));
    forecasts[m.key] = forecastSeries(seriesPoints, {
      horizonHours: state.horizonHours,
      stepMinutes: state.stepMinutes,
      threshold: state.threshold,
      growthMultiplier: state.growthMultiplier,
      scaleFactor: getScaleFactor(m.key, addedReplicas),
    });
  }
  return forecasts;
}

function recomputeAndRender() {
  if (!state.rows.length) return;

  const forecasts = computeForecastSet(state.addedReplicas);
  const analysis = analyzeClusterCapacity(forecasts, {
    threshold: state.threshold,
    baseReplicas: BASE_REPLICAS,
    addedReplicas: state.addedReplicas,
  });

  state.lastForecasts = forecasts;
  state.lastAnalysis = analysis;

  renderHeaderMeta(analysis);
  renderMetricCards(forecasts);
  renderActiveChart(forecasts);
  renderSimImpact(forecasts, analysis);
  renderAdvisor(forecasts, analysis);
}

function renderHeaderMeta(analysis) {
  els.scenarioBadge.textContent = state.scenarioBadge;
  els.scenarioSubtitle.textContent = state.scenarioSubtitle;
  els.sourceNote.textContent = state.sourceNote;
  els.datasetCitationLink.href = state.datasetUrl || NAB_REPO_URL;

  els.statusBadge.className = `status-pill ${statusToClass(analysis.overallStatus)}`;
  if (analysis.earliestBreach) {
    const eta = analysis.earliestBreach.data.breach.expectedHours;
    els.statusBadge.textContent =
      eta === 0
        ? `${analysis.overallStatus} · ${analysis.earliestBreach.label} Saturated`
        : `${analysis.overallStatus} · ${analysis.earliestBreach.label} Breach in ${eta}h`;
  } else {
    els.statusBadge.textContent = `${analysis.overallStatus} · ${analysis.signature}`;
  }
}

function renderMetricCards(forecasts) {
  els.metricCards.innerHTML = '';

  for (const m of METRICS) {
    const fc = forecasts[m.key];
    const isActive = state.chartMode === 'single' && state.activeMetric === m.key;
    const breachClass = fc.breach.status;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `metric-card ${isActive ? 'active' : ''}`;
    card.style.setProperty('--card-accent', m.color);
    card.setAttribute('aria-pressed', String(isActive));
    card.addEventListener('click', () => {
      state.activeMetric = m.key;
      state.chartMode = 'single';
      syncChartModeButtons();
      renderMetricCards(forecasts);
      renderActiveChart(forecasts);
    });

    const etaText = formatEtaText(fc.breach, state.horizonHours);
    const slopeSign = fc.slopePerHour >= 0 ? '+' : '';

    card.innerHTML = `
      <div class="mc-top">
        <span class="mc-label">
          <span class="mc-dot" style="background:${m.color}"></span>
          ${m.label}
        </span>
        <span class="mc-tag ${breachClass}">${breachTagLabel(fc.breach.status)}</span>
      </div>
      <div class="mc-mid">
        <div class="mc-value">${fc.scaledCurrent.toFixed(1)}<span class="mc-unit">%</span></div>
        <div class="mc-slope">${slopeSign}${fc.slopePerHour.toFixed(2)}%/hr</div>
      </div>
      <div class="mc-spark" data-spark="${m.key}"></div>
      <div class="mc-bottom">
        <span>${etaText}</span>
        <span class="mc-rmse">RMSE ${fc.backtest.rmse.toFixed(1)}%</span>
      </div>
    `;

    els.metricCards.appendChild(card);

    const sparkContainer = card.querySelector(`[data-spark="${m.key}"]`);
    const histVals = state.rows.map((r) => r[m.key] * getScaleFactor(m.key));
    const fcVals = fc.forecast.map((f) => f.yhat);
    renderMiniSparkline(sparkContainer, histVals, fcVals, state.threshold, m.color);
  }
}

function syncChartModeButtons() {
  els.modeSingleBtn.classList.toggle('active', state.chartMode === 'single');
  els.modeCompareBtn.classList.toggle('active', state.chartMode === 'compare');
}

function renderActiveChart(forecasts) {
  syncChartModeButtons();

  if (state.chartMode === 'compare') {
    els.chartTitle.textContent = `All 3 Resources · ${state.horizonHours}h Comparison`;
    els.anomalyPill.hidden = true;
    els.chartLegend.innerHTML = `
      <span class="leg-item"><i class="swatch" style="background:${METRIC_COLORS.cpu.line}"></i>CPU</span>
      <span class="leg-item"><i class="swatch" style="background:${METRIC_COLORS.memory.line}"></i>Memory</span>
      <span class="leg-item"><i class="swatch" style="background:${METRIC_COLORS.network.line}"></i>Network</span>
      <span class="leg-item"><i class="swatch limit"></i>SLA Limit</span>
    `;

    const seriesList = METRICS.map((m) => ({
      key: m.key,
      shortLabel: m.shortLabel,
      historical: state.rows.map((r) => ({
        timestamp: r.timestamp,
        value: r[m.key] * getScaleFactor(m.key),
      })),
      forecastResult: forecasts[m.key],
    }));

    renderComparisonChart(els.chartContainer, els.chartTooltip, {
      seriesList,
      threshold: state.threshold,
    });

    const avgRmse =
      (forecasts.cpu.backtest.rmse + forecasts.memory.backtest.rmse + forecasts.network.backtest.rmse) / 3;
    const peakAll = Math.max(
      forecasts.cpu.breach.peakProjected,
      forecasts.memory.breach.peakProjected,
      forecasts.network.breach.peakProjected
    );

    els.backtestStrip.innerHTML = `
      <div class="bt-item"><span>Cluster Avg RMSE</span><strong>${avgRmse.toFixed(2)}%</strong></div>
      <div class="bt-item"><span>Peak CPU</span><strong>${forecasts.cpu.breach.peakProjected.toFixed(1)}%</strong></div>
      <div class="bt-item"><span>Peak Memory</span><strong>${forecasts.memory.breach.peakProjected.toFixed(1)}%</strong></div>
      <div class="bt-item"><span>Peak Network</span><strong>${forecasts.network.breach.peakProjected.toFixed(1)}%</strong></div>
      <div class="bt-item"><span>Max Projected</span><strong>${peakAll.toFixed(1)}%</strong></div>
    `;
    return;
  }

  const m = METRICS.find((item) => item.key === state.activeMetric) || METRICS[0];
  const fc = forecasts[m.key];
  const scale = getScaleFactor(m.key);

  els.chartTitle.textContent = `${m.label} · ${state.horizonHours}h Forecast`;
  const anomCount = fc.anomalies?.length || 0;
  els.anomalyPill.hidden = false;
  els.anomalyPill.className = `anomaly-pill ${anomCount > 0 ? 'has-spikes' : ''}`;
  els.anomalyPill.textContent =
    anomCount > 0 ? `${anomCount} Anomaly Spike${anomCount > 1 ? 's' : ''}` : 'No Historical Spikes';

  els.chartLegend.innerHTML = `
    <span class="leg-item"><i class="swatch" style="background:${m.color}"></i>Observed</span>
    <span class="leg-item"><i class="swatch dashed"></i>Forecast</span>
    <span class="leg-item"><i class="swatch band"></i>95% CI</span>
    <span class="leg-item"><i class="swatch limit"></i>SLA Limit</span>
  `;

  const historical = state.rows.map((r) => ({
    timestamp: r.timestamp,
    value: r[m.key] * scale,
  }));

  renderMainChart(els.chartContainer, els.chartTooltip, {
    metricKey: m.key,
    metricLabel: m.shortLabel,
    historical,
    forecastResult: fc,
    threshold: state.threshold,
  });

  els.backtestStrip.innerHTML = `
    <div class="bt-item"><span>Backtest MAE</span><strong>${fc.backtest.mae.toFixed(2)}%</strong></div>
    <div class="bt-item"><span>Backtest RMSE</span><strong>${fc.backtest.rmse.toFixed(2)}%</strong></div>
    <div class="bt-item"><span>Holdout Window</span><strong>${fc.backtest.holdoutSize} pts</strong></div>
    <div class="bt-item"><span>Holt Params</span><strong>α=${fc.backtest.alpha} · β=${fc.backtest.beta}</strong></div>
    <div class="bt-item"><span>Peak Forecast</span><strong>${fc.breach.peakProjected.toFixed(1)}%</strong></div>
  `;
}

function renderSimImpact(forecasts, analysis) {
  if (state.addedReplicas === 0) {
    els.simImpactBanner.hidden = true;
    return;
  }

  const baseForecasts = computeForecastSet(0);
  const basePeak = Math.max(
    baseForecasts.cpu.breach.peakProjected,
    baseForecasts.network.breach.peakProjected
  );
  const simPeak = Math.max(
    forecasts.cpu.breach.peakProjected,
    forecasts.network.breach.peakProjected
  );
  const headroomGain = Math.max(0, basePeak - simPeak);
  const baseEta = Math.min(
    ...[baseForecasts.cpu.breach.expectedHours, baseForecasts.network.breach.expectedHours].filter(
      (v) => v !== null
    ),
    Infinity
  );
  const simLabel = analysis.earliestBreach
    ? `Breach in ${analysis.earliestBreach.data.breach.expectedHours}h`
    : `Safe >${state.horizonHours}h`;
  const baseLabel = Number.isFinite(baseEta) ? `Breach @ ${baseEta}h` : 'Safe';

  els.simImpactBanner.hidden = false;
  els.simImpactBanner.innerHTML = `
    <span class="sim-impact-badge">SIMULATED IMPACT (+${state.addedReplicas} NODES)</span>
    <span>${baseLabel} → <strong>${simLabel}</strong> · Peak compute/net reduced <strong>-${headroomGain.toFixed(1)}%</strong></span>
  `;
}

function renderAdvisor(forecasts, analysis) {
  els.advisorSignature.className = `advisor-signature ${statusToClass(analysis.overallStatus)}`;
  els.advisorSignature.textContent = analysis.signature;
  els.advisorSummary.textContent = analysis.summary;

  // Resource Risk Matrix
  els.riskMatrix.innerHTML = '';
  for (const m of METRICS) {
    const fc = forecasts[m.key];
    const peak = fc.breach.peakProjected;
    const eta = formatEtaText(fc.breach, state.horizonHours);
    const barClass = fc.breach.status;

    const row = document.createElement('div');
    row.className = 'risk-row';
    row.innerHTML = `
      <div class="risk-row-top">
        <span class="risk-name"><i class="mc-dot" style="background:${m.color}"></i>${m.shortLabel}</span>
        <span class="risk-vals">${fc.scaledCurrent.toFixed(1)}% → Peak <strong>${peak.toFixed(1)}%</strong></span>
        <span class="risk-eta ${barClass}">${eta}</span>
      </div>
      <div class="risk-bar-track">
        <div class="risk-bar-fill ${barClass}" style="width:${Math.min(100, peak).toFixed(1)}%"></div>
        <div class="risk-threshold-tick" style="left:${state.threshold}%"></div>
      </div>
    `;
    els.riskMatrix.appendChild(row);
  }

  // 1-Click Simulate Recommended Fix button
  if (analysis.recommendedAdd > 0 && state.addedReplicas < analysis.recommendedAdd) {
    els.applyFixBtn.hidden = false;
    const n = analysis.recommendedAdd;
    els.applyFixBtn.textContent = `Simulate Recommended Fix (+${n} Node${n === 1 ? '' : 's'})`;
  } else {
    els.applyFixBtn.hidden = true;
  }

  els.advisorRecommendations.innerHTML = '';
  for (const rec of analysis.recommendations) {
    const item = document.createElement('div');
    item.className = 'rec-card';
    item.innerHTML = `
      <div class="rec-header">
        <span class="rec-priority">${rec.priority}</span>
        <span class="rec-impact">${rec.impact}</span>
      </div>
      <div class="rec-title">${rec.title}</div>
      <p class="rec-detail">${rec.detail}</p>
    `;
    els.advisorRecommendations.appendChild(item);
  }
}

function formatEtaText(breach, horizonHours) {
  if (breach.status === 'breached') return 'Breached now';
  if (breach.expectedHours !== null) return `Breach in ~${breach.expectedHours}h`;
  if (breach.worstCaseHours !== null) return `95% CI risk ~${breach.worstCaseHours}h`;
  return `Safe for >${horizonHours}h`;
}

function breachTagLabel(status) {
  if (status === 'breached') return 'SATURATED';
  if (status === 'critical') return 'CRITICAL';
  if (status === 'warning') return 'WATCH';
  return 'OK';
}

function statusToClass(overallStatus) {
  if (overallStatus === 'CRITICAL') return 'critical';
  if (overallStatus === 'WARNING') return 'warning';
  if (overallStatus === 'OVER-PROVISIONED') return 'finops';
  return 'healthy';
}

async function handleCsvFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseCsvTelemetry(text);
    state.scenarioId = 'custom-csv';
    state.scenarioTitle = `Custom CSV (${file.name})`;
    state.scenarioBadge = 'Custom Upload';
    state.scenarioSubtitle = `${parsed.rows.length} points @ ${parsed.metadata.stepMinutes}-min interval (${parsed.metadata.mode})`;
    state.sourceNote = parsed.metadata.normalizedScale
      ? `Loaded "${file.name}" — raw metrics auto-normalized against scale ${Math.round(parsed.metadata.normalizedScale).toLocaleString()}.`
      : `Loaded user CSV "${file.name}".`;
    state.datasetUrl = null;
    state.stepMinutes = parsed.metadata.stepMinutes;
    state.rows = parsed.rows;
    recomputeAndRender();
    showToast(`Loaded ${parsed.rows.length} rows from ${file.name}`);
  } catch (err) {
    showToast(err.message || 'Failed to parse CSV file');
  }
}

function wireEvents() {
  els.scenarioSelect.addEventListener('change', (e) => {
    selectScenario(e.target.value);
  });

  els.modeSingleBtn.addEventListener('click', () => {
    state.chartMode = 'single';
    if (state.lastForecasts) {
      renderMetricCards(state.lastForecasts);
      renderActiveChart(state.lastForecasts);
    }
  });

  els.modeCompareBtn.addEventListener('click', () => {
    state.chartMode = 'compare';
    if (state.lastForecasts) {
      renderMetricCards(state.lastForecasts);
      renderActiveChart(state.lastForecasts);
    }
  });

  els.csvUpload.addEventListener('change', async (e) => {
    await handleCsvFile(e.target.files?.[0]);
    e.target.value = '';
  });

  // Allow dropping a CSV file anywhere onto the dashboard
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.csv')) {
      e.preventDefault();
      await handleCsvFile(file);
    }
  });

  els.downloadCsvBtn.addEventListener('click', () => {
    const csv = rowsToCsvText(state.rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.scenarioId}-telemetry.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded CSV sample');
  });

  const bindSlider = (slider, labelEl, key, fmt, isFloat = false) => {
    slider.addEventListener('input', () => {
      const val = isFloat ? Number.parseFloat(slider.value) : Number.parseInt(slider.value, 10);
      state[key] = val;
      labelEl.textContent = fmt(val);
      recomputeAndRender();
    });
  };

  bindSlider(els.thresholdSlider, els.thresholdValue, 'threshold', (v) => `${v}%`);
  bindSlider(els.horizonSlider, els.horizonValue, 'horizonHours', (v) => `${v}h`);
  bindSlider(els.growthSlider, els.growthValue, 'growthMultiplier', (v) => `${v.toFixed(1)}x`, true);
  bindSlider(
    els.replicaSlider,
    els.replicaValue,
    'addedReplicas',
    (v) => (v === 0 ? `0 (3 nodes)` : `+${v} (${BASE_REPLICAS + v} nodes)`)
  );

  els.applyFixBtn.addEventListener('click', () => {
    const recAdd = state.lastAnalysis?.recommendedAdd || 0;
    if (recAdd <= 0) return;
    state.addedReplicas = recAdd;
    els.replicaSlider.value = String(recAdd);
    els.replicaValue.textContent = `+${recAdd} (${BASE_REPLICAS + recAdd} nodes)`;
    recomputeAndRender();
    showToast(`Applied +${recAdd} replicas — forecast updated`);
  });

  els.resetSimBtn.addEventListener('click', () => {
    state.threshold = 85;
    state.horizonHours = 12;
    state.growthMultiplier = 1.0;
    state.addedReplicas = 0;

    els.thresholdSlider.value = '85';
    els.thresholdValue.textContent = '85%';
    els.horizonSlider.value = '12';
    els.horizonValue.textContent = '12h';
    els.growthSlider.value = '1.0';
    els.growthValue.textContent = '1.0x';
    els.replicaSlider.value = '0';
    els.replicaValue.textContent = '0 (3 nodes)';

    recomputeAndRender();
    showToast('Simulation sliders reset');
  });

  els.openPromptBtn.addEventListener('click', () => {
    if (!state.lastForecasts || !state.lastAnalysis) return;
    els.promptPreview.value = buildAdvisorPrompt(state.lastForecasts, state.lastAnalysis, {
      scenarioTitle: state.scenarioTitle,
      threshold: state.threshold,
      horizonHours: state.horizonHours,
      baseReplicas: BASE_REPLICAS,
      addedReplicas: state.addedReplicas,
    });
    els.promptModal.hidden = false;
  });

  els.closePromptBtn.addEventListener('click', () => {
    els.promptModal.hidden = true;
  });

  els.promptModal.addEventListener('click', (e) => {
    if (e.target === els.promptModal) els.promptModal.hidden = true;
  });

  els.copyPromptBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.promptPreview.value);
      showToast('Capacity Advisor prompt copied to clipboard');
    } catch {
      els.promptPreview.select();
      document.execCommand('copy');
      showToast('Prompt selected & copied');
    }
  });
}

async function init() {
  populateScenarioDropdown();
  wireEvents();
  await selectScenario('traffic-surge');
}

init();
