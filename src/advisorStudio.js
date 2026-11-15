/**
 * 03 · Capacity Advisor
 * Dedicated Prompt Engineering Workbench that interprets raw resource metrics
 * (CPU, Memory, Network, Slopes, Replicas) and enforces deterministic scaling JSON.
 */

export const ADVISOR_PRESETS = [
  {
    id: 'cpu-spike',
    label: 'Compute & Traffic Spike',
    cpu: 81,
    cpuSlope: 3.6,
    memory: 59,
    memorySlope: 0.7,
    network: 75,
    networkSlope: 3.1,
    replicas: 4,
    slaLimit: 85,
  },
  {
    id: 'mem-leak',
    label: 'Silent Memory Leak',
    cpu: 39,
    cpuSlope: 0.1,
    memory: 79,
    memorySlope: 4.2,
    network: 31,
    networkSlope: 0.2,
    replicas: 3,
    slaLimit: 85,
  },
  {
    id: 'idle-finops',
    label: 'Over-Provisioned Cluster',
    cpu: 16,
    cpuSlope: -0.3,
    memory: 23,
    memorySlope: 0.0,
    network: 11,
    networkSlope: -0.1,
    replicas: 6,
    slaLimit: 85,
  },
  {
    id: 'net-egress',
    label: 'Network Egress Bottleneck',
    cpu: 46,
    cpuSlope: 0.4,
    memory: 49,
    memorySlope: 0.2,
    network: 83,
    networkSlope: 3.4,
    replicas: 3,
    slaLimit: 85,
  },
];

export function evaluateAdvisorDecision(inputs) {
  const {
    cpu,
    cpuSlope,
    memory,
    memorySlope,
    network,
    networkSlope,
    replicas,
    slaLimit,
  } = inputs;

  const isLeak =
    memorySlope >= 1.2 &&
    memory >= slaLimit - 18 &&
    cpu < slaLimit - 18 &&
    cpuSlope < 0.8;

  const isIdle =
    cpu < 28 &&
    memory < 32 &&
    network < 25 &&
    replicas > 2 &&
    Math.max(cpuSlope, memorySlope, networkSlope) <= 0.3;

  const isNetBottleneck =
    (network >= slaLimit - 8 || (networkSlope >= 1.5 && network + networkSlope * 4 >= slaLimit)) &&
    cpu < slaLimit - 15;

  const isComputeSurge =
    cpu >= slaLimit - 8 ||
    network >= slaLimit - 8 ||
    (cpuSlope >= 1.0 && cpu + cpuSlope * 4 >= slaLimit) ||
    (networkSlope >= 1.0 && network + networkSlope * 4 >= slaLimit);

  if (isLeak) {
    return {
      decision: 'ROLLING_RESTART_AND_PROFILE',
      replica_delta: 0,
      target_replicas: replicas,
      urgency: memory >= slaLimit ? 'P0_IMMEDIATE' : 'P1_WITHIN_1H',
      root_cause: `Memory climbing +${memorySlope.toFixed(1)}%/hr toward ${slaLimit}% while CPU stays calm (${cpu}%). Adding replicas masks rather than fixes an unbounded heap/cache leak.`,
      guardrails_passed: ['avoided_ineffective_cpu_scale', 'zero_downtime_pod_drain'],
      rollback_trigger: 'Halt drain if active error rate exceeds 0.5% or healthy pod count drops below N-1.',
      confidence: 0.94,
    };
  }

  if (isNetBottleneck) {
    const delta = 1;
    return {
      decision: 'EDGE_CACHE_AND_SCALE_INGRESS',
      replica_delta: delta,
      target_replicas: replicas + delta,
      urgency: 'P1_PROACTIVE',
      root_cause: `Network utilization (${network}%, +${networkSlope.toFixed(1)}%/hr) approaching ${slaLimit}% saturation ahead of CPU (${cpu}%).`,
      guardrails_passed: ['bandwidth_offload_prioritized', 'min_20pct_headroom'],
      rollback_trigger: 'Revert ingress compression/tier change if p95 handshake latency increases >25ms.',
      confidence: 0.91,
    };
  }

  if (isComputeSurge) {
    const peakMetric = Math.max(cpu + cpuSlope * 3, network + networkSlope * 3);
    const targetCeiling = Math.max(45, slaLimit - 12);
    const neededTotal = Math.max(replicas + 1, Math.ceil((replicas * peakMetric) / targetCeiling));
    const delta = Math.min(6, neededTotal - replicas);
    return {
      decision: 'SCALE_OUT',
      replica_delta: delta,
      target_replicas: replicas + delta,
      urgency: cpu >= slaLimit || network >= slaLimit ? 'P0_IMMEDIATE' : 'P1_PROACTIVE',
      root_cause: `Correlated load surge (CPU ${cpu}% at +${cpuSlope.toFixed(1)}%/hr, Network ${network}% at +${networkSlope.toFixed(1)}%/hr) projected to breach ${slaLimit}% SLA.`,
      guardrails_passed: ['cooldown_respected', 'max_step_cap_6', 'target_headroom_maintained'],
      rollback_trigger: 'Scale back 1 node after 30 mins if p95 CPU stays <40% and queue depth returns to 0.',
      confidence: 0.93,
    };
  }

  if (isIdle) {
    const delta = -Math.max(1, Math.floor(replicas * 0.33));
    return {
      decision: 'RIGHT_SIZE_DOWN',
      replica_delta: delta,
      target_replicas: Math.max(2, replicas + delta),
      urgency: 'P2_FINOPS',
      root_cause: `Cluster significantly over-provisioned (CPU ${cpu}%, Memory ${memory}%, Network ${network}%) with flat/negative slopes.`,
      guardrails_passed: ['min_ha_floor_2_nodes', '40pct_burst_buffer_preserved'],
      rollback_trigger: 'Immediately restore removed node if CPU >65% or p99 latency rises >20% for 2 consecutive mins.',
      confidence: 0.9,
    };
  }

  return {
    decision: 'HOLD',
    replica_delta: 0,
    target_replicas: replicas,
    urgency: 'P3_NOMINAL',
    root_cause: `All resource metrics (CPU ${cpu}%, Memory ${memory}%, Network ${network}%) operate safely below ${slaLimit}% SLA limit.`,
    guardrails_passed: ['anti_flapping_no_op'],
    rollback_trigger: 'None required; continue 5-minute slope monitoring.',
    confidence: 0.95,
  };
}

