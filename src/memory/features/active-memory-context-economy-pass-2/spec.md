---
title: Active Memory Separation and Cursor Context Economy Pass 2 Intake Spec
feature_id: active-memory-context-economy-pass-2
status: intake-closed
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: src/inbox/in/token-economy-enhanced.md
next_owner: tech-lead
next_stage: plan
extends_feature: cursor-token-economy
extends_relationship: extends-deferred-scope
intake_closure:
  human_approval_gate: pending
  channel: operator_cursor_chat
  note: |
    The intake-analyst opted out of the clarifying-question loop because the
    directive enumerates 12 implementation sections, 20 acceptance criteria,
    7 manual-validation steps, and explicit non-goals. Operator ratification
    is required because pass-2 edits protected surfaces (AGENTS.md, the
    `.cursor/rules/*.mdc` mirror layer, and the documentation-impact and
    policy-compliance route pointers).
intake_notes:
  - The directive at lines 99 to 478 of the source inbox item supplies fully
    actionable required-implementation sections; no material ambiguity remains
    for the canonical spec.
  - The `## Open questions` section is empty. Plan-stage latitude items move to
    `## Deferrals` and `## Plan-stage decisions required` because the directive
    explicitly authorizes the implementation to choose.
  - The intake-analyst MUST NOT modify the inbox source item per the
    intake-analyst persona contract; the source item retains its original body
    at `src/inbox/in/token-economy-enhanced.md`.
  - The phrase `simple task mode` appears in this spec as a backticked
    identifier coined by the source directive at lines 313 to 352. The Layer 1
    weasel-word ban for `simple` is acknowledged here as documented lint debt;
    the implementation MAY rename the mode in plan stage if a non-banned
    canonical name fits better, in which case the rename SHALL propagate
    across every cross-reference in the same delivery slice.
