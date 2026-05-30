---
title: ADR Draft - Summary-First Cursor Context Economy
seq: "draft-cursor-token-economy-0001"
status: proposed
date: 2026-05-09
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
feature_id: cursor-token-economy
references:
  - kind: lines
    path: lib/memory/features/cursor-token-economy/spec.md
    range: [121, 224]
    contentHash: TBD-on-commit
    note: Spec defines indexing, rule, handbook, PRD, command, documentation-impact, and policy-compliance requirements.
  - kind: lines
    path: lib/memory/features/cursor-token-economy/spec.md
    range: [226, 278]
    contentHash: TBD-on-commit
    note: Spec defines scope limits, protected-surface ratification, and deferrals.
  - kind: lines
    path: lib/memory/adr/0002-system-architecture-map.md
    range: [132, 151]
    contentHash: TBD-on-commit
    note: ADR-0002 separates current repository substrate from future runtime execution.
  - kind: lines
    path: lib/memory/adr/0004-documentation-impact-contract.md
    range: [49, 75]
    contentHash: TBD-on-commit
    note: ADR-0004 requires documentation-impact decisions and backlog-linked deferrals.
  - kind: lines
    path: PRD.md
    range: [649, 658]
    contentHash: TBD-on-commit
    note: PRD plan stage requires the plan artifact trio.
---

## Context

Cursor cache-read volume on routine repository invocations can load large historical and duplicated surfaces before a task requires them. The repository contains durable artifacts under `work/**`, generated manifests under `lib/memory/**` and `work/**`, duplicated agent instruction surfaces, full PRD text, and broad Cursor rule globs. Those surfaces remain valuable for explicit human and agent reads, but they add avoidable default indexing cost.

ADR-0002 states that Pancreator is still a document-first repository substrate, and runtime MemoryRouter execution remains future work. This slice therefore uses repository files, Cursor indexing policy, and handbook routing guidance rather than runtime retrieval enforcement. ADR-0004 requires documentation-impact decisions when guidance and reference surfaces change.

## Decision

When routine Cursor retrieval runs, Pancreator SHALL prefer indexed summary surfaces and explicit reads over broad default corpus activation.

When indexing policy lands, Pancreator SHALL track one root `.cursorindexingignore` file and SHALL stop ignoring it in `.gitignore`.

When default indexing excludes historical or generated surfaces, Pancreator SHALL preserve explicit read access to `PRD.md`, `BOOTSTRAP.md`, `lib/memory/**`, and `work/**`.

When Cursor rule activation is audited, Pancreator SHALL narrow over-broad `.cursor/rules/*.mdc` globs and SHALL record prior globs, new globs, and rationale in a work artifact.

When `.cursor/rules/pancreator-engineer.mdc` changes, Pancreator MUST exclude `work/**/*` from default activation unless the rule targets run logs, plans, reviews, or delivery reports.

When PRD retrieval guidance changes, Pancreator SHALL add `PRD.summary.md` for orientation and `PRD.index.md` for section-trigger routing before routine agents load full `PRD.md`.

When handbook routing changes, Pancreator SHALL add `lib/memory/handbook/context-economy.md` and SHALL route context-budgeting decisions from `lib/memory/handbook/index.md`.

When protected surfaces change, Pancreator MUST require human ratification for AGENTS.md slimming, `.cursor/agents/**` indexing exclusion validation, newly discovered over-broad rule edits, and mirrored Cursor rule glob edits.

When implementation completes, Pancreator SHALL produce documentation-impact and policy-compliance artifacts under the work folder, and SHALL link any deferral to `lib/memory/backlog/index.yaml`.

## Status

Status is proposed on 2026-05-09 for `coder` implement-stage execution.

## Consequences

- positive: Routine Cursor invocations load smaller default context while preserving explicit access to canonical artifacts.
- positive: PRD access gains a summary-first path that fits the current document-first repository state.
- positive: Rule glob changes become auditable through a dedicated work artifact.
- positive: Documentation-impact and policy-compliance evidence remains local to the implement slice.
- negative: Operator validation is required because `.cursor/agents/**` indexing exclusion can affect custom agent discovery.
- negative: Human ratification is required for AGENTS.md and mirrored Cursor rule changes before merge.
- neutral: This ADR does not introduce runtime MemoryRouter enforcement; it plans repository and Cursor policy changes only.
