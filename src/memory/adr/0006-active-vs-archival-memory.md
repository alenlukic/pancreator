---
title: Ratify Active Memory Versus Archival Memory
seq: "0006"
status: accepted
date: 2026-05-09T00:00:00Z
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
feature_id: active-memory-context-economy-pass-2
references:
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [191, 210]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Feature scope, preservation boundary, and explicit-read obligation for historical trees.
  - kind: lines
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [275, 286]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: Engineering Spec lists required ADR contents.
  - kind: lines
    path: src/memory/handbook/memory-tiers.md
    range: [34, 122]
    contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf
    note: Six-tier taxonomy, promotion rule, and archival explicit-read defaults.
  - kind: lines
    path: src/memory/handbook/glossary.md
    range: [212, 226]
    contentHash: 31546d19f1cabd2d82e88353fbc8a3d67f1b5b5a97f2b28734841d7103b5446f
    note: Glossary defines active-memory, active-work, durable-memory, archival-memory, internal-operating-content, and generated-machine-artifact.
  - kind: lines
    path: src/memory/handbook/context-economy.md
    range: [64, 108]
    contentHash: 108ea6a48c7e60dc62cbccd8af11af6d211d94f67a16082945437a56f400342e
    note: Memory-tier routing, active work explicit-read rule, archive boundary, and explicit-read surface examples.
  - kind: lines
    path: src/memory/active/README.md
    range: [29, 67]
    contentHash: 248cc86b0b3fb0dda938f61108737912251213461398744faa2a97949f710923
    note: Active-memory purpose, exclusions, soft budgets, and promotion into durable-memory.
  - kind: lines
    path: src/memory/active/current.md
    range: [24, 44]
    contentHash: 9a9c132f603409e4c8f0123aab6c310efeef2768a695c6f3b2ea955619f1e52c
    note: Routine orientation entry through pointer-first current focus.
  - kind: lines
    path: src/memory/active/runs.md
    range: [22, 35]
    contentHash: 1cd2565ba3ed1a9507a846512679a159cb56b37e37018b37d780130dfbe51519
    note: Run-pointer table keeps active logs under work and completed logs under src/internal/work_archive paths.
  - kind: lines
    path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md
    range: [44, 49]
    contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70
    note: Plan-stage deferrals name backlog linkage and glossary reversal.
  - kind: lines
    path: src/memory/adr/0003-inbox-lifecycle-and-archival.md
    range: [52, 64]
    contentHash: 994081b69166cd0be26dfbd5d506d6fbdf0aafd25c765fc7c6437c49fc485161
    note: Prior archival-boundary problem framing for inbox and queue history.
  - kind: lines
    path: src/memory/adr/0004-documentation-impact-contract.md
    range: [37, 47]
    contentHash: d77cc5cf38a61e2dafc65da2672914ad5bf6fd55295f49786c9b213670085f57
    note: Prior decision that deferred work requires backlog linkage and rationale.
  - kind: lines
    path: src/memory/adr/0005-timestamp-naming-conventions.md
    range: [35, 47]
    contentHash: a548b88124c47e651c06ade432fdd6b45992332676d31b381d73a41f6abc38ed
    note: Prior migration discipline before physical path moves.
---

## Context

Tesseract mixes short-term coordination, durable Feature memory, and historical
pipeline outputs in one repository. Pass 1 narrowed default Cursor context, yet
operators still need one explicit model that separates routine orientation
from durable specs and from archival runs without deleting history. Citation:
`{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [191, 210], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`.

ADR-0003 frames archive separation for inbox intake. ADR-0004 requires explicit
deferral records with backlog linkage. ADR-0005 requires manifest and rollback
discipline before bulk path migration. This ADR names the memory-tier split and
defers physical moves until a later migration slice pays compatibility cost.
Citations:
`{kind: lines, path: src/memory/adr/0003-inbox-lifecycle-and-archival.md, range: [52, 64], contentHash: 994081b69166cd0be26dfbd5d506d6fbdf0aafd25c765fc7c6437c49fc485161}`;
`{kind: lines, path: src/memory/adr/0004-documentation-impact-contract.md, range: [37, 47], contentHash: d77cc5cf38a61e2dafc65da2672914ad5bf6fd55295f49786c9b213670085f57}`;
`{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [35, 47], contentHash: a548b88124c47e651c06ade432fdd6b45992332676d31b381d73a41f6abc38ed}`.

## Decision

When Tesseract classifies repository memory for default retrieval, Tesseract
SHALL use six tiers:
**active-memory**,
**active-work**,
**durable-memory**,
**archival-memory**,
**internal-operating-content**,
and **generated-machine-artifact** per glossary and handbook policy. Citations:
`{kind: lines, path: src/memory/handbook/glossary.md, range: [212, 226], contentHash: 31546d19f1cabd2d82e88353fbc8a3d67f1b5b5a97f2b28734841d7103b5446f}`;
`{kind: lines, path: src/memory/handbook/memory-tiers.md, range: [34, 122], contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf}`.

When routine orientation starts among Memory paths, Tesseract SHALL treat
`src/memory/active/**` as the only **active-memory** tier intended for default
orientation. Citation:
`{kind: lines, path: src/memory/handbook/context-economy.md, range: [75, 77], contentHash: 108ea6a48c7e60dc62cbccd8af11af6d211d94f67a16082945437a56f400342e}`.

