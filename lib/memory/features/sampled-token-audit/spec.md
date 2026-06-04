---
title: Sampled Token Audit Engineering Spec
feature_id: sampled-token-audit
task_id: 53589_0906_sampled-token-audit
stage: intake
owner: intake-analyst
status: intake-awaiting-ratification
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: lib/inbox/in/172971_06-04-26/53607_0906_sampled-token-audit.md
next_owner: tech-lead
next_stage: plan
intake_closure:
  human_approval_gate: pending
  approved_date: null
  channel: operator_cursor_chat
  note: Spec emitted for human ratification. No clarifying rounds were required because the directive defines sampling instrumentation, audit command behavior, analysis heuristics, bounded repair, acceptance criteria, and non-goals with no material ambiguity.
intake_notes:
  - The intake-analyst did not enter the canonicalize-spec clarifying-question loop because the source directive enumerates four required outcomes, six acceptance checks, and explicit non-goals without unresolved scope, acceptance, constraint, or prior-art gaps.
  - The canonical spec preserves the phase-1 posture declared in the source directive: instrument feature-delivery SDK invocations first, reuse prototype harness capture patterns, and defer handbook or pipeline-semantics changes to high-complexity repair deferrals.
  - The human_approval gate remains mandatory before any state transition. After ratification, the SDK-controlled feature-delivery runner may advance task `53589_0906_sampled-token-audit` with this artifact.
references:
  - kind: lines
    path: lib/inbox/in/172971_06-04-26/53607_0906_sampled-token-audit.md
    range: [48, 67]
    contentHash: pending
    note: Source directive Problem and Goal sections define the production token-observability gap and the phase-1 sampling objective.
  - kind: lines
    path: lib/inbox/in/172971_06-04-26/53607_0906_sampled-token-audit.md
    range: [69, 116]
    contentHash: pending
    note: Source directive Required outcomes section defines sampling, audit command, analysis heuristics, and bounded repair behavior.
  - kind: lines
    path: lib/inbox/in/172971_06-04-26/53607_0906_sampled-token-audit.md
    range: [117, 133]
    contentHash: pending
    note: Source directive Acceptance criteria and out-of-scope list anchor intake closure.
  - kind: lines
    path: tests/compliance/context-usage/README.md
    range: [1, 95]
    contentHash: 5aa9d74
    note: Prototype harness trace, summary, findings contracts, and calibrate loop patterns to reuse in production sampling.
  - kind: lines
    path: tests/compliance/context-usage/lib/collect-usage.mjs
    range: [1, 280]
    contentHash: f15ea58
    note: Streamed SDK usage capture via processStreamEvent, createTraceSink, and assertUsageCaptured.
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts
    range: [181, 320]
    contentHash: 2a0a648
    note: runLogRecordFromRunnerEnvelope token_usage_unavailable default and invokeFeatureDeliveryEnteringStage SDK choke point.
  - kind: lines
    path: lib/internal/packages/@pancreator/runner-cursor/src/sdk-transport.ts
    range: [74, 135]
    contentHash: e94c6ad
    note: Current Agent.prompt fast path; sampled path adds streaming capture without changing unsampled behavior.
  - kind: lines
    path: lib/memory/handbook/context-economy.md
    range: [176, 214]
    contentHash: d890e2c
    note: Handoff discipline; handbook edits remain deferred unless audit proves a narrow mismatch.
  - kind: lines
    path: lib/memory/handbook/run-log-schema.md
    range: [102, 120]
    contentHash: pending
    note: gen_ai.usage fields and token_usage_unavailable convention for sampled run-log emission.
  - kind: lines
    path: lib/memory/features/token-economy-calibration-hardening/delivery-report.md
    range: [1, 15]
    contentHash: pending
    note: Shipped calibration harness; production feature-delivery still lacks live token traces.
---

# Spec

This Feature SHALL add deterministic sampling of feature-delivery SDK stage
invocations so operators can audit token economy on real `pan run` and
`pan advance` executions without manual reproduction. The implementation SHALL
persist redacted full-stream traces and token summaries for approximately 10
percent of invocations, expose `pnpm -w exec pan token-economy sample-audit` to
analyze new samples since the last audit watermark, and provide a bounded
`--repair` path that auto-applies low- and medium-complexity fixes while
deferring high-complexity findings via a new inbox item. Phase 1 SHALL target
feature-delivery SDK invocations only and SHALL design extension hooks for
broader agent invocation coverage without blocking phase 1 delivery.

