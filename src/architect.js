/**
 * 02 · Zero-Downtime Architect
 * Closed-loop Envoy Mesh / ALB autonomous traffic self-balancing simulator.
 * Demonstrates sub-second telemetry sensing, pre-5xx tail-latency canary draining,
 * warm standby pool activation, and live packet-flow visualization.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

export const CHAOS_SCENARIOS = [
  {
    id: 'steady',
    label: 'Nominal Baseline',
    rps: 1200,
    degradedNode: null,
    summary: 'Steady production load balanced across 3 us-east-1 AZ hosts; iad-az4 warm standby idle.',
  },
  {
    id: 'flash-spike',
    label: 'Flash Surge (2.6x)',
    rps: 3120,
    degradedNode: null,
    summary: 'Sudden webhook + flash-sale ingress burst exceeding 3-node p99 latency envelope.',
  },
  {
    id: 'node-brownout',
    label: 'AZ-b GC Brownout',
    rps: 1650,
    degradedNode: 'node-2',
    summary: 'Host ip-10-42-2-09 (iad-az2) shows 3.1x GC pause drift & worker queue buildup pre-5xx.',
  },
  {
    id: 'double-fault',
    label: 'Surge + AZ-b Fault',
    rps: 2800,
    degradedNode: 'node-2',
    summary: 'Concurrent traffic surge while iad-az2 degrades—cascading outage resilience drill.',
  },
];

function stampLog(offsetMs, level, tag, source, text) {
  const d = new Date(Date.now() + offsetMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return { ts: `${hh}:${mm}:${ss}.${ms}Z`, level, tag, source, text };
}

/**
 * Evaluates cluster routing & availability under either AI Self-Balancing mode
 * or naive Reactive Round-Robin mode. Supports optional rpsOverride from live slider.
 */
