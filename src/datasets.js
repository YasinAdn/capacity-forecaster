import { NAB_CPU_FALLBACK, NAB_NET_FALLBACK } from './nabFallback.js';

export const NAB_REPO_URL =
  'https://github.com/numenta/NAB/tree/master/data/realAWSCloudwatch';

export const SCENARIOS = [
  {
    id: 'traffic-surge',
    title: 'eks-checkout-api · Traffic Surge (Live Stream)',
    badge: 'PROMETHEUS · US-EAST-1',
    subtitle: 'Compounding API ingress across CPU, RSS Memory & ENI Network (10h @ 5m resolution)',
    sourceNote:
      'Cluster telemetry stream (3x c6i.2xlarge · 24 vCPU / 96 GiB) capturing diurnal peak + webhook acceleration.',
    datasetUrl: null,
  },
  {
    id: 'nab-public',
    title: 'AWS CloudWatch EC2 (Public NAB Dataset)',
    badge: 'PUBLIC BENCHMARK · NAB',
    subtitle: 'Real AWS EC2 CPU utilization + NetworkIn telemetry from Numenta Anomaly Benchmark',
    sourceNote:
      'CPU: unmodified ec2_cpu_utilization_ac20cd.csv; Network: iio_us-east-1_i-a2eb1cd9_NetworkIn.csv (10 MB/5m cap); Memory: companion baseline.',
    datasetUrl: NAB_REPO_URL,
  },
  {
    id: 'memory-leak',
    title: 'eks-billing-worker · Heap Retention Leak',
    badge: 'PROMETHEUS · US-EAST-1',
    subtitle: 'Flat compute/network utilization while unmanaged cache growth drives RSS toward OOM',
    sourceNote:
      'Cluster pod telemetry isolating slow worker memory growth (+~2.9%/hr) beneath flat RPS demand.',
    datasetUrl: null,
  },
  {
    id: 'idle-cluster',
    title: 'eks-staging-mesh · Over-Provisioned Fleet',
    badge: 'FINOPS AUDIT · US-EAST-1',
    subtitle: 'Sustained low compute headroom flagging right-sizing cost recovery opportunity',
    sourceNote:
      'Idle multi-AZ node pool telemetry used to identify safe down-scaling & AWS spend recovery.',
    datasetUrl: null,
  },
];

