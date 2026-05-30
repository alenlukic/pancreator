---
title: Feature-delivery harness — wire CursorRunner through run and advance
feature_id: feature-delivery-harness-wire-cursorrunner-through-run-and-advance
status: intake-awaiting-ratification
next_owner: tech-lead
next_stage: plan
source_inbox_item: src/inbox/in/172979_05-27-26/72021_0359_feature-delivery-cursor-runner-harness-wiring/72021_0359_feature-delivery-cursor-runner-harness-wiring.md
intake_round: 0
parent_batch_feature: m1-substrate-runtime-batch
backlog_linkage: BR4-harness-loop-runner-stub-residual
default_invocation_mode: manual
sdk_invocation_mode_opt_in: true
auto_advance_retry_budget: 3
references:
  - kind: lines
    path: src/inbox/in/172979_05-27-26/72021_0359_feature-delivery-cursor-runner-harness-wiring/72021_0359_feature-delivery-cursor-runner-harness-wiring.md
    range: [69, 95]
    contentHash: 6eeaa2f
    note: "Directive problem statement and goal — closes WP-B acceptance gap that pan run/advance never use the runner as the stage executor."
  - kind: lines
    path: src/inbox/in/172979_05-27-26/72021_0359_feature-delivery-cursor-runner-harness-wiring/72021_0359_feature-delivery-cursor-runner-harness-wiring.md
    range: [97, 124]
    contentHash: 6eeaa2f
    note: "Directive required outcomes — runner on advance, runner on run, pipeline integration, env ergonomics, configuration, and tests."
  - kind: lines
    path: src/inbox/in/172979_05-27-26/72021_0359_feature-delivery-cursor-runner-harness-wiring/72021_0359_feature-delivery-cursor-runner-harness-wiring.md
    range: [125, 174]
    contentHash: 6eeaa2f
    note: "Directive target state machine — net-new automation rules including default progression, retry budget, automatic re-entry routing, retry-limit halt, report-stage gate, reinvocation, and logic-change quality gate."
  - kind: lines
    path: src/inbox/in/172979_05-27-26/72021_0359_feature-delivery-cursor-runner-harness-wiring/72021_0359_feature-delivery-cursor-runner-harness-wiring.md
    range: [175, 200]
    contentHash: 6eeaa2f
    note: "Directive acceptance criteria — log records, manual mode no-SDK, real persona fields, sdk auto-advance, retry-limit halt, report human gate, reinvocation, and QA evidence."
  - kind: lines
    path: src/internal/packages/@pancreator/cli/src/feature-delivery-run.ts
    range: [286, 313]
    contentHash: 7c5e4d7
    note: "Current wiring — startFeatureDelivery invokes CursorRunner once for intake using stubPersonaForStage, discards compilePipeline output (void compiled), and never calls executePipeline."
  - kind: lines
    path: src/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md
    range: [85, 91]
    contentHash: c549713
    note: "WP-B Cursor SDK runner invocation acceptance — end-to-end smoke test SHALL complete one feature-delivery stage via the SDK runner without a manual paste step."
  - kind: lines
    path: src/pipelines/feature-delivery.yaml
    range: [25, 67]
    contentHash: a247fa7
    note: "Canonical feature-delivery stage order, persona ownership, and stage I/O. Stage inventory remains authoritative; this Feature only adds runtime automation deltas."
  - kind: lines
    path: OPERATION.md
    range: [26, 94]
    contentHash: 97a5bee
    note: "Already-specified manual feature-delivery loop and post-invocation state machine semantics that this Feature extends rather than redefines."
  - kind: lines
    path: src/personas/coder.md
    range: [81, 167]
    contentHash: 1db3997
    note: "Implement-stage re-entry contract and test obligations governing the auto-advance loopback target for must_fix and qa_fails."
  - kind: lines
    path: src/personas/reviewer.md
    range: [90, 145]
    contentHash: 4b5ea80
    note: "Review-stage gate semantics and must-fix re-entry behavior consumed by automation rule 3."
  - kind: lines
    path: src/personas/qa-tester.md
    range: [89, 180]
    contentHash: d22b04e
    note: "Test-stage verification contract and severity-based re-entry routing expectations consumed by automation rule 3 and the logic-change quality gate."
  - kind: lines
    path: src/memory/features/timestamp-naming-conventions/spec.md
    range: [77, 82]
    contentHash: a759255
    note: "Outbox filename timestamp-prefix requirement — system-produced src/inbox/out/ artifacts MUST use {SID-prefix}_{HHMM}_{semantic-suffix}."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [69, 75]
    contentHash: 41ad365
    note: "Canonical inbox queue, response, archive, and operator-sandbox path layout consumed by the retry-limit halt and report-stage gate outbox writes."
  - kind: lines
    path: docs/PRD.md
    range: [641, 648]
    contentHash: 6336a5f
    note: "PRD §7 feature-delivery intake-stage YAML declaring loop.max_rounds: 5 and gate: human_approval; this intake holds the human_approval gate before plan."
  - kind: lines
    path: pancreator.yaml
    range: [1, 40]
    contentHash: 0d68373
    note: "Live policy file — Phase 5 status, risk_tier medium, and the absence of a runner.cursor.invocation block, demonstrating manual default behavior today."
  - kind: lines
    path: pancreator-defaults.yaml
    range: [30, 53]
    contentHash: 665ad46
    note: "Risk-tier medium defaults that govern coverage, bundle, and gate severities applied by the runtime when auto-advance is enabled."
