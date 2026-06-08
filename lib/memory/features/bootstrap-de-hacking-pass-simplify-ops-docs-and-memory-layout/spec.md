---
title: "Bootstrap de-hacking pass — simplify ops, docs, and memory layout"
feature_id: bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout
status: intake-awaiting-ratification
next_owner: tech-lead
next_stage: plan
source_inbox_item: lib/inbox/in/172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md
intake_round: 1
work_packages:
  - id: wp-1-feature-folder-audit
    label: "WP-1 — Audit and move feature skeletons to backlog"
    primary_owner: librarian
    secondary_owner: tech-lead
  - id: wp-2-operation-md-extraction
    label: "WP-2 — Extract OPERATION.md and slim README.md"
    primary_owner: tech-writer
  - id: wp-3-operator-output-conformance
    label: "WP-3 — Operator-output conformance enforcement"
    primary_owner: pancreator-engineer
    secondary_owner: contract-writer
  - id: wp-4-backlog-debt-consolidation
    label: "WP-4 — Retire lib/memory/debt/ and update AGENTS workspace map"
    primary_owner: tech-lead
  - id: wp-5-ci-slim-and-librarian-gate
    label: "WP-5 — Slim CI workflows and define librarian pre-close validation"
    primary_owner: pancreator-engineer
    secondary_owner: librarian
  - id: wp-6-duplication-philosophy-sweep
    label: "WP-6 — Duplication and philosophy sweep across handbook, CLI, and agents"
    primary_owner: supervisor
    review_only_owner: persona-designer
human_gates:
  - intake_ratification
  - plan_ratification
  - implement_pause_resume_available
  - review_pass
  - report_acceptance
  - ship_local_diff_ratification
  - index_audit
references:
  - kind: lines
    path: lib/inbox/in/172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md
    range: [1, 196]
    contentHash: ea35250
    note: "Source directive — full canonical text including frontmatter, problem statement, R1–R7 outcomes, acceptance criteria, suggested work packages, and traceability."
  - kind: lines
    path: AGENTS.md
    range: [1, 296]
    contentHash: b953d77
    note: "Operating card — workspace map, delegation rules, working agreement, copy-paste command policy, and bootstrap status that this pass aligns the repository against."
  - kind: lines
    path: README.md
    range: [1, 250]
    contentHash: c32e865
    note: "Operator entry point — currently embeds the feature-delivery loop, advance-command table, manual workflow, and key-paths map that WP-2 extracts into OPERATION.md."
  - kind: lines
    path: lib/memory/handbook/operator-output-contract.md
    range: [1, 315]
    contentHash: 6ac0e9a
    note: "Next operator steps schema — §3.1 pan prefix, §3.4 fully formed copy-paste commands, and §7 prohibited content that WP-3 audits and enforces."
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [1, 217]
    contentHash: 2762053
    note: "Canonical inbox paths — §1 active queue, §1a operator sandbox exclusion, §3 minimum archival procedure that govern this directive's source path."
  - kind: lines
    path: lib/memory/backlog/index.yaml
    range: [1, 587]
    contentHash: c7bae7d
    note: "Backlog index — current ranked items and schema target for WP-1 relocated skeletons and WP-4 debt rollup."
  - kind: lines
    path: OPERATION.md
    range: [156, 180]
    contentHash: pending
    note: "Librarian pre-close validation — local quality gate that replaced GitHub Actions workflows removed in bootstrap."
  - kind: lines
    path: lib/personas/librarian.md
    range: [1, 185]
    contentHash: 3f338c1
    note: "Librarian persona — close-artifacts duty and pipeline-stage metadata that WP-5 extends with a pre-close test/fix obligation."
  - kind: lines
    path: .docs/PRD.summary.md
    range: [1, 54]
    contentHash: 35226da
    note: "Strategic context — compact PRD orientation that WP-2 may need to update when the operator doc layout changes."
  - kind: lines
    path: lib/memory/active/current.md
    range: [1, 97]
    contentHash: d1f6703
    note: "Active-memory current — shipped-feature roster used by WP-1 to discriminate implemented features from skeletons."
  - kind: lines
    path: lib/memory/handbook/context-economy.md
    range: [1, 260]
    contentHash: 4e3313a
    note: "Context economy contract — single-canonical-source policy underlying R1 duplication reduction."
  - kind: lines
    path: lib/memory/handbook/documentation-impact-contract.md
    range: [1, 115]
    contentHash: a4138fb
    note: "Documentation impact contract — mandatory per-task check that R7 invokes across every touched surface."
  - kind: lines
    path: lib/memory/handbook/subagent-model-tiers.md
    range: [1, 93]
    contentHash: bb78edf
    note: "Subagent tier policy — single canonical source for standard/complex tier semantics that R1 deduplicates against."
  - kind: lines
    path: pancreator.yaml
    range: [1, 39]
    contentHash: a7092be
    note: "Live phase tracking — Bootstrap Phase 5 in progress; this pass ships inside Phase 5 without changing phase exit semantics."
