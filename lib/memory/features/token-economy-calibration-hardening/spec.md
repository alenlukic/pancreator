---
title: Token Economy Calibration Hardening Engineering Spec
feature_id: token-economy-calibration-hardening
task_id: 60274_0715_token-economy-calibration-hardening
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172971_06-04-26/74107_0324_token-economy-calibration-hardening.md
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the directive defines the calibration defects, hardening outcomes, enforcement behavior, acceptance criteria, and non-goals with no material ambiguity.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates three required outcomes, five acceptance checks, and explicit non-goals without unresolved scope, acceptance, constraint, or prior-art gaps.
  - The canonical spec preserves the follow-on posture declared in the shipped token-economy-prototype delivery report: harden calibration quality and add expected-upper enforcement without expanding the 2x2 matrix or resurrecting legacy harness paths.
  - The human_approval gate remains mandatory before any state transition. After ratification, the SDK-controlled feature-delivery runner may advance task `60274_0715_token-economy-calibration-hardening` with this artifact.
references:
  - kind: lines
    path: lib/inbox/in/172971_06-04-26/74107_0324_token-economy-calibration-hardening.md
    range: [33, 46]
    contentHash: 110be55
    note: Source directive Problem and Goal sections define the first-live-calibration defects, n=1 overhead weakness, and missing expected-upper enforcement.
  - kind: lines
    path: lib/inbox/in/172971_06-04-26/74107_0324_token-economy-calibration-hardening.md
    range: [48, 80]
    contentHash: 110be55
    note: Source directive Required outcomes section defines clean iteration, statistically defensible baselines, and the enforcement layer.
  - kind: lines
    path: lib/inbox/in/172971_06-04-26/74107_0324_token-economy-calibration-hardening.md
    range: [82, 98]
    contentHash: 110be55
    note: Source directive Acceptance criteria and out-of-scope list anchor intake closure.
  - kind: lines
    path: tests/compliance/context-usage/README.md
    range: [1, 75]
    contentHash: 5aa9d74
    note: Canonical harness root, prototype matrix, expected-consumption formula, and iterative calibration loop.
  - kind: lines
    path: lib/memory/features/token-economy-prototype/spec.md
    range: [194, 212]
    contentHash: 83ede19
    note: WP-6 matrix runner and iterative calibrate→analyze→fix loop inherited from the shipped prototype.
  - kind: lines
    path: lib/memory/features/token-economy-prototype/delivery-report.md
    range: [1, 12]
    contentHash: 332c30e
    note: Shipped prototype matrix and established the hardening pass as a follow-on to the prototype harness delivery.
  - kind: lines
    path: tests/compliance/context-usage/calibration/findings/task-high.composer-2.5.json
    range: [1, 40]
    contentHash: e1a2c8b
    note: Findings artifacts anchor the machine-readable output shape and demonstrate duplicate-read inefficiency reporting for the calibration loop.
---

# Spec

This Feature SHALL harden the shipped token-economy prototype harness at
`tests/compliance/context-usage/` so that live calibration produces clean,
ratifiable baselines and surfaces expected-upper exceedance during matrix runs.
The harness SHALL eliminate `discovery_under_allowlist` policy violations in
`task-high`, reduce duplicate-read inefficiencies via prompt and task-contract
tightening, default overhead calibration to at least 8 noop probes per model,
re-establish all committed overhead and expected baselines from a clean matrix
run, normalize analyzer finding paths to fixture-relative form, and compare each
run's observed total against the ratified `expected_upper` for its
`{task, model}` combination. The Feature SHALL NOT expand the prototype matrix
beyond four combinations or resurrect legacy harness paths.

## Background

### Current-state defect summary

The intake source identifies three blockers that prevent operators from
treating the committed calibration outputs as ratified policy:

1. **Policy violations and inefficiencies in the first live slice.** The source
   directive calls out `discovery_under_allowlist` violations in `task-high`
   plus duplicate-read inefficiencies that require prompt and task-contract
   hardening.
2. **Under-sampled overhead baselines.** The source directive requires the
   baseline floor to move from n=1 to n≥8 per model so the committed upper
   confidence bounds become statistically defensible.
3. **Missing expected-upper enforcement.** The source directive requires each
   matrix run to compare observed totals against the ratified
   `expected_total_tokens.upper_confidence_bound` and surface exceedances in the
   run summary.

### Follow-on scope boundary

This Feature is a hardening pass on the shipped prototype, not a matrix
expansion. The implementation SHALL keep exactly four live calibration
combinations: `{task-low, task-high} × {composer-2.5, gpt-5.5}`. The
implementation SHALL keep the canonical harness root at
`tests/compliance/context-usage/` and SHALL NOT restore
`tests/context-usage/` or other legacy execution paths.

## Acceptance criteria

### WP-1 — Clean calibration iteration

- When an operator runs `pnpm run context:usage:calibrate` with default flags,
  the harness SHALL produce **zero** `policy_violations` across all four
  `{task, model}` combinations in `calibration/findings/`.
- The implementation SHALL harden the `task-high` prompt and task contract in
  `tests/compliance/context-usage/lib/tasks.mjs` so agents do not invoke
  discovery tools when an explicit read allowlist exists.
- The implementation SHALL tighten the `task-high` prompt to discourage
  duplicate reads of paths already in the required-read set.
- When inefficiencies remain after prompt and contract fixes, the operator
  SHALL document each irreducible inefficiency kind in committed harness
  documentation or the delivery report with one sentence of rationale per kind.
