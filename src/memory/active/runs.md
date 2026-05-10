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
    path: src/memory/features/active-memory-context-economy-pass-2/spec.md
    range: [237, 246]
    contentHash: e6c4fcd2ef59f5cc9dfb5d528876b7e1e25dae7ccc9da22805d6343737ed0d9d
    note: "Spec requires runs.md pointers without embedded artifacts."
related:
  - /src/memory/handbook/run-log-schema.md
  - /src/memory/active/current.md
---

# Active and recent runs

When an operator tracks runs, the operator SHALL store paths only and SHALL
keep active logs under **active-work** prefixes such as `src/work/<day>/<task-id>/` and completed logs under **archival-memory** prefixes such as `src/internal/work_archive/<day>/<task-id>/`.

## Active runs

- None.

## Recent runs

| Run identifier | Pointer | Feature | Outcome |
|---|---|---|---|
| `172997_05-09-26/10920_2058_intake` | `src/internal/work_archive/172997_05-09-26/10920_2058_intake-active-memory-context-economy-pass-2/` | `active-memory-context-economy-pass-2` | intake closed, ratified |
| `172997_05-09-26/3900_2255_plan` | `src/internal/work_archive/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/` | `active-memory-context-economy-pass-2` | plan + implement (7 slices, 3 waves) + review (approve) + report drafted |