export function evaluateArchitectState({
  mode = 'ai',
  scenarioId = 'node-brownout',
  rpsOverride = null,
}) {
  const baseScenario = CHAOS_SCENARIOS.find((s) => s.id === scenarioId) || CHAOS_SCENARIOS[0];
  const effectiveRps =
    Number.isFinite(rpsOverride) && rpsOverride > 0 ? Math.round(rpsOverride) : baseScenario.rps;
  const scenario = { ...baseScenario, rps: effectiveRps };
  const nodeCap = 950;

  const nodes = [
    { id: 'node-1', name: 'iad-az1 · 10.42.1.18', capacity: nodeCap, health: 98, status: 'healthy' },
    {
      id: 'node-2',
      name: 'iad-az2 · 10.42.2.09',
      capacity: scenario.degradedNode === 'node-2' ? 280 : nodeCap,
      health: scenario.degradedNode === 'node-2' ? 31 : 97,
      status: scenario.degradedNode === 'node-2' ? 'degraded' : 'healthy',
    },
    { id: 'node-3', name: 'iad-az3 · 10.42.3.41', capacity: nodeCap, health: 98, status: 'healthy' },
    {
      id: 'standby-4',
      name: 'iad-az4 · warm-04',
      capacity: nodeCap,
      health: 99,
      status: 'standby',
    },
  ];

  const logs = [];
  let droppedRequests = 0;
  let p99LatencyMs = 34;

  if (mode === 'reactive') {
    const perNodeRps = effectiveRps / 3;
    for (let i = 0; i < 3; i += 1) {
      const node = nodes[i];
      node.trafficPct = 33.3;
      node.rps = Math.round(perNodeRps);
      node.loadPct = Math.min(145, Math.round((node.rps / node.capacity) * 100));
      node.http5xx = 0;
      if (node.rps > node.capacity) {
        const overflow = node.rps - node.capacity;
        const dropped = Math.round(overflow * 0.45);
        droppedRequests += dropped;
        node.http5xx = dropped;
        node.status = 'overloaded';
        node.p99Ms = Math.round(68 + (node.loadPct - 95) * 11.4);
      } else {
        node.p99Ms = Math.round(28 + node.loadPct * 0.4);
      }
    }
    nodes[3].trafficPct = 0;
    nodes[3].rps = 0;
    nodes[3].loadPct = 0;
    nodes[3].http5xx = 0;
    nodes[3].p99Ms = 0;
    nodes[3].status = 'standby';

    const maxLoad = Math.max(...nodes.slice(0, 3).map((n) => n.loadPct));
    p99LatencyMs = maxLoad > 100 ? Math.round(45 + (maxLoad - 95) * 12.5) : 42;

    if (droppedRequests > 0) {
      logs.push(
        stampLog(
          -180,
          'WARN',
          'ALERT',
          'alb-ingress',
          `round_robin=33.3% upstream=${scenario.degradedNode ? '10.42.2.09(degraded)' : 'all_primaries'} queue_sat=${maxLoad}%`
        )
      );
      logs.push(
        stampLog(
          -40,
          'CRIT',
          'OUTAGE',
          'http-router',
          `status=503_OVERFLOW dropped_rps=${droppedRequests} p99_ms=${p99LatencyMs} hpa_cooldown=180s`
        )
      );
    } else {
      logs.push(
        stampLog(
          0,
          'INFO',
          'OK',
          'alb-ingress',
          `mode=round_robin rps=${effectiveRps} max_load=${maxLoad}% http_5xx=0 p99_ms=${p99LatencyMs}`
        )
      );
    }
  } else {
    const healthyPrimaries = nodes.slice(0, 3).filter((n) => n.status !== 'degraded');
    const primaryHealthyCap = healthyPrimaries.reduce((acc, n) => acc + n.capacity, 0);
    const needsStandby = effectiveRps > primaryHealthyCap * 0.78 || scenario.degradedNode !== null;

    if (needsStandby) {
      nodes[3].status = 'active';
    }

    const routingPool = nodes.filter((n) => n.status === 'healthy' || n.status === 'active');
    const degradedNodes = nodes.filter((n) => n.status === 'degraded');

    let remainingRps = effectiveRps;
    for (const d of degradedNodes) {
      const canaryRps = Math.min(80, Math.round(effectiveRps * 0.04));
      d.rps = canaryRps;
      d.trafficPct = Number(((canaryRps / effectiveRps) * 100).toFixed(1));
      d.loadPct = Math.round((canaryRps / d.capacity) * 100);
      d.http5xx = 0;
      d.p99Ms = 86;
      remainingRps -= canaryRps;
    }

    const totalPoolCap = routingPool.reduce((acc, n) => acc + n.capacity, 0);
    for (const n of routingPool) {
      const share = n.capacity / totalPoolCap;
      n.rps = Math.round(remainingRps * share);
      n.trafficPct = Number(((n.rps / effectiveRps) * 100).toFixed(1));
      n.loadPct = Math.round((n.rps / n.capacity) * 100);
      if (n.rps > n.capacity) {
        const overflowDrop = Math.round((n.rps - n.capacity) * 0.2);
        droppedRequests += overflowDrop;
        n.http5xx = overflowDrop;
        n.p99Ms = Math.round(48 + (n.loadPct - 95) * 4.5);
      } else {
        n.http5xx = 0;
        n.p99Ms = Math.round(24 + n.loadPct * 0.34);
      }
    }

    if (nodes[3].status === 'standby') {
      nodes[3].trafficPct = 0;
      nodes[3].rps = 0;
      nodes[3].loadPct = 0;
      nodes[3].http5xx = 0;
      nodes[3].p99Ms = 0;
    }

    const maxHealthyLoad = Math.max(...routingPool.map((n) => n.loadPct));
    p99LatencyMs = Math.round(28 + maxHealthyLoad * 0.32);

    if (scenario.degradedNode) {
      logs.push(
        stampLog(
          -240,
          'WARN',
          'AI SENSE',
          'mesh-ewma',
          'host=10.42.2.09 gc_pause_ms=164 queue_vel=3.1x -> pre_5xx_anomaly=true'
        )
      );
      logs.push(
        stampLog(
          -120,
          'INFO',
          'DRAIN',
          'envoy-ctrl',
          `host=10.42.2.09 weight=33.3%->${nodes[1].trafficPct}% mode=CANARY_ISOLATED http_5xx=0`
        )
      );
    }
    if (needsStandby) {
      logs.push(
        stampLog(
          -30,
          'WARN',
          'PRE-WARM',
          'pool-mgr',
          `promoted=iad-az4/warm-04 pool_peak=${maxHealthyLoad}% p99_ms=${p99LatencyMs} drops=${droppedRequests}`
        )
      );
    }
    if (!scenario.degradedNode && !needsStandby) {
      logs.push(
        stampLog(
          0,
          'INFO',
          'BALANCED',
          'envoy-ctrl',
          `weighted_ewma=active active_nodes=3 rps=${effectiveRps} max_load=${maxHealthyLoad}% p99_ms=${p99LatencyMs}`
        )
      );
    }
  }

  const availabilityPct =
    droppedRequests === 0
      ? 100
      : Number((100 - (droppedRequests / Math.max(1, effectiveRps)) * 100).toFixed(2));

  return {
    mode,
    scenario,
    nodes,
    droppedRequests,
    availabilityPct,
    p99LatencyMs,
    logs,
  };
}

