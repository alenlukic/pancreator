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
    contentHash: aa84cf148c94698899c74f51be5255337290b1ef08e84aedf916b89f19e757fd
    note: "ADR-0003 decision defines the required lifecycle states and manual-versus-future automation boundary."
  - kind: lines
    path: PRD.md
    range: [267, 267]
    contentHash: e7226f12abc886237b6ac1510e8ce51f9aaaf0e24c11376107d50bd468359c59
    note: "PRD glossary defines Inbox as a bidirectional queue with in/out/thread locations."
  - kind: lines
    path: PRD.md
    range: [1037, 1037]
    contentHash: 1b196129be3b8ea9d2f52cee6ea204bcbcbb0d970f0de6810e4dd0b8ae627b1e
    note: "PRD CLI surface includes inbox management verbs."
  - kind: lines
    path: AGENTS.md
    range: [101, 103]
    contentHash: 6fc43bd7967303a348658906c91b158737259088f5200c9e9d3ea420afb08ce6
    note: "AGENTS defines `/inbox/in/` and `/inbox/out/` as canonical operational queue paths."
  - kind: lines
    path: AGENTS.md
    range: [130, 130]
    contentHash: 84615919c53e378e2649c695bb306d0e08903a59e843af757757cfa1b54b7d3f
    note: "AGENTS workspace map defines `inbox/{in,out,threads}/`."
  - kind: lines
    path: BOOTSTRAP.md
    range: [49, 53]
    contentHash: 214aec65730e2b02accc8be23f009a16d98509e930d3bff9bbc1389cd612a582
    note: "Bootstrap scaffold includes inbox directories in the required repository substrate."
  - kind: lines
    path: memory/handbook/contract-style.md
    range: [60, 65]
    contentHash: 6ea08ca23f1241425af057fc20324c9d18c456de7eaf1e25c5b0b56c4fcdb4d4
    note: "Layer 1 requires RFC 2119 keywords in normative prose."
  - kind: lines
    path: inbox/threads/timestamp-naming-conventions/round-01-clarify-human-responses.md
    range: [79, 87]
    contentHash: TBD-on-commit
    note: "Operator round-1 answer Q7 assigns prefix ownership to the active processing agent."
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

## 3a - Responding to outbox artifacts

When an outbox artifact in `/inbox/out/` requests operator answers for an
active thread, operators SHALL post replies under the referenced thread path in
`/inbox/threads/<thread-id>/`.

Operators MUST NOT move outbox artifacts into `/inbox/in/`.

Only inbound source items are archived by moving from `/inbox/in/` to
`/inbox/archive/in/` after completion criteria are satisfied.

## 3b - Semantic immutability and correction policy

Semantic content in `/inbox/in/`, `/inbox/out/`, and `/inbox/threads/` SHALL be
immutable once created.

When operators need to correct or add meaning-bearing content, they MUST use
append-only artifacts rather than in-place semantic rewrites. Valid mechanisms
are:

- a new thread round under the same thread path,
- a superseding outbox report under `/inbox/out/`, or
- a new inbound directive under `/inbox/in/`.

Operators MAY apply minimal non-semantic fixes in place only when clearly
needed (for example metadata typo correction). Every such exception MUST include
an explicit audit note in operator handoff context or run-log evidence that
identifies path, timestamp, and rationale.

## 3c - Timestamp prefix ownership (human-generated inbox)

When a human-generated artifact under `/inbox/in/` or `/inbox/threads/` lacks the
required UTC time-prefix tokens before downstream processing continues, the
agent processing that artifact SHALL append the two time-prefix segments.

When a later migration run encounters the same non-conforming basename, the
agent executing that migration SHALL apply the same prefix rule before archival
or pipeline handoff proceeds.

Where inbox policy names specific personas, this handbook rule SHALL remain
decoupled from persona identifiers so future roster changes do not invalidate
the obligation.

Citation: `{kind: lines, path: inbox/threads/timestamp-naming-conventions/round-01-clarify-human-responses.md, range: [79, 87], contentHash: TBD-on-commit}`.

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