references:
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [1, 33]
    contentHash: fb1ac76
    note: "Operator-authored frontmatter declares feature id, owner, stage, and reference set for the pass-2 directive."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [37, 60]
    contentHash: fb1ac76
    note: "Context section quantifies the prior cache-read baseline near 770000 tokens after pass 1 against the prior 2200000-token average."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [62, 75]
    contentHash: fb1ac76
    note: "Problem section motivates the explicit memory-tier separation that pass 2 introduces."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [89, 97]
    contentHash: fb1ac76
    note: "Non-goals enumerate preservation constraints across PRD, BOOTSTRAP, memory, work, personas, and Cursor agents."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [101, 229]
    contentHash: fb1ac76
    note: "Required implementation §1 defines the active, durable, archival, internal, and generated-machine memory-tier taxonomy."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [231, 252]
    contentHash: fb1ac76
    note: "Required implementation §2 specifies the active-memory directory layout and the 1000-word per-file plus 5000-word tier-wide soft budgets."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [254, 276]
    contentHash: fb1ac76
    note: "Required implementation §3 specifies safe path classification with a no-unsafe-physical-migration constraint."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [278, 294]
    contentHash: fb1ac76
    note: "Required implementation §4 specifies the new ADR for active versus archival memory at the next available ADR sequence number."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [296, 311]
    contentHash: fb1ac76
    note: "Required implementation §5 specifies the context-economy and handbook index updates that route to active-memory and memory-tier guidance."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [313, 352]
    contentHash: fb1ac76
    note: "Required implementation §6 defines `simple task mode` default behavior and escalation criteria."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [353, 376]
    contentHash: fb1ac76
    note: "Required implementation §7 specifies further AGENTS slimming with an approximately 900-word soft budget and the 00-agents-md.mdc minimization."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [378, 402]
    contentHash: fb1ac76
    note: "Required implementation §8 specifies the second Cursor rule audit covering pancreator-engineer, persona-designer, intake-analyst, supervisor, tech-lead, and tech-writer."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [403, 426]
    contentHash: fb1ac76
    note: "Required implementation §9 specifies the seven memory-tier groups the context-budget report MUST emit."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [428, 444]
    contentHash: fb1ac76
    note: "Required implementation §10 specifies the .cursorindexingignore policy alignment with the new tier model."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [446, 457]
    contentHash: fb1ac76
    note: "Required implementation §11 specifies the model and context escalation guidance."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [459, 478]
    contentHash: fb1ac76
    note: "Required implementation §12 enumerates the documentation-impact surfaces and the backlog file the Feature MUST update."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [480, 503]
    contentHash: fb1ac76
    note: "Acceptance criteria items 1 through 20 anchor the gate semantics this spec mirrors."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [505, 515]
    contentHash: fb1ac76
    note: "Manual validation section enumerates the seven post-implementation operator checks."
  - kind: lines
    path: src/inbox/in/token-economy-enhanced.md
    range: [517, 535]
    contentHash: fb1ac76
    note: "Desired outcome section declares the directional cache-read token bands for routine, medium, and large tasks."
  - kind: lines
    path: src/memory/features/cursor-token-economy/spec.md
    range: [121, 224]
    contentHash: f44cc8e
    note: "Pass-1 spec defines the .cursorindexingignore policy, summary-first PRD reads, the context-budget tool, and the documentation-impact obligations that pass 2 extends."
  - kind: lines
    path: AGENTS.md
    range: [157, 189]
    contentHash: a29b04a
    note: "AGENTS workspace map block whose memory and work entries pass 2 extends with the new active-memory tier and tier classification annotations."
  - kind: lines
    path: AGENTS.md
    range: [92, 130]
    contentHash: a29b04a
    note: "AGENTS working-agreement block whose protected semantics pass 2 preserves through routing pointers when the directive slims AGENTS further."
  - kind: lines
    path: src/memory/handbook/context-economy.md
    range: [29, 73]
    contentHash: d890e2c
    note: "Existing context-economy policy that pass 2 extends with memory-tier routing, the `simple task mode` definition, and escalation guidance."
  - kind: lines
    path: src/memory/handbook/index.md
    range: [53, 70]
    contentHash: 3130f78
    note: "Handbook routing table whose row set pass 2 extends with active-memory and memory-tier intents."
  - kind: lines
    path: src/internal/tools/context-budget-report.mjs
    range: [1, 1]
    contentHash: 108ed9f
    note: "Existing context-budget reporter pass 2 extends with seven memory-tier groups."
  - kind: lines
    path: .cursorindexingignore
    range: [1, 1]
    contentHash: bdb0a62
    note: "Existing Cursor indexing-ignore file pass 2 audits and extends to align with the new memory-tier taxonomy."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [79, 100]
    contentHash: bb2a660
    note: "Operator-sandbox immunity rule excludes /src/inbox/notes/ from agent traversal across every pass 2 edit."
  - kind: lines
    path: src/memory/handbook/policy-compliance-contract.md
    range: [47, 98]
    contentHash: 971f594
    note: "Policy-compliance contract requires `/src/work/<day>/<task-id>/policy-compliance.json` for non-`src/work/` structural changes."
  - kind: lines
    path: src/memory/handbook/documentation-impact-contract.md
    range: [42, 102]
    contentHash: 38ed821
    note: "Documentation-impact contract requires the post-task decision record this Feature satisfies."
  - kind: lines
    path: src/memory/handbook/contract-style.md
    range: [50, 158]
    contentHash: 7c6ace0
    note: "Layer 1 style discipline (RFC 2119, EARS, atomic, active voice, quantification, weasel-word ban, glossary, sentence-length cap, dual-anchor citations) governs every clause in this spec."
---

# Spec

This Feature SHALL extend the pass-1 Cursor token-economy controls cited at
`{kind: lines, path: src/memory/features/cursor-token-economy/spec.md, range: [121, 224], contentHash: f44cc8e}`
with an explicit memory-tier taxonomy, a new `src/memory/active/` operator surface,
a `simple task mode`, narrower always-loaded context, narrower remaining
Cursor rule triggers, per-tier context-budget reporting, an updated
indexing-ignore policy, and explicit model and context escalation guidance per
the directive at
`{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [99, 478], contentHash: fb1ac76}`.

This Feature SHALL preserve every Persona, Skill, Pipeline, Spec Contract,
documentation-impact, policy-compliance, and inbox-lifecycle obligation cited
at
`{kind: lines, path: AGENTS.md, range: [92, 130], contentHash: a29b04a}`.

