---
title: Active memory current state
slug: active-memory-current
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tech-lead, supervisor]
purpose: |
  Compact operator-facing pointers for current repository focus without
  embedding durable or archival artifacts.
references:
  - kind: lines
    path: memory/features/active-memory-context-economy-pass-2/spec.md
    range: [237, 244]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: "Spec requires current.md summaries with pointers only."
related:
  - /memory/handbook/context-economy.md
  - /memory/handbook/memory-tiers.md
  - /memory/active/README.md
  - /memory/active/runs.md
---

# Current focus

When an agent needs active-memory orientation, the agent SHALL read this file
before scanning broader `memory/` trees unless `simple task mode` blocks that
read per `memory/handbook/context-economy.md`.

## Active Feature

- Feature identifier: `active-memory-context-economy-pass-2`
- Engineering Spec:
  `{kind: lines, path: memory/features/active-memory-context-economy-pass-2/spec.md, range: [191, 210], contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d}`
- Plan workspace pointer:
  `{kind: lines, path: work/173009_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/plan.md, range: [30, 43], contentHash: 58bbab6b966ad3014a4369cf75c6a43235f18832f625902ff70ff1151f086f70}`

## Risks and blockers

- None recorded here yet.

## Operator notes

- Maintainers SHALL refresh `contentHash` fields when cited files change.
