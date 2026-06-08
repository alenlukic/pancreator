---
id: surface-opt-p4-tighten-cursor-agents-retrieval-contracts
title: "surface-opt P4 — tighten .cursor/agents retrieval contracts"
status: draft
stage: intake
owner: intake-analyst
created_at: "2026-06-01T05:45:00.000Z"
program: pancreator-surface-optimization
track: D
piece: P4
governance: gov
depends_on: []
source_directive: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p4-agent-retrieval-contracts.md
references:
  - kind: lines
    path: lib/inbox/in/172974_06-01-26/75420_0303_surface-opt-p4-agent-retrieval-contracts.md
    range: [34, 105]
    contentHash: f86aabe
    note: "Source directive Problem, Goal, Touch set, Required outcomes (R1-R3), Acceptance criteria (AC1-AC4), Out of scope, Governance, Dependencies, and Implementation notes."
  - kind: lines
    path: .cursor/agents/coder.md
    range: [6, 66]
    contentHash: 61d635a
    note: "Representative projection that duplicates persona tool/disallowedTools/metadata YAML and cold-reads AGENTS plus full persona plus context-economy."
  - kind: lines
    path: AGENTS.md
    range: [90, 99]
    contentHash: b953d77
    note: "AGENTS §4.2 — each persona has exactly one canonical Cursor projection at .cursor/agents/<name>.md; persona files remain canonical source."
---

# Spec — tighten .cursor/agents retrieval contracts

## 1 — Context and motivation

Each `.cursor/agents/*.md` projection duplicates the full `tools`,
`disallowedTools`, and `metadata` YAML from its `lib/personas/<name>.md` source,
and its retrieval contract still routes the agent to cold-read AGENTS plus the
full persona spec plus context-economy at every routine stage (source directive
Problem). The `.cursor/agents/coder.md` file is a representative projection of
that duplicated authority and cold-read pattern. The duplicated authority
inflates cold-start reads, and the bounded `next-prompt.md` already carries the
stage scope each subagent needs. This feature tightens every
`.cursor/agents/*.md` retrieval contract so the bounded prompt is the first read,
gates broad-document reads behind explicit-escalation conditions, and drops the
duplicated persona YAML that the `lib/personas/<name>.md` source owns. This piece
ships in Track D step 2 with P3 per the source directive Sequencing paragraph.

## 2 — Requirements

**R1** Each `.cursor/agents/*.md` retrieval contract SHALL name `next-prompt.md`
or `handoff.md` as the first read.

**R2** Each `.cursor/agents/*.md` file SHALL gate every broad-document read
(AGENTS, full persona spec, context-economy) behind a named explicit-escalation
condition.

**R3** Each `.cursor/agents/*.md` file SHALL remove the duplicated `tools`,
`disallowedTools`, and `metadata` YAML that its `lib/personas/<name>.md` source
already owns.

## 3 — Acceptance criteria

- AC1: When an agent reads any `.cursor/agents/*.md` retrieval contract, the
  contract SHALL name `next-prompt.md` or `handoff.md` as the first read.
- AC2: When an agent reads any `.cursor/agents/*.md` file, the file SHALL list
  each broad-document read only under a named explicit-escalation condition.
- AC3: When a maintainer diffs any `.cursor/agents/*.md` file against its
  `lib/personas/<name>.md` source, the projection SHALL NOT duplicate the source
  `tools`, `disallowedTools`, or `metadata` YAML.
- AC4: When the delivering run reaches the review gate, the run SHALL record 1
  persona-designer review note in the handoff before advance.

## 4 — Touch set (projected)

| Path | Change type | Rationale |
|------|-------------|-----------|
| `.cursor/agents/*.md` | modify | Name `next-prompt.md` or `handoff.md` as the first read, gate broad-document reads behind named explicit-escalation conditions, and drop duplicated persona YAML (R1, R2, R3, AC1, AC2, AC3). |
| `.pan/work/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/handoff.md` | modify | Record 1 persona-designer review note before advance (AC4). |

## 5 — Out of scope

- This piece SHALL NOT modify any `lib/personas/<name>.md` source; persona-semantic
  changes route through `persona-designer` (source directive Out-of-scope bullet 1).
- This piece SHALL NOT alter the self-protected meta-persona role semantics
  (source directive Out-of-scope bullet 2).
- This piece SHALL NOT change the CLI or runner engine, reserved for Track O
  P5–P8 (source directive Out-of-scope bullet 3).
- This piece SHALL NOT change MCP handlers, active memory, the `state.json`
  shape, or the dashboard (source directive Out-of-scope bullet 4 and Touch-set
  guard paragraph).

## 6 — Governance

This piece carries the `[gov]` flag because it edits agent-projection surfaces
adjacent to persona authority (source directive Governance paragraph). The
delivering run SHALL record 1 persona-designer review in the handoff before
advance, per source directive Governance paragraph. The run SHALL NOT alter role
semantics, authority boundaries, tool grants, or safety constraints of any
persona (source directive Governance paragraph).

## 7 — Dependencies and sequencing

- This piece depends on no other piece (source directive Dependencies: none).
- This piece SHALL ship in Track D step 2 with P3, and every Track-D run through
  P4 SHALL reach archival close before the Track-O rebuild lands (source directive
  Sequencing paragraph).

## 8 — Open questions

_None. The source directive states R1–R3 and AC1–AC4 with quantified outcomes, an
explicit touch set, and explicit out-of-scope bounds, so the clarifying dialogue
closes at round 0._

## 9 — Revision history

| Date | Author | Change |
|------|--------|--------|
| 2026-06-01 | intake-analyst | Initial canonical spec from directive `75420_0303_surface-opt-p4-agent-retrieval-contracts.md`; 0 clarifying rounds. |