---

# Spec

This Feature SHALL execute a bounded **de-hacking pass** that removes
bootstrap-era duplication, aligns the repository with handbook canon, retires
non-load-bearing memory tiers, extracts a canonical operator how-to into
`OPERATION.md`, slims CI to a bootstrap-appropriate posture, and establishes a
**librarian pre-close validation** contract as the default local quality gate.
The pass SHALL NOT implement full unattended `feature-delivery` automation and
SHALL NOT build the v0 operator dashboard; both downstream tracks remain
out of scope and SHALL be unblocked rather than delivered by this Feature.

Delivery proceeds as six coordinated work packages (WP-1 through WP-6) under
one feature-delivery run. The pass closes the directive's R1–R7 required
outcomes and produces a single ratified delivery report citing each touched
surface.

## Naming reconciliation

The source directive frontmatter records `feature_id: bootstrap-de-hacking-pass`
at `lib/inbox/in/172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md` line 3.
The active feature-delivery run records
`featureId: bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout` at
`.pan/work/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/state.json`.
The canonical Feature id for downstream tracking SHALL be
`bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout` because that
slug matches both the active task id and the canonical Feature folder path. The
short slug `bootstrap-de-hacking-pass` SHALL remain valid only as the inbox
filename anchor and SHALL NOT appear as a feature folder name.

## Delivery phasing

Delivery SHALL proceed in three phases to respect dependency order.

| Phase | Work packages | Dependency constraint |
|---|---|---|
| Phase 1 | WP-1, WP-4 | Memory and workspace-map cleanup MUST precede WP-2 README/OPERATION extraction so the operator how-to references the post-cleanup layout. |
| Phase 2 | WP-2, WP-3, WP-6 | WP-2 OPERATION.md authoring MAY proceed in parallel with WP-3 operator-output enforcement and WP-6 duplication sweep once Phase 1 ships. |
| Phase 3 | WP-5 | CI slimming and librarian pre-close validation MUST land last so the new gate references the post-cleanup `OPERATION.md` and the consolidated backlog. |

Work packages within one phase MAY ship as one staged change set or as
sequential change sets at the plan-stage owner's discretion. The plan stage
SHALL ratify a single phasing choice and SHALL record it in `plan.md`.

## Acceptance criteria

### WP-1 — Feature folder audit and skeleton relocation

- When the plan stage authors the disposition table, the table SHALL classify
  each subdirectory of `lib/memory/features/` into exactly one of three
  buckets: `keep-implemented`, `relocate-to-backlog`, or `archive-or-delete`.

- When the disposition table classifies a folder as `keep-implemented`, the
  folder SHALL retain `spec.md`, `delivery-report.md`, and `index.json` and
  SHALL document at least one implemented substrate anchor — a package path,
  a CLI verb, a pipeline YAML, or a ratified dogfood evidence file — inside
  `index.json` under `artifact_index.implementation_surface`.

- When the disposition table classifies a folder as `relocate-to-backlog`,
  the implementor SHALL move the folder's spec content to a backlog item
  under `lib/memory/backlog/index.yaml` with the original `feature_id` as the
  backlog `id`, SHALL preserve any draft spec under
  `lib/memory/backlog/drafts/<feature-id>.md`, and SHALL delete the original
  folder under `lib/memory/features/`.

- When the disposition table classifies a folder as `archive-or-delete`, the
  implementor SHALL author a deletion or archival ADR under
  `lib/memory/adr/` that cites the source directive and the disposition table
  row, and SHALL update `lib/memory/features/index.json` in the same change
  set so the global feature index lists no orphan rows.

- When WP-1 ships, `lib/memory/features/` SHALL contain exclusively folders
  classified as `keep-implemented` in the disposition table, and
  `lib/memory/active/current.md` § "Most recent shipped Features" SHALL list
  only rows that match a `keep-implemented` folder.

