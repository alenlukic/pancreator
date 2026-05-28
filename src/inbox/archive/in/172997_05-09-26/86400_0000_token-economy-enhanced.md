---
title: Active Memory Separation and Cursor Context Economy Pass 2
feature_id: active-memory-context-economy-pass-2
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-09T00:00:00Z
references:
  - kind: path
    path: .cursorindexingignore
    note: Existing Cursor indexing policy from pass 1.
  - kind: path
    path: AGENTS.md
    note: Current always-loaded repo operating contract.
  - kind: path
    path: .cursor/rules/00-agents-md.mdc
    note: Always-on Cursor rule loading AGENTS.md.
  - kind: path
    path: .cursor/rules/daedaline-engineer.mdc
    note: Still includes broad internal-context triggers such as handbook/persona paths.
  - kind: path
    path: src/memory/handbook/context-economy.md
    note: Existing context-economy policy from pass 1.
  - kind: path
    path: src/internal/tools/context-budget-report.mjs
    note: Existing rough corpus-size reporting tool.
  - kind: path
    path: src/work/
    note: Existing raw execution artifact tree; should be classified as archival/explicit-read memory.
  - kind: path
    path: src/memory/
    note: Existing durable memory tree; needs active/src/internal/durable/archive separation.
---

# Active Memory Separation and Cursor Context Economy Pass 2

## Context

A first context-economy pass appears to have materially improved Cursor token usage.

Observed prior Opus 4.7 cache-read runs for similar simple tasks:

- 2.8M
- 1.5M
- 2.3M

Average: approximately 2.2M cache-read tokens.

After the first pass, a similar task produced approximately 770K cache-read tokens, a roughly 65% reduction.

That is a real improvement, but 770K is still high for simple work. The likely remaining issue is not one giant file alone. The repo still lacks a strong structural separation between:

- short-term / active operator memory,
- long-term durable memory,
- archival raw execution artifacts,
- internal operating content,
- generated machine artifacts,
- source code.

This creates both token-economy problems and operator-clarity problems.

## Problem

The repo currently has useful context controls, including `.cursorindexingignore`, `PRD.summary.md`, `PRD.index.md`, `src/memory/handbook/context-economy.md`, and `src/internal/tools/context-budget-report.mjs`.

However, the underlying memory model is still too implicit.

In practice:

- `src/work/**` contains historical/generated execution artifacts but lives as a prominent top-level corpus.
- `src/memory/**` mixes durable feature memory, ADRs, backlog, handbook pages, generated indexes, delivery reports, and current operating knowledge.
- Internal operating content such as handbook pages, personas, Cursor rules, and skills can still be treated like active context.
- Agents do not yet have a crisp “simple task mode” that strongly prevents unnecessary context/tool/model escalation.
- Cursor cache-read volume is improved but still too high for routine tasks.
- Operators lack an obvious answer to: “what context is active right now, what is durable memory, what is archival, and what is internal system machinery?”

## Goal

Implement a second pass that combines:

1. Further Cursor token-economy improvements.
2. Explicit structural separation between active memory, durable memory, archival memory, and internal operating content.
3. A clear operator-facing memory map.
4. Safer default retrieval behavior for simple tasks.
5. A measurable before/after validation loop.

The target is not to delete or hide context. The target is to make context retrieval intentional.

## Non-goals

This task SHALL NOT delete historical artifacts.

This task SHALL NOT break existing Daedaline pipeline behavior, run logging, inbox processing, Cursor custom agent discovery, or policy-compliance gates.

This task SHALL NOT perform risky large-scale path migrations without either compatibility shims or explicit deferral.

This task SHALL NOT make `PRD.md`, `BOOTSTRAP.md`, `src/memory/**`, `src/work/**`, `src/personas/**`, or `.cursor/agents/**` unavailable for explicit reads.

## Required implementation

### 1. Define the memory tier model

Create a clear memory-tier taxonomy.

Add a new handbook page:

- `src/memory/handbook/memory-tiers.md`

It SHALL define these tiers:

#### Active memory

Short-term, operator-facing, low-token context.

Purpose:

- current focus,
- active feature pointers,
- current run pointers,
- current risks/blockers,
- operator notes that are expected to change soon.

Expected location:

- `src/memory/active/`

Rules:

- active memory files must be small,
- active memory should point to durable/archival artifacts rather than copying them,
- active memory should be safe to inspect by default,
- active memory should not contain bulky generated output,
- active memory should have explicit promotion/expiration rules.

#### Durable memory

Long-term ratified project memory.

Purpose:

