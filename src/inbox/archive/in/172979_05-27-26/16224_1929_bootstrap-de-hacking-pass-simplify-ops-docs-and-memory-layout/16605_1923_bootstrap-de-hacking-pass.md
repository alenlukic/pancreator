---
title: "Bootstrap de-hacking pass — simplify ops, docs, and memory layout"
feature_id: bootstrap-de-hacking-pass
stage: intake
owner: intake-analyst
status: open
created_at: "2026-05-27T19:23:14.782Z"
references:
  - kind: path
    path: AGENTS.md
    note: Operating card, workspace map, and delegation rules to align after cleanup.
  - kind: path
    path: README.md
    note: Operator entry point; operational how-tos to extract into OPERATION.md.
  - kind: path
    path: src/memory/handbook/operator-output-contract.md
    note: Next-operator-steps format and copy-paste command requirements.
  - kind: path
    path: src/memory/handbook/inbox-lifecycle.md
    note: Canonical inbox paths and promotion rules.
  - kind: path
    path: src/memory/backlog/index.yaml
    note: Target backlog for future-work skeletons and debt consolidation.
  - kind: path
    path: src/memory/features/
    note: Feature folders to audit; only implemented work should remain.
  - kind: path
    path: .github/workflows/phase-0a-scaffold.yml
    note: Primary CI workflow; candidate for slimming or workflow_dispatch during bootstrap.
  - kind: path
    path: .github/workflows/run-logger-conformance.yml
    note: Secondary CI workflow; candidate for librarian pre-close validation instead.
  - kind: path
    path: src/personas/librarian.md
    note: Close-artifacts stage owner; should run tests and fix straightforward failures.
  - kind: path
    path: docs/PRD.summary.md
    note: Strategic context for feature-delivery automation and operator UI goals.
---

# Bootstrap de-hacking pass — simplify ops, docs, and memory layout

## Problem

Bootstrap development accumulated ad-hoc fixes, parallel conventions, and
operator friction as issues were discovered and patched in place. The repo now
carries duplication across docs, memory tiers, CI, and agent output; skeleton
feature folders coexist with shipped work; and long-running GitHub workflows slow
velocity without matching current bootstrap needs.

Near-term product goals are **fully automated feature delivery** and a **v0
operator dashboard** for lower-friction operation and visibility. Both depend on a
coherent conceptual model, lean operational surfaces, and trustworthy memory
layout—not more one-off patches.

## Goal

Execute a bounded **de-hacking pass** that removes redundancy, aligns the repo
with handbook and AGENTS philosophy, prioritizes conceptual and operational
simplicity, and shifts cost/benefit toward librarian-gated local validation over
heavy CI—while keeping documentation accurate and operator workflows copy-paste
safe.

## Strategic alignment

This pass SHALL NOT implement full pipeline automation or the dashboard UI. It
SHALL produce a ratified plan and incremental changes that **unblock** those
tracks by:

- Reducing noise agents and operators load on every task.
- Making `src/memory/features/` truthfully represent implemented capabilities.
- Centralizing operator procedures in a maintainable `OPERATION.md`.
- Establishing librarian pre-close test/fix discipline as the default quality gate.

## Required outcomes

### R1 — Duplication and philosophy conformance

- Inventory bootstrap-era duplication (docs, handbook seeds, CLI help vs handbook,
  parallel agent projections, stale README sections, overlapping feature specs).
- Refactor or delete redundancies where a single canonical source exists per
  `src/memory/handbook/context-economy.md` and `documentation-impact-contract.md`.
- Record any intentional dual-location artifacts with explicit ownership in
  handbook or ADR (do not leave silent drift).

### R2 — Operator output and next steps

- Audit persona projections and handbook contracts for **Next operator steps**
  conformance per `src/memory/handbook/operator-output-contract.md`.
- Enforce: fully formed `pnpm -w exec tess …` command blocks (no bare `tess`),
  one copy-paste block per mutating action, no prose file-shopping lists.
- Add or tighten validation (lint, compliance descriptor, or maintainer script)
  where gaps are found; document deferrals in backlog with owner.

### R3 — Feature memory vs backlog

- **`src/memory/features/`** SHALL contain only features with implemented,
  verifiable substrate (packages, CLI verbs, pipelines, or ratified dogfood
  evidence)—not future-work placeholders.
- Skeleton or not-yet-implemented intents SHALL move to **`src/memory/backlog/`**
  (`index.yaml` items with links to any preserved spec drafts under backlog or
  archive paths as appropriate).
- Update `src/memory/features/*/index.json` discovery, active-memory shipped
  lists, and citation targets after moves; run citation/hash refresh where touched.

