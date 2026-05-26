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
    path: src/memory/adr/0003-inbox-lifecycle-and-archival.md
    range: [74, 95]
    contentHash: aa84cf148c94698899c74f51be5255337290b1ef08e84aedf916b89f19e757fd
    note: "ADR-0003 decision defines the required lifecycle states and manual-versus-future automation boundary."
  - kind: lines
    path: docs/PRD.md
    range: [267, 267]
    contentHash: e7226f12abc886237b6ac1510e8ce51f9aaaf0e24c11376107d50bd468359c59
    note: "PRD glossary defines Inbox as a bidirectional queue with in/out/thread locations."
  - kind: lines
    path: docs/PRD.md
    range: [1037, 1037]
    contentHash: 1b196129be3b8ea9d2f52cee6ea204bcbcbb0d970f0de6810e4dd0b8ae627b1e
    note: "PRD CLI surface includes inbox management verbs."
  - kind: lines
    path: AGENTS.md
    range: [101, 103]
    contentHash: 6fc43bd7967303a348658906c91b158737259088f5200c9e9d3ea420afb08ce6
    note: "AGENTS defines `/src/inbox/in/` and `/src/inbox/out/` as canonical operational queue paths."
  - kind: lines
    path: AGENTS.md
    range: [130, 130]
    contentHash: 84615919c53e378e2649c695bb306d0e08903a59e843af757757cfa1b54b7d3f
    note: "AGENTS workspace map defines `src/inbox/{in,out,threads}/`."
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [49, 53]
    contentHash: 214aec65730e2b02accc8be23f009a16d98509e930d3bff9bbc1389cd612a582
    note: "Bootstrap scaffold includes inbox directories in the required repository substrate."
  - kind: lines
    path: src/memory/handbook/contract-style.md
    range: [60, 65]
    contentHash: 6ea08ca23f1241425af057fc20324c9d18c456de7eaf1e25c5b0b56c4fcdb4d4
    note: "Layer 1 requires RFC 2119 keywords in normative prose."
  - kind: lines
    path: src/inbox/threads/172996_05-10-26/timestamp-naming-conventions/25121_1701_round-01-clarify-human-responses.md
    range: [79, 87]
    contentHash: fa0e81be4c4f848be79a91f7e0642a64f0cbd5b419cc415c36700119f1149468
    note: "Operator round-1 answer Q7 assigns prefix ownership to the active processing agent."
related:
  - /src/memory/adr/0003-inbox-lifecycle-and-archival.md
  - /src/memory/handbook/backlog-format.md
  - /src/inbox/in/
  - /src/inbox/out/
  - /src/inbox/threads/
  - /src/inbox/notes/
---

# Inbox Lifecycle

This page defines canonical paths and the minimum operator procedure for moving
completed inbound requests out of the active queue.

## 1 - Canonical locations

Operators SHALL use these canonical paths:

- Active queue: `/src/inbox/in/` (artifacts nest under `<day>/{SID}_{HHMM}_{semantic}.md` leaves without per-file task subdirectories)
- Responses: `/src/inbox/out/` (same day-bucket leaf layout as the active queue)
- Threads: `/src/inbox/threads/` (thread artifacts nest under `<day>/<feature-slug>/` with `{SID}_{HHMM}_{semantic}.md` leaves; primary discovery SHOULD use `src/inbox/artifact-index.json` when present)
- Archive: `/src/inbox/archive/in/` (same day-bucket leaf layout as the active queue)
- Operator sandbox: `/src/inbox/notes/` (human-only; see Section 1a)

Operators MUST NOT treat ad hoc directories as inbox sources of truth.

## 1a - Operator sandbox (`/src/inbox/notes/`)

`/src/inbox/notes/` is a human-operator-only scratch area for drafts, working
notes, and pre-intake material that is not yet ready for the active queue.

The following rules SHALL apply:

- Agents MUST NOT read, traverse, ingest, summarize, cite, or otherwise
  consume content from `/src/inbox/notes/`.
- Agents MUST NOT write to, move into, move out of, rename, or delete any
  file under `/src/inbox/notes/`.
- Agents MUST NOT treat `/src/inbox/notes/` as a directive source; only
  `/src/inbox/in/` is the canonical incoming work queue.
- Operators promote a notes draft into the active queue by manually moving
  the file from `/src/inbox/notes/` to `/src/inbox/in/`. Promotion MUST occur before
  any agent processes the content.
- Tools that scan inbox content (search indexers, citation resolvers,
  compliance descriptors, librarian crawlers) SHALL exclude `/src/inbox/notes/`
  from their traversal scope.

Semantic immutability and timestamp-prefix obligations defined elsewhere in
this contract do not apply to `/src/inbox/notes/` because it is operator-owned.

## 2 - Lifecycle states

Every inbound item SHALL progress through these states:

