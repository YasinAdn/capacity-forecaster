/**
 * 02 · Zero-Downtime Architect
 * Interactive AI Self-Balancing & Proactive Outage Prevention Simulator.
 * Demonstrates closed-loop telemetry sensing -> predictive anomaly weighting ->
 * graceful node draining -> warm standby activation with zero dropped requests.
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
    label: 'Normal Traffic (1.0x)',
    rps: 1200,
    degradedNode: null,
    summary: 'Balanced 3-node cluster with Standby-4 warm in reserve.',
  },
  {
    id: 'flash-spike',
    label: 'Flash Crowd Surge (2.6x)',
    rps: 3120,
    degradedNode: null,
    summary: 'Sudden 2.6x ingress burst exceeding static 3-node safe capacity.',
  },
  {
    id: 'node-brownout',
    label: 'Degrade Node-2 (GC Stall)',
    rps: 1650,
    degradedNode: 'node-2',
    summary: 'Node-2 exhibits rising p99 tail latency and thread-pool exhaustion before HTTP 5xx.',
  },
  {
    id: 'double-fault',
    label: 'Spike + Node-2 Brownout',
    rps: 2800,
    degradedNode: 'node-2',
    summary: 'Combined traffic surge while Node-2 degrades—worst-case cascading outage test.',
  },
];

/**
 * Pure simulation step evaluating cluster routing & availability under either
 * AI Self-Balancing mode or naive Reactive Round-Robin mode.
 */
