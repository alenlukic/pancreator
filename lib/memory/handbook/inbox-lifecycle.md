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
    path: lib/memory/adr/0003-inbox-lifecycle-and-archival.md
    range: [74, 95]
    contentHash: 064d359
    note: "ADR-0003 decision defines the required lifecycle states and manual-versus-future automation boundary."
  - kind: lines
    path: .docs/PRD.md
    range: [267, 267]
    contentHash: 2eb6aa4
    note: "PRD glossary defines Inbox as a bidirectional queue with in/out/thread locations."
  - kind: lines
    path: .docs/PRD.md
    range: [1037, 1037]
    contentHash: 2eb6aa4
    note: "PRD CLI surface includes inbox management verbs."
  - kind: lines
    path: AGENTS.md
    range: [101, 103]
    contentHash: b953d77
    note: "AGENTS defines `/lib/inbox/in/` and `/lib/inbox/out/` as canonical operational queue paths."
  - kind: lines
    path: AGENTS.md
    range: [130, 130]
    contentHash: b953d77
    note: "AGENTS workspace map defines `lib/inbox/{in,out,threads}/`."
  - kind: lines
    path: .docs/BOOTSTRAP.md
    range: [49, 53]
    contentHash: b788753
    note: "Bootstrap scaffold includes inbox directories in the required repository substrate."
  - kind: lines
    path: lib/memory/handbook/contract-style.md
    range: [60, 65]
    contentHash: 2d7acae
    note: "Layer 1 requires RFC 2119 keywords in normative prose."
  - kind: lines
    path: lib/inbox/threads/172996_05-10-26/timestamp-naming-conventions/25121_1701_round-01-clarify-human-responses.md
    range: [79, 87]
    contentHash: fa0e81b
    note: "Operator round-1 answer Q7 assigns prefix ownership to the active processing agent."
related:
  - /lib/memory/adr/0003-inbox-lifecycle-and-archival.md
  - /lib/memory/handbook/backlog-format.md
  - /lib/inbox/in/
  - /lib/inbox/out/
  - /lib/inbox/threads/
  - /lib/inbox/notes/
---

# Inbox Lifecycle

This page defines canonical paths and the minimum operator procedure for moving
completed inbound requests out of the active queue.

## 0 - Local-only storage

`/lib/inbox/` is **gitignored** and holds transient local comms only. Operators
and tools MUST NOT commit inbox artifacts to version control. Fresh clones and
new workspaces materialize queue directories on demand (`pnpm -w exec pan init`,
`pnpm -w exec pan intake new`, or agent/tool writes). Durable copies of completed
inbound items belong under `/.pan/archive/inbox/in/` per Section 3.

## 1 - Canonical locations

Operators SHALL use these canonical paths:

- Active queue: `/lib/inbox/in/` (artifacts nest under `<day>/{SID}_{HHMM}_{semantic}.md` leaves without per-file task subdirectories)
- Responses: `/lib/inbox/out/` (same day-bucket leaf layout as the active queue)
- Threads: `/lib/inbox/threads/` (thread artifacts nest under `<day>/<feature-slug>/` with `{SID}_{HHMM}_{semantic}.md` leaves)
- Archive: `/.pan/archive/inbox/in/` (same day-bucket leaf layout as the active queue)
- Operator sandbox: `/lib/inbox/notes/` (human-only; see Section 1a)

Operators MUST NOT treat ad hoc directories as inbox sources of truth.

## 1a - Operator sandbox (`/lib/inbox/notes/`)

`/lib/inbox/notes/` is a human-operator-only scratch area for drafts, working
notes, and pre-intake material that is not yet ready for the active queue.

The following rules SHALL apply:

- Agents MUST NOT read, traverse, ingest, summarize, cite, or otherwise
  consume content from `/lib/inbox/notes/`.
- Agents MUST NOT write to, move into, move out of, rename, or delete any
  file under `/lib/inbox/notes/`.
- Agents MUST NOT treat `/lib/inbox/notes/` as a directive source; only
  `/lib/inbox/in/` is the canonical incoming work queue.
- Operators promote a notes draft into the active queue by manually moving
  the file from `/lib/inbox/notes/` to `/lib/inbox/in/`. Promotion MUST occur before
  any agent processes the content.
- Tools that scan inbox content (search indexers, citation resolvers,
  compliance descriptors, librarian crawlers) SHALL exclude `/lib/inbox/notes/`
  from their traversal scope.

Semantic immutability and timestamp-prefix obligations defined elsewhere in
this contract do not apply to `/lib/inbox/notes/` because it is operator-owned.

## 2 - Lifecycle states

Every inbound item SHALL progress through these states:

- `new`: item is present in `/lib/inbox/in/` and is unclaimed.
- `in_progress`: item is actively being processed.
- `responded`: required response artifact exists in `/lib/inbox/out/`.
- `archived`: inbound item has been moved to `/.pan/archive/inbox/in/`.

State transitions SHOULD be monotonic in this order:
`new -> in_progress -> responded -> archived`.

## 3 - Minimum manual procedure (current mechanism)

Until runtime/CLI automation lands, operators MUST use this procedure for each
completed inbound item:

1. Confirm the inbound request has reached `responded` state by verifying the
   corresponding response artifact exists in `/lib/inbox/out/`.