export function buildRemediationCommand(result) {
  switch (result.decision) {
    case 'ROLLING_RESTART_AND_PROFILE':
      return `kubectl rollout restart deploy/checkout-api -n prod && kubectl top pods -n prod --sort-by=memory`;
    case 'EDGE_CACHE_AND_SCALE_INGRESS':
      return `kubectl patch hpa ingress-gw -n prod --patch '{"spec":{"minReplicas":${result.target_replicas}}}' && aws cloudfront create-invalidation --paths "/api/v2/catalog*"`;
    case 'SCALE_OUT':
      return `kubectl scale deploy/checkout-api -n prod --replicas=${result.target_replicas} && kubectl rollout status deploy/checkout-api -n prod`;
    case 'RIGHT_SIZE_DOWN':
      return `kubectl scale deploy/checkout-api -n prod --replicas=${result.target_replicas} # Preserves >=2 HA quorum`;
    default:
      return `# HOLD (${result.target_replicas} replicas active) — all signals inside SLA headroom`;
  }
}

export function compileCapacityAdvisorPrompt(inputs) {
  const payload = {
    cluster_replicas: inputs.replicas,
    sla_threshold_pct: inputs.slaLimit,
    telemetry: {
      cpu_pct: inputs.cpu,
      cpu_slope_pct_per_hr: inputs.cpuSlope,
      memory_pct: inputs.memory,
      memory_slope_pct_per_hr: inputs.memorySlope,
      network_pct: inputs.network,
      network_slope_pct_per_hr: inputs.networkSlope,
    },
  };

  return `# SYSTEM ROLE
You are a Principal SRE & FinOps Capacity Advisor. Interpret the infrastructure telemetry snapshot below and output a deterministic, zero-downtime scaling recommendation.

# SAFETY GUARDRAILS
1. Never recommend adding CPU replicas to fix a pure memory leak (rising memory with flat CPU).
2. Always preserve a High-Availability minimum of 2 replicas when downsizing idle clusters.
3. Account for hourly slope velocity—act proactively before hitting sla_threshold_pct.
4. Cap single scale-out increments at +6 nodes and specify an explicit rollback trigger.

# INPUT METRIC SNAPSHOT
\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

# DECISION RUBRIC
- SCALE_OUT: CPU or Network is near/above SLA or rising steeply toward breach.
- ROLLING_RESTART_AND_PROFILE: Memory climbs >=1.2%/hr toward SLA while CPU stays calm.
- EDGE_CACHE_AND_SCALE_INGRESS: Network bottlenecks ahead of CPU/Memory.
- RIGHT_SIZE_DOWN: All metrics stay <32% with flat/declining demand and replicas > 2.
- HOLD: Healthy headroom with no approaching threshold breach.

# REQUIRED OUTPUT FORMAT (STRICT JSON ONLY)
Return valid JSON matching this schema with no extra prose:
{
  "decision": "SCALE_OUT | ROLLING_RESTART_AND_PROFILE | EDGE_CACHE_AND_SCALE_INGRESS | RIGHT_SIZE_DOWN | HOLD",
  "replica_delta": <integer>,
  "target_replicas": <integer>,
  "urgency": "P0_IMMEDIATE | P1_PROACTIVE | P1_WITHIN_1H | P2_FINOPS | P3_NOMINAL",
  "root_cause": "<concise 1-2 sentence technical diagnosis>",
  "guardrails_passed": ["<guardrail_id>"],
  "rollback_trigger": "<measurable revert condition>",
  "confidence": <0.0-1.0>
}`;
}