export function evaluateArchitectState({ mode = 'ai', scenarioId = 'node-brownout' }) {
  const scenario = CHAOS_SCENARIOS.find((s) => s.id === scenarioId) || CHAOS_SCENARIOS[0];
  const nodeCap = 950; // Safe RPS per healthy node before tail-latency spike

  const nodes = [
    { id: 'node-1', name: 'Node-1 (iad-a)', capacity: nodeCap, health: 98, status: 'healthy' },
    {
      id: 'node-2',
      name: 'Node-2 (iad-b)',
      capacity: scenario.degradedNode === 'node-2' ? 280 : nodeCap,
      health: scenario.degradedNode === 'node-2' ? 31 : 97,
      status: scenario.degradedNode === 'node-2' ? 'degraded' : 'healthy',
    },
    { id: 'node-3', name: 'Node-3 (iad-c)', capacity: nodeCap, health: 98, status: 'healthy' },
    {
      id: 'standby-4',
      name: 'Standby-4 (Warm)',
      capacity: nodeCap,
      health: 99,
      status: 'standby',
    },
  ];

  const logs = [];
  let droppedRequests = 0;
  let p99LatencyMs = 34;

  if (mode === 'reactive') {
    // Naive round-robin keeps sending 33.3% of traffic to all 3 primary nodes
    // and leaves Standby-4 cold until after 5xx breaches occur.
    const perNodeRps = scenario.rps / 3;
    for (let i = 0; i < 3; i += 1) {
      const node = nodes[i];
      node.trafficPct = 33.3;
      node.rps = Math.round(perNodeRps);
      node.loadPct = Math.min(135, Math.round((node.rps / node.capacity) * 100));
      if (node.rps > node.capacity) {
        const overflow = node.rps - node.capacity;
        droppedRequests += Math.round(overflow * 0.45);
        node.status = 'overloaded';
      }
    }
    nodes[3].trafficPct = 0;
    nodes[3].rps = 0;
    nodes[3].loadPct = 0;
    nodes[3].status = 'standby';

    const maxLoad = Math.max(...nodes.slice(0, 3).map((n) => n.loadPct));
    p99LatencyMs = maxLoad > 100 ? Math.round(45 + (maxLoad - 95) * 12.5) : 42;

    if (droppedRequests > 0) {
      logs.push({
        tag: 'ALERT',
        text: `Static round-robin kept routing 33% traffic into ${scenario.degradedNode ? 'degraded Node-2' : 'saturated primaries'}.`,
      });
      logs.push({
        tag: 'OUTAGE',
        text: `${droppedRequests} req/s dropped (HTTP 502/504) while reactive autoscaler waits for 3-min threshold window.`,
      });
    } else {
      logs.push({ tag: 'OK', text: 'Static round-robin holding under current nominal load.' });
    }
  } else {
    // AI Self-Balancing: senses tail-latency velocity, drains degraded nodes smoothly,
    // wakes warm standby proactively when aggregate load > 72% of active capacity.
    const healthyPrimaries = nodes.slice(0, 3).filter((n) => n.status !== 'degraded');
    const primaryHealthyCap = healthyPrimaries.reduce((acc, n) => acc + n.capacity, 0);
    const needsStandby = scenario.rps > primaryHealthyCap * 0.78 || scenario.degradedNode !== null;

    if (needsStandby) {
      nodes[3].status = 'active';
    }

    const routingPool = nodes.filter((n) => n.status === 'healthy' || n.status === 'active');
    const degradedNodes = nodes.filter((n) => n.status === 'degraded');

    // Drained nodes receive 4% canary probe traffic max so recovery can be verified safely
    let remainingRps = scenario.rps;
    for (const d of degradedNodes) {
      const canaryRps = Math.min(80, Math.round(scenario.rps * 0.04));
      d.rps = canaryRps;
      d.trafficPct = Number(((canaryRps / scenario.rps) * 100).toFixed(1));
      d.loadPct = Math.round((canaryRps / d.capacity) * 100);
      remainingRps -= canaryRps;
    }

    const totalPoolCap = routingPool.reduce((acc, n) => acc + n.capacity, 0);
    for (const n of routingPool) {
      const share = n.capacity / totalPoolCap;
      n.rps = Math.round(remainingRps * share);
      n.trafficPct = Number(((n.rps / scenario.rps) * 100).toFixed(1));
      n.loadPct = Math.round((n.rps / n.capacity) * 100);
      if (n.rps > n.capacity) {
        droppedRequests += Math.round((n.rps - n.capacity) * 0.2);
      }
    }

    const maxHealthyLoad = Math.max(...routingPool.map((n) => n.loadPct));
    p99LatencyMs = Math.round(28 + maxHealthyLoad * 0.32);

    if (scenario.degradedNode) {
      logs.push({
        tag: 'AI SENSE',
        text: 'Detected Node-2 GC stall / queue-depth velocity (+3.1x baseline) before 5xx onset.',
      });
      logs.push({
        tag: 'DRAIN',
        text: 'Shifted Node-2 routing weight 33% → 4% canary and rebalanced across healthy nodes.',
      });
    }
    if (needsStandby) {
      logs.push({
        tag: 'PRE-WARM',
        text: `Promoted Standby-4 (Warm) into active pool; peak per-node load capped at ${maxHealthyLoad}%.`,
      });
    }
    if (!scenario.degradedNode && !needsStandby) {
      logs.push({
        tag: 'BALANCED',
        text: 'Weighted EWMA router holding equal headroom across 3 healthy nodes; Standby-4 idle.',
      });
    }
  }

  const availabilityPct =
    droppedRequests === 0
      ? 100
      : Number((100 - (droppedRequests / Math.max(1, scenario.rps)) * 100).toFixed(2));

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
  const width = 760;
  const height = 270;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'topology-svg',
    role: 'img',
    'aria-label': 'AI zero-downtime load balancing topology diagram',
  });

  const ingress = { x: 85, y: 135 };
  const router = { x: 270, y: 135 };
  const nodePositions = [
    { x: 560, y: 42 },
    { x: 560, y: 104 },
    { x: 560, y: 166 },
    { x: 560, y: 228 },
  ];

  // Link: Ingress -> Router
  svg.appendChild(
    svgEl('line', {
      x1: ingress.x + 56,
      y1: ingress.y,
      x2: router.x - 76,
      y2: router.y,
      stroke: '#10b981',
      'stroke-width': 3,
      'stroke-dasharray': '6 4',
    })
  );

  // Links: Router -> 4 Worker Nodes
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

    const strokeW = isActive ? Math.max(1.8, (node.trafficPct / 35) * 3.4) : 1.2;

    svg.appendChild(
      svgEl('path', {
        d: `M ${router.x + 76} ${router.y} C ${(router.x + pos.x) / 2} ${router.y}, ${(router.x + pos.x) / 2} ${pos.y}, ${pos.x - 108} ${pos.y}`,
        fill: 'none',
        stroke: strokeColor,
        'stroke-width': strokeW.toFixed(1),
        'stroke-dasharray': node.status === 'standby' ? '4 4' : 'none',
        opacity: isActive ? '0.92' : '0.45',
      })
    );

    // Weight pill on link midpoint
    const midX = 408;
    const midY = pos.y + (router.y - pos.y) * 0.2;
    const pill = svgEl('rect', {
      x: midX - 24,
      y: midY - 10,
      width: 48,
      height: 19,
      rx: 9,
      fill: '#121215',
      stroke: strokeColor,
      'stroke-width': 1,
    });
    svg.appendChild(pill);
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
  drawBox(svg, ingress.x, ingress.y, 112, 62, '#1a1a1f', 'rgba(255,255,255,0.2)', [
    { text: 'INGRESS', cls: 'topo-kicker' },
    { text: `${simState.scenario.rps} req/s`, cls: 'topo-title' },
  ]);

  // AI Router Box
  const routerAccent = simState.mode === 'ai' ? '#10b981' : '#f59e0b';
  drawBox(svg, router.x, router.y, 152, 74, '#141418', routerAccent, [
    { text: simState.mode === 'ai' ? 'AI CONTROLLER' : 'STATIC ROUTER', cls: 'topo-kicker-accent' },
    { text: simState.mode === 'ai' ? 'Proactive Balancer' : 'Naive Round-Robin', cls: 'topo-title' },
  ]);

  // Worker Node Boxes
  simState.nodes.forEach((node, idx) => {
    const pos = nodePositions[idx];
    const border =
      node.status === 'overloaded' || node.status === 'degraded'
        ? '#f43f5e'
        : node.status === 'active'
        ? '#f59e0b'
        : node.status === 'standby'
        ? 'rgba(255,255,255,0.16)'
        : '#10b981';
    const subLabel =
      node.status === 'standby'
        ? 'Warm Standby · 0 rps'
        : `${node.rps} rps · ${node.loadPct}% cap`;

    drawBox(svg, pos.x, pos.y, 216, 46, '#121215', border, [
      { text: node.name, cls: 'topo-node-name' },
      { text: subLabel, cls: 'topo-node-sub' },
    ]);
  });

  container.appendChild(svg);
}

function drawBox(svg, cx, cy, w, h, fill, stroke, lines) {
  svg.appendChild(
    svgEl('rect', {
      x: cx - w / 2,
      y: cy - h / 2,
      width: w,
      height: h,
      rx: 10,
      fill,
      stroke,
      'stroke-width': 1.5,
    })
  );
  lines.forEach((line, idx) => {
    const t = svgEl('text', {
      x: cx,
      y: cy + (idx === 0 ? -5 : 13),
      'text-anchor': 'middle',
      class: line.cls,
    });
    t.textContent = line.text;
    svg.appendChild(t);
  });
}
