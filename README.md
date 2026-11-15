# AIOps Capacity & Reliability Suite

Live Prototype: https://capacity-forecaster.vercel.app  
Source Repository: https://github.com/YasinAdn/capacity-forecaster

A zero-backend, zero-sign-up static web suite demonstrating **three clearly differentiated AIOps capabilities** in an Obsidian Carbon & Electric Emerald/Amber/Tangerine/Crimson theme (zero blue, zero purple):

| Pillar | Tab / Module | Primary Question Answered | Core Mechanism |
| :--- | :--- | :--- | :--- |
| **1. Capacity Forecaster** | `01 · Capacity Forecaster` ([src/forecaster.js](src/forecaster.js)) | **When** will CPU, Memory, or Network hit capacity limits, and **what** should be optimized? | Damped Holt linear smoothing over telemetry + trailing-holdout RMSE backtest + time-to-threshold breach ETA + "What-If" growth/replica sliders. |
| **2. Zero-Downtime Architect** | `02 · Zero-Downtime Architect` ([src/architect.js](src/architect.js)) | **How** does an AI control plane prevent live outages automatically? | Closed-loop real-time load balancer (`SENSE → SCORE → BALANCE → PREVENT`) with chaos injection, tail-latency pre-5xx draining (33% → 4% canary), and warm standby promotion. |
| **3. Capacity Advisor** | `03 · Capacity Advisor` ([src/advisorStudio.js](src/advisorStudio.js)) | **How** should an LLM prompt interpret resource snapshots into safe scaling JSON? | Interactive prompt engineering workbench embedding SRE anti-flapping guardrails, metric slope velocity, deterministic JSON schema validation, and 1-click telemetry sync from Tab 1. |

## Public Telemetry Dataset
- **Numenta Anomaly Benchmark (NAB)** — Real AWS CloudWatch Corpus:
  https://github.com/numenta/NAB/tree/master/data/realAWSCloudwatch
- Embedded real slices in `data/`: `nab_ec2_cpu_ac20cd.csv` & `nab_ec2_network_in.csv`, plus synthetic scenarios (`Traffic Surge`, `Memory Leak Signature`, `Over-Provisioned Cluster`) and drag-and-drop CSV upload.

## Run Locally & Tests
No build step or API keys required — pure ES modules served over any static HTTP server:

```powershell
# Example using Python or the local PowerShell static server on port 4173
```

Open `http://localhost:4173` for the 3-tab suite and `http://localhost:4173/tests/test_runner.html` for the automated in-browser test suite.