When an operator maintains **active-memory**, the operator SHALL store concise
summaries and pointers, SHALL link bulky specs and logs under **durable-memory**
or **archival-memory**, and SHALL promote retained facts into **durable-memory**
while keeping linked archival paths reachable by explicit read. Citations:
`{kind: lines, path: src/memory/handbook/memory-tiers.md, range: [45, 57], contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf}`;
`{kind: lines, path: src/memory/active/README.md, range: [36, 67], contentHash: 248cc86b0b3fb0dda938f61108737912251213461398744faa2a97949f710923}`.

When Tesseract classifies `src/work/**`, Tesseract SHALL treat that prefix as
**active-work** because it holds in-progress pipeline workspace artifacts.

When Tesseract classifies `src/internal/work_archive/**`, `src/inbox/out/**`, and
`src/inbox/threads/**`, Tesseract SHALL treat those prefixes as **archival-memory**
because they hold historical pipeline workspaces, operator threads, staged
responses, plans, reviews, and run outputs rather than day-zero orientation. Citation:
`{kind: lines, path: src/memory/handbook/memory-tiers.md, range: [75, 80], contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf}`.

When Tesseract loads **archival-memory** by default inside Cursor indexing or
agent retrieval, Tesseract SHALL treat that tier as explicit-read only so bulk
run history does not inflate routine context. Citations:
`{kind: lines, path: src/memory/handbook/memory-tiers.md, range: [82, 87], contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf}`;
`{kind: lines, path: src/memory/handbook/context-economy.md, range: [79, 80], contentHash: 108ea6a48c7e60dc62cbccd8af11af6d211d94f67a16082945437a56f400342e}`.

When a human or agent needs archival detail, that party SHALL open explicit
paths or attachments; exclusion from default indexing MUST NOT block access.
Citation:
`{kind: lines, path: src/memory/handbook/context-economy.md, range: [98, 108], contentHash: 108ea6a48c7e60dc62cbccd8af11af6d211d94f67a16082945437a56f400342e}`.

When Tesseract classifies `src/memory/features/**`, `src/memory/adr/**`, and
`src/memory/backlog/**`, Tesseract SHALL treat those prefixes as **durable-memory**
loaded by explicit route. Citation:
`{kind: lines, path: src/memory/handbook/memory-tiers.md, range: [59, 69], contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf}`.

When Tesseract classifies `src/memory/handbook/**`, `src/personas/**`, `src/skills/**`,
`.cursor/rules/**`, and `.cursor/agents/**`, Tesseract SHALL treat those paths
as **internal-operating-content** distinct from **active-memory**. Citation:
`{kind: lines, path: src/memory/handbook/memory-tiers.md, range: [92, 104], contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf}`.

When Tesseract classifies generated JSON, manifests, dry-run outputs, post-write
outputs, and lockfiles, Tesseract SHALL treat those artifacts as
**generated-machine-artifact** surfaces excluded from default semantic indexing
unless one task documents inclusion. Citation:
`{kind: lines, path: src/memory/handbook/memory-tiers.md, range: [106, 118], contentHash: a00f149bb18a67b22d897e91ae1c5e6cfda6b49d2f7fda5f96abf757e6430caf}`.

When Tesseract completes a run under `src/work/**`, Tesseract SHALL rely on the
`librarian` maintenance role to move completed run artifacts into
`src/internal/work_archive/**`, update references, and leave active runs in `src/work/**`.
Citation:
`{kind: lines, path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [46, 46], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`.

When Tesseract ships executable budget-warning tooling for **active-memory**
soft caps, Tesseract SHALL defer that tooling to backlog item
`active-memory-budget-warning-tool` so reporting and enforcement slices stay
separated. Citation:
`{kind: lines, path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [48, 48], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`.

When Tesseract narrows Cursor rule globs for mirror-parity risk, Tesseract
SHALL track ratification work under backlog item
`active-memory-rule-glob-ratification`. Citation:
`{kind: lines, path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [49, 49], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`.

When Tesseract records plan-stage glossary policy, Tesseract SHALL treat the
reversed glossary deferral as closed: tier nouns now live in
`src/memory/handbook/glossary.md` per plan deferral list item 2 instead of
remaining undefined.
Citation:
`{kind: lines, path: src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [47, 47], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`.

## Consequences

- Positive: Routine tasks gain a small **active-memory** entry point while
  durable specs and archival runs stay reachable.
- Positive: Context-budget reporting can compare tier footprints without
  deleting history.
- Positive: Physical migration stays gated behind manifest and rollback
  discipline consistent with ADR-0005.
- Negative: Operators must trim and promote **active-memory** so it does not
  mirror **archival-memory**.
- Negative: Executable budget warnings and glob ratification stay open until
  backlog items close.
- Neutral: This ADR records repository policy only; it does not implement a
  runtime MemoryRouter or provider-specific model selection.

## Status

This ADR is accepted on 2026-05-09 (UTC). The ratified Engineering Spec at
`{kind: lines, path: src/memory/features/active-memory-context-economy-pass-2/spec.md, range: [275, 286], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`
requires this decision record.
