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
    path: lib/memory/features/memory-context/active-memory-context-economy-pass-2/index.json
    range: [1, 120]
    contentHash: d18eff8
    note: "Most recent shipped Feature delivery report."
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [60, 130]
    contentHash: 29f20be
    note: "Inbox lifecycle drives the next-Feature pickup procedure."
related:
  - /lib/memory/handbook/context-economy.md
  - /lib/memory/handbook/memory-tiers.md
  - /lib/memory/active/README.md
  - /lib/memory/active/runs.md
  - /lib/memory/active/handoffs.md
---

# Current focus

When an agent needs active-memory orientation, the agent SHALL read this file
before scanning broader `lib/memory/` trees unless `simple task mode` blocks that
read per `lib/memory/handbook/context-economy.md`.

## Active Feature

- `(none)`

## Most recent shipped Features

| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |
|---|---|---|---|---|
| `batch-feature-delivery-runs-sequential-parallel` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md` |
| `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172980_05-26-26/71700_0612_bootstrap-cruft-cleanup-batch.md` |
| `bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md` |
| `bootstrap-phase-5-m1-exit-close-docs-bootstrap` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md` |
| `build-mode-inbox-scaffolding` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172970_06-05-26/19570_1833_build-mode-inbox-scaffolding.md` |
| `ci-best-practices-batch` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172980_05-26-26/71701_0613_ci-best-practices-batch.md` |
| `cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `command-center-active-memory-craft-enforcement` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172966_06-09-26/82800_0059_cockpit-v2-active-memory-craft-enforcement.md` |
| `command-center-active-memory-inbox-triage-multi-run-view` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172967_06-08-26/54352_0854_cockpit-v2-pipeline-orientation.md` |
| `command-center-active-memory-operator-craft-revalidation` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172966_06-09-26/81282_0125_cockpit-v2-active-memory-operator-craft-revalidation.md` |

## Risks and blockers

- **M1 ratified:** Bootstrap Phase 5 / M1 closure ratified 2026-05-31 (human GO
  recorded in
  `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/m1-closure-ratification-request.md`).
  M2 planning opens via inbox.
- xeremia-sandbox US-9 PoC and AC8 SDK smoke passed 2026-05-31 (no operator workarounds).
- Phoenix/Langfuse external trace verification deferred to M2 (`bootstrap-external-observability-phoenix-langfuse` backlog item).

## Operator notes

<!-- pan:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-06-16T21:34:38.535Z`

<!-- /pan:active-memory:operator-notes:auto -->



































- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `pnpm -w exec pan refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `pnpm -w exec pan close-artifacts`; set Active Feature manually when work starts — `pnpm -w exec pan close-artifacts` clears it to `(none)` when the archived inbox source matched.
