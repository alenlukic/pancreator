---
title: Feature-delivery harness — wire CursorRunner through run and advance
feature_id: feature-delivery-cursor-runner-harness-wiring
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-27T03:59:38Z
references:
  - kind: lines
    path: lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md
    range: [85, 91]
    contentHash: "5009d5a"
    note: WP-B acceptance — SDK invocation and feature-delivery smoke without manual paste.
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/lib/feature-delivery-run.ts
    range: [286, 309]
    contentHash: "1131dfc"
    note: Current wiring — single intake smoke invoke; compiled graph discarded.
  - kind: lines
    path: work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/implementation-report.md
    range: [69, 82]
    contentHash: "pending"
    note: Known gaps — pan run default manual; CLI does not load .env.
  - kind: path
    path: lib/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
    note: Parent M1 batch (WP-B partial delivery).
  - kind: path
    path: docs/PRD.md
    note: Harness loop and runner-cursor substrate (BR4).
  - kind: lines
    path: OPERATION.md
    range: [26, 94]
    contentHash: "pending"
    note: Already-specified manual feature-delivery loop and post-invocation state machine semantics that this intake extends rather than redefines.
  - kind: lines
    path: lib/pipelines/feature-delivery.yaml
    range: [25, 67]
    contentHash: "pending"
    note: Canonical pipeline stage order and persona ownership.
  - kind: lines
    path: lib/personas/coder.md
    range: [81, 167]
    contentHash: "pending"
    note: Implement-stage re-entry contract and test obligations for code changes.
  - kind: lines
    path: lib/personas/reviewer.md
    range: [90, 145]
    contentHash: "pending"
    note: Review-stage gate semantics and must-fix re-entry behavior.
  - kind: lines
    path: lib/personas/qa-tester.md
    range: [89, 180]
    contentHash: "pending"
    note: Test-stage verification contract and severity-based re-entry routing expectations.
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    range: [77, 82]
    contentHash: "pending"
    note: Outbox filename timestamp-prefix requirement.
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [69, 75]
    contentHash: "pending"
    note: Canonical inbox/outbox path and naming layout.
---

# Feature-delivery harness — wire CursorRunner through run and advance

## Problem

M1 batch task `966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo`
delivered `@pancreator/runner-cursor` with live `@cursor/sdk` transport and LangGraph pipeline
compilation, but **`pan run feature-delivery` and `pan advance` do not use the runner as the
stage executor**.

Today `startFeatureDelivery` only:

1. Calls `CursorRunner.invoke` **once** at run creation for the **intake** stage.
2. Uses **`stubPersonaForStage`**, not the real persona markdown from `lib/personas/`.
3. Discards the compiled graph (`void compiled`) and never calls `executePipeline`.
4. Leaves **`pan advance`** entirely manual (handoff / `next-prompt.md` / operator paste).

Operators with `CURSOR_API_KEY` in repo-root `.env` can prove SDK transport via a standalone
smoke script, but **`pan` does not load `.env`** and repo `pancreator.yaml` has no
`runner.cursor.invocation: sdk`, so the CLI path remains **`manual` by default**.

This gap blocks WP-B acceptance as written in the M1 feature spec: *“When an end-to-end smoke
test runs one `feature-delivery` stage via the SDK runner, `CursorRunner.invoke` SHALL complete
that stage without a manual paste step.”*

## Goal

Close the harness-loop gap so **`feature-delivery` can optionally execute stages through
`CursorRunner`** (SDK or manual per `pancreator.yaml`), with checkpoint/run-log alignment,
while preserving today’s manual-delegation path as the default until the operator opts in.

## Required outcomes

1. **Runner on advance (SDK path).** When `runner.cursor.invocation` is `sdk`, `advanceFeatureDelivery`
   SHALL invoke `CursorRunner` for the **entering** stage (or the stage being delegated per
   ledger contract), passing `next-prompt.md` path, expected artifact path, real persona resolution
   (from `lib/personas/<name>.md` or validated projection), and ledger context.

2. **Runner on run (configurable).** `startFeatureDelivery` SHALL either remove the one-off stub
   smoke or replace it with the same invocation contract used on advance; it MUST NOT be the only
   runner touchpoint.

3. **Pipeline integration (minimal slice).** The implementor SHALL wire `compilePipeline` +
   `executePipeline` (or an equivalent compiled-graph step driver) so stage order and intervention
   side-channel semantics are exercised on at least one SDK-backed stage transition—not only a
   discarded compile call.

4. **Environment ergonomics.** The CLI SHALL load repo-root `.env` for subprocess/SDK calls when
   the file exists (without committing secrets), OR the handbook SHALL document a single supported
   operator pattern; loading `.env` is preferred for dogfood parity with local `.env` setup.

5. **Configuration.** Document and support `runner.cursor.invocation: manual | sdk` in
   `pancreator.yaml` (already read by `readCursorInvocationMode`); add an example block to
   `pancreator-defaults.yaml` or handbook if missing.

6. **Tests.** Vitest coverage for: advance + sdk invokes transport (mocked); full inbox path on
   `pan run feature-delivery`; manual mode still does not call SDK; persona resolution fails
   closed on unknown persona.

## Target state machine (automated harness)

This section defines net-new state-machine behavior that SHALL apply when CursorRunner/harness
wiring lands. Existing stage order, stage owners, and manual `pan advance` loop semantics are
already specified elsewhere in `OPERATION.md`, `lib/pipelines/feature-delivery.yaml`, and persona
contracts; this intake only captures automation deltas.

### Already specified elsewhere (reference only)

