/**
 * Pure SVG Time-Series Forecast Chart, Multi-Metric Comparison & Mini-Sparklines.
 * Obsidian Carbon + Amber / Tangerine / Emerald palette (zero blue/purple).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

export const METRIC_COLORS = {
  cpu: { line: '#f59e0b', area: 'rgba(245, 158, 11, 0.17)', forecast: '#fde047' },
  memory: { line: '#fb923c', area: 'rgba(251, 146, 60, 0.17)', forecast: '#fb7185' },
  network: { line: '#10b981', area: 'rgba(16, 185, 129, 0.17)', forecast: '#6ee7b7' },
};

function setupSvgFrame(width, height, pad, threshold, totalCount, timestamps) {
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xAt = (idx) => pad.left + (idx / Math.max(1, totalCount - 1)) * plotW;
  const yAt = (pct) => pad.top + (1 - Math.max(0, Math.min(100, pct)) / 100) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'forecast-svg',
    role: 'img',
    'aria-label': 'Resource utilization historical and forecast chart',
  });

  const threshY = yAt(threshold);
  svg.appendChild(
    svgEl('rect', {
      x: pad.left,
      y: pad.top,
      width: plotW,
      height: Math.max(0, threshY - pad.top),
      fill: 'rgba(244, 63, 94, 0.08)',
    })
  );

  for (const pct of [0, 25, 50, 75, 100]) {
    const y = yAt(pct);
    svg.appendChild(
      svgEl('line', {
        x1: pad.left,
        y1: y,
        x2: width - pad.right,
        y2: y,
        stroke: 'rgba(255, 255, 255, 0.08)',
        'stroke-width': 1,
      })
    );
    const label = svgEl('text', {
      x: pad.left - 10,
      y: y + 4,
      'text-anchor': 'end',
      class: 'chart-axis-text',
    });
    label.textContent = `${pct}%`;
    svg.appendChild(label);
  }

  const tickStep = Math.max(1, Math.floor(totalCount / 6));
  for (let i = 0; i < timestamps.length; i += tickStep) {
    const lbl = svgEl('text', {
      x: xAt(i),
      y: height - 12,
      'text-anchor': 'middle',
      class: 'chart-axis-text',
    });
    lbl.textContent = shortAxisTime(timestamps[i]);
    svg.appendChild(lbl);
  }

  return { svg, plotW, plotH, xAt, yAt, threshY };
}

function appendNowAndLimit(svg, pad, width, height, nowX, threshY, threshold) {
  svg.appendChild(
    svgEl('line', {
      x1: nowX,
      y1: pad.top,
      x2: nowX,
      y2: height - pad.bottom,
      stroke: 'rgba(255, 255, 255, 0.28)',
      'stroke-dasharray': '3 4',
      'stroke-width': 1.2,
    })
  );
  const nowLbl = svgEl('text', {
    x: nowX,
    y: pad.top - 8,
    'text-anchor': 'middle',
    class: 'chart-now-label',
  });
  nowLbl.textContent = 'NOW';
  svg.appendChild(nowLbl);

  svg.appendChild(
    svgEl('line', {
      x1: pad.left,
      y1: threshY,
      x2: width - pad.right,
      y2: threshY,
      stroke: '#f43f5e',
      'stroke-dasharray': '5 4',
      'stroke-width': 1.5,
    })
  );
  const threshLabel = svgEl('text', {
    x: pad.left + 8,
    y: Math.max(pad.top + 12, threshY - 6),
    'text-anchor': 'start',
    class: 'chart-threshold-label',
  });
  threshLabel.textContent = `SLA Limit ${threshold}%`;
  svg.appendChild(threshLabel);
}

export function renderMainChart(container, tooltipEl, config) {
  const { metricKey, metricLabel, historical, forecastResult, threshold } = config;
  const palette = METRIC_COLORS[metricKey] || METRIC_COLORS.cpu;
  const forecast = forecastResult.forecast;
  const breach = forecastResult.breach;
  const anomalies = forecastResult.anomalies || [];

  container.innerHTML = '';

  const width = 880;
  const height = 340;
  const pad = { top: 26, right: 24, bottom: 38, left: 48 };
  const totalCount = historical.length + forecast.length;

  const combined = [
    ...historical.map((pt, i) => ({
      idx: i,
      kind: 'observed',
      timestamp: pt.timestamp,
      value: pt.value,
      lower: null,
      upper: null,
      anomaly: anomalies.find((a) => a.index === i) || null,
    })),
    ...forecast.map((pt, j) => ({
      idx: historical.length + j,
      kind: 'forecast',
      timestamp: pt.timestamp,
      value: pt.yhat,
      lower: pt.lower,
      upper: pt.upper,
      anomaly: null,
    })),
  ];

  const { svg, plotW, plotH, xAt, yAt, threshY } = setupSvgFrame(
    width,
    height,
    pad,
    threshold,
    totalCount,
    combined.map((c) => c.timestamp)
  );

  const defs = svgEl('defs');
  const histGrad = svgEl('linearGradient', { id: 'histAreaGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
  histGrad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': palette.line, 'stop-opacity': '0.28' }));
  histGrad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': palette.line, 'stop-opacity': '0.0' }));
  defs.appendChild(histGrad);
  svg.appendChild(defs);

  const nowIdx = historical.length - 1;
  const nowX = xAt(nowIdx);

  if (forecast.length > 0) {
    const lastHist = historical[historical.length - 1];
    const upperPts = [`${nowX.toFixed(1)},${yAt(lastHist.value).toFixed(1)}`];
    const lowerPts = [];

    for (let j = 0; j < forecast.length; j += 1) {
      const idx = historical.length + j;
      upperPts.push(`${xAt(idx).toFixed(1)},${yAt(forecast[j].upper).toFixed(1)}`);
      lowerPts.unshift(`${xAt(idx).toFixed(1)},${yAt(forecast[j].lower).toFixed(1)}`);
    }
    lowerPts.push(`${nowX.toFixed(1)},${yAt(lastHist.value).toFixed(1)}`);

    svg.appendChild(
      svgEl('polygon', {
        points: [...upperPts, ...lowerPts].join(' '),
        fill: 'rgba(250, 204, 21, 0.13)',
      })
    );
  }

  const histCoords = historical.map((pt, i) => `${xAt(i).toFixed(1)},${yAt(pt.value).toFixed(1)}`);
  if (histCoords.length > 1) {
    const areaPoints = [
      `${xAt(0).toFixed(1)},${yAt(0).toFixed(1)}`,
      ...histCoords,
      `${nowX.toFixed(1)},${yAt(0).toFixed(1)}`,
    ].join(' ');
    svg.appendChild(svgEl('polygon', { points: areaPoints, fill: 'url(#histAreaGrad)' }));
    svg.appendChild(
      svgEl('polyline', {
        points: histCoords.join(' '),
        fill: 'none',
        stroke: palette.line,
        'stroke-width': 2.5,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      })
    );
  }

  // Historical anomaly markers
  for (const anom of anomalies) {
    const ax = xAt(anom.index);
    const ay = yAt(anom.value);
    svg.appendChild(
      svgEl('circle', {
        cx: ax,
        cy: ay,
        r: 5.5,
        fill: 'rgba(244, 63, 94, 0.18)',
        stroke: '#fb7185',
        'stroke-width': 1.5,
      })
    );
  }

  if (forecast.length > 0) {
    const lastHist = historical[historical.length - 1];
    const fcCoords = [
      `${nowX.toFixed(1)},${yAt(lastHist.value).toFixed(1)}`,
      ...forecast.map((pt, j) => `${xAt(historical.length + j).toFixed(1)},${yAt(pt.yhat).toFixed(1)}`),
    ];
    const isRisky = breach.status === 'critical' || breach.status === 'breached' || breach.status === 'warning';
    svg.appendChild(
      svgEl('polyline', {
        points: fcCoords.join(' '),
        fill: 'none',
        stroke: isRisky ? '#fb7185' : palette.forecast,
        'stroke-width': 2.5,
        'stroke-dasharray': '7 4',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      })
    );
  }

  appendNowAndLimit(svg, pad, width, height, nowX, threshY, threshold);

  if (breach.breachIndex > 0 && breach.expectedHours !== null) {
    const bIdx = historical.length + breach.breachIndex;
    const bx = xAt(bIdx);
    const by = yAt(forecast[breach.breachIndex].yhat);

    svg.appendChild(svgEl('circle', { cx: bx, cy: by, r: 8.5, fill: 'rgba(244, 63, 94, 0.24)' }));
    svg.appendChild(
      svgEl('circle', {
        cx: bx,
        cy: by,
        r: 4.5,
        fill: '#f43f5e',
        stroke: '#0a0a0c',
        'stroke-width': 1.5,
      })
    );
    const tag = svgEl('text', {
      x: Math.min(width - pad.right - 4, Math.max(pad.left + 60, bx)),
      y: Math.max(pad.top + 14, by - 12),
      'text-anchor': bx > width - 130 ? 'end' : 'middle',
      class: 'chart-breach-label',
    });
    tag.textContent = `Breach +${breach.expectedHours}h`;
    svg.appendChild(tag);
  }

  const hoverLine = svgEl('line', {
    x1: 0,
    y1: pad.top,
    x2: 0,
    y2: height - pad.bottom,
    stroke: 'rgba(255, 255, 255, 0.4)',
    'stroke-width': 1,
    visibility: 'hidden',
  });
  const hoverDot = svgEl('circle', {
    cx: 0,
    cy: 0,
    r: 5,
    fill: '#fafaf9',
    stroke: palette.line,
    'stroke-width': 2,
    visibility: 'hidden',
  });
  svg.appendChild(hoverLine);
  svg.appendChild(hoverDot);

  const overlay = svgEl('rect', {
    x: pad.left,
    y: pad.top,
    width: plotW,
    height: plotH,
    fill: 'transparent',
    class: 'chart-overlay',
  });

  overlay.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const norm = Math.max(0, Math.min(1, (relX - pad.left) / plotW));
    const idx = Math.round(norm * (combined.length - 1));
    const item = combined[idx];
    if (!item) return;

    const cx = xAt(idx);
    const cy = yAt(item.value);
    hoverLine.setAttribute('x1', cx);
    hoverLine.setAttribute('x2', cx);
    hoverLine.setAttribute('visibility', 'visible');

    hoverDot.setAttribute('cx', cx);
    hoverDot.setAttribute('cy', cy);
    hoverDot.setAttribute('stroke', item.kind === 'forecast' ? '#fde047' : palette.line);
    hoverDot.setAttribute('visibility', 'visible');

    const ciLine =
      item.kind === 'forecast'
        ? `<div class="tt-ci">95% CI: ${item.lower.toFixed(1)}% – ${item.upper.toFixed(1)}%</div>`
        : '';
    const anomLine = item.anomaly
      ? `<div class="tt-anom">Anomaly Spike (Z=${item.anomaly.zScore > 0 ? '+' : ''}${item.anomaly.zScore})</div>`
      : '';

    tooltipEl.innerHTML = `
      <div class="tt-phase ${item.kind}">${item.kind === 'forecast' ? 'FORECAST' : 'OBSERVED'}</div>
      <div class="tt-time">${item.timestamp}</div>
      <div class="tt-val">${metricLabel}: <strong>${item.value.toFixed(1)}%</strong></div>
      ${ciLine}${anomLine}
    `;
    tooltipEl.hidden = false;

    const pctX = (cx / width) * 100;
    tooltipEl.style.left = pctX > 68 ? `${pctX - 24}%` : `${pctX + 2}%`;
  });

  overlay.addEventListener('pointerleave', () => {
    hoverLine.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tooltipEl.hidden = true;
  });

  svg.appendChild(overlay);
  container.appendChild(svg);
}

/**
 * Renders all 3 metrics (CPU, Memory, Network) together for side-by-side bottleneck comparison.
 */
