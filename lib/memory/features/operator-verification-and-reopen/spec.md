---
id: operator-verification-and-reopen
title: Operator verification at close and task reopen
status: draft
stage: implement
owner: pancreator-engineer
created_at: "2026-06-04T12:00:00.000Z"
references:
  - kind: lines
    path: lib/memory/handbook/contract-templates/operator-verification.template.md
    range: [1, 40]
    contentHash: 464c0bb
    note: Canonical operator verification pack template.
  - kind: lines
    path: OPERATION.md
    range: [140, 180]
    contentHash: 90e3bfe
    note: Operator verification pack, ad-hoc close, and reopen commands.
---

# Engineering Spec — Operator verification at close and task reopen

## Goal

Require an operator-facing verification pack at pipeline and ad-hoc close, gate
archival on its presence, and provide `pan reopen` to unarchive closed tasks back
to `intake` or a named stage.

## Acceptance criteria

- AC1: `operator-verification.md` is scaffolded when feature-delivery reaches `complete`.
- AC2: `close-artifacts` fails closed when `operator-verification.md` is missing.
- AC3: `close-out-of-band` archives ad-hoc workspaces with verification pack and minimal state.
- AC4: `pan reopen` restores `archive/work/` to `work/`, sets `status: reopened`, and defaults to `intake`.
- AC5: `OPERATION.md` and `AGENTS.md` document verification, ad-hoc close, and reopen.

## Implementation notes

CLI modules: `operator-verification.ts`, `close-out-of-band.ts`, `reopen-feature-delivery.ts`.
Active-memory helpers: `patchFeatureIndexReopenedInbox`, `applyActiveMemoryRefreshOnReopen`.