### R4 — OPERATION.md extraction

- Create repository-root **`OPERATION.md`** as the canonical operator how-to
  (searchable sections: inbox, feature delivery loop, `tess` verbs, memory
  refresh, commit/policy-compliance, troubleshooting).
- **`README.md`** SHALL remain a short entry point (status, map, pointers)—not
  the full procedural manual.
- Add handbook obligation: agents SHALL update `OPERATION.md` whenever
  operator-facing interfaces change (CLI flags, paths, defaults, env vars).
- Link from `README.md`, `AGENTS.md` §6, and `docs/M1.index.md` as needed.

### R5 — Backlog/debt consolidation

- Merge **`src/memory/debt/`** into backlog-only tracking; debt items are backlog
  items (tag or `category: debt` in backlog schema if useful).
- Remove or redirect empty `src/memory/debt/` tree; update AGENTS workspace map,
  PRD.index triggers, and MCP resource lists to match.
- Migrate any open debt references in docs to backlog entries.

### R6 — CI cost/benefit and librarian gate

- Propose and implement a bootstrap-appropriate CI posture:
  - Slim workflows, `workflow_dispatch`-only, path-narrowing, or temporary disable
    with documented rationale—**prefer velocity** until feature-delivery automation
    and dashboard exist.
- Define **librarian pre-close validation**: before `tess close-artifacts`, librarian
  (or delegated coder under librarian prompt) SHALL run agreed local checks
  (e.g. `pnpm test`, targeted package tests, typecheck) and fix straightforward
  failures (type errors, stale status fields, formatting) within task scope.
- Document the check list in `OPERATION.md` and librarian persona/skill; heavy
  conformance suites MAY remain manual/`operator-on-demand` per AGENTS §6.1.

### R7 — Documentation impact

- Complete documentation-impact pass for all touched surfaces.
- Ensure `docs/PRD.summary.md` / `docs/M1.index.md` pointers reflect new operator
  doc layout where applicable (full PRD edits only if scope requires).

## Acceptance criteria

- A feature spec (`src/memory/features/bootstrap-de-hacking-pass/spec.md`) exists
  after intake with touch-set, ordered work packages, and explicit human gates.
- `OPERATION.md` exists; `README.md` is shortened and links to it; handbook cites
  the maintenance obligation.
- Audit artifact lists: features removed/moved to backlog, debt tier retired,
  backlog items created for each relocated skeleton.
- Operator-output audit summary: conforming examples cited; gaps either fixed or
  backlog-linked with owner.
- CI change rationale documented (README or OPERATION.md + backlog if CI disabled).
- Librarian close-out procedure documents pre-close test/fix expectations.
- `pnpm -w exec tess` workspace tests and compliance descriptors applicable to
  touched paths pass (or deferrals recorded per deferral protocol).
- Delivery report cites this inbox item and records doc-impact disposition.

## Out of scope

- Implementing full unattended `feature-delivery` (separate inbox:
  `feature-delivery-cursor-runner-harness-wiring`).
- Building the v0 dashboard UI (follow-on feature; this pass may note API/CLI
  hooks the UI will need).
- Large PRD rewrites or Phase exit ratification (human gates unchanged).
- Rewriting historical `src/internal/work_archive/` content.
- Reading or ingesting `src/inbox/notes/` (human-only sandbox).

## Suggested work packages (intake to refine)

| WP | Title | Primary owner |
|----|--------|----------------|
| WP-1 | Audit + move feature skeletons → backlog | librarian + tech-lead |
| WP-2 | OPERATION.md extraction + README slim | tech-writer |
| WP-3 | Operator-output conformance + lint hooks | tesseract-engineer + contract-writer |
| WP-4 | Backlog/debt consolidation + AGENTS map | tech-lead |
| WP-5 | CI slimming + librarian pre-close test contract | tesseract-engineer + librarian |
| WP-6 | Duplication/philosophy sweep (handbook, CLI, agents) | supervisor + persona-designer (review only) |

## Suggested owners

| Area | Persona |
|------|---------|
| Intake, spec, touch-set | `intake-analyst` → `tech-lead` |
| Memory tier moves, close-artifacts | `librarian` |
| Operator docs | `tech-writer` |
| CI / CLI / validation scripts | `tesseract-engineer` |
| Contracts / compliance descriptors | `contract-writer` |
| Review | `reviewer` |

## Traceability

- Relates to strategic goals: feature-delivery automation, v0 operator dashboard.
- Complements: `src/inbox/in/172979_05-27-26/72021_0359_feature-delivery-cursor-runner-harness-wiring.md`
- Prior art: `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants` feature (partial overlap—this pass is broader and includes ops/CI/docs).