---

# Spec

This Feature SHALL close the harness-loop gap so the `feature-delivery` runtime executes stage work through `CursorRunner` whenever the operator opts in via `pancreator.yaml`, while preserving operator-led delegation as the default. The Feature replaces the current single-shot intake smoke (`feature-delivery-run.ts` lines 286–313) with a uniform stage-invocation contract on both `pnpm -w exec pan run feature-delivery` and `pnpm -w exec pan advance`, wires the compiled `StateGraph` from `compilePipeline` into stage execution, resolves real persona markdown from `src/personas/<name>.md` (no `stubPersonaForStage`), loads repo-root `.env` for SDK credentials, and adds a bounded automatic loopback regime with a cumulative 3-attempt retry budget and a mandatory human gate after `report`. The Feature closes the residual BR4 stub behavior that survived the M1 substrate batch and satisfies the WP-B acceptance clause that one stage SHALL run end-to-end through `CursorRunner.invoke` without manual paste.

## Background

The M1 substrate batch landed `@pancreator/runner-cursor` with a live `@cursor/sdk` transport and a `compilePipeline` LangGraph compiler, but the CLI does not use either as the stage executor. Today `startFeatureDelivery` calls `CursorRunner.invoke` exactly once for the `intake` stage using `stubPersonaForStage`, discards the compiled graph with `void compiled`, and leaves `advanceFeatureDelivery` entirely manual. The CLI does not load repo-root `.env`, and `pancreator.yaml` carries no `runner.cursor.invocation` block, so `readCursorInvocationMode` resolves to `manual` even when the operator has `CURSOR_API_KEY` configured locally. As a result, the operator must paste each `next-prompt.md` into a Cursor subagent for every stage, and the WP-B end-to-end SDK smoke clause cannot pass through the operator-facing CLI path.

## Scope and non-scope orientation

The directive defines net-new automation rules. This spec preserves every existing artifact authority unchanged.

| Concern | Authoritative source | Spec posture |
|---|---|---|
| Stage inventory and persona ownership | `src/pipelines/feature-delivery.yaml` lines 25–67 | Reference only; no edits in this Feature. |
| Manual `pan run` / `pan advance` semantics | `OPERATION.md` lines 26–94 | Reference only; manual remains the default. |
| Implement-stage obligations after loopback | `src/personas/coder.md` lines 81–167 | Reference only; consumed when automation routes to `implement`. |
| Review-stage gate semantics | `src/personas/reviewer.md` lines 90–145 | Reference only; consumed when automation routes back from `review`. |
| Test-stage routing and severity | `src/personas/qa-tester.md` lines 89–180 | Reference only; consumed when automation routes back from `test`. |
| Outbox naming conventions | `src/memory/features/timestamp-naming-conventions/spec.md` lines 77–82 | Reference only; halt artifact and report-gate artifact MUST conform. |
| Inbox path layout | `src/memory/handbook/inbox-lifecycle.md` lines 69–75 | Reference only; halt and gate artifacts target `src/inbox/out/<day-bucket>/`. |

