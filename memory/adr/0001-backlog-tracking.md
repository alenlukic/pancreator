---
title: Ratify Backlog Tracking Canon
seq: "0001"
status: proposed
date: 2026-04-25
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
references:
  - kind: lines
    path: PRD.md
    range: [259, 259]
    contentHash: TBD-on-commit
    note: "PRD glossary defines backlog as `/memory/backlog/`, the live ranked roadmap."
  - kind: lines
    path: PRD.md
    range: [378, 378]
    contentHash: TBD-on-commit
    note: "PRD memory layer includes backlog and requires dual-anchor cross-references."
  - kind: lines
    path: AGENTS.md
    range: [18, 29]
    contentHash: TBD-on-commit
    note: "AGENTS defines handbook and PRD as canonical authoring references."
  - kind: lines
    path: AGENTS.md
    range: [77, 83]
    contentHash: TBD-on-commit
    note: "AGENTS requires dual-anchor citations and Layer 1 style discipline."
  - kind: lines
    path: AGENTS.md
    range: [120, 121]
    contentHash: TBD-on-commit
    note: "AGENTS workspace map allocates `/memory/backlog/` as the backlog memory tier."
  - kind: lines
    path: BOOTSTRAP.md
    range: [51, 51]
    contentHash: TBD-on-commit
    note: "Bootstrap scaffolds `/memory/backlog/` as a required memory directory."
  - kind: lines
    path: BOOTSTRAP.md
    range: [264, 270]
    contentHash: TBD-on-commit
    note: "Bootstrap cross-cutting conventions require dual-anchor citations in artifacts."
  - kind: lines
    path: memory/handbook/glossary.md
    range: [225, 226]
    contentHash: TBD-on-commit
    note: "Handbook glossary defines Backlog ownership and scope."
  - kind: lines
    path: memory/handbook/contract-style.md
    range: [60, 63]
    contentHash: TBD-on-commit
    note: "Layer 1 requires RFC 2119 obligation keywords in normative statements."
  - kind: lines
    path: memory/handbook/contract-style.md
    range: [114, 124]
    contentHash: TBD-on-commit
    note: "Layer 1 bans weasel words in normative clauses."
---

## Context

Tesseract already defines `/memory/backlog/` as a durable memory tier and as
the live ranked roadmap, but the repo does not yet ratify one canonical file
path for tracking open and deferred work items. This gap creates inconsistent
capture across chat threads, bootstrap notes, and artifact reviews.

AGENTS and BOOTSTRAP require dual-anchor citations and Layer 1 discipline for
normative artifacts, so backlog tracking also requires one citation-bearing
record that every stage can reference and update through the same contract
surface.

## Decision

Tesseract SHALL track every open or deferred item in
`/memory/backlog/index.yaml`; `/memory/handbook/backlog-format.md` SHALL define
the human-readable schema for that index; and during bootstrap, every open or
deferred item recorded in chat notes or bootstrap notes MUST be copied into the
backlog index with `owner`, `milestone`, and `status` fields before phase-exit
ratification.

## Status

Status is proposed on 2026-04-25 and awaits human ratification at the next
phase boundary.

## Consequences

- positive: One canonical index path removes ambiguity about where open and
  deferred items are tracked.
- positive: A handbook schema reference standardizes how humans read and update
  backlog entries.
- negative: Bootstrap operators MUST run a one-time migration pass over open
  and deferred notes before the next phase gate.
- negative: Any workflow that stores open items outside the backlog index MUST
  be updated.
- neutral: This ADR does not change prioritization ownership, which remains
  with the `pm` persona.
