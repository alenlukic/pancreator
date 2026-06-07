---
title: Ratify External Versus Internal Repository Surfaces
seq: "0008"
status: accepted
date: 2026-06-07
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: null
superseded-by: null
references:
  - kind: lines
    path: README.md
    range: [1, 10]
    contentHash: pending
    note: External landing page and delivery operating card appendix.
  - kind: lines
    path: AGENTS.md
    range: [1, 10]
    contentHash: pending
    note: Internal Pancreator self-development operating card.
  - kind: lines
    path: lib/memory/handbook/context-economy.md
    range: [45, 70]
    contentHash: pending
    note: Default retrieval discipline after surface split.
  - kind: lines
    path: lib/memory/handbook/embedded-install-manifest.yaml
    range: [1, 45]
    contentHash: pending
    note: Embedded allow/deny lists for operational versus product surfaces.
---

## Context

Pancreator serves two audiences in one repository: operators running
Pancreator-powered feature delivery on a project, and contributors planning and
building Pancreator itself. A single root `AGENTS.md` and indexed `docs/PRD*`
routes mixed both audiences into the same default Cursor context.

## Decision

The repository SHALL classify paths as **external surface** or **internal
surface**. These nouns are distinct from contract-template YAML keys named
`external:`.

### External surface

Paths used for Pancreator-powered agentic development on a target project:

- `README.md` (including the **Delivery operating card** appendix when
  `project_root` is `.`)
- `OPERATION.md`
- `lib/personas/`, `lib/pipelines/`, `lib/personas/skills/`
- `lib/memory/handbook/` delivery-operations pages (inbox, operator output,
  pancreator-config, run-log schema)
- `lib/memory/active/`, `lib/memory/adoption/`, non-bootstrap
  `lib/memory/features/`
- `lib/internal/packages/`, `lib/internal/tools/` (implementation extension)

When `project_root` is `.pancreator`, the delivery operating card SHALL live at
`.pancreator/AGENTS.md` and procedures at `.pancreator/OPERATION.md`. The host
repository `AGENTS.md` SHALL receive an additive Pancreator pointer block only.

### Internal surface

Paths used to plan and build Pancreator itself:

- Root `AGENTS.md` in the Pancreator product repository (daedaline self-host)
- `docs/**` (PRD, bootstrap, M1 route maps, and `docs/README.md` directory guide)
- `lib/memory/adr/`, `lib/memory/backlog/`, `lib/memory/research/`
- `lib/memory/features/bootstrap-phase-*`
- `archive/**`, `tests/**`, `client/` (monorepo operator cockpit)

Internal surfaces SHALL be excluded from default Cursor semantic indexing via
`.cursorindexingignore`. Agents MAY still open them with explicit paths when the
task builds or evolves Pancreator.

### Excluded from both default sweeps

- `lib/memory/checkpoints/`
- `work/**`, `lib/inbox/**`, generated JSON and manifests per ADR-0006

## Consequences

- Feature-delivery personas read the **delivery operating card** first, not
  internal `AGENTS.md`.
- Meta-personas (`pancreator-engineer`, `persona-designer`, `contract-writer`,
  `compliance-auditor`) read internal `AGENTS.md` and `docs/**` when the task
  evolves Pancreator.
- `pan init` seeds `.pancreator/AGENTS.md` and `.pancreator/OPERATION.md` for
  embedded adopt; greenfield installs seed delivery templates at harness root.
- Handbook, glossary, and context-economy pages SHALL document both surfaces and
  the resolver helper `resolveDeliveryOperatingCard`.