## Acceptance criteria

The acceptance criteria below split into six work packages. Plan-stage delegation MAY ratify alternative work-package partitioning, but every clause below SHALL be satisfied before the implementation report is accepted.

### WP-1 — Runner on advance (SDK path)

- When `runner.cursor.invocation` is `sdk` and the operator runs `pnpm -w exec pan advance <task-id> --artifact <stage-artifact>` after a stage completes, `advanceFeatureDelivery` SHALL invoke `CursorRunner.invoke` for the entering stage and SHALL pass the regenerated `next-prompt.md` path, the expected artifact path, the resolved persona record, and a ledger context carrying `taskId`, `pipelineId`, `stageId`, and `featureId`.
- When `advanceFeatureDelivery` invokes `CursorRunner.invoke`, it SHALL resolve the persona by reading `src/personas/<name>.md` and SHALL NOT use `stubPersonaForStage`.
- When `runner.cursor.invocation` is `manual`, `advanceFeatureDelivery` SHALL skip the SDK transport and SHALL preserve today's handoff-and-paste flow.
- When the runner returns a typed result, the run SHALL append one record to `src/work/<day>/<task-id>/run.log.jsonl` containing the OpenInference and OTel GenAI attributes already specified in `@pancreator/runner-cursor`.

### WP-2 — Runner on run (configurable, no stub-only path)

- When `pnpm -w exec pan run feature-delivery <inbox-entry>` runs with `runner.cursor.invocation: sdk`, `startFeatureDelivery` SHALL invoke `CursorRunner.invoke` using the same contract that WP-1 defines, with no `stubPersonaForStage` call on any code path.
- When `runner.cursor.invocation` is `manual`, `startFeatureDelivery` SHALL NOT call `@cursor/sdk` and SHALL emit the existing JSON envelope unchanged.
- When the SDK transport returns successfully, the runtime SHALL replace the current `void compiled` discard pattern with a bound reference consumed by WP-3 stage execution.

### WP-3 — Pipeline integration (compiled-graph slice)

- When the runtime executes at least one SDK-backed stage transition, it SHALL drive that transition through the compiled `StateGraph` returned by `compilePipeline` rather than the imperative stage map.
- When the compiled graph executes a stage node, the OpenInference span name SHALL carry the stage persona's role name as already specified in the M1 substrate batch spec lines 85–91.
- When the compiled graph encounters an intervention side-channel event (`pause`, `reroute`, `abort`), it SHALL route through the single side-channel node already defined in `@pancreator/pipeline` and SHALL NOT maintain a parallel state machine.
- When the compiler refuses compilation (unknown persona, unknown contract kind, missing worktree pool), `startFeatureDelivery` and `advanceFeatureDelivery` SHALL exit non-zero with the compiler's error message and SHALL NOT mutate `state.json`.

### WP-4 — Environment ergonomics

- When `pnpm -w exec pan <subcommand>` runs from the repository root and a repo-root `.env` file exists, the CLI SHALL load that file before constructing `CursorRunner` and SHALL NOT log secret values to stdout, stderr, or `run.log.jsonl`.
- When `.env` is absent, the CLI SHALL fall back to the existing process environment without error.
- When the CLI loads `.env`, it SHALL NOT commit, write, or echo `.env` content into any file under `src/work/`, `src/memory/`, or `src/inbox/`.

### WP-5 — Configuration surface

- When `pancreator.yaml` carries `runner.cursor.invocation: manual`, the CLI SHALL behave per WP-1 and WP-2 manual-mode clauses.
- When `pancreator.yaml` carries `runner.cursor.invocation: sdk`, the CLI SHALL behave per WP-1 and WP-2 SDK-mode clauses.
- When `pancreator.yaml` omits the `runner.cursor.invocation` key, the CLI SHALL resolve invocation to `manual` per the existing `readCursorInvocationMode` contract.
- When the implementation lands, `pancreator-defaults.yaml`, `pancreator.yaml`, or the handbook entry at `src/memory/handbook/pancreator-config.md` SHALL document at least one example block showing both `manual` and `sdk` values; the implementor SHALL select the documentation surface in the plan stage.

