---
title: Ratify Inbox Lifecycle and Archival Mechanism
seq: "0003"
status: proposed
date: 2026-04-25
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
references:
  - kind: lines
    path: .docs/PRD.md
    range: [267, 267]
    contentHash: 2eb6aa4
    note: "PRD glossary defines Inbox as the bidirectional queue with in/out/thread paths."
  - kind: lines
    path: .docs/PRD.md
    range: [1037, 1037]
    contentHash: 2eb6aa4
    note: "PRD CLI surface includes `pan inbox` management verbs."
  - kind: lines
    path: AGENTS.md
    range: [101, 103]
    contentHash: b953d77
    note: "AGENTS defines `/lib/inbox/in/` as the canonical incoming work queue and `/lib/inbox/out/` as staged responses."
  - kind: lines
    path: AGENTS.md
    range: [130, 130]
    contentHash: b953d77
    note: "AGENTS workspace map defines `lib/inbox/{in,out,threads}/`."
  - kind: lines
    path: AGENTS.md
    range: [145, 146]
    contentHash: b953d77
    note: "AGENTS bootstrap status records that runtime/CLI execution wiring is not landed."
  - kind: lines
    path: .docs/BOOTSTRAP.md
    range: [49, 53]
    contentHash: b788753
    note: "Bootstrap scaffold includes `lib/inbox/{in,out,threads}/` as a required repository substrate."
  - kind: lines
    path: lib/memory/handbook/contract-style.md
    range: [60, 65]
    contentHash: 2d7acae
    note: "Layer 1 requires RFC 2119 keywords for normative statements."
  - kind: lines
    path: lib/memory/handbook/contract-style.md
    range: [114, 124]
    contentHash: 2d7acae
    note: "Layer 1 forbids weasel words in normative clauses."
---

## Context

Pancreator uses file-backed inbox paths for human-to-org intake and org-to-human
responses, but the repository does not yet ratify one lifecycle contract for
when an incoming item is active, complete, and moved out of the active queue.
Without one lifecycle, operators can process items but cannot apply a
deterministic archive transition.

The repository currently has the inbox directories and human-operated
procedures. The runtime/CLI automation surface is planned but not yet wired as
an executable flow. The lifecycle contract therefore MUST define a manual
archive mechanism now and a future automated mechanism that can replace manual
steps when the runtime lands.

## Decision

Pancreator SHALL adopt the inbound inbox lifecycle state model below for every
artifact that enters `/lib/inbox/in/`:

- `new`: the item exists in `/lib/inbox/in/` and no operator has claimed active
  execution.
- `in_progress`: an operator has claimed active execution and has begun
  producing the response artifact.
- `responded`: the required response artifact is present in `/lib/inbox/out/`, and
  the inbound item is complete for the current cycle.
- `archived`: the inbound item has been moved from `/lib/inbox/in/` to
  `/.pan/archive/inbox/in/` after the response is produced.

Pancreator SHALL use the following mechanism boundaries:

- Current mechanism (bootstrap and pre-runtime): operators MUST perform archive
  transitions manually by moving responded inbound files from `/lib/inbox/in/` to
  `/.pan/archive/inbox/in/`.
- Future mechanism (runtime/CLI): the runtime SHOULD provide an explicit
  archival operation (`pan inbox archive` or equivalent) that validates
  `responded` state and performs the archive move deterministically.

While runtime archival automation is not implemented, operators SHALL treat
`/lib/inbox/in/` as the active queue and `/.pan/archive/inbox/in/` as the canonical
archive location for completed inbound items.

## Status

Status is proposed on 2026-04-25 and awaits human ratification at the next
bootstrap phase boundary.

## Consequences

- positive: Operators gain one canonical lifecycle vocabulary that separates
  active intake work from archived intake history.
- positive: Manual archival now uses one deterministic path, which reduces
  queue ambiguity during bootstrap operations.
- negative: Until runtime automation lands, operators MUST execute and verify
  archive moves manually.
- negative: Existing tools that only read `/lib/inbox/in/` MUST be updated before
  they can surface archived intake records.
- neutral: This ADR ratifies lifecycle and file movement discipline only; it
  does not archive any file as part of ratification.