export function renderComparisonChart(container, tooltipEl, config) {
  const { seriesList, threshold } = config;
  container.innerHTML = '';

  const first = seriesList[0];
  const width = 880;
  const height = 340;
  const pad = { top: 26, right: 24, bottom: 38, left: 48 };
  const histLen = first.historical.length;
  const fcLen = first.forecastResult.forecast.length;
  const totalCount = histLen + fcLen;

  const timestamps = [
    ...first.historical.map((h) => h.timestamp),
    ...first.forecastResult.forecast.map((f) => f.timestamp),
  ];

  const { svg, plotW, plotH, xAt, yAt, threshY } = setupSvgFrame(
    width,
    height,
    pad,
    threshold,
    totalCount,
    timestamps
  );

  const nowIdx = histLen - 1;
  const nowX = xAt(nowIdx);

  for (const s of seriesList) {
    const palette = METRIC_COLORS[s.key];
    const histPts = s.historical.map((pt, i) => `${xAt(i).toFixed(1)},${yAt(pt.value).toFixed(1)}`);
    svg.appendChild(
      svgEl('polyline', {
        points: histPts.join(' '),
        fill: 'none',
        stroke: palette.line,
        'stroke-width': 2.2,
        'stroke-linejoin': 'round',
      })
    );

    const fc = s.forecastResult.forecast;
    if (fc.length > 0) {
      const lastH = s.historical[histLen - 1];
      const fcPts = [
        `${nowX.toFixed(1)},${yAt(lastH.value).toFixed(1)}`,
        ...fc.map((pt, j) => `${xAt(histLen + j).toFixed(1)},${yAt(pt.yhat).toFixed(1)}`),
      ];
      svg.appendChild(
        svgEl('polyline', {
          points: fcPts.join(' '),
          fill: 'none',
          stroke: palette.line,
          'stroke-width': 2.1,
          'stroke-dasharray': '6 4',
          'stroke-opacity': '0.9',
        })
      );
    }

    const b = s.forecastResult.breach;
    if (b.breachIndex > 0 && b.expectedHours !== null) {
      const bx = xAt(histLen + b.breachIndex);
      const by = yAt(fc[b.breachIndex].yhat);
      svg.appendChild(
        svgEl('circle', {
          cx: bx,
          cy: by,
          r: 4.5,
          fill: palette.line,
          stroke: '#0a0a0c',
          'stroke-width': 1.5,
        })
      );
    }
  }

  appendNowAndLimit(svg, pad, width, height, nowX, threshY, threshold);

  const hoverLine = svgEl('line', {
    x1: 0,
    y1: pad.top,
    x2: 0,
    y2: height - pad.bottom,
    stroke: 'rgba(255, 255, 255, 0.4)',
    'stroke-width': 1,
    visibility: 'hidden',
  });
  svg.appendChild(hoverLine);

  const overlay = svgEl('rect', {
    x: pad.left,
    y: pad.top,
    width: plotW,
    height: plotH,
    fill: 'transparent',
    class: 'chart-overlay',
  });

  overlay.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const norm = Math.max(0, Math.min(1, (relX - pad.left) / plotW));
    const idx = Math.round(norm * (totalCount - 1));
    const isFc = idx >= histLen;
    const cx = xAt(idx);

    hoverLine.setAttribute('x1', cx);
    hoverLine.setAttribute('x2', cx);
    hoverLine.setAttribute('visibility', 'visible');

    const lines = seriesList.map((s) => {
      const val = isFc
        ? s.forecastResult.forecast[idx - histLen]?.yhat ?? 0
        : s.historical[idx]?.value ?? 0;
      const color = METRIC_COLORS[s.key].line;
      return `<div class="tt-val"><span class="tt-dot" style="background:${color}"></span>${s.shortLabel}: <strong>${val.toFixed(1)}%</strong></div>`;
    });

    tooltipEl.innerHTML = `
      <div class="tt-phase ${isFc ? 'forecast' : 'observed'}">${isFc ? 'FORECAST' : 'OBSERVED'}</div>
      <div class="tt-time">${timestamps[idx] || ''}</div>
      ${lines.join('')}
    `;
    tooltipEl.hidden = false;
    const pctX = (cx / width) * 100;
    tooltipEl.style.left = pctX > 68 ? `${pctX - 24}%` : `${pctX + 2}%`;
  });

  overlay.addEventListener('pointerleave', () => {
    hoverLine.setAttribute('visibility', 'hidden');
    tooltipEl.hidden = true;
  });

  svg.appendChild(overlay);
  container.appendChild(svg);
}