- The analyzer SHALL normalize finding paths to fixture-relative form by
  stripping temporary sandbox prefixes such as
  `var/folders/.../context-usage-task-high-*/` before writing
  `calibration/findings/<combo>.json`.

### WP-2 — Statistically defensible baselines

- `calibrate-matrix.mjs` SHALL default `--overhead-runs` to **8** noop probes
  per model.
- When overhead calibration completes with default flags, each committed
  `baselines/overhead.<model>.json` file SHALL report `sample_count ≥ 8` and
  `total_tokens.n ≥ 8`.
- After a clean matrix run, the implementation SHALL re-establish all four
  `baselines/expected.<task>.<model>.json` files from
  `calibration/raw/matrix-samples.json` via `establishExpectedFromRaw`.
- The harness README SHALL record calibration provenance for the committed
  baseline set: UTC timestamp, overhead run count, matrix run count per combo,
  and the `matrix-samples.json` path used to establish expected baselines.

### WP-3 — Expected-upper enforcement layer

- During or immediately after each matrix combination run, the harness SHALL
  compare the observed `total_tokens` against the ratified
  `expected_total_tokens.upper_confidence_bound` for that `{task, model}` combo.
- The matrix summary output SHALL emit one **expected_upper exceedance** flag
  per run when the observed total exceeds the expected upper bound.
- The matrix runner SHALL expose an operator toggle `--fail-on-exceedance` that
  exits non-zero when any run exceeds its expected upper; the default behavior
  SHALL remain warn-only for this slice.
- The offline unit-test suite SHALL cover `establishExpectedFromRaw` and the
  exceedance comparison logic without live API calls.

### WP-4 — Regression and compliance gates

- When an operator runs `pnpm run context:usage:test`, the offline suite SHALL
  pass with no API key.
- When an operator runs the repository compliance exit bundle, all
  context-usage checks SHALL remain green.
- The implementation SHALL NOT add models, task classes, or harness roots beyond
  the prototype matrix declared in the source directive.

## Documentation impact

```yaml
documentation_impact:
  applies: true
  rationale: >-
    This Feature changes calibration defaults, baseline provenance, analyzer path
    normalization, expected-upper enforcement, task-high prompt/contract
    behavior, and the harness README calibration section.
  changed-surfaces:
    - tests/compliance/context-usage/README.md
    - tests/compliance/context-usage/lib/tasks.mjs
    - tests/compliance/context-usage/lib/analyzer.mjs
    - tests/compliance/context-usage/calibrate-matrix.mjs
    - tests/compliance/context-usage/establish-expected.mjs
    - tests/compliance/context-usage/context-usage.unit.test.mjs
    - tests/compliance/context-usage/baselines/overhead.composer-2.5.json
    - tests/compliance/context-usage/baselines/overhead.gpt-5.5.json
    - tests/compliance/context-usage/baselines/expected.task-low.composer-2.5.json
    - tests/compliance/context-usage/baselines/expected.task-low.gpt-5.5.json
    - tests/compliance/context-usage/baselines/expected.task-high.composer-2.5.json
    - tests/compliance/context-usage/baselines/expected.task-high.gpt-5.5.json
    - work/172971_06-04-26/60274_0715_token-economy-calibration-hardening/touch-set.json
  deferred-items: []
```

The plan-stage owner SHALL refine the `changed-surfaces` list against the final
touch-set and SHALL record any documentation deferral with backlog linkage if a
required surface cannot be updated inside this task boundary.

## Out of scope

- The Feature SHALL NOT expand beyond `composer-2.5` and `gpt-5.5` models or
  beyond `task-low` and `task-high` task classes.
- The Feature SHALL NOT add mid-stream SDK circuit breakers or move live
  calibration into CI.
- The Feature SHALL NOT modify `pancreator-model-escalation.yaml` except for
  harness allowlist alignment when strictly required.
- The Feature SHALL NOT resurrect `tests/context-usage/` or any non-prototype
  harness execution path outside `tests/compliance/context-usage/`.
- The Feature SHALL NOT read, write, traverse, or cite any file under
  `lib/inbox/notes/`.

## Human ratification required

The operator MUST ratify this canonical Engineering Spec before the task
advances to plan. No additional clarifying-question round is pending. After the
operator accepts this artifact, the next state transition SHALL use
`lib/memory/features/token-economy-calibration-hardening/spec.md` as the
ratified intake artifact for task
`60274_0715_token-economy-calibration-hardening`.

## Suggested downstream owners

| Concern | Recommended owner |
|---|---|
| Plan, ADR draft, and touch-set | `tech-lead` |
| Task contract, analyzer, matrix runner, and baseline updates | `coder` |
| Policy-violation fixes and contract compliance | `reviewer` |
| Offline test updates and live calibration verification | `qa-tester` |
| README provenance and delivery report surfaces | `tech-writer` |
| Stage advancement after ratification | `supervisor` |

## Traceability

- Source directive: `lib/inbox/in/172971_06-04-26/74107_0324_token-economy-calibration-hardening.md`.
- Active task: `60274_0715_token-economy-calibration-hardening` under
  `work/172971_06-04-26/`.
- Output artifact: `lib/memory/features/token-economy-calibration-hardening/spec.md`.
- Prior art: `lib/memory/features/token-economy-prototype/spec.md` and
  `lib/memory/features/token-economy-prototype/delivery-report.md`.

## Open questions

_(none — the directive is sufficiently specified for plan-stage delegation.)_
