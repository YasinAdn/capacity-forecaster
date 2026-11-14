# Submission Checklist

## 1. Prototype Link
Push `capacity-forecaster/` to GitHub and deploy directly on Vercel (no build step, no environment variables, no sign-ups required).

## 2. Public Dataset Link
- Numenta Anomaly Benchmark (NAB) — Real AWS CloudWatch Corpus:
  https://github.com/numenta/NAB/tree/master/data/realAWSCloudwatch

## 3. Summary (~97 words)
**Idea:** Capacity Forecaster is a zero-backend AIOps dashboard that predicts CPU, memory, and network saturation before outages occur and translates forecasts into scaling and cost-optimization decisions.

**Approach:** Built a static web prototype deployable on Vercel using public AWS CloudWatch telemetry (Numenta NAB) alongside simulated stress scenarios (traffic surges, memory leaks, idle clusters) and custom CSV uploads. The engine applies damped Holt linear smoothing tuned via trailing-holdout RMSE minimization to estimate exact time-to-threshold breaches with 95% confidence bands. A joint multi-metric advisor isolates root causes (distinguishing compute surges from memory leaks or over-provisioning) and generates structured scaling recommendations.
