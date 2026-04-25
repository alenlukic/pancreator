---
title: Inbox Lifecycle and Archival Procedure
slug: inbox-lifecycle
stability: experimental
bootstrap-only: false
phase: 1
owners: [intake-analyst, supervisor, tech-writer, librarian]
purpose: |
  The canonical lifecycle contract for inbound inbox items, including state
  definitions, canonical inbox paths, and the minimum manual archive procedure
  required while runtime archival automation is not yet implemented.
references:
  - kind: lines
    path: memory/adr/0003-inbox-lifecycle-and-archival.md
    range: [74, 95]
    contentHash: TBD-on-commit
    note: "ADR-0003 decision defines the required lifecycle states and manual-versus-future automation boundary."
  - kind: lines
    path: PRD.md
    range: [267, 267]
    contentHash: TBD-on-commit
    note: "PRD glossary defines Inbox as a bidirectional queue with in/out/thread locations."
  - kind: lines
    path: PRD.md
    range: [1037, 1037]
    contentHash: TBD-on-commit
    note: "PRD CLI surface includes inbox management verbs."
  - kind: lines
    path: AGENTS.md
    range: [101, 103]
    contentHash: TBD-on-commit
    note: "AGENTS defines `/inbox/in/` and `/inbox/out/` as canonical operational queue paths."
  - kind: lines
    path: AGENTS.md
    range: [130, 130]
    contentHash: TBD-on-commit
    note: "AGENTS workspace map defines `inbox/{in,out,threads}/`."
  - kind: lines
    path: BOOTSTRAP.md
    range: [49, 53]
    contentHash: TBD-on-commit
    note: "Bootstrap scaffold includes inbox directories in the required repository substrate."
  - kind: lines
    path: memory/handbook/contract-style.md
    range: [60, 65]
    contentHash: TBD-on-commit
    note: "Layer 1 requires RFC 2119 keywords in normative prose."
related:
  - /memory/adr/0003-inbox-lifecycle-and-archival.md
  - /memory/handbook/backlog-format.md
  - /inbox/in/
  - /inbox/out/
  - /inbox/threads/
---

# Inbox Lifecycle

This page defines canonical paths and the minimum operator procedure for moving
completed inbound requests out of the active queue.

## 1 - Canonical locations

Operators SHALL use these canonical paths:

- Active queue: `/inbox/in/`
- Responses: `/inbox/out/`
- Threads: `/inbox/threads/`
- Archive: `/inbox/archive/in/`

Operators MUST NOT treat ad hoc directories as inbox sources of truth.

## 2 - Lifecycle states

Every inbound item SHALL progress through these states:

- `new`: item is present in `/inbox/in/` and is unclaimed.
- `in_progress`: item is actively being processed.
- `responded`: required response artifact exists in `/inbox/out/`.
- `archived`: inbound item has been moved to `/inbox/archive/in/`.

State transitions SHOULD be monotonic in this order:
`new -> in_progress -> responded -> archived`.

## 3 - Minimum manual procedure (current mechanism)

Until runtime/CLI automation lands, operators MUST use this procedure for each
completed inbound item:

1. Confirm the inbound request has reached `responded` state by verifying the
   corresponding response artifact exists in `/inbox/out/`.
2. Mark the inbound item complete by recording `responded` status in the
   operator handoff context (for example the active work note or run log entry
   that references the response artifact path).
3. Move the inbound source file from `/inbox/in/` to `/inbox/archive/in/`
   without changing the file basename.
4. Verify the source file no longer exists in `/inbox/in/` and exists in
   `/inbox/archive/in/`.

Operators SHALL execute archival moves only after the response artifact exists.

## 4 - Future automated mechanism

The runtime SHOULD expose an explicit archival operation (`tess inbox archive`
or equivalent) that:

- validates `responded` preconditions,
- performs the move from `/inbox/in/` to `/inbox/archive/in/`, and
- emits a run-log event with source and destination paths.

Until this automation is implemented, manual procedure in Section 3 remains
required.

## 5 - Stability

This page is bootstrap-canonical for inbox lifecycle usage. Promotion to
`stability: stable` requires ratified runtime automation and operational
validation in a dogfood run.
