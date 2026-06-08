---
title: Active memory tier README
slug: active-memory-readme
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tech-lead, supervisor]
purpose: |
  Operator-facing scope statement for the active-memory tier and exclusions
  that keep default Cursor context small.
references:
  - kind: lines
    path: lib/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [235, 251]
    contentHash: 9b2ddcc
    note: "Spec acceptance criteria require README scope and soft budgets."
  - kind: lines
    path: .pan/archive/inbox/in/172997_05-09-26/86400_0000_token-economy-enhanced.md
    range: [231, 251]
    contentHash: 188405e
    note: "Directive §2 defines README behavior and soft budgets. Source archived from lib/inbox/in/ per inbox-lifecycle handbook §3."
related:
  - /lib/memory/handbook/memory-tiers.md
  - /lib/memory/handbook/context-economy.md
  - /lib/memory/active/current.md
  - /lib/memory/active/runs.md
  - /lib/memory/active/handoffs.md
---

# Active memory tier

This directory holds **active-memory** only. The Feature cites scope rules at
`{kind: lines, path: lib/memory/features/active-memory-context-economy-pass-2/spec.md, range: [235, 251], contentHash: 9b2ddcc}`.

## What belongs here

When an operator edits active memory, the operator SHOULD store concise
summaries of current focus, Feature identifiers in flight, run identifiers,
risks, blockers, and soon-changing coordination notes.

When an operator adds navigation, the operator SHALL link to **durable-memory**
and **archival-memory** paths instead of embedding full specs or run logs.

When an operator tracks planning/execution handoffs, the operator SHALL store
only handoff pointers and status in `lib/memory/active/handoffs.md`. The full
handoff card SHALL live under `.pan/work/<day>/<task-id>/handoff.md` while the run
is active and under `.pan/archive/work/<day>/<task-id>/handoff.md` after
archival.

## What does not belong here

When an operator classifies bulky artifacts, the operator SHALL keep Feature
specs under `lib/memory/features/`, ADRs under `lib/memory/adr/`, backlog records under
`lib/memory/backlog/`, and active pipeline outputs under `.pan/work/`, and completed historical pipeline outputs under `.pan/archive/work/`.

When an operator handles generated indexes, manifests, or compliance JSON, the
operator SHALL treat those objects as **generated-machine-artifact** surfaces
outside this tier unless a ratified exception exists.

When an operator stores handbook doctrine or persona machinery, the operator
SHALL keep those files under **internal-operating-content** paths outside
`lib/memory/active/`.

## Soft budgets

When an author edits any file under `lib/memory/active/`, the author SHOULD keep
the prose body at most 1,000 words per file.

When an operator maintains the full tier, the operator SHOULD keep all files
under `lib/memory/active/` at most 5,000 words combined unless a human ratification
record raises the cap.

When an operator exceeds a soft budget, the operator SHALL promote enduring
facts into **durable-memory** and SHALL trim redundant prose here.