- `new`: item is present in `/src/inbox/in/` and is unclaimed.
- `in_progress`: item is actively being processed.
- `responded`: required response artifact exists in `/src/inbox/out/`.
- `archived`: inbound item has been moved to `/src/inbox/archive/in/`.

State transitions SHOULD be monotonic in this order:
`new -> in_progress -> responded -> archived`.

## 3 - Minimum manual procedure (current mechanism)

Until runtime/CLI automation lands, operators MUST use this procedure for each
completed inbound item:

1. Confirm the inbound request has reached `responded` state by verifying the
   corresponding response artifact exists in `/src/inbox/out/`.
2. Mark the inbound item complete by recording `responded` status in the
   operator handoff context (for example the active work note or run log entry
   that references the response artifact path).
3. Move the inbound source file from its path under `/src/inbox/in/` to the matching path under `/src/inbox/archive/in/`
   without changing the file basename (preserve the `<day>/` prefix segment and timestamp-prefixed leaf name when present).
4. Verify the source file no longer exists under `/src/inbox/in/` and exists under
   `/src/inbox/archive/in/`.

Operators SHALL execute archival moves only after the response artifact exists.

## 3a - Responding to outbox artifacts

When an outbox artifact in `/src/inbox/out/` requests operator answers for an
active thread, operators SHALL post replies under the referenced thread path in
`/src/inbox/threads/` (nested paths MUST stay under `<day>/<feature-slug>/` with timestamp-prefixed basenames; other inbox queues use `<day>/` leaves without per-file task subdirectories).

Operators MUST NOT move outbox artifacts into `/src/inbox/in/`.

Only inbound source items are archived by moving from `/src/inbox/in/` to
`/src/inbox/archive/in/` after completion criteria are satisfied.

## 3b - Semantic immutability and correction policy

Semantic content in `/src/inbox/in/`, `/src/inbox/out/`, and `/src/inbox/threads/` SHALL be
immutable once created.

When operators need to correct or add meaning-bearing content, they MUST use
append-only artifacts rather than in-place semantic rewrites. Valid mechanisms
are:

- a new thread round under the same thread path,
- a superseding outbox report under `/src/inbox/out/`, or
- a new inbound directive under `/src/inbox/in/`.

Operators MAY apply minimal non-semantic fixes in place only when clearly
needed (for example metadata typo correction). Every such exception MUST include
an explicit audit note in operator handoff context or run-log evidence that
identifies path, timestamp, and rationale.

## 3c - Timestamp prefix ownership (human-generated inbox)

When a human-generated artifact under `/src/inbox/in/` or `/src/inbox/threads/` lacks the
required UTC time-prefix tokens before downstream processing continues, the
agent processing that artifact SHALL append the two time-prefix segments.

When a later migration run encounters the same non-conforming basename, the
agent executing that migration SHALL apply the same prefix rule before archival
or pipeline handoff proceeds.

Where inbox policy names specific personas, this handbook rule SHALL remain
decoupled from persona identifiers so future roster changes do not invalidate
the obligation.

Citation: `{kind: lines, path: src/inbox/threads/172996_05-10-26/timestamp-naming-conventions/25121_1701_round-01-clarify-human-responses.md, range: [79, 87], contentHash: fa0e81be4c4f848be79a91f7e0642a64f0cbd5b419cc415c36700119f1149468}`.

## 3d - Empty directory hygiene

Renames and archival moves under `/src/inbox/in/`, `/src/inbox/out/`,
`/src/inbox/threads/`, and `/src/inbox/archive/in/` MUST NOT leave orphan empty
directories behind (for example empty day buckets or legacy per-file task folders
after a reshape).

When an agent or migration tool moves the last artifact out of an inbox
directory, that agent or tool MUST remove every resulting empty parent directory
under the affected queue, except queue roots that intentionally retain only
`.gitkeep`.

The migration tool `src/internal/tools/migrate-inbox-convention.mjs` SHALL run
empty-directory pruning automatically after every inbox write pass. Operators and
agents MAY also run a standalone hygiene pass:

```bash
node src/internal/tools/migrate-inbox-convention.mjs --prune-empty-dirs --dry-run
node src/internal/tools/migrate-inbox-convention.mjs --prune-empty-dirs --write
```

A `--dry-run` prune pass MUST list candidate empty directories without deleting
them. A `--write` prune pass MUST delete only directories that are still empty at
apply time. Pruning MUST NOT traverse or modify `/src/inbox/notes/`.

## 4 - Future automated mechanism

The runtime SHOULD expose an explicit archival operation (`tess inbox archive`
or equivalent) that:

- validates `responded` preconditions,
- performs the move from `/src/inbox/in/` to `/src/inbox/archive/in/`, and
- emits a run-log event with source and destination paths.

Until this automation is implemented, manual procedure in Section 3 remains
required.

## 5 - Stability

This page is bootstrap-canonical for inbox lifecycle usage. Promotion to
`stability: stable` requires ratified runtime automation and operational
validation in a dogfood run.
