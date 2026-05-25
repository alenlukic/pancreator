---
title: runner-cursor invokes Cursor SDK for real persona execution
feature_id: runner-cursor-sdk-invocation
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:01Z
references:
  - kind: path
    path: src/internal/packages/@tesseract/runner-cursor/
    note: CursorRunner.invoke currently returns a dryRun envelope; there is no Cursor agent transport.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: BR4 names runner-cursor as the substrate that closes the hand-orchestrated → pipeline-driven gap.
  - kind: path
    path: docs/PRD.md
    note: §11 lists runner-cursor as MVP; §6 prescribes the persona contract; §10 prescribes the run-log emission.
  - kind: path
    path: /Users/alen/.cursor/skills-cursor/sdk/SKILL.md
    note: Cursor SDK skill is available in this Cursor install; @cursor/sdk and cursor-sdk are the supported entry points.
---

# runner-cursor invokes Cursor SDK for real persona execution

## Problem

Phase 4 was ratified with the operator manually invoking each Cursor persona
and then calling `tess advance` with the validated stage artifact. The
`@tesseract/runner-cursor` package ships a `CursorRunner.invoke` that builds an
invocation envelope and returns `{dryRun: true}` without calling any model.
This is the substrate gap BR4 anticipated.

## Goal

Replace the dry-run stub with a real Cursor SDK invocation so a single persona
stage can run end-to-end without an operator pasting `next-prompt.md` into the
Cursor agent panel.

## Required outcomes

1. `CursorRunner.invoke` accepts a stage prompt path, a persona spec, and the
   active task ledger, and returns a typed result with the persona's emitted
   artifact path plus a structured run-log fragment.
2. The implementation uses `@cursor/sdk` (or the Python `cursor-sdk` if a
   Python sidecar is required) and respects persona `model`, `tools`,
   `disallowedTools`, and `maxTurns` from the 16-field spec.
3. Invocation respects `simple task mode` and never reads files outside the
   declared touch-set.
4. A feature flag (`tesseract.yaml: runner.cursor.invocation: manual | sdk`)
   selects between the existing manual workflow and the SDK invocation, with
   `manual` as the default until the conformance suite is green.
5. The run-log fragment carries OpenInference + OTel GenAI attributes per
   `src/memory/handbook/run-log-schema.md`.

## Acceptance criteria

- A vitest suite invokes `CursorRunner.invoke` against a stub persona prompt
  and asserts a non-dry-run envelope with the artifact path, the OpenInference
  span shape, and the touch-set bound.
- An end-to-end smoke test runs one stage of `feature-delivery` against the
  SDK runner, with the operator providing only the inbox directive and the
  pipeline producing the stage artifact without manual paste.
- Persona `disallowedTools` is enforced by the SDK invocation, not just the
  persona file.
- The feature flag default remains `manual` and is documented in
  `src/memory/handbook/persona-spec.md`.

## Out of scope

- Cohorted parallel pipelines (still single-pipeline-at-a-time per Q7).
- Full intervention spectrum (M2 scope).
- Sandbox-pool execution (M3 scope).

## Recommended downstream owners

- `tech-lead` for the plan and the runner-vs-manual feature-flag contract.
- `tesseract-engineer` for the SDK wiring and the conformance vitest.
- `reviewer` for the touch-set and disallowed-tool enforcement.
