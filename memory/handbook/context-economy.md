---
title: Context economy and Cursor retrieval
slug: context-economy
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tech-lead, supervisor]
purpose: |
  Default discipline for AI context, Cursor indexing, and explicit document
  retrieval so routine tasks avoid loading the full durable-memory and work
  artifact surface.
references:
  - kind: lines
    path: AGENTS.md
    range: [1, 36]
    contentHash: TBD-on-commit
    note: AGENTS defines the primary entry contract and canon table including PRD routing.
  - kind: lines
    path: memory/handbook/index.md
    range: [43, 78]
    contentHash: TBD-on-commit
    note: Handbook index defines retrieval policy and routing table maintenance rules.
related:
  - /memory/handbook/index.md
  - /PRD.summary.md
  - /PRD.index.md
---

# Context economy and Cursor retrieval

## Default retrieval discipline

Agents and operators SHOULD load the smallest surface that resolves the task:

1. Read `AGENTS.md` first for the working agreement and workspace map.
2. Read `PRD.summary.md` for product orientation on routine tasks.
3. Read `memory/handbook/index.md` and follow at most one primary route plus stated secondaries.
4. Read full `PRD.md` only when the task requires product-spec detail, citation repair, or line-anchored requirements (see `PRD.index.md`).
5. Read `BOOTSTRAP.md` when the task is phase-boundary, exit-criterion, or bootstrap-sequence work.

Agents MUST NOT read, traverse, ingest, cite, or modify files under `/inbox/notes/` per inbox lifecycle.

## Indexed versus explicit-read surfaces

The repository root `.cursorindexingignore` file declares paths Cursor SHOULD treat as low default indexing value. Exclusion from default indexing MUST NOT mean deletion or secrecy: humans and agents SHALL still open excluded files with explicit paths or editor attachments when the task requires them.

Typical explicit-read surfaces include:

- Full `PRD.md` for deep spec work.
- `BOOTSTRAP.md` for bootstrap phase gates.
- Selected `work/**` artifacts for plan, review, run logs, and delivery slices.
- `memory/features/**` for feature specs, contracts, and delivery reports when the named Feature is in scope.

## Generated manifests and machine outputs

Agents SHOULD treat generated JSON manifests, migration dry-run outputs, and bulk index JSON under `memory/**` as machine-oriented. Operators SHOULD rely on summaries, runbooks, and feature `spec.md` for human decisions unless debugging a specific generator.

## When to read specific documents

| Need | Primary read | Notes |
|------|----------------|-------|
| Ubiquitous language | `memory/handbook/glossary.md` | Resolve every domain noun before authoring contracts or specs. |
| Routing handbook pages | `memory/handbook/index.md` | Avoid loading the full handbook tree by default. |
| Product intent at low detail | `PRD.summary.md` | Orientation only; not a substitute for `PRD.md` when citations need line anchors. |
| Section-level PRD routing | `PRD.index.md` | Picks which `PRD.md` section to open next. |
| Feature implementation | `memory/features/<id>/spec.md` | Canonical Engineering Spec for that Feature. |
| Bootstrap sequencing | `BOOTSTRAP.md` | Phase inputs, outputs, and exit criteria. |
| Governance and policy artifacts | `memory/handbook/policy-compliance-contract.md`, `memory/handbook/documentation-impact-contract.md` | Required for governed commits and post-task documentation decisions. |

## Operator maintenance

When `.cursorindexingignore` changes, the operator SHOULD restart or reindex Cursor and SHOULD verify custom agent discovery if `.cursor/agents/**` remains excluded. The operator SHOULD run `pnpm run context:budget` (or `node tools/context-budget-report.mjs`) before and after policy changes to capture directional corpus size estimates.
