---
title: Active memory run pointers
slug: active-memory-runs
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [tech-lead, supervisor]
purpose: |
  Pointer-only table for active and recent pipeline runs without embedding run
  artifacts inside active memory.
references:
  - kind: lines
    path: memory/features/active-memory-context-economy-pass-2/spec.md
    range: [237, 246]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: "Spec requires runs.md pointers without embedded artifacts."
related:
  - /memory/handbook/run-log-schema.md
  - /memory/active/current.md
---

# Active and recent runs

When an operator tracks runs, the operator SHALL store paths only and SHALL
keep logs under **archival-memory** prefixes such as `work/<task-id>/`.

## Active runs

| Run identifier | Pointer | Notes |
|---|---|---|
| `173009_05-09-26` plan task | `work/173009_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/` | Wave 1 parallel implementation slices |

## Recent runs

- None archived here yet.