- feature specs,
- ADRs,
- backlog,
- stable delivery reports,
- ratified contracts,
- long-lived decisions.

Current locations include:

- `src/memory/features/`
- `src/memory/adr/`
- `src/memory/backlog/`

Rules:

- durable memory is explicit-route context,
- durable memory should be indexed selectively,
- generated indexes/reports should remain explicit-read unless task-relevant.

#### Archival memory

Historical raw execution artifacts and completed conversation/run material.

Purpose:

- auditability,
- reconstruction,
- debugging,
- historical traceability.

Current locations include:

- `src/work/**`
- `src/inbox/out/**`
- `src/inbox/threads/**`

Rules:

- archival memory is explicit-read only by default,
- archival memory should not be semantically indexed by Cursor by default,
- archival artifacts should not be copied into active memory,
- active memory may link to archival artifacts by path.

#### Internal operating content

System machinery and operating doctrine.

Purpose:

- handbook pages,
- persona definitions,
- Cursor rules,
- skills,
- templates,
- policy contracts.

Current locations include:

- `src/memory/handbook/`
- `src/personas/`
- `src/skills/`
- `.cursor/rules/`
- `.cursor/agents/`

Rules:

- internal content is not the same as active memory,
- internal content should be routeable through indexes,
- agents should load only the specific internal content needed for the task,
- broad persona/handbook loading should be avoided.

#### Generated machine artifacts

Machine-generated artifacts optimized for tooling rather than human reasoning.

Purpose:

- indexes,
- manifests,
- migration outputs,
- dry-run outputs,
- compliance JSON,
- run logs.

Rules:

- explicit-read only by default,
- excluded from default Cursor semantic indexing unless there is a strong reason,
- summarized for operator-facing use.

### 2. Add active-memory directory and operator map

Create:

- `src/memory/active/README.md`
- `src/memory/active/current.md`
- `src/memory/active/runs.md`

Minimum behavior:

`src/memory/active/README.md` explains what belongs in active memory and what does not.

`src/memory/active/current.md` is a compact operator-facing current-state file. It should contain only short summaries and pointers.

`src/memory/active/runs.md` tracks active/recent run pointers without embedding full run artifacts.

These files must be intentionally small. Add a documented soft budget, for example:

- each active memory file SHOULD stay under approximately 1,000 words,
- the whole `src/memory/active/` tier SHOULD stay under approximately 5,000 words unless deliberately ratified.

If a stronger implementation is practical, add a lightweight check to warn when active-memory files exceed the budget.

### 3. Classify existing paths without unsafe migration

Implement structural separation in the safest way compatible with the current repo.

At minimum:

- Create the new `src/memory/active/` tier.
- Document `src/work/**` as archival memory and explicit-read only.
- Document `src/memory/features/**`, `src/memory/adr/**`, and `src/memory/backlog/**` as durable memory.
- Document `src/memory/handbook/**`, `src/personas/**`, `src/skills/**`, `.cursor/rules/**`, and `.cursor/agents/**` as internal operating content.
- Document generated JSON/manifests as generated machine artifacts.

Do not move large existing directory trees unless the implementation can prove references, tests, and pipeline behavior remain correct.

If the implementation chooses not to physically migrate existing trees, record that as an intentional compatibility decision, not an omission.

If physical migration is attempted, it must include:

- reference updates,
- compatibility shims or aliases where needed,
- tests,
- migration report,
- explicit rollback notes.

### 4. Add an ADR for active versus archival memory

Create a new ADR:

- `src/memory/adr/000X-active-vs-archival-memory.md`

Use the next available ADR number.

It SHALL record:

- the problem,
- the selected memory-tier model,
- why `src/work/**` is archival/explicit-read by default,
- why `src/memory/active/**` exists,
- how active memory promotes into durable memory,
- how archival memory remains accessible,
- what migrations were deferred and why.

### 5. Update context-economy policy

Update:

- `src/memory/handbook/context-economy.md`
- `src/memory/handbook/index.md`

Required changes:

- Route active-memory questions to `src/memory/active/current.md`.
- Route memory-tier questions to `src/memory/handbook/memory-tiers.md`.
- State that `src/memory/active/**` is the only memory tier intended for routine default orientation.
- State that `src/work/**` is archival and explicit-read only.
- State that internal operating content should be loaded by route, not swept wholesale.
- State that `PRD.summary.md` remains the default product orientation surface.
- State that full `PRD.md`, `BOOTSTRAP.md`, durable feature memory, and archival run artifacts require task-specific justification.

### 6. Implement simple task mode