### WP-2 — OPERATION.md extraction and README slim

- When WP-2 ships, the repository root SHALL contain a new file `OPERATION.md`
  as the canonical operator how-to.

- When the operator opens `OPERATION.md`, the document SHALL contain at least
  these top-level sections in this order: `Inbox lifecycle`, `Feature delivery
  loop`, `pan CLI verbs`, `Active memory refresh`, `Commit and
  policy-compliance`, and `Troubleshooting`.

- When WP-2 ships, `README.md` SHALL be a short entry point that contains
  status, system overview, key paths map, and pointers to `OPERATION.md`,
  `AGENTS.md`, `.docs/M1.index.md`, and `.docs/PRD.summary.md`.

- When WP-2 ships, `README.md` SHALL NOT contain the feature-delivery loop
  procedure, the `pan advance` command table, the post-invocation state
  machine table, or the manual bootstrap workflow; those bodies SHALL live
  in `OPERATION.md` and SHALL be referenced from `README.md` by anchor link.

- When `README.md` line count exceeds 120 lines after WP-2 ships, the
  implementor SHALL move additional procedural prose into `OPERATION.md`
  until `README.md` is at most 120 lines.

- When WP-2 ships, `lib/memory/handbook/` SHALL contain at least one new or
  updated handbook page that obligates agents to update `OPERATION.md`
  whenever operator-facing interfaces change. Operator-facing interfaces
  include CLI flag changes, CLI subcommand additions or removals,
  documented file-path changes under `lib/inbox/`, `.pan/work/`, or
  `lib/memory/features/`, default-value changes, and environment variable
  additions or removals.

- When WP-2 ships, `AGENTS.md` § 6 "What to do next" SHALL reference
  `OPERATION.md` as the canonical operator how-to, and `.docs/M1.index.md`
  SHALL link to `OPERATION.md` from its operator-routing section.

### WP-3 — Operator-output conformance enforcement

- When the implementor completes the audit pass, the audit SHALL cover every
  persona file under `lib/personas/`, every Cursor projection under
  `.cursor/agents/`, every Cursor rule under `.cursor/rules/`, and every
  handbook page that includes operator-visible example output, and SHALL
  emit one audit report under
  `.pan/work/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/operator-output-audit.md`.

- When the audit report cites a violation, the implementor SHALL classify
  the violation as one of three labels: `bare-pan-invocation`,
  `prose-file-shopping-list`, or `missing-or-vague-how-clause`. The
  implementor SHALL fix every `bare-pan-invocation` violation in the same
  change set and SHALL fix or backlog-link every other violation.

- When WP-3 ships, no file under `lib/personas/`, `.cursor/agents/`,
  `.cursor/rules/`, or `lib/memory/handbook/` SHALL contain a runnable
  copy-paste shell line that invokes bare `pan <subcommand>` without the
  `pnpm -w exec pan <subcommand>` prefix required by
  `lib/memory/handbook/operator-output-contract.md` § 3.1.

- When WP-3 ships, at least one automated lint, compliance descriptor, or
  maintainer script SHALL detect the `bare-pan-invocation` pattern in
  operator-visible runnable code blocks across `lib/personas/`,
  `.cursor/agents/`, `.cursor/rules/`, `lib/memory/handbook/`, `AGENTS.md`,
  `README.md`, and `OPERATION.md`, and SHALL fail with a non-zero exit code
  when a violation is found.

- When WP-3 defers a remediation, the implementor SHALL add one backlog
  item under `lib/memory/backlog/index.yaml` per deferred remediation with
  the offending file path, the violation label, and an owner persona
  recorded in the backlog item body.

### WP-4 — Backlog/debt consolidation and AGENTS map alignment

- When WP-4 ships, the path `lib/memory/debt/` SHALL NOT exist in the
  working tree.

- When WP-4 ships, `AGENTS.md` § 7 "Workspace map" SHALL NOT list
  `/lib/memory/debt/` and SHALL document only paths that exist in the
  working tree at WP-4 ship time.

- When WP-4 ships, the backlog schema documented in
  `lib/memory/handbook/backlog-format.md` SHALL accept a debt classification
  on each backlog item through either a `category: debt` field or an
  equivalent `tags: [debt]` entry, and the change set SHALL update the
  handbook page to record the chosen encoding.

