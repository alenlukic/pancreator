---
title: Token Economy Prototype Engineering Spec
feature_id: token-economy-prototype
status: intake-awaiting-ratification
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172972_06-03-26/18847_1845_token-economy-prototype.md
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the directive defines the prototype matrix, deliverables, calibration loop, analyzer scope, acceptance criteria, and non-goals with no material ambiguity.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive explicitly states that no clarifying rounds are required and the implementation boundary is fully specified.
  - The canonical spec preserves the directive's prototype-only posture: exactly two models, exactly two task classes, one canonical harness root, and an iterative calibration workflow that prioritizes observability and overhead-anchored expected-consumption math over prior live-envelope ratification logic.
  - The human_approval gate remains mandatory before any state transition; this artifact does not authorize `pnpm -w exec pan advance 18834_1846_token-economy-prototype --artifact lib/memory/features/token-economy-prototype/spec.md` until the operator ratifies the spec.
references:
  - kind: lines
    path: lib/inbox/in/172972_06-03-26/18847_1845_token-economy-prototype.md
    range: [28, 40]
    contentHash: 7ac26ae
    note: Source directive Problem and Goal sections define the broken expected-consumption model, missing observability, and the intended overhead-anchored prototype objective.
  - kind: lines
    path: lib/inbox/in/172972_06-03-26/18847_1845_token-economy-prototype.md
    range: [41, 80]
    contentHash: 7ac26ae
    note: Source directive Required outcomes section defines the 2-model x 2-task scope matrix, architecture, deliverables, and iterative calibration loop.
  - kind: lines
    path: lib/inbox/in/172972_06-03-26/18847_1845_token-economy-prototype.md
    range: [82, 108]
    contentHash: 7ac26ae
    note: Source directive Acceptance criteria, out-of-scope list, implementation guidance, and no-clarifying-rounds instruction anchor this intake closure.
  - kind: lines
    path: tests/compliance/context-usage/README.md
    range: [1, 15]
    contentHash: eb01f8d
    note: Current README confirms `tests/compliance/context-usage/` is the canonical harness root and that legacy `tests/context-usage/` references are historical.
  - kind: lines
    path: lib/memory/handbook/context-economy.md
    range: [66, 67]
    contentHash: 4e3313a
    note: Context-economy policy prohibits reads under `lib/inbox/notes/`; the analyzer in this prototype must continue to detect that violation class.
  - kind: lines
    path: pancreator-model-escalation.yaml
    range: [17, 31]
    contentHash: 9c474d2
    note: Active config is `complex`; the prototype matrix is intentionally narrowed to `composer-2.5` and `gpt-5.5` for medium-power and high-power calibration coverage.
---

# Spec

This Feature SHALL replace the current context-usage calibration strategy with a
prototype-scoped token-economy harness rooted only at
`tests/compliance/context-usage/`. The prototype SHALL support exactly four
live calibration combinations: `{task-low, task-high} x {composer-2.5,
gpt-5.5}`. The harness SHALL compute expected token consumption from two
separate empirical distributions: model-specific fresh-run overhead and
task-and-model-specific variable consumption after subtracting the model's
overhead median from each observed run. The harness SHALL emit timestamped
observability artifacts during calibration, detect policy violations and
inefficiencies from trace data, and support a repeatable calibrate -> analyze ->
batch-fix loop until the prototype is clean or only irreducible overhead
remains.

## Background

### Current-state defect summary

The current harness measures token consumption but does not produce an expected
consumption model the prototype can trust. The replacement design SHALL correct
three defects at once:

1. Expected-consumption math currently ignores statistically known fresh-run
   overhead. The prototype SHALL separate overhead from variable task cost.
2. Calibration currently lacks in-run observability. The prototype SHALL emit
   timestamped usage snapshots and action logs during each run rather than only
   after `run.wait()`.
3. Calibration currently does not close the loop on policy waste. The prototype
   SHALL analyze each run for violations and inefficiencies, then feed the
   results into a batch-fix cycle.

### Prototype scope boundary

The prototype is a reduction, not an extension. The implementation SHALL narrow
the harness to the matrix below and SHALL remove alternate execution paths that
would keep legacy scope alive.

| Dimension | Low | High |
|---|---|---|
| Model power | `composer-2.5` | `gpt-5.5` |
| Task complexity | `task-low` | `task-high` |

`task-low` SHALL represent a routing-answer task with no writes.
`task-high` SHALL represent a multi-read task that performs at least one edit
and writes a required artifact.

## Acceptance criteria

### WP-1 — Canonical root and aggressive purge

- The repository SHALL keep `tests/compliance/context-usage/` as the only
  canonical harness root for this prototype.
- The implementation SHALL remove the legacy `tests/context-usage/` tree.
- The implementation SHALL remove or disable non-prototype runners, suites,
  stale baselines, stale output trees, and calibration assets that preserve
  tier-sandbox, fd-skeleton, fd-trace, session-suite, or similar legacy
  execution paths outside the 4-combination prototype matrix.
