---
title: CLI stub-verb explicit deferral protocol
feature_id: cli-stub-verb-deferral-protocol
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:14Z
references:
  - kind: path
    path: src/internal/packages/@tesseract/cli/src/run.ts
    note: tess init, tess approve, tess memory, tess contracts, tess lint and the non-feature-delivery branch of tess run all return {"status":"stub"}.
  - kind: path
    path: src/internal/packages/@tesseract/mcp-server/
    note: Eight MCP tools mirror the same stubbed behavior; consistent protocol benefits both surfaces.
  - kind: path
    path: docs/PRD.md
    note: §9 claims the CLI grammar is operator-ready; today operators cannot tell which verbs work without invoking each.
  - kind: path
    path: src/personas/compliance-auditor.md
    note: Compliance-auditor expects deterministic CLI behavior; opaque stubs undermine audit reproducibility.
---

# CLI stub-verb explicit deferral protocol

## Problem

The `tess` CLI exposes verbs that are documented as MVP scope but are
implemented as `{"status":"stub"}` JSON. An operator who runs `tess init`
gets a success exit code and an opaque payload that does not say why the
verb is unimplemented, which milestone is responsible, or what the manual
workaround is. The same protocol gap covers the eight stubbed MCP tools.
This is a quiet operator-trust regression: stubs masquerade as working
commands.

## Goal

Replace the bare `{"status":"stub"}` envelope with a structured
deferral protocol that names the responsible milestone, points at the
manual workaround, and exits non-zero so operators and CI cannot
mistakenly treat the call as successful.

## Required outcomes

1. Every stub CLI verb returns a JSON envelope of the shape:
   ```json
   {
     "status": "deferred",
     "verb": "tess <name>",
     "milestone": "M1 | M2 | M3",
     "tracking_intake": "src/inbox/in/<day>/<file>.md",
     "manual_workaround": "<short paragraph>"
   }
   ```
   and exits non-zero with a stable error code.
2. The same envelope is returned by the corresponding MCP tool stubs,
   keyed by tool name rather than verb.
3. Each stub points at the intake item that tracks its implementation
   (where one exists in this batch) or the relevant PRD section.
4. Help output (`tess --help`, `tess <verb> --help`) marks deferred verbs
   with a `[deferred: <milestone>]` tag.
5. Unit tests assert the envelope shape, the non-zero exit code, and the
   stable error code.

## Acceptance criteria

- Running each currently-stubbed verb produces the deferral envelope,
  not the bare stub.
- A CI smoke test exercises every CLI verb at least once and asserts
  that no verb returns the historical `{"status":"stub"}` payload.
- AGENTS.md §6 references the deferral protocol as the canonical
  operator-friction contract.
- The compliance-auditor persona can rely on stable exit codes when
  evaluating CLI presence in broad sweeps.

## Out of scope

- Implementing the deferred verbs themselves (each is a separate intake).
- Localizing or templating the manual-workaround text beyond plain
  English.

## Recommended downstream owners

- `tech-lead` for the deferral envelope contract and the milestone map.
- `coder` for the CLI / MCP wiring.
- `reviewer` for the help-output and exit-code audit.