- When WP-4 ships, every prior reference to `lib/memory/debt/` across
  `.docs/`, `lib/memory/handbook/`, `lib/personas/`, `.cursor/agents/`,
  `.cursor/rules/`, and `lib/internal/packages/@pancreator/mcp-server/`
  SHALL redirect to `lib/memory/backlog/index.yaml` or SHALL be removed.

- When WP-4 ships, the MCP resource list under
  `lib/internal/packages/@pancreator/mcp-server/` SHALL NOT advertise
  `lib/memory/debt/` as a discoverable resource.

### WP-5 — CI slimming and librarian pre-close validation

- When the plan stage drafts the CI posture decision, the plan SHALL select
  exactly one CI disposition per workflow file under `.github/workflows/`
  from this set: `keep-as-is`, `narrow-paths`, `workflow-dispatch-only`,
  `disable-with-rationale`, or `delete-with-rationale`.

- When the plan ratifies `workflow-dispatch-only`, `disable-with-rationale`,
  or `delete-with-rationale` for any workflow, the implementor SHALL record
  the rationale in `OPERATION.md` § "Troubleshooting" or a new
  `OPERATION.md` § "CI posture" section and SHALL add a backlog item under
  `lib/memory/backlog/index.yaml` that names the re-enable trigger
  condition.

- When WP-5 ships, the librarian persona at `lib/personas/librarian.md`
  SHALL document a **pre-close validation** obligation that the librarian
  (or the coder delegated under a librarian prompt) executes before
  invoking `pnpm -w exec pan close-artifacts <task-id>`.

- When WP-5 ships, the pre-close validation obligation SHALL enumerate at
  minimum these checks: `pnpm -w test` for the repository test suite,
  `pnpm -w typecheck` for TypeScript type errors across the workspace,
  `node lib/internal/tools/check-phase-0a-scaffold.mjs` for scaffold
  invariants, and `node lib/internal/tools/context-budget-report.mjs` for
  context budget regression detection.

- When the librarian pre-close validation encounters a failure that fits
  the bounded failure list (TypeScript type errors, stale status field
  rows, formatting drift, or stale `contentHash` values on cited files),
  the librarian (or delegated coder) SHALL fix the failure in the same
  change set rather than punt the failure to the operator.

- When the librarian pre-close validation encounters a failure outside the
  bounded list (a substantive test failure, an unexpected schema change, a
  contract regression), the librarian SHALL halt the close-artifacts run
  and SHALL escalate to the operator with a written failure summary at
  `.pan/work/<day>/<task-id>/librarian-pre-close-failure.md` instead of
  invoking `close-artifacts`.

- When WP-5 ships, `OPERATION.md` SHALL document the pre-close validation
  check list and the bounded-failure fix policy, and the
  `librarian` skill or persona at `lib/personas/skills/` or `lib/personas/` SHALL
  cite that documentation by dual-anchor.

- When WP-5 ships, heavy conformance suites that the operator still runs
  on demand (for example `tests/compliance/` broad sweeps) MAY remain
  manual or `operator-on-demand` per AGENTS § 6.1 and SHALL NOT block
  the librarian pre-close gate.

### WP-6 — Duplication and philosophy sweep

- When the implementor opens the duplication inventory, the inventory SHALL
  emit one report under
  `.pan/work/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/duplication-inventory.md`
  that lists every detected duplication finding under one of four
  categories: `docs-vs-handbook`, `cli-help-vs-handbook`,
  `parallel-agent-projections`, or `overlapping-feature-specs`.

- When the inventory marks a duplication as `consolidate`, the implementor
  SHALL collapse the duplicated body into the canonical source named in
  `lib/memory/handbook/context-economy.md` and SHALL update every prior
  duplicate location to a citation-only pointer.

- When the inventory marks a duplication as `intentional-dual-location`,
  the implementor SHALL author a handbook clause or an ADR under
  `lib/memory/adr/` that records the owner, the canonical source, and the
  mirror obligation; silent drift SHALL NOT remain after WP-6 ships.

- When WP-6 ships, `compliance-auditor` SHALL run a broad sweep against
  `tests/compliance/schemas/latest.yaml` and SHALL report zero
  `block`-severity findings tied to bare-`pan` invocations, missing
  `OPERATION.md` references, residual `lib/memory/debt/` paths, or
  feature-folder skeletons.

### Cross-cutting acceptance

- When the run reaches the report stage, one delivery report at
  `lib/memory/features/bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/delivery-report.md`
  SHALL cover all six work packages and SHALL cite the source inbox item
  at `lib/inbox/in/172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md`.