- After the purge, the harness SHALL expose exactly four runnable calibration
  combinations and SHALL NOT preserve hidden alternate combinations by script,
  fixture, or baseline file naming.

### WP-2 — Prototype fixtures and task contract

- The harness SHALL ship two committed fixture roots:
  `tests/compliance/context-usage/fixtures/task-low/` and
  `tests/compliance/context-usage/fixtures/task-high/`.
- Each fixture SHALL be a minimal synthetic Pancreator-style repository slice
  with enough realistic structure to exercise agent retrieval behavior.
- Each fixture SHALL include at least one decoy file whose content is plausible
  but unnecessary for success, including a full `.docs/PRD.md`-style decoy or an
  equivalent large-context distraction.
- The harness SHALL ship one module at
  `tests/compliance/context-usage/lib/tasks.mjs`.
- `lib/tasks.mjs` SHALL define, for each task, at minimum: a prompt builder, the
  fixture root path, a read allowlist, any required output artifacts, and any
  forbidden-path patterns.
- `task-low` SHALL require no writes.
- `task-high` SHALL require at least one edit and one output artifact write.
- The task contract SHALL be strict enough for the analyzer to classify
  forbidden-path reads, allowlist breaches, duplicate reads, decoy reads, and
  discovery-driven waste.

### WP-3 — Observability and trace artifacts

- The harness SHALL extend `tests/compliance/context-usage/lib/collect-usage.mjs`
  with an NDJSON trace sink.
- For every calibration run, the trace sink SHALL emit timestamped records for
  run start, run end, per-turn usage snapshots, and each tool-call action.
- Each calibration run SHALL write its NDJSON trace log under
  `tests/compliance/context-usage/calibration/traces/<combo>/`.
- Each calibration run SHALL also write a summary JSON artifact adjacent to its
  NDJSON trace so the analyzer can operate without reparsing the full live run.
- The observability format SHALL make it possible to attribute large token spikes
  to concrete turns or actions rather than only to an aggregate total.

### WP-4 — Overhead calibration and expected-consumption math

- The harness SHALL ship an overhead calibration entry point named
  `tests/compliance/context-usage/calibrate-overhead.mjs`.
- `calibrate-overhead.mjs` SHALL calibrate only the two prototype models:
  `composer-2.5` and `gpt-5.5`.
- Each overhead probe SHALL be a noop fresh-run probe that measures model-level
  startup overhead independent of task-variable work.
- The harness SHALL write one overhead baseline file per model at
  `tests/compliance/context-usage/baselines/overhead.<model>.json`.
- The harness SHALL ship
  `tests/compliance/context-usage/lib/expected.mjs` and
  `tests/compliance/context-usage/establish-expected.mjs`.
- `establish-expected.mjs` SHALL produce one expected baseline per
  `{task, model}` combination at
  `tests/compliance/context-usage/baselines/expected.<task>.<model>.json`.
- For every observed calibration run, the variable sample SHALL equal
  `observed_total - overhead_median(model)`.
- For every expected baseline, the expected upper bound SHALL equal
  `overhead.upper_confidence_bound(model) + variable.upper_confidence_bound(task, model)`.
- The expected-consumption implementation SHALL reuse the existing statistical
  primitives in `tests/compliance/context-usage/lib/calibration-stats.mjs`,
  including `summarizeMetric` and `nonparametricQuantileUpperBound`, unless a
  plan-stage ADR explicitly replaces one with a justified equivalent.
- The prototype SHALL NOT retain a separate live-envelope or hand-ratified
  expected-consumption gate parallel to the overhead-plus-variable formula.

### WP-5 — Analyzer contract

- The harness SHALL ship one analyzer module at
  `tests/compliance/context-usage/lib/analyzer.mjs`.
- The analyzer SHALL consume calibration traces and summary artifacts and emit
  machine-readable findings under
  `tests/compliance/context-usage/calibration/findings/`.
- The analyzer SHALL classify findings into at least two families:
  `policy_violations` and `inefficiencies`.
- The analyzer SHALL detect, at minimum, all of the following
  `policy_violations`:
  forbidden-path reads, read-allowlist breaches, discovery when an explicit
  allowlist exists, and reads under `lib/inbox/notes/`.
- The analyzer SHALL detect, at minimum, all of the following
  `inefficiencies`: duplicate reads, decoy-file reads, and excess turns.
- The analyzer output SHALL preserve enough detail to support batch fixes to
  prompts, fixtures, task rules, or harness logic without re-running the source
  trace in a debugger.

### WP-6 — Matrix runner and iterative calibration loop

- The harness SHALL ship one orchestration entry point at
  `tests/compliance/context-usage/calibrate-matrix.mjs`.
- `calibrate-matrix.mjs` SHALL orchestrate the following sequence:
  fresh-run overhead probes, `N` live runs for each of the four
  `{task, model}` combinations, expected-baseline establishment, and analyzer
  execution.