Define a simple task mode for Cursor/agent invocations.

This can live in `AGENTS.md`, `src/memory/handbook/context-economy.md`, or a new concise rule/doc if that is cleaner.

Simple task mode applies to:

- small code edits,
- lint/typecheck/build/test invocations,
- dependency inspection,
- file lookup,
- mechanical refactors,
- formatting fixes,
- repo maintenance that does not require product reasoning.

Simple task mode SHALL instruct agents:

- do not read `PRD.md`,
- do not read `BOOTSTRAP.md`,
- do not traverse `src/memory/**`,
- do not traverse `src/work/**`,
- do not load personas beyond the currently invoked persona,
- do not invoke subagents unless explicitly needed,
- inspect only directly relevant files,
- prefer exact paths over broad codebase search,
- prefer cheaper/faster models unless explicitly escalated,
- summarize any escalation to larger context or more expensive model.

Add explicit escalation criteria for leaving simple task mode.

Examples of escalation criteria:

- task changes product behavior,
- task changes pipeline/persona semantics,
- task touches policy/compliance behavior,
- task requires historical artifact reconstruction,
- tests fail in a way that requires broader architectural diagnosis,
- operator explicitly requests broad repo analysis.

### 7. Slim always-loaded context further

Review `AGENTS.md` and `.cursor/rules/00-agents-md.mdc`.

Current `AGENTS.md` is much better than the original large context surface, but it is still the always-loaded contract. Reduce it further if safe.

Targets:

- `AGENTS.md` should be an operating card and routing map, not a briefing.
- Move verbose detail into `src/memory/handbook/**`.
- Preserve all normative semantics.
- Keep explicit route pointers for policy-compliance, documentation-impact, inbox lifecycle, and memory-tier rules.
- Avoid duplicating PRD/context-economy text in AGENTS.

Preferred soft budget:

- `AGENTS.md` SHOULD be under approximately 900 words if feasible.
- If that target would make the repo less safe or less clear, document why the larger size is retained.

Also review `.cursor/rules/00-agents-md.mdc`:

- Keep it minimal.
- Avoid broad trigger surfaces.
- Ensure the always-on rule does not encourage Cursor to load unnecessary product/internal context.

### 8. Narrow remaining broad Cursor rule triggers

Audit `.cursor/rules/*.mdc` again.

Focus especially on rules that still cause internal content to activate broadly.

At minimum, review:

- `.cursor/rules/daedaline-engineer.mdc`
- `.cursor/rules/persona-designer.mdc`
- `.cursor/rules/intake-analyst.mdc`
- `.cursor/rules/supervisor.mdc`
- `.cursor/rules/tech-lead.mdc`
- `.cursor/rules/tech-writer.mdc`

Specific guidance:

- Remove `src/personas/**/*.md` from `daedaline-engineer` unless the task is persona work.
- Avoid broad `src/memory/handbook/**/*.md` triggers where a narrower route is sufficient.
- Keep `src/work/**` out of default rule activation except for rules that specifically operate on run artifacts.
- Keep generated JSON out of semantic triggers unless a rule explicitly processes machine artifacts.
- Ensure persona-authoring work has its own narrow rule path.

Emit or update a rule-audit artifact for this pass.

### 9. Expand context-budget reporting by tier

Update `src/internal/tools/context-budget-report.mjs` so it reports approximate footprint by memory tier.

Minimum required groups:

- active memory: `src/memory/active/**`
- durable memory: `src/memory/features/**`, `src/memory/adr/**`, `src/memory/backlog/**`
- archival memory: `src/work/**`, `src/inbox/out/**`, `src/inbox/threads/**`
- internal operating content: `src/memory/handbook/**`, `src/personas/**`, `src/skills/**`, `.cursor/rules/**`, `.cursor/agents/**`
- product context: `PRD.md`, `PRD.summary.md`, `PRD.index.md`, `BOOTSTRAP.md`
- source code: `packages/**`, `tools/**`, tests
- generated machine artifacts: generated JSON, manifests, dry-run/write/post-write outputs, lockfiles

The report should clearly distinguish:

- approximate total corpus,
- indexable/default context,
- explicit-read-only context,
- active-memory footprint.

A rough `chars / 4` token estimate is acceptable if labeled as approximate.

Update or add tests for the new grouping behavior.

### 10. Update `.cursorindexingignore`

Review and update `.cursorindexingignore` to align with the new tier model.

Expected policy:

