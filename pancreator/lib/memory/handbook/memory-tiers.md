---
slug: memory-tiers
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tech-lead, supervisor]
purpose: |
  Canonical six-tier taxonomy for classifying repository knowledge by default
  retrieval cost, durability, and operator-facing intent.
references:
  - '{"kind":"lines","path":"lib/memory/features/memory-context/active-memory-context-economy-pass-2/index.json","range":[212,312],"contentHash":"9b2ddcc","note":"Acceptance criteria anchor active-memory and memory-tier handbook obligations."}'
  - '{"kind":"lines","path":".pan/archive/inbox/in/172997_05-09-26/86400_0000_token-economy-enhanced.md","range":[101,230],"contentHash":"188405e","note":"Directive §1 defines tier purposes, locations, and rules."}'
related:
  - /lib/memory/handbook/context-economy.md
  - /lib/memory/handbook/simple-task-mode.md
  - /lib/memory/handbook/glossary.md
  - /lib/memory/active/README.md
...

# Operator section
- 👀 **In this file:** Memory tiers for Cursor context economy
- ⚖️ **Why it matters:** Quick orientation for Memory tiers for Cursor context economy before agents load the full contract.
- 🧭 **See also:**
  - /lib/memory/handbook/context-economy.md
  - /lib/memory/handbook/glossary.md
  - /lib/memory/active/README.md

# Memory tiers for Cursor context economy

This page defines the six context tiers agents use when they classify default
versus explicit-read context. The Feature cites this taxonomy at
`{kind: lines, path: lib/memory/features/memory-context/active-memory-context-economy-pass-2/index.json, range: [212, 312], contentHash: 9b2ddcc}`.

## Active memory

When an agent names **active-memory**, the agent SHALL treat the tier as
short-term operator-facing context with low default token load.

The canonical path prefix for active memory is `lib/memory/active/`.

When an operator maintains active memory, the operator SHOULD store current
focus, active Feature pointers, active run pointers, active handoff pointers,
current risks or blockers, and soon-changing operator notes only.

When an agent reads active memory, the agent SHALL prefer pointers to durable,
active-work, and archival artifacts instead of copying bulky sources.

When an operator tracks plan-to-execution state, the operator SHALL keep the
full handoff card in `.pan/work/<day>/<task-id>/handoff.md` and SHALL keep only a
pointer in `lib/memory/active/handoffs.md`.

When an agent classifies active memory, the agent SHALL treat active memory as
safe for routine default inspection and SHALL treat bulky generated output as
out of scope for this tier.

When an operator promotes knowledge out of active memory, the operator SHALL
move retained facts into **durable-memory** and SHALL keep linked archival paths
reachable by explicit read.

When an operator expires stale active-memory prose, the operator SHALL delete
or replace summaries so `lib/memory/active/**` does not become an archival mirror.

## External versus internal surfaces

When an agent names **external surface**, the agent SHALL treat paths documented
at `lib/memory/adr/0008-external-vs-internal-surfaces.md` as the default
feature-delivery context. The **agent operating card** (`AGENTS.md` or
`.pancreator/AGENTS.md`) is the primary cross-tool entry for delivery agents.
Human procedures live in `OPERATION.md`.

When an agent names **internal surface**, the agent SHALL treat `AGENTS.md`,
`.docs/**`, ADRs, backlog, bootstrap features, `tests/**`, and `client/` as
Pancreator self-development context excluded from default semantic indexing.

When `project_root` is `.pancreator`, the agent operating card SHALL resolve
to `.pancreator/AGENTS.md` via `resolveDeliveryOperatingCard` in
`@pancreator/core`.


## Active work

When an agent names **active-work**, the agent SHALL treat `.pan/work/**` as the
short-lived active run workspace, not as long-term memory.

When a run is active, blocked, or awaiting human ratification, the run SHALL
stay under `.pan/work/<day>/<task-id>/` and SHALL remain explicit-read only by
default.

When a run reaches `complete` and `pnpm -w exec pan close-artifacts <task-id>`
succeeds, the run SHALL reside under `.pan/archive/work/<day>/<task-id>/`. The CLI
performs the move; agents MUST NOT manually `mv` active runs during the index
stage. Update references after closure and leave only a small pointer in
`lib/memory/active/runs.md` when useful.

