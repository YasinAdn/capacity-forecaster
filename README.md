# Capacity Forecaster · AIOps Resource Prediction & Scaling Advisor

A zero-backend, client-side capacity forecasting and scaling advisor built for rapid deployment on **Vercel** with no external API keys or sign-ups required.

## What It Does
1. **Multi-Metric Time-Series Forecasting (`src/forecaster.js`)**
   - Forecasts **CPU**, **Memory**, and **Network** utilization over a configurable 6h–48h horizon using **Damped Holt Linear Trend Smoothing** auto-tuned via trailing-holdout **RMSE minimization**.
   - Renders historical telemetry, MAD residual anomaly spike rings, dashed forecast trajectories, **95% confidence intervals**, SLA threshold danger zones, and exact **Time-to-Threshold Breach** markers—with a toggle between **Focused** and **All 3 Metrics** comparison modes.
   - Displays live backtest accuracy (**MAE**, **RMSE**, holdout window size, tuned $\alpha/\beta$).
2. **Joint Capacity Advisor (`analyzeClusterCapacity`)**
   - Displays a **Resource Risk Matrix** comparing CPU, Memory, and Network peak forecasts against the SLA threshold, plus a **1-Click Simulate Recommended Fix** button that previews before/after headroom impact.
   - Evaluates CPU, Memory, and Network trajectories together to isolate distinct operational patterns:
     - **Memory Leak Signature** (steady CPU + climbing RAM $\rightarrow$ recommends rolling drain & heap profiling rather than blindly adding vCPUs)
     - **Compounding Compute & Network Surge** ($\rightarrow$ proactive replica pre-warming + CDN/compression offloading)
     - **Over-Provisioned FinOps Audit** ($\rightarrow$ right-sizing and cluster floor reduction)
3. **Interactive What-If Simulator & Prompt Generator**
   - Adjust **SLA Threshold**, **Forecast Horizon**, **Traffic Growth Multiplier**, and **Added Replicas** in real time.
   - Exports a pre-populated **Capacity Advisor LLM Prompt** for deeper human/AI review with zero API credentials.
4. **Public Dataset + Custom CSV Support**
   - Includes unmodified telemetry slices from the **Numenta Anomaly Benchmark (NAB)** AWS CloudWatch corpus (`data/nab_ec2_cpu_ac20cd.csv` and `data/nab_ec2_network_in.csv`), plus simulated stress-test workloads and drag-and-drop/file CSV upload (`timestamp,cpu,memory,network` or raw single-metric `timestamp,value`).

## Public Dataset Attribution
- **Numenta Anomaly Benchmark (NAB) — AWS CloudWatch Telemetry:**  
  https://github.com/numenta/NAB/tree/master/data/realAWSCloudwatch

## Deploy to Vercel (Zero Config)
1. Push this folder to a GitHub repository.
2. Open [Vercel](https://vercel.com/), click **Add New Project**, and import your GitHub repository.
3. Leave build command empty and output directory as `.` (root), then click **Deploy**.

## Local Preview
Serve the directory with any static HTTP server (required for ES modules), for example:
```bash
npx serve .
# or
python -m http.server 4173
```
Then open `http://localhost:4173` (and `http://localhost:4173/tests/test_runner.html` to run the in-browser test suite).
