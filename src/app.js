import {
  analyzeClusterCapacity,
  buildAdvisorPrompt,
  forecastSeries,
  parseCsvTelemetry,
} from './forecaster.js';
import { loadScenario, NAB_REPO_URL, rowsToCsvText, SCENARIOS } from './datasets.js';
import { renderMainChart, renderMiniSparkline } from './chart.js';

const METRICS = [
  { key: 'cpu', label: 'CPU Utilization', shortLabel: 'CPU', color: '#38bdf8' },
  { key: 'memory', label: 'Memory Utilization', shortLabel: 'Memory', color: '#a78bfa' },
  { key: 'network', label: 'Network Bandwidth', shortLabel: 'Network', color: '#34d399' },
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
  advisorSignature: document.getElementById('advisorSignature'),
  advisorSummary: document.getElementById('advisorSummary'),
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

function getScaleFactor(metricKey) {
  if (state.addedReplicas === 0) return 1.0;
  if (metricKey === 'memory') {
    return BASE_REPLICAS / (BASE_REPLICAS + state.addedReplicas * 0.6);
  }
  return BASE_REPLICAS / (BASE_REPLICAS + state.addedReplicas);
}

function recomputeAndRender() {
  if (!state.rows.length) return;

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
      scaleFactor: getScaleFactor(m.key),
    });
  }

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
  renderAdvisor(analysis);
}

function renderHeaderMeta(analysis) {
  els.scenarioBadge.textContent = state.scenarioBadge;
  els.scenarioSubtitle.textContent = state.scenarioSubtitle;
  els.sourceNote.textContent = state.sourceNote;

  const linkUrl = state.datasetUrl || NAB_REPO_URL;
  els.datasetCitationLink.href = linkUrl;

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
    const isActive = state.activeMetric === m.key;
    const breachClass = fc.breach.status;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `metric-card ${isActive ? 'active' : ''}`;
    card.setAttribute('aria-pressed', String(isActive));
    card.addEventListener('click', () => {
      state.activeMetric = m.key;
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

function renderActiveChart(forecasts) {
  const m = METRICS.find((item) => item.key === state.activeMetric) || METRICS[0];
  const fc = forecasts[m.key];
  const scale = getScaleFactor(m.key);

  els.chartTitle.textContent = `${m.label} · ${state.horizonHours}h Forecast`;

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

function renderAdvisor(analysis) {
  els.advisorSignature.className = `advisor-signature ${statusToClass(analysis.overallStatus)}`;
  els.advisorSignature.textContent = analysis.signature;
  els.advisorSummary.textContent = analysis.summary;

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
  if (breach.expectedHours !== null) {
    return `Breach in ~${breach.expectedHours}h`;
  }
  if (breach.worstCaseHours !== null) {
    return `95% CI risk ~${breach.worstCaseHours}h`;
  }
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

function wireEvents() {
  els.scenarioSelect.addEventListener('change', (e) => {
    selectScenario(e.target.value);
  });

  els.csvUpload.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
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
    } finally {
      e.target.value = '';
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
