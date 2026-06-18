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
  - '{"kind":"lines","path":"lib/memory/features/memory-context/active-memory-context-economy-pass-2/index.json","range":[237,246],"contentHash":"9b2ddcc","note":"Spec requires runs.md pointers without embedded artifacts."}'
related:
  - /lib/memory/handbook/run-log-schema.md
  - /lib/memory/active/current.md
...

# Active and recent runs

When an operator tracks runs, the operator SHALL store paths only and SHALL
keep active logs under **active-work** prefixes such as `.pan/work/<day>/<task-id>/` and completed logs under **archival-memory** prefixes such as `.pan/archive/work/<day>/<task-id>/`.

## Active runs

| Run identifier | Pointer | Feature | Status |
|---|---|---|---|
| *(none)* | *(none)* | *(none)* | *(none)* |

## Recent runs

| Run identifier | Pointer | Feature | Outcome |
|---|---|---|---|
| `172996_05-10-26/15300_2230_symlink-removal-agents-cursor` | `.pan/archive/work/172996_05-10-26/15300_2230_symlink-removal-agents-cursor/` | `symlink-removal-agents-cursor` | complete; archived by librarian |
| `172996_05-10-26/14989_1950_compliance-auditor-structural-audit` | `.pan/archive/work/172996_05-10-26/14989_1950_compliance-auditor-structural-audit/` | `compliance-auditor-structural-audit` | complete; archived by librarian |
| `172996_05-10-26/68321_1315_bootstrap-state-fast-forward` | *(no retained workspace)* | `bootstrap-state-fast-forward` | complete; operator close-out |
| `172997_05-09-26/10920_2058_intake` | `.pan/archive/work/172997_05-09-26/10920_2058_intake-active-memory-context-economy-pass-2/` | `active-memory-context-economy-pass-2` | intake closed, ratified |
| `172997_05-09-26/3900_2255_plan` | `.pan/archive/work/172997_05-09-26/3900_2255_plan-active-memory-context-economy-pass-2/` | `active-memory-context-economy-pass-2` | plan + implement (7 slices, 3 waves) + review (approve) + report drafted |
