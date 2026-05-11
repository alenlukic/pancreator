---
title: AGENTS.md Authoring Guide
slug: agents-md-authoring
stability: experimental
bootstrap-only: false
phase: 0b
owners: [supervisor, librarian, tech-lead]
purpose: |
  Canonical authoring and change-control guidance for `/AGENTS.md`, the
  primary cross-tool contract for this repository. This guide defines required
  shape, update triggers, governance workflow, mirror policy, and pre-merge
  quality checks for AGENTS changes.
references:
  - kind: lines
    path: docs/BOOTSTRAP.md
    range: [57, 71]
    contentHash: 51973c1e32036385d02d823c1e19393494fbbd2d0741be12aa8e4d55660de80e
    note: "Phase 0b requires `/src/memory/handbook/agents-md-authoring.md` as a handbook seed."
  - kind: lines
    path: AGENTS.md
    range: [3, 6]
    contentHash: fcc9af63e232ebccfcc0ce86f23d03c532727ce46af2dcd869b70748adb79810
    note: "AGENTS defines itself as the primary cross-tool contract and declares symlink surfaces."
  - kind: lines
    path: AGENTS.md
    range: [16, 30]
    contentHash: d3e4a75dac43a7f9fe62c9f7fd25912ee98d94c932465f743d26eff17400bd08
    note: "AGENTS canon table defines mandatory handbook references."
  - kind: lines
    path: AGENTS.md
    range: [55, 71]
    contentHash: 1941cd3a9be67964e0d9dfe9de6b207382fe89299504f6b13aebf27ddc25bed1
    note: "AGENTS delegation rule defines when work is delegated versus performed directly."
  - kind: lines
    path: AGENTS.md
    range: [75, 100]
    contentHash: 28c22c2e763b67c9b41fb4ac9df82cd0de3eb3a632142bc4399c8b40ec9a200e
    note: "AGENTS working agreement defines non-negotiable operating constraints."
  - kind: lines
    path: AGENTS.md
    range: [158, 160]
    contentHash: 0dd1d3f2c5d1db206bc6da3c346b13c101655a6dacffc6c24072fd769e4c20a0
    note: "AGENTS changes require inbox item plus explicit human ratification."
related:
  - /AGENTS.md
  - /docs/BOOTSTRAP.md
  - /src/memory/handbook/glossary.md
  - /src/memory/handbook/constitution.md
  - /src/memory/handbook/documentation-impact-contract.md
---

# AGENTS.md Authoring Guide

## 1 - Purpose and scope

`/AGENTS.md` is the repository's primary cross-tool contract. It SHALL define
operator and agent obligations that apply across runtimes, personas, skills,
and workflow surfaces.

This guide governs authoring and edits for `/AGENTS.md` only. Persona-specific
behavior belongs in `src/personas/<name>.md` and `.cursor/rules/<name>.mdc`.
Pipeline-step execution behavior belongs in pipeline and persona artifacts, not
in ad-hoc AGENTS prose.

## 2 - Required AGENTS shape

An AGENTS file in this repo MUST include, at minimum, the sections below in
stable numbered form:

1. **What this repo is.** Scope and bootstrap state.
2. **Where the canon lives.** Canon table listing required handbook and spec
   references.
3. **Where the agents live.** Persona/rule/skill locations and roster notes.
4. **Pipeline-step delegation rule.** Delegation obligation and fallback mode.
5. **Working agreement.** Non-negotiable operating constraints.
6. **How to discover what to do next.** Operator queue and navigation order.
7. **Workspace map.** Canonical top-level path map.
8. **Bootstrap status (live).** Current implementation state.
9. **Stability.** Change authority and promotion path.

Section numbering MAY increase when new mandatory sections are ratified. A
change MUST NOT silently reorder or remove an existing mandatory section.

## 3 - Update triggers

Authors SHALL update `/AGENTS.md` when any trigger below occurs:

1. **Canon drift.** A required handbook page is added, removed, renamed, or has
   a changed normative purpose.
2. **Path drift.** A top-level path in the workspace map changes.
3. **Governance drift.** Human-gate, ratification, or non-negotiable workflow
   obligations change.
4. **Delegation drift.** Pipeline delegation rules, fallback mode, or persona
   ownership boundaries change.
5. **Bootstrap-state drift.** The live status no longer matches repository
   reality.
6. **Cross-file contradiction.** AGENTS text conflicts with `docs/PRD.md`,
   `docs/BOOTSTRAP.md`, or handbook canon.

When a trigger fires, the author SHALL update AGENTS in the same change set as
the source change, or SHALL record a deferral with backlog linkage.

## 4 - Change-control workflow

AGENTS changes are governance changes and SHALL follow this sequence:

1. Open or reference an inbox directive under `/src/inbox/in/` that authorizes the
   update scope.
2. When the change is policy-significant, create or update an ADR under
   `/src/memory/adr/` before ratification.
3. Stage AGENTS and dependent canonical docs together to keep references
   coherent.
4. Request explicit human ratification before treating new AGENTS rules as
   active policy.
5. If any required update is deferred, record rationale and backlog linkage in
   `/src/memory/backlog/index.yaml` per documentation-impact policy.

## 5 - Link policy

`/AGENTS.md` is the single canonical root operating card.

Authors MUST NOT add `.github/copilot-instructions.md`, root `CLAUDE.md`, or
other duplicate mirrors of AGENTS content. Any tool that expects a separate
Copilot instruction file SHALL be configured to read `AGENTS.md` when the
product allows it.

Authors MUST NOT maintain duplicate static copies of AGENTS narrative in any
mirror surface without an inbox-authorized exception and backlog linkage.

## 6 - Quality checks before merge

Before merge, the author SHALL verify:

1. **Repo reality alignment.** AGENTS claims match actual directories, active
   bootstrap state, and current roster.
2. **Canon table integrity.** Every listed file exists and each purpose line is
   precise and current.
3. **Reference integrity.** Frontmatter references use dual-anchor shape with
   `contentHash` populated or explicitly `TBD-on-commit`.
4. **Policy coherence.** AGENTS introduces no contradiction with `docs/PRD.md`,
   `docs/BOOTSTRAP.md`, constitution, glossary, and handbook contracts.
5. **Delegation coherence.** Delegation rules in AGENTS remain consistent with
   persona metadata ownership boundaries.
6. **Entrypoint integrity.** The repository root exposes only `/AGENTS.md` as
   the operating card; no duplicate instruction symlinks or parallel static
   copies.

## 7 - Author checklist (compact)

- [ ] Trigger identified and scoped.
- [ ] Inbox directive linked; ADR linked when policy-significant.
- [ ] Required AGENTS sections preserved and coherent.
- [ ] Canon table updated for any handbook/spec drift.
- [ ] Entrypoint policy validated (`AGENTS.md` only at repo root for the operating card).
- [ ] Cross-file contradiction check passed (`docs/PRD.md`, `docs/BOOTSTRAP.md`, handbook).
- [ ] Deferrals, if any, recorded with backlog linkage.
- [ ] Human ratification requested before policy activation.

## 8 - Stability

This guide is a Phase 0b handbook seed and is currently `experimental`.
Promotion to `stable` SHALL follow repeated dogfood validation that AGENTS
changes remain coherent, ratifiable, and contradiction-free across phases.