- When the run reaches the ship stage, the policy-compliance artifact at
  `.pan/work/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/policy-compliance.json`
  SHALL exist and SHALL satisfy
  `lib/memory/handbook/policy-compliance-contract.md`.

- When the run reaches the index stage, the per-feature index at
  `lib/memory/features/bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/index.json`
  SHALL list every artifact produced by every work package with a
  dual-anchor citation.

- When the run completes, the documentation-impact decision per
  `lib/memory/handbook/documentation-impact-contract.md` SHALL record
  `applies: true` and SHALL enumerate every touched documentation surface
  (at minimum `AGENTS.md`, `README.md`, `OPERATION.md`, `.docs/M1.index.md`,
  `.docs/PRD.summary.md`, the librarian persona, and the handbook pages
  touched by WP-4 and WP-5).

- When the run completes, the validation gate SHALL pass each of:
  `node --test tests/*.test.mjs`,
  `node lib/internal/tools/check-phase-0a-scaffold.mjs`,
  `node lib/internal/tools/context-budget-report.mjs`, and
  `bash -n .cursor/hooks/enforce-policy-compliance.sh`, or SHALL record an
  explicit deferral per the deferral protocol with backlog linkage.

## Touch-set hints (plan stage refines)

The plan stage SHALL refine the touch-set; the intake hints below MUST be
treated as non-exhaustive starting candidates.

| Work package | Likely touched surfaces |
|---|---|
| WP-1 | `lib/memory/features/<each-audited-folder>/`, `lib/memory/backlog/index.yaml`, `lib/memory/backlog/drafts/`, `lib/memory/features/index.json`, `lib/memory/active/current.md`, `lib/memory/adr/<new-archival-or-deletion-adr>.md` |
| WP-2 | `OPERATION.md` (new), `README.md`, `AGENTS.md` § 6, `.docs/M1.index.md`, at least one page under `lib/memory/handbook/` recording the OPERATION-update obligation |
| WP-3 | `.pan/work/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/operator-output-audit.md`, `lib/personas/*.md`, `.cursor/agents/*.md`, `.cursor/rules/*.mdc`, `lib/memory/handbook/operator-output-contract.md`, the new lint or compliance descriptor under `lib/internal/tools/` or `tests/compliance/` |
| WP-4 | `AGENTS.md` § 7, `lib/memory/handbook/backlog-format.md`, `lib/memory/handbook/memory-tiers.md`, `lib/internal/packages/@pancreator/mcp-server/`, `.docs/PRD.index.md`, `lib/memory/backlog/index.yaml` |
| WP-5 | `lib/personas/librarian.md`, `lib/personas/qa-tester.md`, `lib/personas/skills/<librarian-skill-if-needed>/SKILL.md`, `OPERATION.md`, `lib/memory/backlog/index.yaml` |
| WP-6 | `.pan/work/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/duplication-inventory.md`, paths cited by the inventory, `lib/memory/adr/<new-intentional-dual-location-adr>.md` if any |

## Validation expectations

The plan, implement, and review stages SHALL execute each command below from
the repository root and SHALL record exit codes in the implementation report
or the review report.

```bash
node --test tests/*.test.mjs
node lib/internal/tools/check-phase-0a-scaffold.mjs
node lib/internal/tools/context-budget-report.mjs
bash -n .cursor/hooks/enforce-policy-compliance.sh
```

When WP-3 lands a new lint or compliance descriptor, the implement and review
stages SHALL also execute that lint or descriptor and SHALL record its exit
code alongside the four commands above.

When WP-5 lands the librarian pre-close validation contract, the librarian
SHALL execute the documented check list before running
`pnpm -w exec pan close-artifacts 16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout`.

## Documentation impact

The documentation-impact decision per
`lib/memory/handbook/documentation-impact-contract.md` SHALL record
`applies: true` for this Feature. The minimum impacted documentation
surfaces SHALL include:

- `AGENTS.md` § 6 "What to do next" and § 7 "Workspace map".
- `README.md` (slimmed to entry-point only).
- `OPERATION.md` (new canonical operator how-to).
- `.docs/M1.index.md` (operator-routing link to `OPERATION.md`).
- `.docs/PRD.summary.md` (cross-reference update only if the operator doc
  layout changes the PRD-summary pointers).
