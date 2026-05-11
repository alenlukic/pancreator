---
title: Cursor Token Economy and Default Context Budget
feature_id: cursor-token-economy
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-09T00:00:00Z
references:
  - kind: path
    path: .cursor/rules/00-agents-md.mdc
    note: Always-on Cursor rule currently loads AGENTS.md for every invocation.
  - kind: path
    path: .cursor/rules/tesseract-engineer.mdc
    note: Broad glob surface appears likely to activate large internal context.
  - kind: path
    path: AGENTS.md
    note: Canonical repo operating contract and default agent entrypoint.
  - kind: path
    path: PRD.md
    note: Large product spec; should remain available but not default-loaded for routine tasks.
  - kind: path
    path: src/work/
    note: Historical and generated execution artifacts; likely high-volume low-signal default context.
  - kind: path
    path: src/memory/
    note: Durable memory tier; should be routed deliberately rather than bulk-loaded.
---

# Cursor Token Economy and Default Context Budget

## Problem

Simple Cursor invocations in this repo are producing unexpectedly high token cache-read totals, observed around 1.4M and 2.8M cache-read tokens despite tiny actual input/output.

The working hypothesis is that Cursor is repeatedly reusing a very large cached repo-context prefix across agent/tool-loop calls. This is probably not caused by `PRD.md` alone. The larger issue appears to be that the repo mixes:

- active source code,
- durable memory,
- generated work artifacts,
- historical run output,
- persona mirrors,
- Cursor rule projections,
- large product specs,
- lockfiles,
- generated JSON manifests,

inside the same default AI-indexable surface.

This harms token economy and may also degrade agent quality by increasing irrelevant context pressure.

## Goal

Implement a comprehensive context-economy pass that reduces default Cursor context exposure while preserving the Tesseract repo’s core operating model.

The system SHALL optimize for:

1. Lower default Cursor cache-read volume for simple tasks.
2. Explicit retrieval of high-value context only when task-relevant.
3. Preservation of agent/persona/pipeline behavior.
4. No deletion of historical records.
5. Measurable before/after validation.

## Non-goals

This task SHALL NOT remove historical work artifacts.

This task SHALL NOT weaken policy-compliance, documentation-impact, inbox lifecycle, or human-ratification requirements.

This task SHALL NOT hide `PRD.md`, `BOOTSTRAP.md`, `src/memory/`, or `src/work/` from explicit human or agent access. The desired behavior is “not default indexed / not default loaded,” not “unavailable.”

## Required implementation

### 1. Add project-level Cursor indexing controls

Create a root `.cursorindexingignore` with an initial conservative ignore policy.

Recommended initial content:

```gitignore
# Historical/generated agent artifacts
src/work/**
src/inbox/out/**
src/inbox/threads/**

# Generated manifests / bulky machine outputs
**/migration-manifest*.json
**/*.dry-run.json
**/*.post-write.json
**/*.write.json

# Generated or low-signal durable indexes/reports
src/memory/**/*.json
src/memory/**/delivery-report.md
src/memory/**/index.json

# Lockfile rarely needed for semantic repo reasoning
pnpm-lock.yaml

# Cursor-native mirrors are runtime surfaces, not semantic source of truth.
# Validate Cursor still discovers custom agents before keeping this exclusion.
.cursor/agents/**
```

Then update `.gitignore` so `.cursorindexingignore` is not ignored. Prefer committing `.cursorindexingignore` so the repo carries its own context-economy policy.

Do not add `.cursorignore` unless the implementation can prove the ignored files remain explicitly accessible when needed. This task is about indexing/default-context control first.

### 2. Audit and narrow Cursor rule globs

Audit every `.cursor/rules/*.mdc` file and identify rules whose `globs` activate too much context for common tasks.

At minimum, review:

- `.cursor/rules/00-agents-md.mdc`
- `.cursor/rules/tesseract-engineer.mdc`
- `.cursor/rules/intake-analyst.mdc`
- `.cursor/rules/tech-writer.mdc`
- `.cursor/rules/supervisor.mdc`

The `tesseract-engineer` rule currently appears too broad. Replace broad corpus globs such as:

```yaml
globs: ["AGENTS.md", "BOOTSTRAP.md", "src/memory/**/*", "src/personas/**/*", "src/skills/**/*", "src/work/**/*", ".cursor/agents/**/*", ".cursor/rules/**/*"]
```

with narrower triggers such as:

```yaml
globs:
  - "src/inbox/in/**/*.md"
  - "src/internal/packages/@tesseract/**"
  - "src/internal/packages/tesseract/**"
  - "tools/**/*.mjs"
  - "tests/**/*.ts"
  - "tests/**/*.mjs"
  - "tesseract.yaml"
  - "tesseract-defaults.yaml"
  - "src/memory/handbook/**/*.md"
  - "src/skills/**/SKILL.md"
  - ".cursor/rules/*.mdc"
```

Do not include `src/work/**/*` in default engineering rule activation unless a rule specifically handles run logs, plans, reviews, or delivery reports.

Emit a small audit artifact listing each Cursor rule, whether its glob changed, and why.

### 3. Create a context-economy handbook page

Add a new handbook page:

```text
src/memory/handbook/context-economy.md
```

