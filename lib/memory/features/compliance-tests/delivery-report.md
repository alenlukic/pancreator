# Delivery Report - compliance-tests

## Summary
This slice ships the canonical compliance-test surface under `tests/compliance/`, the first-slice manual runbook, severity routing, run-template fields, and the AGENTS trigger guidance. Review is green with `review_passes: true`, the compliance audit is green with `compliance_passes: true`, and the first slice keeps scheduler automation deferred to backlog while preserving human-in-the-loop gating for high findings. 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/plan.md",
  "range": [59, 70],
  "contentHash": "d44e1d0"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md",
  "range": [1, 10],
  "contentHash": "6e4a90a"
}
```


## Architecture
- Canonical compliance descriptors and schemas live in `tests/compliance/`, and duplicate feature-contract files are removed or excluded from the implementation slice. 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/plan.md",
  "range": [59, 66],
  "contentHash": "d44e1d0"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/adr-draft.md",
  "range": [64, 80],
  "contentHash": "886e735"
}
```

- First-slice execution stays manual: operators and agents use `operator-on-demand` or `structure-change`, while `scheduled-cadence` remains backlog deferred until scheduler wiring lands. 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/plan.md",
  "range": [59, 70],
  "contentHash": "d44e1d0"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/adr-draft.md",
  "range": [70, 80],
  "contentHash": "886e735"
}
```

- Severity routing is deterministic: `high` blocks review and approval until a zero-high rerun lands, `medium` creates backlog items with escalation off by default, and `low` creates backlog items plus warning output. 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/plan.md",
  "range": [67, 70],
  "contentHash": "d44e1d0"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/adr-draft.md",
  "range": [74, 80],
  "contentHash": "886e735"
}
```

- AGENTS keeps the trigger guidance explicit for manual runs and structure-change runs, and the backlog carries the deferred automation follow-up. 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/plan.md",
  "range": [69, 70],
  "contentHash": "d44e1d0"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/adr-draft.md",
  "range": [80, 92],
  "contentHash": "886e735"
}
```


## Interfaces
- `tests/compliance/schemas/latest.yaml` and `tests/compliance/schemas/v1.yaml` define the descriptor schema envelope with required `schema_ref`, `id`, `severity`, `trigger_modes`, `scope`, and `assertion` fields. 

```json
{
  "kind": "lines",
  "path": "tests/compliance/schemas/latest.yaml",
  "range": [1, 13],
  "contentHash": "43bdbf6"
}
```
 

```json
{
  "kind": "lines",
  "path": "tests/compliance/schemas/v1.yaml",
  "range": [1, 13],
  "contentHash": "5bb7003"
}
```

- `tests/compliance/high-remediation-blocking.yaml` defines the high-severity gate contract for review and approval blocking, and the test report records the passing validation path for that descriptor. 

```json
{
  "kind": "lines",
  "path": "tests/compliance/high-remediation-blocking.yaml",
  "range": [1, 14],
  "contentHash": "d5b4d95"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [26, 30],
  "contentHash": "5f703e8"
}
```

- `tests/compliance/medium-backlog-default-off.yaml` defines medium-severity backlog creation and escalation-off default behavior, and the validation report marks it as passing. 

```json
{
  "kind": "lines",
  "path": "tests/compliance/medium-backlog-default-off.yaml",
  "range": [1, 14],
  "contentHash": "2812f02"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [26, 30],
  "contentHash": "5f703e8"
}
```

- `tests/compliance/low-warning-emission.yaml` defines low-severity backlog creation plus console and `lib/inbox/out` warning emission, and the validation report marks it as passing. 

```json
{
  "kind": "lines",
  "path": "tests/compliance/low-warning-emission.yaml",
  "range": [1, 14],
  "contentHash": "7e20ef3"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [26, 30],
  "contentHash": "5f703e8"
}
```

- `lib/memory/features/compliance-tests/manual-runbook.md` exposes the operational modes `scheduled-cadence`, `structure-change`, and `operator-on-demand`, and the runbook records the manual execution protocol. 

```json
{
  "kind": "lines",
  "path": "lib/memory/features/compliance-tests/manual-runbook.md",
  "range": [8, 53],
  "contentHash": "1a93c2a"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [17, 30],
  "contentHash": "5f703e8"
}
```

- `lib/memory/features/compliance-tests/severity-routing.md` exposes the high, medium, and low routing obligations and the deferred automation linkage. 

```json
{
  "kind": "lines",
  "path": "lib/memory/features/compliance-tests/severity-routing.md",
  "range": [1, 26],
  "contentHash": "83240f9"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [17, 30],
  "contentHash": "5f703e8"
}
```

- `lib/memory/features/compliance-tests/run-template.json` defines the run-record fields `run_timestamp`, `trigger_mode`, `test_results[].test_id`, `test_results[].outcome`, and the high-severity follow-up fields. 

```json
{
  "kind": "lines",
  "path": "lib/memory/features/compliance-tests/run-template.json",
  "range": [1, 54],
  "contentHash": "defffd1"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [10, 30],
  "contentHash": "5f703e8"
}
```

- `AGENTS.md` section 6.1 exposes the compliance-run trigger guidance for manual invocation and structure-change events. 

```json
{
  "kind": "lines",
  "path": "AGENTS.md",
  "range": [130, 141],
  "contentHash": "f2d87ec"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md",
  "range": [5, 10],
  "contentHash": "6e4a90a"
}
```


## Tradeoffs
- The slice accepts deferred scheduler automation and deferred automatic structure-change wiring so the first delivery remains manual and auditable. 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/adr-draft.md",
  "range": [80, 92],
  "contentHash": "886e735"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md",
  "range": [82, 92],
  "contentHash": "6e4a90a"
}
```

