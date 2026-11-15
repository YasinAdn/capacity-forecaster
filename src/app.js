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
import {
  CHAOS_SCENARIOS,
  evaluateArchitectState,
  renderArchitectTopology,
} from './architect.js';
import {
  ADVISOR_PRESETS,
  buildRemediationCommand,
  compileCapacityAdvisorPrompt,
  evaluateAdvisorDecision,
} from './advisorStudio.js';

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
  activeTab: 'forecaster',
  liveStream: true,
  archMode: 'ai',
  archScenarioId: 'node-brownout',
  archRpsOverride: null,
  advisorInputs: {
    cpu: 81,
    cpuSlope: 3.6,
    memory: 59,
    memorySlope: 0.7,
    network: 75,
    networkSlope: 3.1,
    replicas: 4,
    slaLimit: 85,
  },
};

const els = {
  scenarioSelect: document.getElementById('scenarioSelect'),
  liveStreamBtn: document.getElementById('liveStreamBtn'),
  liveStreamLabel: document.getElementById('liveStreamLabel'),
  globalLiveDot: document.getElementById('globalLiveDot'),
  opsSpendValue: document.getElementById('opsSpendValue'),
  opsUtcClock: document.getElementById('opsUtcClock'),
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

  // 3-Pillar Navigation Tabs
  tabBtnForecaster: document.getElementById('tabBtnForecaster'),
  tabBtnArchitect: document.getElementById('tabBtnArchitect'),
  tabBtnAdvisor: document.getElementById('tabBtnAdvisor'),
  panelForecaster: document.getElementById('panel-forecaster'),
  panelArchitect: document.getElementById('panel-architect'),
  panelAdvisor: document.getElementById('panel-advisor'),

  // 02 · Zero-Downtime Architect
  archModeAiBtn: document.getElementById('archModeAiBtn'),
  archModeReactiveBtn: document.getElementById('archModeReactiveBtn'),
  chaosScenarioBtns: document.getElementById('chaosScenarioBtns'),
  archRpsSlider: document.getElementById('archRpsSlider'),
  archRpsVal: document.getElementById('archRpsVal'),
  architectKpis: document.getElementById('architectKpis'),
  archScenarioSummary: document.getElementById('archScenarioSummary'),
  archStateBadge: document.getElementById('archStateBadge'),
  architectTopology: document.getElementById('architectTopology'),
  architectLogList: document.getElementById('architectLogList'),

  // 03 · Capacity Advisor Workbench
  syncFromForecasterBtn: document.getElementById('syncFromForecasterBtn'),
  advisorPresetRow: document.getElementById('advisorPresetRow'),
  advCpuSlider: document.getElementById('advCpuSlider'),
  advCpuVal: document.getElementById('advCpuVal'),
  advCpuSlopeSlider: document.getElementById('advCpuSlopeSlider'),
  advCpuSlopeVal: document.getElementById('advCpuSlopeVal'),
  advMemSlider: document.getElementById('advMemSlider'),
  advMemVal: document.getElementById('advMemVal'),
  advMemSlopeSlider: document.getElementById('advMemSlopeSlider'),
  advMemSlopeVal: document.getElementById('advMemSlopeVal'),
  advNetSlider: document.getElementById('advNetSlider'),
  advNetVal: document.getElementById('advNetVal'),
  advReplicasSlider: document.getElementById('advReplicasSlider'),
  advReplicasVal: document.getElementById('advReplicasVal'),
  advDecisionPill: document.getElementById('advDecisionPill'),
  advJsonPreview: document.getElementById('advJsonPreview'),
  copyCliBtn: document.getElementById('copyCliBtn'),
  advCliPreview: document.getElementById('advCliPreview'),
  advGuardrailsList: document.getElementById('advGuardrailsList'),
  copyStudioPromptBtn: document.getElementById('copyStudioPromptBtn'),
  advStudioPromptText: document.getElementById('advStudioPromptText'),
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

function formatHwUnits(key, pct, totalReplicas) {
  if (key === 'cpu') {
    const totalVcpu = totalReplicas * 8;
    const used = (totalVcpu * pct) / 100;
    return [`${used.toFixed(1)} / ${totalVcpu} vCPU`, `${totalReplicas}× c6i.2xlarge`];
  }
  if (key === 'memory') {
    const totalGib = totalReplicas * 32;
    const used = (totalGib * pct) / 100;
    return [`${used.toFixed(1)} / ${totalGib} GiB RSS`, `heap ${Math.round(pct * 0.88)}% alloc`];
  }
  const totalGbps = totalReplicas * 10;
  const used = (totalGbps * pct) / 100;
  return [`${used.toFixed(2)} / ${totalGbps} Gbps`, `ENI rx+tx`];
}

function isStreamableScenario() {
  return state.scenarioId !== 'nab-public' && state.scenarioId !== 'custom-csv';
}

function syncLiveStreamButton() {
  const canStream = isStreamableScenario();
  const isActive = canStream && state.liveStream;
  els.liveStreamBtn.disabled = !canStream;
  els.liveStreamBtn.classList.toggle('active', isActive);
  els.liveStreamLabel.textContent = !canStream
    ? 'STATIC TRACE'
    : isActive
    ? 'LIVE 2.5s'
    : 'PAUSED';
}

function renderHeaderMeta(analysis) {
  els.scenarioBadge.textContent = state.scenarioBadge;
  els.scenarioSubtitle.textContent = state.scenarioSubtitle;
  els.sourceNote.textContent = state.sourceNote;
  els.datasetCitationLink.href = state.datasetUrl || NAB_REPO_URL;

  const totalNodes = BASE_REPLICAS + state.addedReplicas;
  const monthlySpend = totalNodes * 216;
  els.opsSpendValue.textContent = `$${monthlySpend.toLocaleString()}/mo · ${totalNodes} nodes`;

  const sevClass = statusToClass(analysis.overallStatus);
  els.statusBadge.className = `status-pill ${sevClass}`;
  els.globalLiveDot.className = `live-dot ${sevClass === 'critical' ? 'crit' : sevClass === 'warning' ? 'warn' : ''}`;

  if (analysis.earliestBreach) {
    const eta = analysis.earliestBreach.data.breach.expectedHours;
    els.statusBadge.textContent =
      eta === 0
        ? `${analysis.overallStatus} · ${analysis.earliestBreach.label} Saturated`
        : `${analysis.overallStatus} · ${analysis.earliestBreach.label} Breach in ${eta}h`;
  } else {
    els.statusBadge.textContent = `${analysis.overallStatus} · ${analysis.signature}`;
  }
  syncLiveStreamButton();
}

function renderMetricCards(forecasts) {
  els.metricCards.innerHTML = '';
  const totalReplicas = BASE_REPLICAS + state.addedReplicas;

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
    const [hwLeft, hwRight] = formatHwUnits(m.key, fc.scaledCurrent, totalReplicas);
    const fillPct = Math.max(0, Math.min(100, fc.scaledCurrent));

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
      <div class="mc-hw-row">
        <span>${hwLeft}</span>
        <span>${hwRight}</span>
      </div>
      <div class="mc-gauge-track" aria-hidden="true">
        <div class="mc-gauge-fill" style="width:${fillPct.toFixed(1)}%;background:${m.color}"></div>
        <div class="mc-gauge-limit" style="left:${state.threshold}%"></div>
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

  els.copyPromptBtn.addEventListener('click', () =>
    copyTextToClipboard(
      els.promptPreview.value,
      els.promptPreview,
      'Capacity Advisor prompt copied to clipboard'
    )
  );

  els.liveStreamBtn.addEventListener('click', () => {
    state.liveStream = !state.liveStream;
    syncLiveStreamButton();
    showToast(state.liveStream ? 'Live 2.5s telemetry polling active' : 'Telemetry stream paused');
  });

  els.tabBtnForecaster.addEventListener('click', () => switchTab('forecaster'));
  els.tabBtnArchitect.addEventListener('click', () => switchTab('architect'));
  els.tabBtnAdvisor.addEventListener('click', () => switchTab('advisor'));

  els.archModeAiBtn.addEventListener('click', () => {
    state.archMode = 'ai';
    renderArchitect();
  });

  els.archModeReactiveBtn.addEventListener('click', () => {
    state.archMode = 'reactive';
    renderArchitect();
  });

  els.archRpsSlider.addEventListener('input', () => {
    const val = Number.parseInt(els.archRpsSlider.value, 10);
    state.archRpsOverride = val;
    renderArchitect();
  });

  for (const spec of ADV_SLIDERS) {
    els[spec.slider].addEventListener('input', () => {
      const raw = spec.isFloat
        ? Number.parseFloat(els[spec.slider].value)
        : Number.parseInt(els[spec.slider].value, 10);
      state.advisorInputs[spec.key] = raw;
      els[spec.label].textContent = spec.fmt(raw);
      renderAdvisorStudio();
    });
  }

  els.syncFromForecasterBtn.addEventListener('click', syncAdvisorFromForecaster);

  els.copyCliBtn.addEventListener('click', () =>
    copyTextToClipboard(
      els.advCliPreview.textContent,
      null,
      'Kubernetes remediation CLI copied'
    )
  );

  els.copyStudioPromptBtn.addEventListener('click', () =>
    copyTextToClipboard(
      els.advStudioPromptText.value,
      els.advStudioPromptText,
      'Engineered Capacity Advisor prompt copied'
    )
  );
}

const TAB_MAP = {
  forecaster: () => ({ btn: els.tabBtnForecaster, panel: els.panelForecaster }),
  architect: () => ({ btn: els.tabBtnArchitect, panel: els.panelArchitect }),
  advisor: () => ({ btn: els.tabBtnAdvisor, panel: els.panelAdvisor }),
};

const ADV_SLIDERS = [
  { key: 'cpu', slider: 'advCpuSlider', label: 'advCpuVal', fmt: (v) => `${v}%` },
  {
    key: 'cpuSlope',
    slider: 'advCpuSlopeSlider',
    label: 'advCpuSlopeVal',
    fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%/hr`,
    isFloat: true,
  },
  { key: 'memory', slider: 'advMemSlider', label: 'advMemVal', fmt: (v) => `${v}%` },
  {
    key: 'memorySlope',
    slider: 'advMemSlopeSlider',
    label: 'advMemSlopeVal',
    fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%/hr`,
    isFloat: true,
  },
  { key: 'network', slider: 'advNetSlider', label: 'advNetVal', fmt: (v) => `${v}%` },
  { key: 'replicas', slider: 'advReplicasSlider', label: 'advReplicasVal', fmt: (v) => `${v} nodes` },
];

const DECISION_TONE = {
  SCALE_OUT: 'warning',
  EDGE_CACHE_AND_SCALE_INGRESS: 'warning',
  ROLLING_RESTART_AND_PROFILE: 'critical',
  RIGHT_SIZE_DOWN: 'finops',
  HOLD: 'healthy',
};

async function copyTextToClipboard(text, fallbackInput, toastMsg) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(toastMsg);
  } catch {
    if (fallbackInput && typeof fallbackInput.select === 'function') {
      fallbackInput.select();
      document.execCommand('copy');
    }
    showToast(toastMsg);
  }
}