### WP-6 — Automated harness state machine

The clauses in this work package define net-new behavior that activates when, and only when, `runner.cursor.invocation` is `sdk`. Every clause SHALL be inert under `manual` mode.

- When a stage completes and the gate is `human_approval`, the runtime SHALL pause for the operator unless the stage is one of `review`, `test`, or `report` per the rules below.
- When `review` returns `review_passes`, the runtime SHALL auto-advance to `test` without an operator command.
- When `review` returns `must_fix`, the runtime SHALL auto-route to `implement` and SHALL increment the cumulative retry counter by one.
- When `test` returns `qa_passes`, the runtime SHALL auto-advance to `report` without an operator command.
- When `test` returns `qa_fails` with a non-plan-invalidating verdict from `qa-tester`, the runtime SHALL auto-route to `implement` and SHALL increment the cumulative retry counter by one.
- When `test` returns `qa_fails` with a plan-invalidating verdict from `qa-tester`, the runtime SHALL auto-route to `plan` and SHALL increment the cumulative retry counter by one.
- When the cumulative retry counter exceeds 3 across `must_fix` and `qa_fails` events combined within one run, the runtime SHALL transition to a terminal `halted` state, SHALL stop further auto-advancement, SHALL print a halt summary line to stdout that names `task_id`, `feature_id`, `failing_stage`, `retry_count`, and the outbox artifact path, and SHALL write exactly one timestamp-prefixed file under `src/inbox/out/<day-bucket>/` whose basename matches `{SID-prefix}_{HHMM}_{semantic-suffix}` per timestamp-naming-conventions lines 77–82.
- When the runtime reaches the `report` stage and the `report` artifact is generated, the runtime SHALL stop and SHALL write exactly one timestamp-prefixed outbox artifact under `src/inbox/out/<day-bucket>/` whose front matter includes `task_id`, `feature_id`, `gate: report_approval`, a `decision` field with allowed values `approve` or `needs_changes`, and a free-text `required_changes` field for use when `decision` is `needs_changes`.
- When the operator submits an `approve` decision through the existing inbox-response procedure, the runtime SHALL resume and advance to `ship`.
- When the operator submits a `needs_changes` decision with non-empty `required_changes`, the runtime SHALL route to the stage that the operator names (`plan` or `implement`) and SHALL preserve `run.log.jsonl` continuity.
- When the operator invokes reinvocation at an explicit stage boundary using a task-relevant artifact path plus operator prose context, the runtime SHALL resume from that stage, SHALL preserve `run.log.jsonl` continuity, and SHALL apply the WP-6 retry counter to subsequent automatic loopbacks within the same run.
- When a run introduces or modifies logic, the run SHALL include automated test outcomes and manual QA evidence in the test report; when QA fails, `qa-tester` SHALL select the re-entry target (`plan` or `implement`) per the severity rules already defined in `src/personas/qa-tester.md` lines 89–180.

### WP-7 — Tests and regression coverage

- When `pnpm --filter @pancreator/cli test` runs, the suite SHALL include vitest cases asserting that `advanceFeatureDelivery` calls `CursorRunner.invoke` exactly once per advance under `sdk` mode against a mocked transport.
- When `pnpm --filter @pancreator/cli test` runs under `manual` mode, the suite SHALL assert that no SDK transport call occurs for the full inbox path (`run` → multiple `advance` calls → `complete`).
- When the persona resolver receives an unknown persona name, the resolver SHALL throw a typed error and the corresponding test case SHALL assert that the runtime exits non-zero without mutating `state.json`.
- When `pnpm --filter @pancreator/runner-cursor test` runs, the existing M1 WP-B touch-set tests SHALL remain green.
- When `node --test tests/*.test.mjs` runs, the repository-level test suite SHALL remain green.
- When `node src/internal/tools/check-phase-0a-scaffold.mjs` runs, the scaffold-conformance suite SHALL remain green.
- When `node src/internal/tools/context-budget-report.mjs` runs, the context-budget report SHALL remain green.