## Background

### Current-state defect summary

The intake source identifies three blockers that prevent operators from
detecting token economy regressions on production pipeline runs:

1. **Missing durable token telemetry on SDK invocations.** Feature-delivery SDK
   runs invoke agents via `Agent.prompt` without durable action logs or token
   usage in `run.log.jsonl`; `runLogRecordFromRunnerEnvelope` currently sets
   `token_usage_unavailable: true` on every record.
2. **Prototype signal does not reach production.** The token-economy prototype
   harness under `tests/compliance/context-usage/` proves streamed capture and
   analyzer findings on a 2×2 matrix, but that signal does not reach production
   pipeline invocations.
3. **No incremental audit surface.** Operators lack a command to scan new
   sampled traces, detect regressions against rolling baselines, and route
   bounded repairs without reopening the prototype calibration matrix.

### Phase-1 scope boundary

This Feature bridges prototype capture patterns into production
feature-delivery SDK invocations. The implementation SHALL keep the unsampled
fast path behavior unchanged, SHALL NOT promote prototype `expected.*.json`
bounds as global repo policy caps, and SHALL NOT expand the prototype 2×2 matrix
or move live calibration into CI.

## Acceptance criteria

### WP-1 — Sampling and trace capture

- When `runner.cursor.sdkSampling.enabled` is true in `pancreator.yaml` with
  default `ratePercent: 10` and `scope: feature-delivery`, the reader in
  `pan-init.ts` SHALL expose configuration and environment overrides for
  force-on and force-off dogfood runs.
- When `invokeFeatureDeliveryEnteringStage` evaluates the deterministic hash
  gate using stable inputs `{taskId, stageId, persona, model, invocationIndex}`,
  approximately 90 percent of invocations SHALL keep the existing
  `Agent.prompt` fast path unchanged.
- When an invocation passes the sampling gate, the runner SHALL use a streamed
  SDK path that reuses `processStreamEvent`, `createTraceSink`, and
  `assertUsageCaptured` patterns from `collect-usage.mjs` via a shared internal
  collector module extracted from the prototype harness.
- When a sampled invocation completes, the runner SHALL persist redacted
  artifacts under
  `work/<day>/<task-id>/sdk-traces/<stage>-<invocation>-<stamp>.ndjson` and
  `.summary.json` following run-log-schema redaction rules with no plaintext
  secrets.
