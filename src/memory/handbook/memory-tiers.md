---
title: Memory tiers for Cursor context economy
slug: memory-tiers
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tech-lead, supervisor]
purpose: |
  Canonical six-tier taxonomy for classifying repository knowledge by default
  retrieval cost, durability, and operator-facing intent.
references:
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [212, 312]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: "Acceptance criteria anchor active-memory and memory-tier handbook obligations."
  - kind: lines
    path: src/inbox/archive/in/75480_0302_token-economy-enhanced.md
    range: [101, 230]
    contentHash: fb1ac76d5d8075ee087808b7efbab96242534524d161f26db68b75f21ae37051
    note: "Directive §1 defines tier purposes, locations, and rules."
related:
  - /src/memory/handbook/context-economy.md
  - /src/memory/handbook/glossary.md
  - /src/memory/active/README.md
---

# Memory tiers for Cursor context economy

This page defines the six context tiers agents use when they classify default
versus explicit-read context. The Feature cites this taxonomy at
`{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [212, 312], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.

## Active memory

When an agent names **active-memory**, the agent SHALL treat the tier as
short-term operator-facing context with low default token load.

The canonical path prefix for active memory is `src/memory/active/`.

When an operator maintains active memory, the operator SHOULD store current
focus, active Feature pointers, active run pointers, active handoff pointers,
current risks or blockers, and soon-changing operator notes only.

When an agent reads active memory, the agent SHALL prefer pointers to durable,
active-work, and archival artifacts instead of copying bulky sources.

When an operator tracks plan-to-execution state, the operator SHALL keep the
full handoff card in `src/work/<day>/<task-id>/handoff.md` and SHALL keep only a
pointer in `src/memory/active/handoffs.md`.

When an agent classifies active memory, the agent SHALL treat active memory as
safe for routine default inspection and SHALL treat bulky generated output as
out of scope for this tier.

When an operator promotes knowledge out of active memory, the operator SHALL
move retained facts into **durable-memory** and SHALL keep linked archival paths
reachable by explicit read.

When an operator expires stale active-memory prose, the operator SHALL delete
or replace summaries so `src/memory/active/**` does not become an archival mirror.


## Active work

When an agent names **active-work**, the agent SHALL treat `src/work/**` as the
short-lived active run workspace, not as long-term memory.

When a run is active, blocked, or awaiting human ratification, the run SHALL
stay under `src/work/<day>/<task-id>/` and SHALL remain explicit-read only by
default.

When a run completes, the `librarian` SHALL move the run to
`src/internal/work_archive/<day>/<task-id>/` during maintenance, update references,
and leave only a small pointer in `src/memory/active/runs.md` when useful.

## Durable memory

When an agent names **durable-memory**, the agent SHALL treat the tier as
long-term ratified project memory.

Expected path prefixes include `src/memory/features/`, `src/memory/adr/`, and
`src/memory/backlog/`.

When an agent loads durable memory, the agent SHALL load explicit routes only
and SHALL avoid wholesale tree traversal unless the task names the Feature or
ADR.

When an agent indexes durable memory inside Cursor, the agent SHOULD index
selectively and SHALL treat generated indexes or reports as explicit-read
unless the task requires them.

## Archival memory

When an agent names **archival-memory**, the agent SHALL treat the tier as
historical execution artifacts and completed conversational material.

Expected path prefixes include `src/internal/work_archive/`, `src/inbox/out/`, `src/inbox/archive/`, and `src/inbox/threads/`.

When an agent loads archival memory by default, the agent SHALL treat archival
memory as explicit-read only. `src/inbox/notes/` is not archival memory; it is a
human-only operator sandbox that agents SHALL NOT traverse.

When an agent relies on `.cursorindexingignore` policy, the agent SHALL treat
archival memory paths as explicit-read defaults rather than default semantic
index targets.

When an operator copies archival artifacts into active memory, the operator
SHALL NOT paste full run payloads; the operator SHALL link by path instead.

## Internal operating content

When an agent names **internal-operating-content**, the agent SHALL treat the
tier as system machinery and operating doctrine distinct from **active-memory**.

Expected path prefixes include `src/memory/handbook/`, `src/personas/`, `src/skills/`,
`.cursor/rules/`, `.cursor/agents/`, and the implementation corpus under
`src/internal/packages/`, `tests/`, and `src/internal/tools/`. Cursor agent projections SHALL stay
compact and route to canonical personas rather than duplicate persona bodies.

When an agent retrieves internal operating content, the agent SHALL load only
the handbook route, persona spec, skill, or rule the task names.

When an agent expands context broadly, the agent SHALL NOT sweep entire
handbook or persona trees without task-specific justification.

## Generated machine artifacts

When an agent names **generated-machine-artifact**, the agent SHALL treat the
tier as machine-oriented outputs indexed for tooling rather than human
default reasoning.

Representative examples include generated JSON indexes, manifests, migration
dry-run outputs, compliance JSON artifacts, and structured run logs referenced
as machine outputs.

When an agent relies on default indexing policy, the agent SHALL exclude
generated machine artifacts unless the task documents a strong inclusion
rationale.

When an operator consumes generated outputs, the operator SHOULD read human
summaries first and SHALL open generated sources only for debugging or
verification.

## Cross-tier routing

When an agent routes memory-tier questions, the agent SHALL open
`src/memory/handbook/index.md` and SHALL select the row that names this page.

When an agent asks what is currently active, the agent SHALL read
`src/memory/active/current.md` first unless `simple task mode` forbids memory
traversal per `src/memory/handbook/context-economy.md`.