## Private SME memory

When an agent names **private SME memory**, the agent SHALL treat
`lib/memory/smes/<name>/` as long-lived, persona-scoped notes owned by the named
SME.

Only the owning SME persona and explicitly routed follow-on work SHOULD read or
extend that directory by default. Other agents SHALL treat SME memory as
explicit-read only and SHALL NOT sweep all SME trees for general context.

## Durable memory

When an agent names **durable-memory**, the agent SHALL treat the tier as
long-term ratified project memory.

Expected path prefixes include `lib/memory/features/`, `lib/memory/adr/`, and
`lib/memory/backlog/`. Technical-debt inventory and groomer backlog items SHALL
use `lib/memory/backlog/index.yaml` with `tags: [debt]` per
`lib/memory/handbook/backlog-format.md`; there is no separate debt tier path.

When an agent loads durable memory, the agent SHALL load explicit routes only
and SHALL avoid wholesale tree traversal unless the task names the Feature or
ADR.

When an agent indexes durable memory inside Cursor, the agent SHOULD index
selectively and SHALL treat generated indexes or reports as explicit-read
unless the task requires them.

## Archival memory

When an agent names **archival-memory**, the agent SHALL treat the tier as
historical execution artifacts and completed conversational material.

Expected path prefixes include `.pan/archive/work/`, `lib/inbox/out/`, `.pan/archive/inbox/`, and `lib/inbox/threads/`.

When an agent loads archival memory by default, the agent SHALL treat archival
memory as explicit-read only. `lib/inbox/notes/` is not archival memory; it is a
human-only operator sandbox that agents SHALL NOT traverse.

When an agent relies on `.cursorindexingignore` policy, the agent SHALL treat
archival memory paths as explicit-read defaults rather than default semantic
index targets.

When an operator copies archival artifacts into active memory, the operator
SHALL NOT paste full run payloads; the operator SHALL link by path instead.

## Internal operating content

When an agent names **internal-operating-content**, the agent SHALL treat the
tier as system machinery and operating doctrine distinct from **active-memory**.

Expected path prefixes include `lib/memory/handbook/`, `lib/personas/`, `lib/personas/skills/`,
`lib/personas/rules/`, and the implementation corpus under
`lib/internal/packages/`, `tests/`, and `lib/internal/tools/`. Local runtime
mirrors under `.cursor/agents/` and `.cursor/rules/` are gitignored; regenerate
them with `pan cursor-sync`. Cursor agent projections SHOULD stay compact and
route to canonical personas rather than duplicate persona bodies.

When an agent retrieves internal operating content, the agent SHALL load only
the handbook route, persona spec, skill, or rule the task names.

When an agent expands context broadly, the agent SHALL NOT sweep entire
handbook or persona trees without task-specific justification.

## Runtime checkpoints

When an agent names **runtime checkpoints**, the agent SHALL treat
`lib/memory/checkpoints/<task-id>/<seq>.json` as transient generated machine
artifacts emitted at stage boundaries, not as authored handbook or durable
memory.

The checkpoint store MAY be empty between runs and is expected to churn during
active pipeline execution. Agents SHALL NOT hand-edit checkpoint JSON except in
an explicit runtime-repair task.

## Generated machine artifacts

When an agent names **generated-machine-artifact**, the agent SHALL treat the
tier as machine-oriented outputs indexed for tooling rather than human
default reasoning.

Representative examples include generated JSON indexes, manifests, migration
dry-run outputs, compliance JSON artifacts, structured run logs referenced as
machine outputs, and bulk index JSON under `lib/memory/**`.

When an agent relies on default indexing policy, the agent SHALL exclude
generated machine artifacts unless the task documents a strong inclusion
rationale.

When an operator consumes generated outputs, the operator SHOULD read human
summaries first and SHALL open generated sources only for debugging or
verification.

## Cross-tier routing

When an agent routes memory-tier questions, the agent SHALL open
`lib/memory/handbook/index.md` and SHALL select the row that names this page.

When an agent asks what is currently active, the agent SHALL read
`lib/memory/active/current.md` first unless `lib/memory/handbook/simple-task-mode.md`
forbids memory traversal.
