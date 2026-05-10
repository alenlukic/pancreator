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
    path: memory/features/active-memory-context-economy-pass-2/spec.md
    range: [235, 251]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: "Spec acceptance criteria require README scope and soft budgets."
  - kind: lines
    path: inbox/archive/in/75480_0302_token-economy-enhanced.md
    range: [231, 251]
    contentHash: fb1ac76d5d8075ee087808b7efbab96242534524d161f26db68b75f21ae37051
    note: "Directive §2 defines README behavior and soft budgets. Source archived from inbox/in/ per inbox-lifecycle handbook §3."
related:
  - /memory/handbook/memory-tiers.md
  - /memory/handbook/context-economy.md
  - /memory/active/current.md
  - /memory/active/runs.md
---

# Active memory tier

This directory holds **active-memory** only. The Feature cites scope rules at
`{kind: lines, path: memory/features/active-memory-context-economy-pass-2/spec.md, range: [235, 251], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.

## What belongs here

When an operator edits active memory, the operator SHOULD store concise
summaries of current focus, Feature identifiers in flight, run identifiers,
risks, blockers, and soon-changing coordination notes.

When an operator adds navigation, the operator SHALL link to **durable-memory**
and **archival-memory** paths instead of embedding full specs or run logs.

## What does not belong here

When an operator classifies bulky artifacts, the operator SHALL keep Feature
specs under `memory/features/`, ADRs under `memory/adr/`, backlog records under
`memory/backlog/`, and active pipeline outputs under `work/`, and completed historical pipeline outputs under `internal/work_archive/`.

When an operator handles generated indexes, manifests, or compliance JSON, the
operator SHALL treat those objects as **generated-machine-artifact** surfaces
outside this tier unless a ratified exception exists.

When an operator stores handbook doctrine or persona machinery, the operator
SHALL keep those files under **internal-operating-content** paths outside
`memory/active/`.

## Soft budgets

When an author edits any file under `memory/active/`, the author SHOULD keep
the prose body at most 1,000 words per file.

When an operator maintains the full tier, the operator SHOULD keep all files
under `memory/active/` at most 5,000 words combined unless a human ratification
record raises the cap.

When an operator exceeds a soft budget, the operator SHALL promote enduring
facts into **durable-memory** and SHALL trim redundant prose here.