- Stage inventory, owner mapping, and baseline transition graph remain defined in
  `lib/pipelines/feature-delivery.yaml`.
- Manual operator-led delegation and existing `must_fix` / `qa_fails` branch semantics remain
  defined in `OPERATION.md`.
- Stage-local persona obligations for `implement`, `review`, and `test` remain defined in
  `lib/personas/coder.md`, `lib/personas/reviewer.md`, and `lib/personas/qa-tester.md`.
- Inbox queue location and timestamp-prefixed outbox naming conventions remain defined in
  `lib/memory/handbook/inbox-lifecycle.md` and
  `lib/memory/features/timestamp-naming-conventions/spec.md`.

### Net-new automation rules

1. **Default progression.** When `runner.cursor.invocation` is `sdk`, the feature-delivery runtime
   SHALL auto-advance stage-to-stage without operator intervention unless one of the exceptions
   below applies.
2. **Combined review+test retry budget.** The runtime SHALL maintain one cumulative retry counter
   across automatic loopbacks triggered by `must_fix` and `qa_fails` events. The counter SHALL cap
   at **3** automatic retries per run total.
3. **Automatic re-entry targeting.**
   - A `must_fix` result from `review` SHALL auto-route to `implement`.
   - A `qa_fails` result from `test` SHALL auto-route to `implement` for bounded fixes, OR to
     `plan` when `qa-tester` marks the failure as plan-invalidating or scope-invalidating.
   - Every automatic loopback from `review` or `test` SHALL consume one retry budget unit.
4. **Retry-limit terminal halt.** When the combined retry counter exceeds the 3-attempt cap, the
   runtime SHALL transition to a terminal halted state, SHALL emit a summary/status line to stdout
   for the invoking environment, and SHALL create one operator-facing outbox artifact under
   `lib/inbox/out/<day-bucket>/` using the timestamp-prefixed basename convention already specified
   elsewhere.
5. **Report-stage human gate.** After `report` is generated, the runtime SHALL stop for final human
   approval and SHALL create one outbox artifact for operator disposition. The outbox front matter
   SHALL include, at minimum, run identity (`task_id`, `feature_id`), gate type (`report_approval`),
   one decision field with allowed values `approve | needs_changes`, and a free-text field for
   required changes when `needs_changes` is selected. Detailed inbox schema remains governed by
   existing inbox contracts.
6. **Stage re-entry / reinvocation.** The runtime SHALL support reinvocation from an explicit stage
   boundary (`plan`, `implement`, or later valid stage) using any task-relevant artifact (for
   example spec, `next-prompt.md`, or outbox item) plus operator prose context.
7. **Logic-change quality gate.** When a change introduces or modifies logic, the run MUST include
   covering tests and manual QA evidence. If QA fails, `qa-tester` SHALL select re-entry to `plan`
   or `implement` based on seriousness.

## Acceptance criteria

- When `runner.cursor.invocation` is `sdk` and `CURSOR_API_KEY` is set, `pnpm -w exec pan advance
  <task-id> --artifact <stage-artifact>` after a stage completes SHALL record a non-stub
  `CursorRunner` invocation in `run.log.jsonl` for that stage transition.
- When invocation is `manual`, `pan run` and `pan advance` SHALL NOT call `@cursor/sdk`.
- When `pnpm -w exec pan run feature-delivery <day-bucket>/<file>.md` runs with `sdk`
  configured, at least one stage hook SHALL use real persona fields (model, tools, disallowedTools,
  maxTurns) from the persona spec—not `stubPersonaForStage` only.
- Package tests for `@pancreator/cli` and `@pancreator/runner-cursor` SHALL pass; existing M1
  touch-set regressions SHALL remain green.
- Implementation report or feature spec SHALL cite this inbox item as the tracking intake for
  harness-loop runner wiring.
- In `sdk` mode, a passing `review` or `test` gate SHALL auto-advance the runtime to the next stage
  without requiring a manual `pan advance` command.
- Across one run, automatic loopbacks caused by `must_fix` and `qa_fails` SHALL stop after 3
  cumulative retries and SHALL transition to a terminal halted status.
- On retry-limit halt, the runtime SHALL write one timestamp-prefixed artifact to
  `lib/inbox/out/<day-bucket>/`, and the invoking process SHALL print a halt summary to stdout that
  includes run id, failing stage, retry count, and outbox artifact path.
- After `report`, the runtime SHALL pause for human approval and SHALL emit one outbox artifact that
  supports operator response values `approve` or `needs_changes` with required change prose.
- Reinvocation at an explicit stage with an artifact path plus operator context SHALL resume from
  that stage and SHALL preserve run-log continuity.
- For any run where logic changed, QA evidence SHALL include automated test outcomes and manual QA;
  failed QA SHALL record re-entry target `plan` or `implement` selected by `qa-tester`.

## Out of scope

- Fully unattended completion through final ship/index closure without report/failure human gate
  decisions.
- Replacing operator persona delegation in Cursor IDE when `manual` is selected.
- Live SDK calls in default CI (mock transport in unit tests; optional manual/scheduled smoke).
- Gate/loop YAML expression evaluation (separate follow-on).

## Suggested owners

| Area | Persona |
|---|---|
| Contract / touch-set | `tech-lead` |
| CLI + runner + pipeline wiring | `pancreator-engineer` or `coder` |
| Review + compliance | `reviewer` |

## Traceability

- Parent batch: `m1-substrate-runtime-batch` / inbox `2597_2316_m1-substrate-runtime-batch.md`
- Closed implement run: `966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo`
- Backlog linkage: closes residual **BR4** harness-loop stub behavior after WP-B transport landed