- `lib/personas/librarian.md` (pre-close validation duty).
- `lib/memory/handbook/backlog-format.md` (debt categorization).
- `lib/memory/handbook/memory-tiers.md` (debt-tier retirement).
- `lib/memory/handbook/operator-output-contract.md` (audit and lint
  references, no semantic change unless WP-3 expands the contract).
- Every persona, Cursor projection, or handbook page touched by WP-3.

Deferrals SHALL follow the deferral protocol with one backlog item per
deferred documentation update.

## Human gates

This Feature SHALL stop at every existing `feature-delivery` human gate. The
gates are non-negotiable and SHALL fire in this order:

1. **intake_ratification** — operator ratifies this spec before plan starts.
2. **plan_ratification** — operator ratifies `plan.md`, `adr-draft.md`,
   `touch-set.json`, and `handoff.md` before implement starts.
3. **implement_pause_resume_available** — operator MAY pause, resume, or
   abort the implement stage with `pnpm -w exec pan pause | resume | abort`.
4. **review_pass** — operator accepts the review verdict or routes the run
   back to implement.
5. **report_acceptance** — operator accepts the delivery report.
6. **ship_local_diff_ratification** — operator ratifies the local diff; no
   agent SHALL push or open a pull request.
7. **index_audit** — operator accepts the per-feature index before
   `pnpm -w exec pan close-artifacts` runs.

## Out of scope

- Implementing full unattended `feature-delivery` automation. The separate
  inbox item at
  `.pan/archive/inbox/in/172979_05-27-26/72021_0359_feature-delivery-cursor-runner-harness-wiring/72021_0359_feature-delivery-cursor-runner-harness-wiring.md`
  owns that work.
- Building the v0 operator dashboard UI. This pass MAY record API or CLI
  hooks the dashboard will consume, but SHALL NOT add dashboard surfaces.
- Large rewrites of `.docs/PRD.md` or `.docs/BOOTSTRAP.md`. Surgical updates
  to PRD-summary, PRD-index, or M1-index pointers are permitted when WP-2
  changes the operator doc layout.
- Phase exit ratification or any change to bootstrap phase semantics in
  `pancreator.yaml`. Phase 5 stays Phase 5.
- Rewriting historical artifacts under `.pan/archive/work/`.
- Reading, citing, ingesting, or modifying any file under
  `lib/inbox/notes/` per AGENTS § 5 and inbox-lifecycle § 1a.
- Renaming `@pancreator/*` packages or changing CLI subcommand grammar
  beyond the OPERATION.md table-of-contents extraction.
- Migrating any existing feature folder out of `keep-implemented` status
  without an explicit disposition-table row in WP-1.

## Deferrals

- **Per-folder disposition for WP-1.** The classification of each
  `lib/memory/features/<id>/` subdirectory into `keep-implemented`,
  `relocate-to-backlog`, or `archive-or-delete` SHALL be authored by the
  plan stage. Intake does not pre-classify because each disposition
  requires reading the per-folder `delivery-report.md`, `index.json`
  implementation-surface anchors, and `lib/memory/active/current.md`
  shipped-feature rows. Backlog linkage: `wp-1-feature-folder-audit`.

- **CI posture per workflow for WP-5.** Final disposition: `delete-with-rationale`
  for all files under `.github/workflows/` (removed 2026-05-28). Local gates are
  `lib/personas/qa-tester.md` and `OPERATION.md` § "Librarian pre-close
  validation". Backlog linkage: `bootstrap-ci-narrow-paths-re-enable` (cancelled).

- **Pre-close check list final shape for WP-5.** The minimum check list
  documented in this spec MAY be extended with additional checks
  (`pnpm -w lint`, package-specific `vitest` invocations, or per-touched
  package smoke tests) at the plan-stage owner's discretion. Backlog
  linkage: `wp-5-ci-slim-and-librarian-gate`.

- **OPERATION.md section detail.** The six minimum top-level sections
  enumerated in WP-2 SHALL appear; the prose body of each section SHALL be
  authored by the tech-writer at the implement stage. Backlog linkage:
  `wp-2-operation-md-extraction`.

- **Backlog debt encoding choice.** The choice between `category: debt`
  and `tags: [debt]` SHALL be made by the plan stage and recorded in
  `lib/memory/handbook/backlog-format.md`. Backlog linkage:
  `wp-4-backlog-debt-consolidation`.

## Open questions

_(none — intake-analyst ratifies the directive as sufficiently specified for
plan-stage delegation; per-WP choices recorded as deferrals above are
intentional plan-stage scope and SHALL NOT block intake ratification.)_