export function renderMiniSparkline(container, historicalValues, forecastValues, threshold, color) {
  container.innerHTML = '';
  const w = 180;
  const h = 44;
  const all = [...historicalValues.slice(-36), ...forecastValues.slice(0, 24)];
  if (all.length < 2) return;

  const split = Math.min(36, historicalValues.length);
  const xAt = (i) => (i / Math.max(1, all.length - 1)) * w;
  const yAt = (v) => 4 + (1 - Math.max(0, Math.min(100, v)) / 100) * (h - 8);

  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'spark-svg' });

  const ty = yAt(threshold);
  svg.appendChild(
    svgEl('line', {
      x1: 0,
      y1: ty,
      x2: w,
      y2: ty,
      stroke: 'rgba(244, 63, 94, 0.45)',
      'stroke-dasharray': '3 3',
      'stroke-width': 1,
    })
  );

  const histPts = all.slice(0, split).map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
  svg.appendChild(
    svgEl('polyline', {
      points: histPts.join(' '),
      fill: 'none',
      stroke: color,
      'stroke-width': 1.9,
    })
  );

  if (split < all.length) {
    const fcPts = all
      .slice(split - 1)
      .map((v, j) => `${xAt(split - 1 + j).toFixed(1)},${yAt(v).toFixed(1)}`);
    svg.appendChild(
      svgEl('polyline', {
        points: fcPts.join(' '),
        fill: 'none',
        stroke: '#fde047',
        'stroke-dasharray': '4 3',
        'stroke-width': 1.7,
      })
    );
  }

  container.appendChild(svg);
}

function shortAxisTime(ts) {
  const parts = String(ts).split(' ');
  return parts.length > 1 ? parts[1].slice(0, 5) : String(ts).slice(-5);
}
