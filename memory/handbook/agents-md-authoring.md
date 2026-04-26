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
  shape, update triggers, governance workflow, symlink policy, and pre-merge
  quality checks for AGENTS changes.
references:
  - kind: lines
    path: BOOTSTRAP.md
    range: [57, 71]
    contentHash: TBD-on-commit
    note: "Phase 0b requires `/memory/handbook/agents-md-authoring.md` as a handbook seed."
  - kind: lines
    path: AGENTS.md
    range: [3, 6]
    contentHash: TBD-on-commit
    note: "AGENTS defines itself as the primary cross-tool contract and declares symlink surfaces."
  - kind: lines
    path: AGENTS.md
    range: [16, 30]
    contentHash: TBD-on-commit
    note: "AGENTS canon table defines mandatory handbook references."
  - kind: lines
    path: AGENTS.md
    range: [55, 71]
    contentHash: TBD-on-commit
    note: "AGENTS delegation rule defines when work is delegated versus performed directly."
  - kind: lines
    path: AGENTS.md
    range: [75, 100]
    contentHash: TBD-on-commit
    note: "AGENTS working agreement defines non-negotiable operating constraints."
  - kind: lines
    path: AGENTS.md
    range: [158, 160]
    contentHash: TBD-on-commit
    note: "AGENTS changes require inbox item plus explicit human ratification."
related:
  - /AGENTS.md
  - /BOOTSTRAP.md
  - /memory/handbook/glossary.md
  - /memory/handbook/constitution.md
  - /memory/handbook/documentation-impact-contract.md
---

# AGENTS.md Authoring Guide

## 1 - Purpose and scope

`/AGENTS.md` is the repository's primary cross-tool contract. It SHALL define
operator and agent obligations that apply across runtimes, personas, skills,
and workflow surfaces.

This guide governs authoring and edits for `/AGENTS.md` only. Persona-specific
behavior belongs in `personas/<name>.md` and `.cursor/rules/<name>.mdc`.
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
6. **Cross-file contradiction.** AGENTS text conflicts with `PRD.md`,
   `BOOTSTRAP.md`, or handbook canon.

When a trigger fires, the author SHALL update AGENTS in the same change set as
the source change, or SHALL record a deferral with backlog linkage.

## 4 - Change-control workflow

AGENTS changes are governance changes and SHALL follow this sequence:

1. Open or reference an inbox directive under `/inbox/in/` that authorizes the
   update scope.
2. When the change is policy-significant, create or update an ADR under
   `/memory/adr/` before ratification.
3. Stage AGENTS and dependent canonical docs together to keep references
   coherent.
4. Request explicit human ratification before treating new AGENTS rules as
   active policy.
5. If any required update is deferred, record rationale and backlog linkage in
   `/memory/backlog/index.yaml` per documentation-impact policy.

## 5 - Link and symlink policy

`/AGENTS.md` is the single canonical file. `CLAUDE.md` and
`.github/copilot-instructions.md` SHALL remain symlinks to `AGENTS.md`.

Authors MUST NOT maintain duplicate static copies of AGENTS content in those
surfaces. Any AGENTS edit SHALL preserve working symlink targets in the same
change set.

## 6 - Quality checks before merge

Before merge, the author SHALL verify:

1. **Repo reality alignment.** AGENTS claims match actual directories, active
   bootstrap state, and current roster.
2. **Canon table integrity.** Every listed file exists and each purpose line is
   precise and current.
3. **Reference integrity.** Frontmatter references use dual-anchor shape with
   `contentHash` populated or explicitly `TBD-on-commit`.
4. **Policy coherence.** AGENTS introduces no contradiction with `PRD.md`,
   `BOOTSTRAP.md`, constitution, glossary, and handbook contracts.
5. **Delegation coherence.** Delegation rules in AGENTS remain consistent with
   persona metadata ownership boundaries.
6. **Symlink integrity.** `CLAUDE.md` and `.github/copilot-instructions.md`
   still resolve to AGENTS.

## 7 - Author checklist (compact)

- [ ] Trigger identified and scoped.
- [ ] Inbox directive linked; ADR linked when policy-significant.
- [ ] Required AGENTS sections preserved and coherent.
- [ ] Canon table updated for any handbook/spec drift.
- [ ] Symlink policy validated (`CLAUDE.md`, `.github/copilot-instructions.md`).
- [ ] Cross-file contradiction check passed (`PRD.md`, `BOOTSTRAP.md`, handbook).
- [ ] Deferrals, if any, recorded with backlog linkage.
- [ ] Human ratification requested before policy activation.

## 8 - Stability

This guide is a Phase 0b handbook seed and is currently `experimental`.
Promotion to `stable` SHALL follow repeated dogfood validation that AGENTS
changes remain coherent, ratifiable, and contradiction-free across phases.