- `src/work/**` remains excluded.
- `src/inbox/out/**` remains excluded.
- `src/inbox/threads/**` remains excluded.
- generated manifests remain excluded.
- generated JSON/index/report artifacts remain excluded unless explicitly justified.
- `pnpm-lock.yaml` remains excluded.
- `.cursor/agents/**` remains excluded only if custom agent discovery has been manually verified.
- `src/memory/active/**` should generally remain indexable unless it becomes too large.
- internal operating content should be indexed selectively, not by broad default.

Record any changes and rationale.

### 11. Add model/context escalation guidance

Add guidance somewhere appropriate, likely `src/memory/handbook/context-economy.md` or `AGENTS.md`.

It should say:

- Opus-class models are expensive and should not be the default for simple mechanical work.
- Simple task mode should use the cheapest model that can reliably complete the task.
- Escalation to Opus-class models is appropriate for ambiguous architecture, policy, cross-cutting refactors, or high-risk reasoning.
- Agents should state when they are escalating context/model usage and why.

This is guidance only; do not hardcode provider-specific behavior unless the repo already has a model-selection mechanism.

### 12. Update documentation and backlog

Apply the repo’s documentation-impact contract.

Evaluate and update:

- `AGENTS.md`
- `.cursor/rules/*.mdc`
- `.cursorindexingignore`
- `src/memory/handbook/index.md`
- `src/memory/handbook/context-economy.md`
- `src/memory/handbook/memory-tiers.md`
- `src/memory/active/README.md`
- `src/memory/active/current.md`
- `src/memory/active/runs.md`
- `src/memory/adr/000X-active-vs-archival-memory.md`
- `README.md`
- `src/memory/backlog/index.yaml`

Record deferred migration work in `src/memory/backlog/index.yaml`.

## Acceptance criteria

This task is complete when all of the following are true:

1. `src/memory/handbook/memory-tiers.md` exists and defines active, durable, archival, internal, and generated-machine tiers.
2. `src/memory/active/README.md` exists.
3. `src/memory/active/current.md` exists and is intentionally small.
4. `src/memory/active/runs.md` exists and stores pointers rather than copied artifacts.
5. A new ADR records the active-versus-archival memory decision.
6. `src/work/**` is explicitly documented as archival memory and explicit-read only by default.
7. Internal operating content is documented separately from active memory.
8. `src/memory/handbook/context-economy.md` reflects the new tier model.
9. `src/memory/handbook/index.md` routes to active memory and memory-tier guidance.
10. Simple task mode is documented with clear default behavior and escalation criteria.
11. `AGENTS.md` is slimmed further if safe, or the decision not to slim it further is documented.
12. `.cursor/rules/*.mdc` have been audited for remaining broad triggers.
13. `daedaline-engineer` no longer broadly activates persona/handbook context unless justified.
14. `src/internal/tools/context-budget-report.mjs` reports approximate footprint by tier.
15. Context-budget tests are updated or added.
16. `.cursorindexingignore` aligns with the new tier model.
17. No historical artifacts are deleted.
18. Any risky physical migration is either completed with compatibility/test coverage or explicitly deferred.
19. A delivery report explains what changed, what was deferred, and what the operator must manually validate.
20. Policy-compliance and documentation-impact requirements are satisfied.

## Manual validation requested from operator

After implementation, the delivery report SHALL ask the operator to:

1. Restart or reindex Cursor.
2. Confirm custom agents under `.cursor/agents/**` are still discoverable if that path remains excluded from indexing.
3. Run `pnpm run context:budget`.
4. Run 3–5 comparable simple Cursor tasks and record cache-read totals.
5. Compare against the previous post-pass-1 result of approximately 770K cache-read tokens.
6. Confirm explicit references to `@PRD.md`, `@BOOTSTRAP.md`, selected `src/work/**` artifacts, and selected durable memory files still work when intentionally requested.
7. Confirm `src/memory/active/current.md` gives a clear operator-facing picture of active context without requiring traversal of archival memory.

## Desired outcome

A simple mechanical task should not cause Cursor to drag the repo’s whole institutional memory into the prompt loop.

Target bands:

- simple task / small edit: ideally under 100K–250K cache-read tokens,
- medium agent task: 250K–750K cache-read tokens,
- large planning/refactor/governance task: 750K+ acceptable when justified.

These are directional targets, not hard correctness gates, because Cursor may include hidden tool/schema/chat overhead outside direct repo control.

The implementation should make the repo’s context model obvious:

- active memory is small and current,
- durable memory is ratified and routeable,
- archival memory is preserved but explicit-read,
- internal operating content is available but not default-loaded,
- generated machine artifacts are not used as human reasoning context unless specifically needed.