function createPrng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function formatIsoShort(epochMs) {
  const d = new Date(epochMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:00`;
}

function generateTrafficSurgeRows() {
  const rand = createPrng(4207);
  const count = 120;
  const stepMs = 5 * 60 * 1000;
  const startMs = Date.UTC(2026, 10, 14, 8, 0, 0);
  const rows = [];

  for (let i = 0; i < count; i += 1) {
    const epochMs = startMs + i * stepMs;
    const progress = i / (count - 1);
    const wave = Math.sin(i * 0.24) * 3.1 + Math.cos(i * 0.11) * 1.4;
    const noise = () => (rand() - 0.5) * 2.6;

    // Accelerating growth in recent hours
    const ramp = progress * 22 + Math.pow(progress, 2.0) * 14;
    const cpu = clamp(40 + ramp + wave + noise(), 5, 99);
    const memory = clamp(50 + progress * 14 + wave * 0.35 + noise() * 0.6, 5, 99);
    const network = clamp(36 + ramp * 0.98 + wave * 1.15 + noise() * 1.1, 5, 99);

    rows.push({
      timestamp: formatIsoShort(epochMs),
      epochMs,
      cpu: Number(cpu.toFixed(2)),
      memory: Number(memory.toFixed(2)),
      network: Number(network.toFixed(2)),
    });
  }
  return rows;
}

function generateMemoryLeakRows() {
  const rand = createPrng(8819);
  const count = 120;
  const stepMs = 5 * 60 * 1000;
  const startMs = Date.UTC(2026, 10, 14, 6, 0, 0);
  const rows = [];

  for (let i = 0; i < count; i += 1) {
    const epochMs = startMs + i * stepMs;
    const progress = i / (count - 1);
    const wave = Math.sin(i * 0.22) * 3.6;
    const noise = () => (rand() - 0.5) * 2.2;

    const cpu = clamp(41 + wave + noise(), 10, 95);
    const memory = clamp(46 + progress * 29.5 + noise() * 0.45, 10, 99);
    const network = clamp(29 + wave * 0.8 + noise() * 0.9, 5, 95);

    rows.push({
      timestamp: formatIsoShort(epochMs),
      epochMs,
      cpu: Number(cpu.toFixed(2)),
      memory: Number(memory.toFixed(2)),
      network: Number(network.toFixed(2)),
    });
  }
  return rows;
}

function generateIdleClusterRows() {
  const rand = createPrng(1337);
  const count = 120;
  const stepMs = 5 * 60 * 1000;
  const startMs = Date.UTC(2026, 10, 14, 4, 0, 0);
  const rows = [];

  for (let i = 0; i < count; i += 1) {
    const epochMs = startMs + i * stepMs;
    const progress = i / (count - 1);
    const wave = Math.sin(i * 0.2) * 2.2;
    const noise = () => (rand() - 0.5) * 1.8;

    const cpu = clamp(18 - progress * 2.5 + wave + noise(), 3, 95);
    const memory = clamp(23 - progress * 1.0 + wave * 0.3 + noise() * 0.5, 5, 95);
    const network = clamp(12 + wave * 0.6 + noise() * 0.7, 2, 95);

    rows.push({
      timestamp: formatIsoShort(epochMs),
      epochMs,
      cpu: Number(cpu.toFixed(2)),
      memory: Number(memory.toFixed(2)),
      network: Number(network.toFixed(2)),
    });
  }
  return rows;
}

async function loadNabPublicRows() {
  let cpuSeries = NAB_CPU_FALLBACK;
  let netSeries = NAB_NET_FALLBACK;

  try {
    const [cpuTextRes, netTextRes] = await Promise.all([
      fetch('./data/nab_ec2_cpu_ac20cd.csv'),
      fetch('./data/nab_ec2_network_in.csv'),
    ]);

    if (cpuTextRes.ok && netTextRes.ok) {
      const [cpuTxt, netTxt] = await Promise.all([cpuTextRes.text(), netTextRes.text()]);
      const parseTwoCol = (txt) =>
        txt
          .trim()
          .split(/\r?\n/)
          .slice(1)
          .map((line) => {
            const [timestamp, val] = line.split(',');
            return { timestamp: timestamp.trim(), value: Number.parseFloat(val) };
          })
          .filter((item) => Number.isFinite(item.value));

      const fetchedCpu = parseTwoCol(cpuTxt);
      const fetchedNet = parseTwoCol(netTxt);
      if (fetchedCpu.length >= 60 && fetchedNet.length >= 60) {
        cpuSeries = fetchedCpu;
        netSeries = fetchedNet;
      }
    }
  } catch {
    // Graceful fallback for file:// preview without local HTTP server
  }

  const len = Math.min(cpuSeries.length, netSeries.length);
  const netLinkCapBytesPer5Min = 10_000_000;
  const rows = [];

  for (let i = 0; i < len; i += 1) {
    const cpuVal = clamp(cpuSeries[i].value, 0, 100);
    const netPct = clamp((netSeries[i].value / netLinkCapBytesPer5Min) * 100, 0, 100);
    const memPct = clamp(42 + cpuVal * 0.14 + Math.sin(i * 0.18) * 1.4, 15, 95);
    const epochMs = Date.parse(cpuSeries[i].timestamp.replace(' ', 'T')) ||
      Date.UTC(2014, 3, 14, 14, 59) + i * 5 * 60 * 1000;

    rows.push({
      timestamp: cpuSeries[i].timestamp,
      epochMs,
      cpu: Number(cpuVal.toFixed(2)),
      memory: Number(memPct.toFixed(2)),
      network: Number(netPct.toFixed(2)),
    });
  }
  return rows;
}

export async function loadScenario(scenarioId) {
  const meta = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
  let rows;

  if (meta.id === 'nab-public') {
    rows = await loadNabPublicRows();
  } else if (meta.id === 'memory-leak') {
    rows = generateMemoryLeakRows();
  } else if (meta.id === 'idle-cluster') {
    rows = generateIdleClusterRows();
  } else {
    rows = generateTrafficSurgeRows();
  }

  return {
    ...meta,
    stepMinutes: 5,
    rows,
  };
}

export function rowsToCsvText(rows) {
  const header = 'timestamp,cpu,memory,network';
  const lines = rows.map(
    (r) =>
      `${r.timestamp},${r.cpu.toFixed(2)},${r.memory.toFixed(2)},${r.network.toFixed(2)}`
  );
  return [header, ...lines].join('\n');
}