- When usage is captured on a sampled invocation, `run.log.jsonl` SHALL emit
  `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
  `pancreator.sampling.sampled`, and `pancreator.sampling.trace_path` and SHALL
  NOT emit `pancreator.token_usage_unavailable: true`.

### WP-2 — Incremental audit command

- When an operator runs `pnpm -w exec pan token-economy sample-audit`, the CLI
  SHALL scan `work/**/sdk-traces/*.summary.json` newer than the watermark at
  `.pan/token-economy/last-audit.json` and SHALL write a report under
  `.pan/token-economy/reports/<timestamp>.json`.
- When the audit command completes report generation, the CLI SHALL advance the
  watermark in `.pan/token-economy/last-audit.json`.
- When an operator passes `--since <iso>`, the audit command SHALL restrict the
  scan to summaries at or after the supplied timestamp.
- When an operator passes `--sampled-only-task <task-id>`, the audit command
  SHALL restrict analysis to summaries under that task's `work/` directory.
- When an operator passes `--repair`, the audit command SHALL invoke a repair
  agent with grouped findings only and SHALL NOT pass full trace payloads to
  the repair agent prompt.

### WP-3 — Analysis heuristics

- When the audit command analyzes a summary, the analyzer SHALL detect forbidden
  path reads including `docs/PRD.md`, `docs/BOOTSTRAP.md`, `archive/work/`,
  `lib/inbox/`, and `lib/inbox/notes/`.
- When the audit command analyzes a summary, the analyzer SHALL detect duplicate
  reads of the same path within one invocation.
- When the audit command analyzes a summary, the analyzer SHALL compare turn and
  token totals against a rolling baseline keyed by `{persona, stage, model}` and
  SHALL flag inflation regressions.
- When the audit command analyzes a summary, the analyzer SHALL detect discovery
  or search tool use when `next-prompt.md` or the handoff card already
  enumerates in-scope paths.
- When the audit command emits findings, the analyzer SHALL reuse or adapt
  `analyzer.mjs` and `expected.mjs` patterns where applicable and SHALL NOT
  treat prototype `expected.*.json` upper bounds as global enforcement caps.

### WP-4 — Bounded repair loop

- When `--repair` receives a low- or medium-complexity finding group, the repair
  agent SHALL auto-apply fixes limited to runner prompts, `.cursor/agents`
  retrieval drift, sampling or analyzer wiring, and handoff or next-prompt
  shaping in feature-delivery-run.
- When `--repair` receives a high-complexity finding group touching
  `AGENTS.md`, `context-economy.md`, `pancreator-model-escalation.yaml`,
  pipeline semantics, CI gating, or broad refactors, the repair path SHALL defer
  by creating an inbox item via `pnpm -w exec pan intake new <slug>` with a
  findings summary.
- When the offline test suite exercises `--repair`, at least one low-scope fix
  SHALL apply in tests and at least one high-scope finding SHALL defer to inbox
  creation without modifying protected surfaces.

### WP-5 — Regression and compliance gates

- When the offline unit-test suite runs, default 10 percent deterministic
  sampling behavior SHALL pass without live API calls.
- When the offline unit-test suite runs, rolling baseline regression detection
  SHALL pass on mocked summaries without live API calls.
- When an operator runs the repository compliance exit bundle, all checks SHALL
  remain green.
- The implementation SHALL NOT require mandatory live API calibration in CI.

## Documentation impact

```yaml
documentation_impact:
  applies: true
  rationale: >-
    This Feature adds pancreator.yaml sampling configuration, a new pan
    token-economy sample-audit command, production SDK trace persistence,
    analyzer heuristics, and bounded repair deferral behavior.
  changed-surfaces:
    - pancreator.yaml
    - lib/internal/packages/@pancreator/cli/src/pan-init.ts
    - lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts
    - lib/internal/packages/@pancreator/runner-cursor/src/sdk-transport.ts
    - lib/internal/packages/@pancreator/cli/src/commands/token-economy-sample-audit.ts
    - tests/compliance/context-usage/lib/collect-usage.mjs
    - tests/compliance/context-usage/lib/analyzer.mjs
    - work/172971_06-04-26/53589_0906_sampled-token-audit/touch-set.json
  deferred-items: []
```

The plan-stage owner SHALL refine the `changed-surfaces` list against the final
touch-set and SHALL record any documentation deferral with backlog linkage if a
required surface cannot be updated inside this task boundary.

## Out of scope

- The Feature SHALL NOT expand the prototype 2×2 matrix or move live calibration
  into CI.
- The Feature SHALL NOT rewrite `context-economy.md` or `AGENTS.md` unless an
  audit proves a narrow documentation mismatch; such fixes default to deferral.
- The Feature SHALL NOT sample non-SDK or non-feature-delivery invocations in
  phase 1 except for design hooks that do not block delivery.
- The Feature SHALL NOT add Phoenix or OTLP export; local sinks only for this
  slice.
- The Feature SHALL NOT read, write, traverse, or cite any file under
  `lib/inbox/notes/`.

## Human ratification required

The operator MUST ratify this canonical Engineering Spec before the task
advances to plan. No additional clarifying-question round is pending. After the
operator accepts this artifact, the next state transition SHALL use
`lib/memory/features/sampled-token-audit/spec.md` as the ratified intake
artifact for task `53589_0906_sampled-token-audit`.

## Suggested downstream owners

| Concern | Recommended owner |
|---|---|
| Plan, ADR draft, and touch-set | `tech-lead` |
| Sampling gate, SDK streaming path, and shared collector | `coder` |
| Audit command, analyzer heuristics, and repair wiring | `coder` |
| Policy compliance and contract review | `reviewer` |
| Offline tests and mocked regression coverage | `qa-tester` |
| Operator-facing command documentation | `tech-writer` |
| Stage advancement after ratification | `supervisor` |

## Traceability

- Source directive:
  `lib/inbox/in/172971_06-04-26/53607_0906_sampled-token-audit.md`.
- Active task: `53589_0906_sampled-token-audit` under
  `work/172971_06-04-26/`.
- Output artifact: `lib/memory/features/sampled-token-audit/spec.md`.
- Prior art: `tests/compliance/context-usage/` prototype harness and
  `lib/memory/features/token-economy-calibration-hardening/delivery-report.md`.

## Open questions

_(none — the directive is sufficiently specified for plan-stage delegation.)_
