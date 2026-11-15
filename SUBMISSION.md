# Submission Checklist

## 1. Prototype Link
- Live App (Vercel): https://capacity-forecaster.vercel.app
- GitHub Repository: https://github.com/YasinAdn/capacity-forecaster
- Pure static ES modules deployed directly with zero build step, zero API keys, and zero external sign-ups.

## 2. Public Dataset Link
- **Numenta Anomaly Benchmark (NAB)** — Real AWS CloudWatch Corpus:
  https://github.com/numenta/NAB/tree/master/data/realAWSCloudwatch

## 3. Clear Differentiation Across the 3 Concepts
1. **Capacity Forecaster (Tab 01):** Predicts **when** CPU, memory, and network will breach SLA thresholds (time-to-exhaustion + confidence intervals) using damped Holt smoothing over NAB AWS CloudWatch and mock CSV telemetry, and suggests optimizations.
2. **Zero-Downtime Architect (Tab 02):** Demonstrates **how** an AI control plane self-balances live traffic in sub-seconds (`0 dropped req/s` vs reactive round-robin outages) via chaos testing, pre-5xx canary draining, and warm standby promotion.
3. **Capacity Advisor (Tab 03):** Standalone **LLM prompt engineering workbench** translating current metric snapshots and hourly slopes into strict, guardrail-enforced JSON scaling decisions (`SCALE_OUT`, `ROLLING_RESTART_AND_PROFILE`, `EDGE_CACHE_AND_SCALE_INGRESS`, `RIGHT_SIZE_DOWN`, `HOLD`).

## 4. ~100-Word Summary
**Idea:** An interactive AIOps Reliability Suite uniting Capacity Forecaster, Zero-Downtime Architect, and Capacity Advisor in one zero-backend web app.

**Approach:** Rather than merging all concepts into one vague chart, each tab isolates its exact role. **Capacity Forecaster** uses real Numenta NAB AWS CloudWatch data and damped Holt smoothing with trailing-holdout backtesting to forecast exact saturation ETAs and FinOps savings. **Zero-Downtime Architect** proves proactive outage prevention under simulated chaos by draining degrading nodes before HTTP 5xx errors and promoting warm standbys with zero dropped requests. **Capacity Advisor** exposes a production-grade prompt template with strict SRE guardrails and deterministic JSON scaling contracts.