- The slice rejects duplicate compliance artifacts under `lib/memory/features/compliance-tests/contracts/` and keeps the canonical surface in `tests/compliance/` to avoid path drift. 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/plan.md",
  "range": [61, 66],
  "contentHash": "d44e1d0"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md",
  "range": [20, 38],
  "contentHash": "6e4a90a"
}
```

- The slice defers non-blocking citation refresh work, including `TBD-on-commit` content hashes, to the backlog instead of blocking delivery. 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md",
  "range": [50, 58],
  "contentHash": "6e4a90a"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/compliance-remediation.md",
  "range": [21, 26],
  "contentHash": "e2e40fb"
}
```


## Usage guidelines
- To block a review handoff on a high finding, run `high-remediation-blocking`; the validation report records the descriptor as passing after the rerun path is satisfied. 

```json
{
  "kind": "lines",
  "path": "tests/compliance/high-remediation-blocking.yaml",
  "range": [1, 14],
  "contentHash": "d5b4d95"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [26, 30],
  "contentHash": "5f703e8"
}
```

- To keep medium findings out of the approval gate, run `medium-backlog-default-off`; it creates backlog work and leaves escalation off unless explicitly enabled. 

```json
{
  "kind": "lines",
  "path": "tests/compliance/medium-backlog-default-off.yaml",
  "range": [1, 14],
  "contentHash": "2812f02"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [26, 30],
  "contentHash": "5f703e8"
}
```

- To surface low findings without blocking, run `low-warning-emission`; it creates backlog work and emits warnings to both console and `lib/inbox/out`. 

```json
{
  "kind": "lines",
  "path": "tests/compliance/low-warning-emission.yaml",
  "range": [1, 14],
  "contentHash": "7e20ef3"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [26, 30],
  "contentHash": "5f703e8"
}
```

- To run the full manual slice, choose `operator-on-demand` or `structure-change`, record `run_timestamp` and `trigger_mode`, then persist `test_results[].test_id` and `test_results[].outcome` in the run template. 

```json
{
  "kind": "lines",
  "path": "lib/memory/features/compliance-tests/manual-runbook.md",
  "range": [41, 61],
  "contentHash": "1a93c2a"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [10, 30],
  "contentHash": "5f703e8"
}
```


## Testing
The coverage delta is artifact-only: no executable source lines changed, so changed-line statement and branch coverage are N/A, while the validation baseline now covers schema parsing, required run-template fields, severity-routing obligations, and all three seed descriptors. 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/test-report.md",
  "range": [8, 30],
  "contentHash": "5f703e8"
}
```
 

```json
{
  "kind": "lines",
  "path": "archive/work/173009_04-27-26/68576_0457_compliance-tests/review.md",
  "range": [82, 92],
  "contentHash": "6e4a90a"
}
```