It SHALL define:

- default retrieval discipline,
- when to read `PRD.md`,
- when to read `BOOTSTRAP.md`,
- when to read `src/memory/handbook/index.md`,
- when to read `src/memory/features/**`,
- when to read `src/work/**`,
- how to treat generated manifests,
- which files should be indexed by Cursor,
- which files should remain explicit-read only.

Update:

```text
src/memory/handbook/index.md
```

with a route for context-budgeting and AI-context retrieval decisions.

### 4. Split PRD access into summary-first retrieval

Create:

```text
PRD.summary.md
PRD.index.md
```

`PRD.summary.md` SHALL be a compact product/context summary suitable for routine agent orientation.

`PRD.index.md` SHALL map major PRD sections to “read this when...” guidance.

Update relevant docs/rules so agents SHOULD read `PRD.summary.md` first and SHOULD read full `PRD.md` only when the task requires product-spec detail, citation repair, or line-anchored requirements.

Do not delete or rewrite the full `PRD.md` except for references needed by this task.

### 5. Slim the always-loaded agent surface

Review `AGENTS.md` as the always-loaded Cursor entrypoint.

The implementation SHOULD reduce always-loaded content where safe by moving verbose operational detail into handbook pages and replacing it with routing pointers.

Preserve the semantics of:

- tool safety,
- no auto-push,
- human phase-boundary ratification,
- inbox queue discovery,
- delegation rules,
- documentation-impact requirements,
- policy-compliance requirements.

Target outcome: `AGENTS.md` should be an operating card and routing map, not a full briefing. Any semantic move out of `AGENTS.md` SHALL preserve a clear pointer to the new canonical location.

Because AGENTS/persona semantics are protected, stage this part carefully and record human-ratification requirements if needed.

### 6. Separate durable memory from generated bulk

Do not delete existing `src/work/**` or generated artifacts.

Instead:

- ensure bulky generated files are excluded from Cursor semantic indexing,
- document that `src/work/**` is explicit-read only by default,
- define where future large generated manifests should live,
- consider `.local/` or ignored subpaths for non-durable scratch artifacts,
- record any deferred migration or architecture changes in `/src/memory/backlog/index.yaml`.

### 7. Add a lightweight context-budget report

Add a script or documented command that estimates repository context footprint by directory and file pattern.

Suggested artifact:

```text
src/internal/tools/context-budget-report.mjs
```

Minimum output SHOULD include approximate character counts and rough token estimates for:

- whole repo text corpus,
- `src/work/**`,
- `src/memory/**`,
- `PRD.md`,
- `AGENTS.md`,
- `.cursor/**`,
- `src/personas/**`,
- `packages/**`,
- `pnpm-lock.yaml`,
- generated JSON manifests.

The tool does not need model-exact tokenization. A rough `chars / 4` estimate is acceptable if clearly labeled.

Add an npm script if consistent with existing package conventions.

### 8. Update documentation and backlog

Apply the repo’s documentation-impact contract.

At minimum, evaluate updates to:

- `src/memory/handbook/index.md`
- `src/memory/handbook/context-economy.md`
- `AGENTS.md`
- `README.md`
- `.cursor/rules/*.mdc`
- `src/memory/backlog/index.yaml`

Record deferrals rather than silently skipping relevant documentation.

## Acceptance criteria

This task is complete when all of the following are true:

1. Root `.cursorindexingignore` exists and is committed.
2. `.gitignore` no longer ignores `.cursorindexingignore`.
3. Broad Cursor rule globs are audited and narrowed where appropriate.
4. `src/work/**` is no longer part of default Cursor semantic indexing.
5. Generated migration manifests and bulky generated JSON artifacts are excluded from default Cursor semantic indexing.
6. `pnpm-lock.yaml` is excluded from default Cursor semantic indexing.
7. Duplicate agent-instruction surfaces are excluded from default semantic indexing where safe.
8. `PRD.summary.md` and `PRD.index.md` exist.
9. Agents are instructed to prefer summary/index retrieval before full PRD retrieval.
10. `src/memory/handbook/context-economy.md` exists and is routed from `src/memory/handbook/index.md`.
11. A context-budget report command or documented manual procedure exists.
12. A delivery report explains what changed, what was deferred, and what the operator must manually verify in Cursor.
13. No historical artifacts are deleted.
14. All required policy-compliance and documentation-impact artifacts are produced.

## Manual validation requested from operator

After implementation, the delivery report SHALL ask the operator to:

1. Restart or reindex Cursor.
2. Rerun the same two simple commands that previously triggered ~1.4M and ~2.8M cache-read totals.
3. Record before/after cache-read totals.
4. Confirm whether explicit references such as `@PRD.md`, `@BOOTSTRAP.md`, and selected `src/work/**` artifacts remain accessible when intentionally requested.
5. Report any agent discovery regression involving `.cursor/agents/**`.

## Implementation guidance

Prefer a safe, staged implementation.

If any measure risks breaking Cursor custom agent discovery, pipeline routing, or canonical citation behavior, implement the safe subset first and record the risky measure as a backlog item with clear rationale.

Do not ask clarifying questions unless blocked. Implement the conservative changes, produce an audit report, and surface any remaining decisions for human ratification.