2. Mark the inbound item complete by recording `responded` status in the
   operator handoff context (for example the active work note or run log entry
   that references the response artifact path).
3. Move the inbound source file from its path under `/lib/inbox/in/` to the matching path under `/.pan/archive/inbox/in/`
   without changing the file basename (preserve the `<day>/` prefix segment and timestamp-prefixed leaf name when present).
4. Verify the source file no longer exists under `/lib/inbox/in/` and exists under
   `/.pan/archive/inbox/in/`.

Operators SHALL execute archival moves only after the response artifact exists.

## 3a - Responding to outbox artifacts

When an outbox artifact in `/lib/inbox/out/` requests operator answers for an
active thread, operators SHALL post replies under the referenced thread path in
`/lib/inbox/threads/` (nested paths MUST stay under `<day>/<feature-slug>/` with timestamp-prefixed basenames; other inbox queues use `<day>/` leaves without per-file task subdirectories).

### 3a.1 — Feature-delivery system outbox artifacts (SDK mode)

When `runner.cursor.invocation` is `sdk`, the feature-delivery runtime MAY write
timestamp-prefixed leaves under `/lib/inbox/out/<day-bucket>/` with basename shape
`{SID-prefix}_{HHMM}_{semantic-suffix}.md` per
`lib/memory/features/timestamp-naming-conventions/spec.md`.

| Artifact | Front matter | Operator action |
|---|---|---|
| Retry-limit halt | `gate: retry_limit_halt`, `task_id`, `feature_id`, `failing_stage`, `retry_count` | Inspect halt summary; use `repair-state` or ratify closure before restarting |
| Report approval gate | `gate: report_approval`, `decision: approve \| needs_changes`, `required_changes` | Edit decision; `pnpm -w exec pan advance <task-id> --artifact <outbox-path>` |

These artifacts are system-produced responses; operators MUST NOT move them into
`/lib/inbox/in/`.

Operators MUST NOT move outbox artifacts into `/lib/inbox/in/`.

Only inbound source items are archived by moving from `/lib/inbox/in/` to
`/.pan/archive/inbox/in/` after completion criteria are satisfied.

## 3b - Semantic immutability and correction policy

Semantic content in `/lib/inbox/in/`, `/lib/inbox/out/`, and `/lib/inbox/threads/` SHALL be
immutable once created.

When operators need to correct or add meaning-bearing content, they MUST use
append-only artifacts rather than in-place semantic rewrites. Valid mechanisms
are:

- a new thread round under the same thread path,
- a superseding outbox report under `/lib/inbox/out/`, or
- a new inbound directive under `/lib/inbox/in/`.

Operators MAY apply minimal non-semantic fixes in place only when clearly
needed (for example metadata typo correction). Every such exception MUST include
an explicit audit note in operator handoff context or run-log evidence that
identifies path, timestamp, and rationale.

## 3c - Timestamp prefix ownership (human-generated inbox)

When a human-generated artifact under `/lib/inbox/in/` or `/lib/inbox/threads/` lacks the
required UTC time-prefix tokens before downstream processing continues, the
agent processing that artifact SHALL append the two time-prefix segments.

When a later migration run encounters the same non-conforming basename, the
agent executing that migration SHALL apply the same prefix rule before archival
or pipeline handoff proceeds.

Where inbox policy names specific personas, this handbook rule SHALL remain
decoupled from persona identifiers so future roster changes do not invalidate
the obligation.

Citation: `{kind: lines, path: lib/inbox/threads/172996_05-10-26/timestamp-naming-conventions/25121_1701_round-01-clarify-human-responses.md, range: [79, 87], contentHash: fa0e81b}`.

## 3d - Empty directory hygiene

Renames and archival moves under `/lib/inbox/in/`, `/lib/inbox/out/`,
`/lib/inbox/threads/`, and `/.pan/archive/inbox/in/` MUST NOT leave orphan empty
directories behind (for example empty day buckets or legacy per-file task folders
after a reshape).

When an agent or migration tool moves the last artifact out of an inbox
directory, that agent or tool MUST remove every resulting empty parent directory
under the affected queue. Pruning MUST NOT remove queue roots that still contain
artifacts.

The migration tool `lib/internal/tools/migrate-inbox-convention.mjs` SHALL run
empty-directory pruning automatically after every inbox write pass. Operators and
agents MAY also run a standalone hygiene pass:

```bash
node lib/internal/tools/migrate-inbox-convention.mjs --prune-empty-dirs --dry-run
node lib/internal/tools/migrate-inbox-convention.mjs --prune-empty-dirs --write
```

A `--dry-run` prune pass MUST list candidate empty directories without deleting
them. A `--write` prune pass MUST delete only directories that are still empty at
apply time. Pruning MUST NOT traverse or modify `/lib/inbox/notes/`.

## 4 - Future automated mechanism

The runtime SHOULD expose an explicit archival operation (`pan inbox archive`
or equivalent) that:

- validates `responded` preconditions,
- performs the move from `/lib/inbox/in/` to `/.pan/archive/inbox/in/`, and
- emits a run-log event with source and destination paths.

Until this automation is implemented, manual procedure in Section 3 remains
required.

## 5 - Stability

This page is bootstrap-canonical for inbox lifecycle usage. Promotion to
`stability: stable` requires ratified runtime automation and operational
validation in a dogfood run.