function switchTab(tabId) {
  if (!TAB_MAP[tabId]) return;
  state.activeTab = tabId;
  for (const [id, getRefs] of Object.entries(TAB_MAP)) {
    const { btn, panel } = getRefs();
    const isActive = id === tabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
    panel.hidden = !isActive;
  }
}

function renderArchitect() {
  els.archModeAiBtn.classList.toggle('active', state.archMode === 'ai');
  els.archModeReactiveBtn.classList.toggle('active', state.archMode === 'reactive');

  els.chaosScenarioBtns.innerHTML = '';
  for (const scenario of CHAOS_SCENARIOS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chaos-btn ${scenario.id === state.archScenarioId ? 'active' : ''}`;
    btn.textContent = scenario.label;
    btn.addEventListener('click', () => {
      state.archScenarioId = scenario.id;
      state.archRpsOverride = null;
      renderArchitect();
    });
    els.chaosScenarioBtns.appendChild(btn);
  }

  const sim = evaluateArchitectState({
    mode: state.archMode,
    scenarioId: state.archScenarioId,
    rpsOverride: state.archRpsOverride,
  });

  els.archRpsSlider.value = String(sim.scenario.rps);
  els.archRpsVal.textContent = `${sim.scenario.rps.toLocaleString()} req/s`;

  const zeroDowntime = sim.droppedRequests === 0;
  els.archScenarioSummary.textContent = sim.scenario.summary;
  els.archStateBadge.className = `status-pill ${zeroDowntime ? 'healthy' : 'critical'}`;
  els.archStateBadge.textContent = zeroDowntime
    ? 'ZERO DOWNTIME · 0 DROPS'
    : `OUTAGE · ${sim.droppedRequests} REQ/S DROPPED`;

  const standbyNode = sim.nodes[3];
  const kpis = [
    {
      label: 'Availability',
      value: `${sim.availabilityPct}%`,
      sub: zeroDowntime ? 'SLA 100% protected' : 'HTTP 502/504 errors',
      tone: zeroDowntime ? 'healthy' : 'critical',
    },
    {
      label: 'Dropped Requests',
      value: `${sim.droppedRequests} req/s`,
      sub: `Out of ${sim.scenario.rps} req/s ingress`,
      tone: zeroDowntime ? 'healthy' : 'critical',
    },
    {
      label: 'Tail Latency (p99)',
      value: `${sim.p99LatencyMs} ms`,
      sub: sim.p99LatencyMs <= 80 ? 'Within <100ms SLO' : 'Queue saturation spike',
      tone: sim.p99LatencyMs <= 80 ? 'healthy' : 'warning',
    },
    {
      label: 'Standby-4 Node',
      value: standbyNode.status === 'active' ? 'ACTIVE' : 'WARM RESERVE',
      sub: `${standbyNode.rps} req/s · ${standbyNode.loadPct}% cap`,
      tone: standbyNode.status === 'active' ? 'warning' : 'healthy',
    },
  ];

  els.architectKpis.innerHTML = kpis
    .map(
      (k) => `
        <div class="arch-kpi-card ${k.tone}">
          <div class="arch-kpi-label">${k.label}</div>
          <div class="arch-kpi-value">${k.value}</div>
          <div class="arch-kpi-sub">${k.sub}</div>
        </div>
      `
    )
    .join('');

  renderArchitectTopology(els.architectTopology, sim);

  els.architectLogList.innerHTML = '';
  for (const entry of sim.logs) {
    const row = document.createElement('div');
    row.className = 'arch-log-item';
    const tone =
      entry.tag === 'OUTAGE' || entry.tag === 'ALERT'
        ? 'critical'
        : entry.tag === 'DRAIN' || entry.tag === 'PRE-WARM'
        ? 'warning'
        : 'healthy';
    const tsEl = document.createElement('span');
    tsEl.className = 'arch-log-ts';
    tsEl.textContent = entry.ts || '';
    const tagEl = document.createElement('span');
    tagEl.className = `arch-log-tag ${tone}`;
    tagEl.textContent = entry.tag;
    const srcEl = document.createElement('span');
    srcEl.className = 'arch-log-src';
    srcEl.textContent = entry.source ? `[${entry.source}]` : '';
    const textEl = document.createElement('span');
    textEl.className = 'arch-log-text';
    textEl.textContent = entry.text;
    row.appendChild(tsEl);
    row.appendChild(tagEl);
    row.appendChild(srcEl);
    row.appendChild(textEl);
    els.architectLogList.appendChild(row);
  }
}

function syncAdvisorSlidersUi() {
  for (const spec of ADV_SLIDERS) {
    const val = state.advisorInputs[spec.key];
    els[spec.slider].value = String(val);
    els[spec.label].textContent = spec.fmt(val);
  }
}

function renderAdvisorStudio() {
  els.advisorPresetRow.innerHTML = '';
  const cur = state.advisorInputs;
  for (const preset of ADVISOR_PRESETS) {
    const isMatch =
      cur.cpu === preset.cpu &&
      cur.cpuSlope === preset.cpuSlope &&
      cur.memory === preset.memory &&
      cur.memorySlope === preset.memorySlope &&
      cur.network === preset.network &&
      cur.replicas === preset.replicas;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chaos-btn ${isMatch ? 'active' : ''}`;
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      state.advisorInputs = {
        cpu: preset.cpu,
        cpuSlope: preset.cpuSlope,
        memory: preset.memory,
        memorySlope: preset.memorySlope,
        network: preset.network,
        networkSlope: preset.networkSlope,
        replicas: preset.replicas,
        slaLimit: preset.slaLimit,
      };
      syncAdvisorSlidersUi();
      renderAdvisorStudio();
    });
    els.advisorPresetRow.appendChild(btn);
  }

  const result = evaluateAdvisorDecision(state.advisorInputs);
  els.advDecisionPill.className = `status-pill ${DECISION_TONE[result.decision] || 'warning'}`;
  els.advDecisionPill.textContent = result.decision;
  els.advJsonPreview.textContent = JSON.stringify(result, null, 2);
  els.advStudioPromptText.value = compileCapacityAdvisorPrompt(state.advisorInputs);
  els.advCliPreview.textContent = `$ ${buildRemediationCommand(result)}`;

  els.advGuardrailsList.innerHTML = '';
  for (const g of result.guardrails_passed || []) {
    const chip = document.createElement('span');
    chip.className = 'guardrail-chip';
    chip.textContent = `✓ ${g}`;
    els.advGuardrailsList.appendChild(chip);
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function formatShortIsoUtc(epochMs) {
  const d = new Date(epochMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:00`;
}

function updateUtcClock() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  els.opsUtcClock.textContent = `${hh}:${mm}:${ss} UTC`;
}

function tickLiveStream() {
  if (!state.liveStream || !isStreamableScenario() || state.activeTab !== 'forecaster') return;
  if (state.rows.length < 8) return;
  const n = state.rows.length;
  const last = state.rows[n - 1];
  const anchor = state.rows[n - 7];
  const nextEpoch = (last.epochMs || Date.now()) + state.stepMinutes * 60 * 1000;
  const phase = (tickLiveStream._tick = (tickLiveStream._tick || 0) + 1);
  const flicker = Math.sin(phase * 0.95) * 0.18;
  const nextVal = (key, mult = 1) => {
    const vel = clamp(last[key] - anchor[key], -3, 3) / 18;
    return Number(clamp(last[key] + vel + flicker * mult, 5, 98.5).toFixed(2));
  };
  state.rows = [
    ...state.rows.slice(1),
    {
      timestamp: formatShortIsoUtc(nextEpoch),
      epochMs: nextEpoch,
      cpu: nextVal('cpu', 1),
      memory: nextVal('memory', 0.35),
      network: nextVal('network', 1.1),
    },
  ];
  recomputeAndRender();
}

function syncAdvisorFromForecaster() {
  if (!state.lastForecasts) return;
  const { cpu, memory, network } = state.lastForecasts;
  state.advisorInputs = {
    cpu: clamp(Math.round(cpu.scaledCurrent), 5, 99),
    cpuSlope: clamp(Number(cpu.slopePerHour.toFixed(1)), -2, 8),
    memory: clamp(Math.round(memory.scaledCurrent), 5, 99),
    memorySlope: clamp(Number(memory.slopePerHour.toFixed(1)), -2, 8),
    network: clamp(Math.round(network.scaledCurrent), 5, 99),
    networkSlope: clamp(Number(network.slopePerHour.toFixed(1)), -2, 8),
    replicas: clamp(BASE_REPLICAS + state.addedReplicas, 1, 12),
    slaLimit: state.threshold,
  };
  syncAdvisorSlidersUi();
  renderAdvisorStudio();
  showToast('Synced live telemetry from 01 · Capacity Forecaster');
}

async function init() {
  populateScenarioDropdown();
  wireEvents();
  updateUtcClock();
  setInterval(updateUtcClock, 1000);
  renderArchitect();
  syncAdvisorSlidersUi();
  renderAdvisorStudio();
  await selectScenario('traffic-surge');
  setInterval(tickLiveStream, 2500);
}

init();