## Documentation impact

```yaml
documentation_impact:
  applies: true
  rationale: >-
    The Feature introduces new automated harness behavior, configures runner.cursor.invocation
    semantics, adds .env loading, and defines a retry budget plus report-stage human gate.
    Operator-facing handbook pages, OPERATION.md, and the pancreator-config handbook entry
    require updates so operators can opt into sdk mode and recognise the auto-advance and
    halt artifacts.
  changed-surfaces:
    - OPERATION.md
    - src/memory/handbook/pancreator-config.md
    - src/memory/handbook/inbox-lifecycle.md
    - pancreator.yaml
    - pancreator-defaults.yaml
    - src/memory/active/current.md
  deferred-items: []
```

The plan-stage executor SHALL refine `changed-surfaces` against the realised touch-set and SHALL add backlog entries under `deferred-items` for any documentation surface that the implementation cannot update inside the same task boundary.

## Out of scope

- Fully unattended completion through final ship, index, and close-artifacts without human gate decisions on `report` or after retry-limit halt.
- Replacing operator persona delegation in the Cursor IDE when `runner.cursor.invocation` is `manual`.
- Live SDK calls in the default CI matrix; mock transport SHALL cover unit tests, and any optional SDK smoke SHALL run only on manual or scheduled triggers.
- Gate and loop YAML expression evaluation beyond the existing `compilePipeline` directive set; expression evaluation remains a separate Feature.
- Cohort orchestration, parallel feature-delivery runs, and multi-tenant concurrency.
- Sandbox-pool execution and container-sandbox install paths.
- SQLite and Postgres checkpointer wrappers.
- Any change to the `intake-analyst` persona spec or to the manual-mode default for `runner.cursor.invocation`.

## Suggested downstream owners

The following persona assignments are RECOMMENDED for the plan stage. The tech-lead MAY adjust them based on the realised touch-set.

| Concern | Recommended owner |
|---|---|
| Plan, ADR draft, and touch-set | `tech-lead` |
| CLI wiring, runner integration, persona resolver, `.env` loader | `pancreator-engineer` (primary) and `coder` (support) |
| Compiled-graph stage execution slice | `pancreator-engineer` |
| Vitest coverage and regression discipline | `pancreator-engineer` |
| Touch-set, disallowed-tool, and contracts review | `reviewer` |
| Manual QA, severity routing, and logic-change quality-gate validation | `qa-tester` |
| Delivery report and operator-facing documentation | `tech-writer` |
| Ship staging and human ratification | `supervisor` |
| Index, artifact closure, and active-memory hygiene | `librarian` |

## Traceability

- Parent batch Feature: `src/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md` (WP-B residual gap).
- Backlog linkage: closes BR4 harness-loop runner stub residual after WP-B SDK transport landed.
- Source directive: `src/inbox/in/172979_05-27-26/72021_0359_feature-delivery-cursor-runner-harness-wiring/72021_0359_feature-delivery-cursor-runner-harness-wiring.md`.
- Active task: `24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance` under `src/work/172978_05-28-26/`.

## Open questions

_(none — directive is sufficiently specified for plan-stage delegation; documentation-surface choice and exact `compilePipeline` slice boundary are reserved for tech-lead plan-stage ratification per WP-3 and WP-5.)_

## Next operator steps

1. **What:** Read the canonical Engineering Spec and decide whether the intake artifact is acceptable for plan-stage delegation.
   **How:** Read-only: open `src/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md` and confirm the seven work-package acceptance blocks, the documentation-impact record, and the empty `## Open questions` section reflect the directive at `src/inbox/in/172979_05-27-26/72021_0359_feature-delivery-cursor-runner-harness-wiring/72021_0359_feature-delivery-cursor-runner-harness-wiring.md`.
2. **What:** Advance the feature-delivery run from `intake` to `plan` once the spec is accepted.
   **How:** From the repository root run:

   ```bash
   pnpm -w exec pan advance 24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance \
     --artifact src/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md
   ```

   Then confirm `src/work/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/state.json` shows `currentStage: plan` before delegating `tech-lead`.