- The matrix runner SHALL default to `--runs 8` for each combination.
- The matrix runner SHALL allow the operator to lower the run count for cheaper
  iteration without changing the code.
- One full default iteration SHALL therefore target approximately 34 live API
  calls: 2 noop probes plus `8 x 4` combination runs.
- The prototype workflow SHALL be iterative: run calibration, inspect findings,
  batch-fix the harness inputs or logic, and repeat until no violations or
  inefficiencies remain or only irreducible overhead remains.
- The matrix runner SHALL summarize the resulting expected baselines and analyzer
  findings in a way that makes the next batch-fix step obvious to the operator
  and downstream planning personas.

### WP-7 — Tests, scripts, docs, and task bookkeeping

- The root `package.json` SHALL expose only the trimmed prototype script set for
  this harness family: `context:usage:test`, `context:usage:calibrate`,
  `context:usage:expected`, and `context:usage:analyze`.
- The implementation SHALL remove or rename legacy `context:usage*` scripts that
  keep deprecated prototype-external workflows alive.
- `pnpm run context:usage:test` SHALL pass offline with no API key.
- The unit-test suite SHALL cover the overhead-plus-variable expected formula,
  analyzer violation detection, analyzer inefficiency detection, and any
  prototype task-contract parsing logic that can be exercised without live API
  calls.
- The harness README at `tests/compliance/context-usage/README.md` SHALL be
  rewritten to describe the prototype matrix, the calibration workflow, the
  trace artifacts, the expected-baseline model, and the operator-only nature of
  live API calibration.
- The delivery touch-set for downstream stages SHALL explicitly track
  documentation-impact and compliance-run obligations created by this
  testing-infrastructure change.

## Documentation impact

```yaml
documentation_impact:
  applies: true
  rationale: >-
    This Feature rewrites the context-usage compliance harness around a narrower
    prototype matrix, new observability artifacts, new calibration scripts, new
    expected-baseline math, and a rewritten operator README. The downstream
    touch-set must also track testing-infrastructure compliance obligations.
  changed-surfaces:
    - tests/compliance/context-usage/README.md
    - tests/compliance/context-usage/lib/tasks.mjs
    - tests/compliance/context-usage/lib/collect-usage.mjs
    - tests/compliance/context-usage/lib/expected.mjs
    - tests/compliance/context-usage/lib/analyzer.mjs
    - tests/compliance/context-usage/calibrate-overhead.mjs
    - tests/compliance/context-usage/establish-expected.mjs
    - tests/compliance/context-usage/calibrate-matrix.mjs
    - package.json
    - .pan/work/172972_06-03-26/18834_1846_token-economy-prototype/touch-set.json
  deferred-items: []
```

The plan-stage owner SHALL refine the `changed-surfaces` list against the final
touch-set and SHALL record any documentation deferral with backlog linkage if a
required surface cannot be updated inside this task boundary.

## Out of scope

- The prototype SHALL NOT add any model beyond `composer-2.5` and `gpt-5.5`.
- The prototype SHALL NOT preserve the rejected mid-stream SDK circuit-breaker
  approach.
- The prototype SHALL NOT modify `pancreator-model-escalation.yaml` except where
  implementation requires narrowing the harness model allowlist.
- The prototype SHALL NOT move live calibration into CI; live API runs remain
  operator-only.
- The prototype SHALL NOT preserve a second expected-consumption gate based on
  hand-ratified envelopes or unrelated manual budgets.
- The prototype SHALL NOT read, write, traverse, or cite any file under
  `lib/inbox/notes/`.

## Human ratification required

The operator MUST ratify this canonical Engineering Spec before the task
advances to plan. No additional clarifying-question round is pending. After the
operator accepts this artifact, the next state transition for this task SHALL be
exactly:

```bash
pnpm -w exec pan advance 18834_1846_token-economy-prototype --artifact lib/memory/features/token-economy-prototype/spec.md
```

## Suggested downstream owners

| Concern | Recommended owner |
|---|---|
| Plan, ADR draft, and touch-set | `tech-lead` |
| Harness purge, fixtures, task contract, and scripts | `coder` |
| Analyzer review, disallowed-path policy, and contract compliance | `reviewer` |
| Offline test updates and live calibration verification | `qa-tester` |
| Documentation and delivery report surfaces | `tech-writer` |
| Stage advancement after ratification | `supervisor` |

## Traceability

- Source directive: `lib/inbox/in/172972_06-03-26/18847_1845_token-economy-prototype.md`.
- Active task: `18834_1846_token-economy-prototype` under
  `.pan/work/172972_06-03-26/`.
- Output artifact: `lib/memory/features/token-economy-prototype/spec.md`.

## Open questions

_(none - the directive is sufficiently specified for plan-stage delegation and
explicitly authorizes a zero-round intake path.)_
