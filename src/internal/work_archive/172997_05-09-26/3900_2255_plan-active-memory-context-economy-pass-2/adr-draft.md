---
title: ADR Draft - Active Versus Archival Memory
seq: "0006"
status: proposed
date: 2026-05-09
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
feature_id: active-memory-context-economy-pass-2
target_path: src/memory/adr/0006-active-vs-archival-memory.md
references:
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [253, 286]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Spec path-classification and ADR requirements.
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [288, 352]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Spec context-economy, active-memory, and simple-task requirements.
  - kind: lines
    path: src/memory/adr/0003-inbox-lifecycle-and-archival.md
    range: [52, 109]
    contentHash: TBD-on-commit
    note: Prior archival boundary for inbox artifacts.
  - kind: lines
    path: src/memory/adr/0004-documentation-impact-contract.md
    range: [49, 75]
    contentHash: TBD-on-commit
    note: Prior documentation-impact and backlog deferral decision.
  - kind: lines
    path: src/memory/adr/0005-timestamp-naming-conventions.md
    range: [35, 60]
    contentHash: TBD-on-commit
    note: Prior migration decision that requires manifest and rollback discipline.
---

## Context

Tesseract stores active operator guidance, durable feature memory, historical work outputs, internal persona guidance, and generated machine artifacts in one repository. Pass 1 reduced default Cursor context through `.cursorindexingignore`, summary-first PRD routing, and a context-budget report. Pass 2 requires a tier model that separates routine orientation from archival and durable memory without deleting history. Citation: `{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [193, 210], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.

ADR-0003 defines inbox archive boundaries, ADR-0004 defines backlog-linked documentation deferrals, and ADR-0005 defines migration rollback discipline. This ADR builds on those decisions rather than moving historical files during the same slice. Citations: `{kind: lines, path: src/memory/adr/0003-inbox-lifecycle-and-archival.md, range: [52, 109], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/adr/0004-documentation-impact-contract.md, range: [49, 75], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [35, 60], contentHash: TBD-on-commit}`.

## Decision

When Tesseract classifies repository memory, Tesseract SHALL use five tiers: active memory, durable memory, archival memory, internal operating content, and generated machine artifacts.

When routine orientation starts, Tesseract SHALL load `src/memory/active/**` as the only memory tier intended for default orientation.

When a summary outgrows active use, Tesseract SHALL promote the retained knowledge into durable memory and SHALL leave the source artifact reachable by explicit read.

When Tesseract classifies `src/work/**`, `src/inbox/out/**`, and `src/inbox/threads/**`, Tesseract SHALL treat those paths as archival memory and explicit-read surfaces.

When Tesseract classifies `src/memory/features/**`, `src/memory/adr/**`, and `src/memory/backlog/**`, Tesseract SHALL treat those paths as durable memory.

When Tesseract classifies `src/memory/handbook/**`, `src/personas/**`, `src/skills/**`, `.cursor/rules/**`, and `.cursor/agents/**`, Tesseract SHALL treat those paths as internal operating content loaded by route.

When Tesseract classifies generated JSON, manifests, dry-run outputs, post-write outputs, and lockfiles, Tesseract SHALL treat those paths as generated machine artifacts excluded from default semantic indexing unless a task justifies inclusion.

When Tesseract evaluates physical migration of `src/work/**` or existing `src/memory/**` trees, Tesseract SHALL defer migration until one slice ships reference updates, compatibility shims, tests, a migration manifest, and rollback notes.

## Status

Status is proposed on 2026-05-09 for implement-stage review and later promotion to `src/memory/adr/0006-active-vs-archival-memory.md`.

## Consequences

- Positive: Routine tasks receive a small active-memory entry point while historical artifacts remain reachable.
- Positive: Context-budget reporting can compare active, durable, archival, internal, product, source, and generated tiers.
- Positive: Physical migration requires a future manifest and rollback plan before path changes occur.
- Negative: Operators must maintain active summaries so `src/memory/active/**` does not become another archival surface.
- Negative: Existing archival paths remain in place until a future migration pays the compatibility cost.
- Neutral: This ADR defines repository policy only; it does not implement runtime model selection or MemoryRouter enforcement.
