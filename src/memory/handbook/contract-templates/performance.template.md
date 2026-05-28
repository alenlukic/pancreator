---
template: performance
slug: performance
stability: experimental
phase: 0b
allowed-in-milestones: [M1 (rego over telemetry JSON), M2 (+ schemathesis perf), M3+]
purpose: |
  Scaffold for performance contract clauses. Each clause MUST carry an SLI
  definition, an SLO target, a measurement window, and an error budget. M1
  gates pre-aggregated telemetry JSON via `kind: rego`. M2+ adds load-test
  runners.
references:
  - kind: lines
    path: /src/memory/handbook/contract-format.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Wrapper schema reference."
  - kind: lines
    path: /src/memory/handbook/contract-style.md
    range: [1, 1]
    contentHash: cb3f91d54eee30e53e35b2b99905f70f169ed549fd78909d3dac2defc9ed8d3b
    note: "Layer 2 (performance) requirements: SLI + SLO + window + error budget."
external:
  - https://sre.google/sre-book/service-level-objectives/
---

# Template — Performance contract

Use this template for clauses gating latency, throughput, error rate, or
resource-consumption thresholds. Each performance clause names a Service
Level Indicator, a Service Level Objective, a measurement window, and an
error budget.

## Slot map

| Slot | Required | Notes |
|---|---|---|
| `id` | yes | Reverse-DNS. Convention: `<feature>.perf.<sli>`. |
| `kind` | yes | M1: `rego` (over pre-aggregated telemetry). M2+: per-runner. |
| `severity` | yes | Latency clauses default `warn`; error-rate clauses default `block`. |
| `applies_to` | yes | Default discriminator: `pipeline-telemetry` or `run-log-event`. |
| `owner` | yes | `sre` (M4+) or `tech-lead` (M1). |
| `description` | yes | EARS, atomic, SLI-named, window-quantified. |
| `references` | yes | Cite the SLO doc and the measurement basis. |
| `runtime` | yes | Per-kind payload. |
| `metadata.daedaline.sli` | yes | The signal name. |
| `metadata.daedaline.slo` | yes | The numeric target with units. |
| `metadata.daedaline.window` | yes | The measurement window (e.g., `5-minute rolling`). |
| `metadata.daedaline.error-budget` | yes | The permitted SLI miss-rate per window. |

## M1 scaffold (`kind: rego` over telemetry JSON)

```yaml
id: <feature>.perf.checkout-p95-latency
kind: rego
severity: warn                                      # promote to block after baseline established
applies_to:
  kind: pipeline-telemetry
  pipeline: feature-delivery
  metric: checkout.latency.p95_ms
  window: per-run
owner: tech-lead
description: |
  When the `feature-delivery` pipeline runs the checkout-perf job, the
  measured `checkout.latency.p95_ms` SHALL be at most 300 ms over a 5-minute
  rolling window with no more than a 1.0 percent miss-rate per window.
references:
  - kind: lines
    path: /src/memory/features/<id>/perf-spec.md
    range: [<start>, <end>]
    contentHash: <sha256>
    note: "Checkout p95-latency SLO."
spec: /src/memory/features/<id>/contracts/checkout-p95-latency.rego
runtime:
  package: daedaline.perf.checkout
  query: data.daedaline.perf.checkout.deny
metadata:
  daedaline.contract_id: <feature>.perf.checkout-p95-latency
  daedaline.applies_to: pipeline-telemetry:feature-delivery#checkout.latency.p95_ms
  daedaline.sli: checkout.latency.p95_ms
  daedaline.slo: "300 ms"
  daedaline.window: "5-minute rolling"
  daedaline.error-budget: "1.0 percent per window"
```

Sidecar `checkout-p95-latency.rego`:

```rego
# METADATA
# title: Checkout p95 latency at most 300 ms
# description: |
#   When the `feature-delivery` pipeline runs the checkout-perf job, the
#   measured `checkout.latency.p95_ms` SHALL be at most 300 ms over a
#   5-minute rolling window with no more than a 1.0 percent miss-rate per
#   window.
# severity: warn
# references:
#   - "/src/memory/features/<id>/perf-spec.md"
# custom:
#   daedaline.contract_id: <feature>.perf.checkout-p95-latency
#   daedaline.applies_to: pipeline-telemetry:feature-delivery#checkout.latency.p95_ms
#   daedaline.sli: checkout.latency.p95_ms
#   daedaline.slo: "300 ms"
#   daedaline.window: "5-minute rolling"
#   daedaline.error-budget: "1.0 percent per window"
package daedaline.perf.checkout

import rego.v1

deny contains msg if {
  input.checkout.latency.p95_ms > 300
  msg := sprintf(
    "When the `feature-delivery` pipeline runs the checkout-perf job, the measured `checkout.latency.p95_ms` SHALL be at most 300 ms; observed %v ms.",
    [input.checkout.latency.p95_ms]
  )
}

deny contains msg if {
  input.checkout.latency.p95_miss_rate > 0.01
  msg := sprintf(
    "When the `feature-delivery` pipeline runs the checkout-perf job, the latency miss-rate SHALL be at most 1.0 percent per window; observed %v.",
    [input.checkout.latency.p95_miss_rate]
  )
}
```

## Failure-handling

Performance failures route to `tech-lead` (M1) or `sre` (M4+). The
`ContractFailure.evidence` SHALL include the offending telemetry sample and
the prior 10 windows' SLI values for trend context. Repeated breaches in
three consecutive windows escalate to `severity: block` per the audit →
soft-gate → hard-gate rollout pattern.
