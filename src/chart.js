/**
 * Pure SVG Time-Series Forecast Chart & Mini-Sparkline Renderer.
 * Zero external dependencies so Vercel deployments load reliably offline or online.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

const METRIC_COLORS = {
  cpu: { line: '#38bdf8', area: 'rgba(56, 189, 248, 0.16)', forecast: '#fbbf24' },
  memory: { line: '#a78bfa', area: 'rgba(167, 139, 250, 0.16)', forecast: '#fb7185' },
  network: { line: '#34d399', area: 'rgba(52, 211, 153, 0.16)', forecast: '#fbbf24' },
};

export function renderMainChart(container, tooltipEl, config) {
  const { metricKey, metricLabel, historical, forecastResult, threshold } = config;
  const palette = METRIC_COLORS[metricKey] || METRIC_COLORS.cpu;
  const forecast = forecastResult.forecast;
  const breach = forecastResult.breach;

  container.innerHTML = '';

  const width = 880;
  const height = 340;
  const pad = { top: 24, right: 24, bottom: 38, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const totalCount = historical.length + forecast.length;
  const xAt = (idx) => pad.left + (idx / Math.max(1, totalCount - 1)) * plotW;
  const yAt = (pct) => pad.top + (1 - Math.max(0, Math.min(100, pct)) / 100) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'forecast-svg',
    role: 'img',
    'aria-label': `${metricLabel} historical utilization and forecast chart`,
  });

  // Gradient definitions
  const defs = svgEl('defs');
  const histGrad = svgEl('linearGradient', { id: 'histAreaGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
  histGrad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': palette.line, 'stop-opacity': '0.26' }));
  histGrad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': palette.line, 'stop-opacity': '0.0' }));
  defs.appendChild(histGrad);
  svg.appendChild(defs);

  // Danger zone above threshold
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

  // Horizontal Y gridlines
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = yAt(pct);
    svg.appendChild(
      svgEl('line', {
        x1: pad.left,
        y1: y,
        x2: width - pad.right,
        y2: y,
        stroke: 'rgba(148, 163, 184, 0.14)',
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

  // Combined points list for unified indexing & tooltips
  const combined = [
    ...historical.map((pt, i) => ({
      idx: i,
      kind: 'observed',
      timestamp: pt.timestamp,
      value: pt.value,
      lower: null,
      upper: null,
    })),
    ...forecast.map((pt, j) => ({
      idx: historical.length + j,
      kind: 'forecast',
      timestamp: pt.timestamp,
      value: pt.yhat,
      lower: pt.lower,
      upper: pt.upper,
    })),
  ];

  // X-axis sparse tick labels
  const tickStep = Math.max(1, Math.floor(totalCount / 6));
  for (let i = 0; i < combined.length; i += tickStep) {
    const x = xAt(i);
    const lbl = svgEl('text', {
      x,
      y: height - 12,
      'text-anchor': 'middle',
      class: 'chart-axis-text',
    });
    lbl.textContent = shortAxisTime(combined[i].timestamp);
    svg.appendChild(lbl);
  }

  // NOW divider line
  const nowIdx = historical.length - 1;
  const nowX = xAt(nowIdx);
  svg.appendChild(
    svgEl('line', {
      x1: nowX,
      y1: pad.top,
      x2: nowX,
      y2: height - pad.bottom,
      stroke: 'rgba(226, 232, 240, 0.35)',
      'stroke-dasharray': '3 4',
      'stroke-width': 1.2,
    })
  );
  const nowLbl = svgEl('text', {
    x: nowX,
    y: pad.top - 7,
    'text-anchor': 'middle',
    class: 'chart-now-label',
  });
  nowLbl.textContent = 'NOW';
  svg.appendChild(nowLbl);

  // 95% Confidence Band polygon (starting from last observed point)
  if (forecast.length > 0) {
    const lastHist = historical[historical.length - 1];
    const upperPts = [`${xAt(nowIdx).toFixed(1)},${yAt(lastHist.value).toFixed(1)}`];
    const lowerPts = [];

    for (let j = 0; j < forecast.length; j += 1) {
      const idx = historical.length + j;
      upperPts.push(`${xAt(idx).toFixed(1)},${yAt(forecast[j].upper).toFixed(1)}`);
      lowerPts.unshift(`${xAt(idx).toFixed(1)},${yAt(forecast[j].lower).toFixed(1)}`);
    }
    lowerPts.push(`${xAt(nowIdx).toFixed(1)},${yAt(lastHist.value).toFixed(1)}`);

    svg.appendChild(
      svgEl('polygon', {
        points: [...upperPts, ...lowerPts].join(' '),
        fill: 'rgba(251, 191, 36, 0.14)',
      })
    );
  }

  // Historical area + polyline
  const histCoords = historical.map((pt, i) => `${xAt(i).toFixed(1)},${yAt(pt.value).toFixed(1)}`);
  if (histCoords.length > 1) {
    const areaPoints = [
      `${xAt(0).toFixed(1)},${yAt(0).toFixed(1)}`,
      ...histCoords,
      `${xAt(nowIdx).toFixed(1)},${yAt(0).toFixed(1)}`,
    ].join(' ');
    svg.appendChild(svgEl('polygon', { points: areaPoints, fill: 'url(#histAreaGrad)' }));
    svg.appendChild(
      svgEl('polyline', {
        points: histCoords.join(' '),
        fill: 'none',
        stroke: palette.line,
        'stroke-width': 2.4,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      })
    );
  }

  // Forecast dashed polyline
  if (forecast.length > 0) {
    const lastHist = historical[historical.length - 1];
    const fcCoords = [
      `${xAt(nowIdx).toFixed(1)},${yAt(lastHist.value).toFixed(1)}`,
      ...forecast.map((pt, j) => `${xAt(historical.length + j).toFixed(1)},${yAt(pt.yhat).toFixed(1)}`),
    ];
    const isRisky = breach.status === 'critical' || breach.status === 'breached' || breach.status === 'warning';
    svg.appendChild(
      svgEl('polyline', {
        points: fcCoords.join(' '),
        fill: 'none',
        stroke: isRisky ? '#fb7185' : palette.forecast,
        'stroke-width': 2.4,
        'stroke-dasharray': '7 4',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      })
    );
  }

  // Threshold reference line
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

  // Breach intersection marker
  if (breach.breachIndex > 0 && breach.expectedHours !== null) {
    const bIdx = historical.length + breach.breachIndex;
    const bx = xAt(bIdx);
    const by = yAt(forecast[breach.breachIndex].yhat);

    svg.appendChild(
      svgEl('circle', {
        cx: bx,
        cy: by,
        r: 8,
        fill: 'rgba(244, 63, 94, 0.24)',
      })
    );
    svg.appendChild(
      svgEl('circle', {
        cx: bx,
        cy: by,
        r: 4.5,
        fill: '#f43f5e',
        stroke: '#0f172a',
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

  // Hover crosshair + focus circle
  const hoverLine = svgEl('line', {
    x1: 0,
    y1: pad.top,
    x2: 0,
    y2: height - pad.bottom,
    stroke: 'rgba(248, 250, 252, 0.45)',
    'stroke-width': 1,
    visibility: 'hidden',
  });
  const hoverDot = svgEl('circle', {
    cx: 0,
    cy: 0,
    r: 5,
    fill: '#f8fafc',
    stroke: palette.line,
    'stroke-width': 2,
    visibility: 'hidden',
  });
  svg.appendChild(hoverLine);
  svg.appendChild(hoverDot);

  // Transparent interaction overlay
  const overlay = svgEl('rect', {
    x: pad.left,
    y: pad.top,
    width: plotW,
    height: plotH,
    fill: 'transparent',
    class: 'chart-overlay',
  });

  const handleMove = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * width;
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
    hoverDot.setAttribute('stroke', item.kind === 'forecast' ? '#fbbf24' : palette.line);
    hoverDot.setAttribute('visibility', 'visible');

    const ciLine =
      item.kind === 'forecast'
        ? `<div class="tt-ci">95% CI: ${item.lower.toFixed(1)}% – ${item.upper.toFixed(1)}%</div>`
        : '';

    tooltipEl.innerHTML = `
      <div class="tt-phase ${item.kind}">${item.kind === 'forecast' ? 'FORECAST' : 'OBSERVED'}</div>
      <div class="tt-time">${item.timestamp}</div>
      <div class="tt-val">${metricLabel}: <strong>${item.value.toFixed(1)}%</strong></div>
      ${ciLine}
    `;
    tooltipEl.hidden = false;

    const pctX = (cx / width) * 100;
    tooltipEl.style.left = pctX > 68 ? `${pctX - 24}%` : `${pctX + 2}%`;
  };

  overlay.addEventListener('pointermove', (e) => handleMove(e.clientX));
  overlay.addEventListener('pointerleave', () => {
    hoverLine.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
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
      'stroke-width': 1.8,
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
        stroke: '#fbbf24',
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