export function renderArchitectTopology(container, simState) {
  container.innerHTML = '';
  const width = 780;
  const height = 296;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'topology-svg',
    role: 'img',
    'aria-label': 'Envoy mesh adaptive load balancing topology diagram',
  });

  // Subtle hardware grid backdrop
  for (let gx = 40; gx < width; gx += 40) {
    svg.appendChild(
      svgEl('line', {
        x1: gx,
        y1: 0,
        x2: gx,
        y2: height,
        stroke: 'rgba(255,255,255,0.025)',
        'stroke-width': 1,
      })
    );
  }
  for (let gy = 40; gy < height; gy += 40) {
    svg.appendChild(
      svgEl('line', {
        x1: 0,
        y1: gy,
        x2: width,
        y2: gy,
        stroke: 'rgba(255,255,255,0.025)',
        'stroke-width': 1,
      })
    );
  }

  const ingress = { x: 86, y: 148 };
  const router = { x: 274, y: 148 };
  const nodePositions = [
    { x: 598, y: 42 },
    { x: 598, y: 112 },
    { x: 598, y: 182 },
    { x: 598, y: 252 },
  ];

  // Animated Ingress -> Router link
  const ingressPath = svgEl('line', {
    x1: ingress.x + 62,
    y1: ingress.y,
    x2: router.x - 84,
    y2: router.y,
    stroke: simState.droppedRequests > 0 ? '#f43f5e' : '#10b981',
    'stroke-width': 3,
    'stroke-dasharray': '8 6',
    class: 'topo-flow topo-flow-fast',
  });
  svg.appendChild(ingressPath);

  // Router -> 4 Worker Nodes
  simState.nodes.forEach((node, idx) => {
    const pos = nodePositions[idx];
    const isActive = node.trafficPct > 0;
    const isDanger = node.status === 'overloaded' || node.status === 'degraded';
    const strokeColor = !isActive
      ? 'rgba(255,255,255,0.12)'
      : isDanger
      ? '#f43f5e'
      : node.status === 'active'
      ? '#f59e0b'
      : '#10b981';

    const strokeW = isActive ? Math.max(1.8, (node.trafficPct / 35) * 3.2) : 1.2;
    const flowClass = !isActive
      ? ''
      : node.trafficPct < 10
      ? 'topo-flow topo-flow-slow'
      : 'topo-flow topo-flow-fast';

    const pathD = `M ${router.x + 84} ${router.y} C ${(router.x + pos.x - 40) / 2} ${router.y}, ${(router.x + pos.x - 40) / 2} ${pos.y}, ${pos.x - 134} ${pos.y}`;

    // Dim static underlay wire
    svg.appendChild(
      svgEl('path', {
        d: pathD,
        fill: 'none',
        stroke: isActive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)',
        'stroke-width': strokeW.toFixed(1),
      })
    );

    // Animated traffic stream
    svg.appendChild(
      svgEl('path', {
        d: pathD,
        fill: 'none',
        stroke: strokeColor,
        'stroke-width': strokeW.toFixed(1),
        'stroke-dasharray': isActive ? '7 7' : '3 5',
        class: flowClass,
        opacity: isActive ? '0.94' : '0.4',
      })
    );

    // Weight pill on link
    const midX = 414;
    const midY = pos.y + (router.y - pos.y) * 0.16;
    svg.appendChild(
      svgEl('rect', {
        x: midX - 25,
        y: midY - 10,
        width: 50,
        height: 19,
        rx: 5,
        fill: '#0b0b0e',
        stroke: strokeColor,
        'stroke-width': 1,
      })
    );
    const pctText = svgEl('text', {
      x: midX,
      y: midY + 3,
      'text-anchor': 'middle',
      class: 'topo-weight-text',
    });
    pctText.textContent = `${node.trafficPct}%`;
    svg.appendChild(pctText);
  });

  // Ingress Box
  drawHeaderBox(svg, ingress.x, ingress.y, 124, 78, '#141418', 'rgba(255,255,255,0.2)', '#10b981', [
    { text: 'ALB · PROD-IAD', cls: 'topo-kicker' },
    { text: `${simState.scenario.rps} req/s`, cls: 'topo-title' },
    { text: 'TLS 1.3 · Ingress', cls: 'topo-node-sub' },
  ]);

  // Controller Box
  const routerAccent = simState.mode === 'ai' ? '#10b981' : '#f59e0b';
  drawHeaderBox(svg, router.x, router.y, 168, 86, '#121216', routerAccent, routerAccent, [
    { text: simState.mode === 'ai' ? 'ENVOY ADAPTIVE MESH' : 'STATIC ROUND-ROBIN', cls: 'topo-kicker-accent' },
    { text: simState.mode === 'ai' ? 'EWMA Pre-5xx LB' : 'Naive 3-Way Split', cls: 'topo-title' },
    {
      text: simState.mode === 'ai' ? '500ms Outlier Drain' : '3m HPA Lag Window',
      cls: 'topo-node-sub',
    },
  ]);

  // Worker Rack Cards with Live Load Bars & LED Dots
  simState.nodes.forEach((node, idx) => {
    const pos = nodePositions[idx];
    const w = 268;
    const h = 54;
    const x = pos.x - w / 2;
    const y = pos.y - h / 2;

    const border =
      node.status === 'overloaded' || node.status === 'degraded'
        ? '#f43f5e'
        : node.status === 'active'
        ? '#f59e0b'
        : node.status === 'standby'
        ? 'rgba(255,255,255,0.14)'
        : '#10b981';

    const ledColor =
      node.status === 'overloaded' || node.status === 'degraded'
        ? '#f43f5e'
        : node.status === 'active'
        ? '#f59e0b'
        : node.status === 'standby'
        ? '#52525b'
        : '#10b981';

    svg.appendChild(
      svgEl('rect', {
        x,
        y,
        width: w,
        height: h,
        rx: 8,
        fill: '#111115',
        stroke: border,
        'stroke-width': 1.4,
      })
    );

    // Status LED
    svg.appendChild(
      svgEl('circle', {
        cx: x + 15,
        cy: y + 17,
        r: 4,
        fill: ledColor,
        class: node.status !== 'standby' ? 'topo-led-pulse' : '',
      })
    );

    // Host AZ / Private IP
    const hostTitle = svgEl('text', {
      x: x + 26,
      y: y + 20,
      'text-anchor': 'start',
      class: 'topo-node-name',
    });
    hostTitle.textContent = node.name;
    svg.appendChild(hostTitle);

    // Right status chip
    const tagTxt = svgEl('text', {
      x: x + w - 10,
      y: y + 20,
      'text-anchor': 'end',
      fill: ledColor,
      class: 'topo-kicker',
    });
    tagTxt.textContent =
      node.status === 'standby'
        ? 'IDLE RESERVE'
        : node.http5xx > 0
        ? `DROP ${node.http5xx}/s`
        : node.status === 'degraded'
        ? 'CANARY 4%'
        : node.status === 'active'
        ? 'PROMOTED'
        : 'HEALTHY';
    svg.appendChild(tagTxt);

    // Sub telemetry line
    const sub = svgEl('text', {
      x: x + 12,
      y: y + 36,
      'text-anchor': 'start',
      class: 'topo-node-sub',
    });
    sub.textContent =
      node.status === 'standby'
        ? '0 req/s · pre-warmed container snapshot ready'
        : `${node.rps} req/s · p99 ${node.p99Ms}ms · load ${node.loadPct}%`;
    svg.appendChild(sub);

    // Inline hardware load bar along bottom edge
    const barW = w - 24;
    const fillRatio = Math.min(1, Math.max(0, node.loadPct / 100));
    svg.appendChild(
      svgEl('rect', {
        x: x + 12,
        y: y + h - 9,
        width: barW,
        height: 4,
        rx: 2,
        fill: 'rgba(255,255,255,0.08)',
      })
    );
    if (fillRatio > 0) {
      svg.appendChild(
        svgEl('rect', {
          x: x + 12,
          y: y + h - 9,
          width: (barW * fillRatio).toFixed(1),
          height: 4,
          rx: 2,
          fill: node.loadPct > 95 ? '#f43f5e' : node.loadPct > 78 ? '#f59e0b' : '#10b981',
        })
      );
    }
  });

  container.appendChild(svg);
}

function drawHeaderBox(svg, cx, cy, w, h, fill, stroke, ledColor, lines) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  svg.appendChild(
    svgEl('rect', {
      x,
      y,
      width: w,
      height: h,
      rx: 8,
      fill,
      stroke,
      'stroke-width': 1.5,
    })
  );
  svg.appendChild(
    svgEl('circle', {
      cx: x + w - 10,
      cy: y + 10,
      r: 3.5,
      fill: ledColor,
      class: 'topo-led-pulse',
    })
  );
  lines.forEach((line, idx) => {
    const t = svgEl('text', {
      x: cx,
      y: y + 25 + idx * 19,
      'text-anchor': 'middle',
      class: line.cls,
    });
    t.textContent = line.text;
    svg.appendChild(t);
  });
}
