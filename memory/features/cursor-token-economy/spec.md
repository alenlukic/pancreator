---
title: Cursor Token Economy and Default Context Budget Intake Spec
feature_id: cursor-token-economy
status: intake-closed
intake_round: 0
clarifying_rounds_posted: 0
source_inbox_item: inbox/in/token_economy.md
next_owner: supervisor
next_stage: ship
intake_closure:
  human_approval_gate: cleared
  approved_date: "2026-05-09"
  channel: operator_cursor_chat
  note: Human ratified the canonical Engineering Spec as written; no clarifying thread was required.
intake_notes:
  - The directive is fully actionable on its face and ends with an explicit no-clarifying-questions instruction at lines 299-305 of the source inbox item.
  - The intake-analyst opted out of the clarifying-question loop because no material ambiguity exists for the canonical spec; the human_approval gate is satisfied by an empty `## Open questions` section plus an explicit `## Human ratification required` block for downstream protected-surface edits.
references:
  - kind: lines
    path: inbox/in/token_economy.md
    range: [29, 49]
    contentHash: TBD-on-commit
    note: Directive Problem section motivates the cache-read-volume reduction goal.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [51, 61]
    contentHash: TBD-on-commit
    note: Directive Goal section names the optimization targets and preservation constraints.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [63, 69]
    contentHash: TBD-on-commit
    note: Directive Non-goals section bounds the feature scope.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [73, 110]
    contentHash: TBD-on-commit
    note: Directive §1 specifies the .cursorindexingignore file content and the .gitignore reversal.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [112, 149]
    contentHash: TBD-on-commit
    note: Directive §2 specifies the Cursor rule audit and the tesseract-engineer glob narrowing example.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [151, 177]
    contentHash: TBD-on-commit
    note: Directive §3 specifies the new context-economy handbook page and the index.md routing entry.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [179, 194]
    contentHash: TBD-on-commit
    note: Directive §4 specifies PRD.summary.md and PRD.index.md as summary-first retrieval surfaces.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [196, 214]
    contentHash: TBD-on-commit
    note: Directive §5 names AGENTS.md slimming as a ratification-bound activity that preserves protected semantics.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [216, 226]
    contentHash: TBD-on-commit
    note: Directive §6 forbids deletion of work/** and routes future bulk artifacts toward .local/ or ignored subpaths.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [228, 253]
    contentHash: TBD-on-commit
    note: Directive §7 specifies the tools/context-budget-report.mjs estimator scope and the chars-over-4 labeling rule.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [255, 268]
    contentHash: TBD-on-commit
    note: Directive §8 lists the documentation-impact updates the delivery slice MUST evaluate.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [270, 287]
    contentHash: TBD-on-commit
    note: Directive Acceptance criteria items 1-14 anchor the gate semantics this spec mirrors.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [289, 297]
    contentHash: TBD-on-commit
    note: Directive Manual validation section enumerates the post-implementation operator checks.
  - kind: lines
    path: inbox/in/token_economy.md
    range: [299, 305]
    contentHash: TBD-on-commit
    note: Directive Implementation guidance authorizes the no-clarifying-questions intake path the analyst followed.
  - kind: lines
    path: PRD.md
    range: [641, 648]
    contentHash: TBD-on-commit
    note: PRD §7 declares loop.max_rounds 5 and gate human_approval for the feature-delivery intake stage.
  - kind: lines
    path: PRD.md
    range: [921, 931]
    contentHash: TBD-on-commit
    note: PRD §8 declares the per-Feature folder layout aligned with Spec Kit v0.8 (spec.md, plan.md, tasks.md).
  - kind: lines
    path: memory/handbook/glossary.md
    range: [222, 235]
    contentHash: TBD-on-commit
    note: Glossary §5 defines Artifact, Feature, Inbox, and Spec Kit alignment as the per-feature folder convention.
  - kind: lines
    path: memory/handbook/glossary.md
    range: [252, 256]
    contentHash: TBD-on-commit
    note: Glossary §6 defines AGENTS.md as the primary cross-tool contract per the LF Agentic AI Foundation standard.
  - kind: lines
    path: AGENTS.md
    range: [78, 95]
    contentHash: TBD-on-commit
    note: AGENTS.md §5 declares the working agreement constraints the spec preserves through every change.
  - kind: lines
    path: memory/handbook/inbox-lifecycle.md
    range: [79, 100]
    contentHash: TBD-on-commit
    note: Inbox-lifecycle §1a confirms /inbox/notes/ is operator-only and out of scope for any Cursor indexing change.
---

# Spec

This Feature SHALL reduce default Cursor cache-read token volume on routine
repository invocations through five staged changes: a root
`.cursorindexingignore` file, narrower `.cursor/rules/*.mdc` glob surfaces,
a new `memory/handbook/context-economy.md` page, summary-first PRD retrieval
surfaces (`PRD.summary.md` and `PRD.index.md`), and a
`tools/context-budget-report.mjs` estimator. The Feature SHALL preserve
every Persona, Skill, Pipeline, Spec Contract, documentation-impact,
policy-compliance, and inbox-lifecycle obligation. The Feature SHALL keep
`PRD.md`, `BOOTSTRAP.md`, the `memory/` tree, and the `work/` tree
reachable for explicit human and agent reads.

## Acceptance criteria

- When the Feature stages the indexing policy, the Feature MUST add one
  `.cursorindexingignore` file at the repository root.
- When the Feature stages the indexing policy, the Feature MUST exclude
  `work/**`, `inbox/out/**`, and `inbox/threads/**` from default Cursor
  semantic indexing through the `.cursorindexingignore` file.
- When the Feature stages the indexing policy, the Feature MUST exclude
  `**/migration-manifest*.json`, `**/*.dry-run.json`,
  `**/*.post-write.json`, and `**/*.write.json` from default Cursor
  semantic indexing through the `.cursorindexingignore` file.
- When the Feature stages the indexing policy, the Feature MUST exclude
  `memory/**/*.json`, `memory/**/delivery-report.md`, and
  `memory/**/index.json` from default Cursor semantic indexing through the
  `.cursorindexingignore` file.
- When the Feature stages the indexing policy, the Feature MUST exclude
  `pnpm-lock.yaml` from default Cursor semantic indexing through the
  `.cursorindexingignore` file.
- When the Feature stages the indexing policy, the Feature MUST exclude
  `CLAUDE.md` and `.github/copilot-instructions.md` from default Cursor
  semantic indexing through the `.cursorindexingignore` file.
- When the Feature stages the indexing policy, the Feature MUST exclude
  `.cursor/agents/**` from default Cursor semantic indexing under one
  comment that requires operator confirmation that Cursor still discovers
  every custom agent before merge.
- When the Feature stages the indexing policy, the Feature MUST update
  `.gitignore` so the repository tracks `.cursorindexingignore` rather
  than ignoring it.
- When the Feature stages the indexing policy, the Feature MUST NOT add a
  root `.cursorignore` file in this delivery slice.
- When the Feature audits Cursor rule files, the Feature MUST evaluate
  the five rule files the directive enumerates at lines 117 to 122 of
  `inbox/in/token_economy.md` for over-broad `globs` activation.
- When the Feature narrows the `.cursor/rules/tesseract-engineer.mdc`
  glob surface, the Feature MUST exclude `work/**/*` from the default
  activation set unless the rule specifically targets run logs, plans,
  reviews, or delivery reports.
- When the Feature stages the rule audit, the Feature MUST emit one
  audit artifact that lists each Cursor rule, the prior glob set, the
  new glob set, and the rationale for the change.
- When the Feature creates the context-economy handbook page, the
  Feature MUST write one new file at
  `memory/handbook/context-economy.md`.
- When the Feature authors `memory/handbook/context-economy.md`, the
  page MUST define default retrieval discipline, per-document read
  triggers, generated-manifest handling, and the
  indexed-versus-explicit-read split per the directive enumeration at
  lines 159 to 169 of `inbox/in/token_economy.md`.
- When the Feature routes the new handbook page, the Feature MUST add
  one routing entry for context-budgeting decisions in
  `memory/handbook/index.md`.
- When the Feature splits PRD access, the Feature MUST create one
  `PRD.summary.md` file as a compact orientation document for routine
  agent reads.
- When the Feature splits PRD access, the Feature MUST create one
  `PRD.index.md` file as a section-to-trigger routing map for full
  `PRD.md` reads.
- When the Feature updates retrieval guidance, the Feature MUST instruct
  agents to read `PRD.summary.md` first and to read `PRD.md` only when
  the task requires product-spec detail, citation repair, or
  line-anchored requirements.
- When the Feature ships the context-budget tool, the Feature MUST add
  one command at `tools/context-budget-report.mjs`.
- While the `tools/context-budget-report.mjs` command runs, the command
  MUST emit character counts and `chars / 4` token estimates for the
  ten path scopes the directive enumerates at lines 240 to 249 of
  `inbox/in/token_economy.md`.
- When the `tools/context-budget-report.mjs` command emits the token
  estimate, the report MUST label the `chars / 4` value as a rough
  estimate.
- When the Feature applies the documentation-impact contract, the
  Feature MUST evaluate updates to the six documentation surfaces the
  directive enumerates at lines 261 to 266 of
  `inbox/in/token_economy.md`.
- When the Feature defers a documentation-impact update, the Feature
  MUST record the deferral rationale and one backlog linkage per the
  documentation-impact contract.
- When the Feature stages the delivery report, the report MUST list
  every staged change, every deferral, and every manual operator
  verification step Cursor requires before merge.
- When the Feature stages the delivery report, the report MUST request
  the five operator post-implementation actions the directive
  enumerates at lines 293 to 297 of `inbox/in/token_economy.md`.
- When the Feature processes historical artifacts, the Feature MUST NOT
  delete any file under `work/**`.
- When the Feature processes historical artifacts, the Feature MUST NOT
  delete any generated manifest under `memory/**` or `work/**`.
- When the Feature stages every governed change, the Feature MUST stage
  one policy-compliance artifact at
  `/work/<task-id>/policy-compliance.json` per the policy-compliance
  contract.

## Out of scope

- This Feature SHALL NOT delete historical artifacts under `work/**`.
- This Feature SHALL NOT weaken policy-compliance, documentation-impact,
  inbox-lifecycle, or human-ratification requirements.
- This Feature SHALL NOT hide `PRD.md`, `BOOTSTRAP.md`, the `memory/`
  tree, or the `work/` tree from explicit human or agent reads.
- This Feature SHALL NOT add a root `.cursorignore` file in this
  delivery slice.
- This Feature SHALL NOT delete or rewrite the full `PRD.md` body
  except for references this Feature edits.
- This Feature SHALL NOT modify Persona spec semantics, role
  boundaries, tool grants, or safety constraints.
- This Feature SHALL NOT read, write, traverse, or cite any file under
  `/inbox/notes/`, which the inbox-lifecycle handbook reserves as a
  human-only operator sandbox.

## Human ratification required

The Feature SHALL stage the changes below behind explicit human
approval because they touch protected surfaces or carry agent-discovery
risk:

- When the Feature edits `AGENTS.md` to slim verbose operational
  detail, the human MUST ratify the diff before merge per the
  AGENTS.md self-protection rule, and the Feature MUST preserve
  tool-safety, no-auto-push, human-phase-boundary, inbox-discovery,
  delegation, documentation-impact, and policy-compliance semantics
  through routing pointers to the new canonical locations.
- When the Feature excludes `.cursor/agents/**` from default Cursor
  semantic indexing, the operator MUST confirm that Cursor still
  discovers every custom agent under `.cursor/agents/` before the
  change merges.
- When the audit identifies a Cursor rule beyond the named five whose
  current `globs` activate over-broad context, the Feature MUST
  surface that rule in the audit artifact for explicit human
  ratification before edit.
- When the Feature narrows the `globs` field on any
  `.cursor/rules/*.mdc` file mirrored from a Persona spec, the human
  MUST ratify the diff because the mirror parity rule binds the
  Persona spec and the Cursor projection together.

## Deferrals

- The Feature MAY defer one Cursor rule glob change to the backlog
  when the audit cannot prove that the narrower glob preserves the
  rule's intended activation surface.
- The Feature MAY defer the migration of bulky generated artifacts
  into `.local/` or another ignored subpath to the backlog when the
  staged delivery slice cannot record the move without churn.
- The Feature MAY defer the addition of a root `.cursorignore` file
  to a future delivery slice that proves explicit-read access remains
  intact for every excluded path.

## Open questions

- None.
