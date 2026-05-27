---
title: Feature-delivery harness — wire CursorRunner through run and advance
feature_id: feature-delivery-cursor-runner-harness-wiring
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-27T03:59:38Z
references:
  - kind: lines
    path: src/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md
    range: [85, 91]
    contentHash: "5009d5a"
    note: WP-B acceptance — SDK invocation and feature-delivery smoke without manual paste.
  - kind: lines
    path: src/internal/packages/@tesseract/cli/src/feature-delivery-run.ts
    range: [286, 309]
    contentHash: "1131dfc"
    note: Current wiring — single intake smoke invoke; compiled graph discarded.
  - kind: lines
    path: src/work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/implementation-report.md
    range: [69, 82]
    contentHash: "pending"
    note: Known gaps — tess run default manual; CLI does not load .env.
  - kind: path
    path: src/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
    note: Parent M1 batch (WP-B partial delivery).
  - kind: path
    path: docs/PRD.md
    note: Harness loop and runner-cursor substrate (BR4).
---

# Feature-delivery harness — wire CursorRunner through run and advance

## Problem

M1 batch task `966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo`
delivered `@tesseract/runner-cursor` with live `@cursor/sdk` transport and LangGraph pipeline
compilation, but **`tess run feature-delivery` and `tess advance` do not use the runner as the
stage executor**.

Today `startFeatureDelivery` only:

1. Calls `CursorRunner.invoke` **once** at run creation for the **intake** stage.
2. Uses **`stubPersonaForStage`**, not the real persona markdown from `src/personas/`.
3. Discards the compiled graph (`void compiled`) and never calls `executePipeline`.
4. Leaves **`tess advance`** entirely manual (handoff / `next-prompt.md` / operator paste).

Operators with `CURSOR_API_KEY` in repo-root `.env` can prove SDK transport via a standalone
smoke script, but **`tess` does not load `.env`** and repo `tesseract.yaml` has no
`runner.cursor.invocation: sdk`, so the CLI path remains **`manual` by default**.

This gap blocks WP-B acceptance as written in the M1 feature spec: *“When an end-to-end smoke
test runs one `feature-delivery` stage via the SDK runner, `CursorRunner.invoke` SHALL complete
that stage without a manual paste step.”*

## Goal

Close the harness-loop gap so **`feature-delivery` can optionally execute stages through
`CursorRunner`** (SDK or manual per `tesseract.yaml`), with checkpoint/run-log alignment,
while preserving today’s manual-delegation path as the default until the operator opts in.

## Required outcomes

1. **Runner on advance (SDK path).** When `runner.cursor.invocation` is `sdk`, `advanceFeatureDelivery`
   SHALL invoke `CursorRunner` for the **entering** stage (or the stage being delegated per
   ledger contract), passing `next-prompt.md` path, expected artifact path, real persona resolution
   (from `src/personas/<name>.md` or validated projection), and ledger context.

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
   `tesseract.yaml` (already read by `readCursorInvocationMode`); add an example block to
   `tesseract-defaults.yaml` or handbook if missing.

6. **Tests.** Vitest coverage for: advance + sdk invokes transport (mocked); full inbox path on
   `tess run feature-delivery`; manual mode still does not call SDK; persona resolution fails
   closed on unknown persona.

## Acceptance criteria

- When `runner.cursor.invocation` is `sdk` and `CURSOR_API_KEY` is set, `pnpm -w exec tess advance
  <task-id> --artifact <stage-artifact>` after a stage completes SHALL record a non-stub
  `CursorRunner` invocation in `run.log.jsonl` for that stage transition.
- When invocation is `manual`, `tess run` and `tess advance` SHALL NOT call `@cursor/sdk`.
- When `pnpm -w exec tess run feature-delivery <day-bucket>/<file>.md` runs with `sdk`
  configured, at least one stage hook SHALL use real persona fields (model, tools, disallowedTools,
  maxTurns) from the persona spec—not `stubPersonaForStage` only.
- Package tests for `@tesseract/cli` and `@tesseract/runner-cursor` SHALL pass; existing M1
  touch-set regressions SHALL remain green.
- Implementation report or feature spec SHALL cite this inbox item as the tracking intake for
  harness-loop runner wiring.

## Out of scope

- Full unattended multi-stage feature-delivery without human gates (Phase-4 ledger gates remain).
- Replacing operator persona delegation in Cursor IDE when `manual` is selected.
- Live SDK calls in default CI (mock transport in unit tests; optional manual/scheduled smoke).
- Gate/loop YAML expression evaluation (separate follow-on).

## Suggested owners

| Area | Persona |
|---|---|
| Contract / touch-set | `tech-lead` |
| CLI + runner + pipeline wiring | `tesseract-engineer` or `coder` |
| Review + compliance | `reviewer` |

## Traceability

- Parent batch: `m1-substrate-runtime-batch` / inbox `2597_2316_m1-substrate-runtime-batch.md`
- Closed implement run: `966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo`
- Backlog linkage: closes residual **BR4** harness-loop stub behavior after WP-B transport landed