This Feature SHALL keep `docs/PRD.md`, `docs/BOOTSTRAP.md`, the `src/memory/` tree, the
`src/work/` tree, the `src/personas/` tree, and the `.cursor/agents/` tree reachable
for explicit human and agent reads per the non-goals at
`{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [89, 97], contentHash: fb1ac76}`.

## Acceptance criteria

### Memory-tier handbook page

- When the Feature lands the memory-tier model, the Feature MUST create one
  new handbook page at `src/memory/handbook/memory-tiers.md`.
- When the Feature authors `src/memory/handbook/memory-tiers.md`, the page MUST
  define the five tiers `active memory`, `durable memory`, `archival memory`,
  `internal operating content`, and `generated machine artifacts` per the
  directive at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [101, 229], contentHash: fb1ac76}`.
- When the Feature authors the memory-tier page, the page MUST list the
  current expected location for each tier.
- When the Feature authors the memory-tier page, the page MUST state that
  `src/work/**` is archival memory.
- When the Feature authors the memory-tier page, the page MUST state that
  archival memory is explicit-read by default.
- When the Feature authors the memory-tier page, the page MUST state that
  internal operating content is distinct from active memory.
- When the Feature authors the memory-tier page, the page MUST state that
  generated machine artifacts are excluded from default Cursor semantic
  indexing unless a specific task justifies inclusion.

### Active-memory directory and operator map

- When the Feature creates the active-memory tier, the Feature MUST create the
  directory `src/memory/active/`.
- When the Feature creates the active-memory tier, the Feature MUST add one
  file at `src/memory/active/README.md` that explains tier scope and exclusions.
- When the Feature creates the active-memory tier, the Feature MUST add one
  file at `src/memory/active/current.md` that contains short summaries and
  pointers without copied artifacts.
- When the Feature creates the active-memory tier, the Feature MUST add one
  file at `src/memory/active/runs.md` that stores active-run pointers without
  embedding full run artifacts.
- When the Feature documents the active-memory soft budgets, the page MUST
  state that each active-memory file SHOULD remain at most 1000 words.
- When the Feature documents the active-memory soft budgets, the page MUST
  state that the entire `src/memory/active/` tier SHOULD remain at most 5000
  words unless an explicit ratification record raises the cap.

### Path classification without unsafe migration

- When the Feature classifies existing paths, the Feature MUST classify
  `src/work/**`, `src/inbox/out/**`, and `src/inbox/threads/**` as archival memory.
- When the Feature classifies existing paths, the Feature MUST classify
  `src/memory/features/**`, `src/memory/adr/**`, and `src/memory/backlog/**` as durable
  memory.
- When the Feature classifies existing paths, the Feature MUST classify
  `src/memory/handbook/**`, `src/personas/**`, `src/skills/**`, `.cursor/rules/**`, and
  `.cursor/agents/**` as internal operating content.
- When the Feature classifies existing paths, the Feature MUST classify
  generated JSON, manifests, and dry-run or post-write outputs as generated
  machine artifacts.
- When the Feature evaluates physical migration of existing directory trees,
  the Feature MUST defer the migration unless the delivery slice ships
  reference updates, compatibility shims, tests, a migration manifest, and
  rollback notes per the directive at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [254, 276], contentHash: fb1ac76}`.
- When the Feature defers physical migration, the Feature MUST record the
  decision as an explicit compatibility deferral in the delivery slice rather
  than as an undocumented omission.

### Active-versus-archival memory ADR

- When the Feature ratifies the memory-tier model, the Feature MUST author one
  new Architecture Decision Record at
  `src/memory/adr/000X-active-vs-archival-memory.md` where `X` is the next
  available ADR sequence number after the current highest seed.
- When the Feature authors the new ADR, the ADR MUST record the problem
  statement, the selected memory-tier model, the reason `src/work/**` is archival
  by default, the reason `src/memory/active/**` exists, the active-to-durable
  promotion rule, the archival accessibility rule, and the deferred migrations
  per the directive at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [278, 294], contentHash: fb1ac76}`.

### Context-economy and handbook index updates

- When the Feature updates the context-economy handbook page, the Feature
  MUST extend `src/memory/handbook/context-economy.md` with the memory-tier
  routing rule.
- When the Feature updates the context-economy page, the page MUST route
  active-memory questions to `src/memory/active/current.md`.
- When the Feature updates the context-economy page, the page MUST route
  memory-tier questions to `src/memory/handbook/memory-tiers.md`.
- When the Feature updates the context-economy page, the page MUST state that
  `src/memory/active/**` is the only memory tier intended for routine default
  orientation.
- When the Feature updates the context-economy page, the page MUST state that
  `src/work/**` is archival memory and explicit-read only.
- When the Feature updates the context-economy page, the page MUST state that
  internal operating content loads by route rather than by wholesale sweep.
- When the Feature updates the context-economy page, the page MUST state that
  full `docs/PRD.md`, `docs/BOOTSTRAP.md`, durable feature memory, and archival run
  artifacts require task-specific justification.
- When the Feature updates the handbook routing index, the Feature MUST add
  one row to `src/memory/handbook/index.md` that routes active-memory questions
  to `src/memory/active/current.md`.
- When the Feature updates the handbook routing index, the Feature MUST add
  one row to `src/memory/handbook/index.md` that routes memory-tier questions to
  `src/memory/handbook/memory-tiers.md`.

### `simple task mode`

- When the Feature defines `simple task mode`, the Feature MUST publish one
  canonical definition either in `AGENTS.md`, in
  `src/memory/handbook/context-economy.md`, or in a new dedicated handbook page
  per the directive at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [313, 352], contentHash: fb1ac76}`.
- When the Feature defines `simple task mode`, the canonical definition MUST
  enumerate the small-edit, lint, typecheck, build, test, dependency
  inspection, file lookup, mechanical refactor, formatting fix, and
  maintenance task classes that `simple task mode` applies to.
- When the Feature defines `simple task mode` default behavior, the page MUST
  instruct agents not to read `docs/PRD.md` while `simple task mode` applies.
- When the Feature defines `simple task mode` default behavior, the page MUST
  instruct agents not to read `docs/BOOTSTRAP.md` while `simple task mode` applies.
- When the Feature defines `simple task mode` default behavior, the page MUST
  instruct agents not to traverse `src/memory/**` while `simple task mode`
  applies.
- When the Feature defines `simple task mode` default behavior, the page MUST
  instruct agents not to traverse `src/work/**` while `simple task mode` applies.
- When the Feature defines `simple task mode` default behavior, the page MUST
  instruct agents not to load Persona specs beyond the currently invoked
  Persona while `simple task mode` applies.
- When the Feature defines `simple task mode` default behavior, the page MUST
  instruct agents not to invoke subagents while `simple task mode` applies
  unless the operator request names a subagent explicitly.
- When the Feature defines `simple task mode` default behavior, the page MUST
  instruct agents to inspect only directly relevant files.
- When the Feature defines `simple task mode` default behavior, the page MUST
  instruct agents to prefer exact paths over broad codebase search.
- When the Feature defines `simple task mode` default behavior, the page MUST
  instruct agents to prefer the cheapest model that reliably completes the
  task.
- When the Feature defines `simple task mode` escalation, the page MUST list
  the six escalation triggers enumerated at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [344, 351], contentHash: fb1ac76}`.
- When an agent escalates context or model usage out of `simple task mode`,
  the agent MUST summarize the escalation rationale in the run-log entry or
  operator response.

### Slim always-loaded context

- When the Feature reviews `AGENTS.md`, the Feature MUST evaluate further
  prose reduction so the file functions as an operating card and a routing
  map rather than as a briefing.
- When the Feature reduces `AGENTS.md` prose, the Feature MUST preserve every
  normative semantic cited at
  `{kind: lines, path: AGENTS.md, range: [92, 130], contentHash: a29b04a}`.
- When the Feature reduces `AGENTS.md` prose, the Feature MUST preserve
  explicit route pointers for the policy-compliance contract, the
  documentation-impact contract, the inbox lifecycle, and the new
  memory-tier rules.
- When the Feature reduces `AGENTS.md` prose, the Feature SHOULD reach a soft
  budget at most 900 words measured across the prose body excluding code
  fences and tables.
- If `AGENTS.md` cannot reach the 900-word soft budget without harming
  operator clarity or repository safety, then the Feature MUST record the
  reason the larger size is retained inside the delivery report.

### Narrow remaining Cursor rule triggers

- When the Feature audits `.cursor/rules/*.mdc`, the audit MUST cover at least
  `pancreator-engineer.mdc`, `persona-designer.mdc`, `intake-analyst.mdc`,
  `supervisor.mdc`, `tech-lead.mdc`, and `tech-writer.mdc` per the directive
  at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [378, 402], contentHash: fb1ac76}`.
- When the Feature narrows `.cursor/rules/pancreator-engineer.mdc`, the
  Feature MUST remove `src/personas/**/*.md` from the default activation set
  unless the rule body specifically targets persona authoring.
- When the Feature audits the rule files, the Feature MUST avoid broad
  `src/memory/handbook/**/*.md` triggers when a narrower route resolves the rule
  intent.
- When the Feature audits the rule files, the Feature MUST keep `src/work/**`
  outside the default activation set unless the rule body specifically
  operates on run-log artifacts, plans, reviews, or delivery reports.
- When the Feature audits the rule files, the Feature MUST keep generated
  JSON outside the activation set unless the rule body specifically processes
  machine artifacts.
- When the Feature stages the rule audit, the Feature MUST emit one audit
  artifact that lists every reviewed rule, the prior glob set, the new glob
  set, and the rationale.

### Per-tier context-budget reporting

- When the Feature extends `src/internal/tools/context-budget-report.mjs`, the report MUST
  emit a per-tier footprint group for active memory covering
  `src/memory/active/**`.
- When the Feature extends the context-budget report, the report MUST emit a
  per-tier footprint group for durable memory covering `src/memory/features/**`,
  `src/memory/adr/**`, and `src/memory/backlog/**`.
- When the Feature extends the context-budget report, the report MUST emit a
  per-tier footprint group for archival memory covering `src/work/**`,
  `src/inbox/out/**`, and `src/inbox/threads/**`.
- When the Feature extends the context-budget report, the report MUST emit a
  per-tier footprint group for internal operating content covering
  `src/memory/handbook/**`, `src/personas/**`, `src/skills/**`, `.cursor/rules/**`, and
  `.cursor/agents/**`.
- When the Feature extends the context-budget report, the report MUST emit a
  per-tier footprint group for product context covering `docs/PRD.md`,
  `docs/PRD.summary.md`, `docs/PRD.index.md`, and `docs/BOOTSTRAP.md`.
- When the Feature extends the context-budget report, the report MUST emit a
  per-tier footprint group for source code covering `packages/**`,
  `tools/**`, and the test suites named under those trees.
- When the Feature extends the context-budget report, the report MUST emit a
  per-tier footprint group for generated machine artifacts covering generated
  JSON, manifests, dry-run outputs, post-write outputs, and lockfiles.
- When the Feature extends the context-budget report, the report MUST
  distinguish the approximate total corpus, the indexable default-context
  subset, the explicit-read-only subset, and the active-memory subset.
- When the Feature emits a token estimate, the report MUST label the
  `chars / 4` value as approximate per the directive at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [422, 426], contentHash: fb1ac76}`.
- When the Feature ships the report extensions, the Feature MUST update or
  add tests at `tests/context-budget-report.test.mjs` that cover the new
  per-tier grouping behavior.

### `.cursorindexingignore` alignment

- When the Feature audits `.cursorindexingignore`, the policy MUST keep
  `src/work/**`, `src/inbox/out/**`, and `src/inbox/threads/**` excluded from default
  Cursor semantic indexing.
- When the Feature audits `.cursorindexingignore`, the policy MUST keep
  generated manifests excluded from default Cursor semantic indexing.
- When the Feature audits `.cursorindexingignore`, the policy MUST keep
  generated JSON, generated index files, and generated report artifacts
  excluded unless an explicit rationale documents inclusion.
- When the Feature audits `.cursorindexingignore`, the policy MUST keep
  `pnpm-lock.yaml` excluded from default Cursor semantic indexing.
- When the Feature audits `.cursorindexingignore`, the policy MUST keep
  `.cursor/agents/**` excluded only after the operator confirms custom-agent
  discovery still works under that exclusion.
- When the Feature audits `.cursorindexingignore`, the policy MUST keep
  `src/memory/active/**` indexable by default.
- When the Feature audits `.cursorindexingignore`, the policy MUST narrow
  internal operating content indexing to selective routes rather than broad
  default sweeps.
- When the Feature changes `.cursorindexingignore`, the Feature MUST record
  the diff and the rationale in the delivery report.

### Model and context escalation guidance

- When the Feature documents escalation guidance, the Feature MUST publish
  one section in either `src/memory/handbook/context-economy.md` or `AGENTS.md`
  per the directive at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [446, 457], contentHash: fb1ac76}`.
- When the Feature documents escalation guidance, the section MUST state that
  Opus-class models are not the default for routine mechanical work.
- When the Feature documents escalation guidance, the section MUST state that
  `simple task mode` uses the cheapest model that reliably completes the
  task.
- When the Feature documents escalation guidance, the section MUST list
  ambiguous architecture, policy reasoning, cross-cutting refactor, and
  high-risk reasoning as the four canonical escalation triggers.
- When an agent escalates the model class or the context surface, the agent
  MUST state the escalation rationale in the same response.
- When the Feature documents escalation guidance, the section MUST NOT
  hardcode any provider-specific model selection because the repository does
  not yet implement runtime model selection.

### Documentation impact and backlog

- When the Feature applies the documentation-impact contract, the Feature
  MUST evaluate updates to `AGENTS.md`, every `.cursor/rules/*.mdc`,
  `.cursorindexingignore`, `src/memory/handbook/index.md`,
  `src/memory/handbook/context-economy.md`, `src/memory/handbook/memory-tiers.md`,
  the three new `src/memory/active/*.md` files, the new active-versus-archival
  ADR, `README.md`, and `src/memory/backlog/index.yaml`.
- When the Feature defers a documentation-impact update, the Feature MUST
  record the deferral rationale and one backlog linkage per the
  documentation-impact contract cited at
  `{kind: lines, path: src/memory/handbook/documentation-impact-contract.md, range: [42, 102], contentHash: 38ed821}`.
- When the Feature stages every governed change, the Feature MUST stage one
  policy-compliance artifact at `/src/work/<day>/<task-id>/policy-compliance.json` per
  the policy-compliance contract cited at
  `{kind: lines, path: src/memory/handbook/policy-compliance-contract.md, range: [47, 98], contentHash: 971f594}`.

### Preservation invariants

- When the Feature processes historical artifacts, the Feature MUST NOT
  delete any file under `src/work/**`.
- When the Feature processes historical artifacts, the Feature MUST NOT
  delete any file under `src/memory/**`.
- When the Feature processes historical artifacts, the Feature MUST NOT
  delete any generated manifest under `src/memory/**` or `src/work/**`.
- When the Feature edits Cursor rule projections mirrored from a Persona
  spec, the human operator MUST ratify the diff because mirror parity binds
  the Persona spec to the Cursor projection.
- When the Feature reads, traverses, or cites repository content, the
  Feature MUST NOT touch any path under `/src/inbox/notes/` per the operator
  sandbox rule cited at
  `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [79, 100], contentHash: bb2a660}`.

### Delivery report and operator validation

- When the Feature stages the delivery report, the report MUST list every
  staged change, every deferral, and every manual operator verification step
  Cursor requires before merge.
- When the Feature stages the delivery report, the report MUST request the
  seven operator post-implementation actions enumerated at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [505, 515], contentHash: fb1ac76}`.
- When the Feature stages the delivery report, the report MUST cite the
  directional cache-read token bands declared at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [517, 535], contentHash: fb1ac76}`
  as informational targets rather than as hard correctness gates.

## Out of scope

- This Feature SHALL NOT delete historical artifacts under `src/work/**`,
  `src/memory/**`, `src/inbox/out/**`, or `src/inbox/threads/**`.
- This Feature SHALL NOT weaken policy-compliance, documentation-impact,
  inbox-lifecycle, or human-ratification requirements.
- This Feature SHALL NOT hide `docs/PRD.md`, `docs/BOOTSTRAP.md`, the `src/memory/` tree,
  the `src/work/` tree, the `src/personas/` tree, or the `.cursor/agents/` tree from
  explicit human or agent reads.
- This Feature SHALL NOT modify Persona spec semantics, Persona role
  boundaries, Persona tool grants, or Persona safety constraints.
- This Feature SHALL NOT add provider-specific model selection logic because
  the repository does not yet implement runtime model selection.
- This Feature SHALL NOT read, write, traverse, or cite any file under
  `/src/inbox/notes/`.
- This Feature SHALL NOT physically migrate large existing directory trees
  unless the same delivery slice ships reference updates, compatibility
  shims, tests, a migration manifest, and rollback notes.
- This Feature SHALL NOT redesign the canonical inbox lifecycle states
  defined at
  `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [102, 113], contentHash: bb2a660}`.

## Human ratification required

The Feature SHALL stage the changes below behind explicit human approval
because each change touches a protected surface.

- When the Feature edits `AGENTS.md` to slim verbose operational detail, the
  human MUST ratify the diff before merge per the AGENTS self-protection rule
  at
  `{kind: lines, path: AGENTS.md, range: [203, 207], contentHash: a29b04a}`.
- When the Feature narrows the `globs` field on any `.cursor/rules/*.mdc`
  file mirrored from a Persona spec, the human MUST ratify the diff because
  the mirror parity rule binds the Persona spec and the Cursor projection
  together.
- When the Feature excludes any new path from default Cursor semantic
  indexing, the operator MUST confirm that explicit-read access still works
  for that path before the change merges.

## Plan-stage decisions required

The intake stage delegates the following implementation choices to the
`tech-lead` plan stage. Each decision below resolves an explicit latitude
slot the directive grants the implementation.

- D1. Choose the single canonical surface that publishes `simple task mode`:
  an `AGENTS.md` section, a new `src/memory/handbook/context-economy.md` section,
  or a new dedicated handbook page. The directive authorizes the
  implementation to choose at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [315, 318], contentHash: fb1ac76}`.
- D2. Choose the next available ADR sequence number for
  `src/memory/adr/000X-active-vs-archival-memory.md`. The directive authorizes the
  implementation to choose at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [282, 284], contentHash: fb1ac76}`.
- D3. Choose whether to ship a lightweight active-memory budget warning
  alongside the soft caps. The directive authorizes the implementation to
  choose at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [248, 252], contentHash: fb1ac76}`.
- D4. Choose the canonical surface for model-and-context escalation guidance:
  `src/memory/handbook/context-economy.md` or `AGENTS.md`. The directive
  authorizes the implementation to choose at
  `{kind: lines, path: src/inbox/in/token-economy-enhanced.md, range: [446, 449], contentHash: fb1ac76}`.
- D5. Choose whether `AGENTS.md` reaches the 900-word soft budget within
  this delivery slice. When the budget is not reached, the plan stage
  records the rationale.

## Deferrals

- The Feature MAY defer physical migration of large existing directory trees
  to a future delivery slice that ships reference updates, compatibility
  shims, tests, a migration manifest, and rollback notes.
- The Feature MAY defer one Cursor rule glob change to the backlog when the
  audit cannot prove that the narrower glob preserves the rule's intended
  activation surface.
- The Feature MAY defer the active-memory budget warning tooling to a future
  delivery slice when the delivery slice cannot ship the tool without churn.
- The Feature MAY defer the memory-tier addition to
  `src/memory/handbook/glossary.md` to a documentation-impact backlog item when
  the same slice does not have capacity to update the glossary atomically;
  the deferral SHALL link a backlog ID per the documentation-impact contract.

## Cross-references

- This Feature extends `src/memory/features/cursor-token-economy/`. The
  relationship is `extends-deferred-scope`, recorded in
  `src/memory/features/active-memory-context-economy-pass-2/index.json`.
- The `src/inbox/in/token-economy-enhanced.md` directive cites
  `src/internal/tools/context-budget-report.mjs`, `AGENTS.md`,
  `.cursor/rules/pancreator-engineer.mdc`,
  `src/memory/handbook/context-economy.md`, `.cursorindexingignore`, the `src/work/`
  tree, and the `src/memory/` tree as the surfaces this Feature edits or
  classifies; intake-stage produces this spec only and routes downstream
  execution after the `human_approval` gate clears.

## Open questions

- None.
