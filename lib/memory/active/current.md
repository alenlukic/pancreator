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
    path: lib/memory/features/active-memory-context-economy-pass-2/delivery-report.md
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

- `lib/inbox/in/172966_06-09-26/81282_0125_cockpit-v2-active-memory-operator-craft-revalidation.md`

## Most recent shipped Features

| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |
|---|---|---|---|---|
| `cockpit-v2-active-memory-craft-enforcement` | [indexed] (`2026-06-09T01:40:00.000Z`) | `lib/memory/features/cockpit-v2-active-memory-craft-enforcement/delivery-report.md` | `—` | `.pan/archive/inbox/in/172966_06-09-26/82780_0100_cockpit-v2-active-memory-craft-enforcement/82800_0059_cockpit-v2-active…` |
| `cockpit-v2-active-memory-operator-readability` | [indexed] (`2026-06-09T01:00:00.000Z`) | `lib/memory/features/cockpit-v2-active-memory-operator-readability/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/919_2344_cockpit-v2-active-memory-operator-readability/945_2344_cockpit-v2-active-…` |
| `cockpit-v2-module-tab-accessibility` | [indexed] (`2026-06-08T23:05:00.000Z`) | `lib/memory/features/cockpit-v2-module-tab-accessibility/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/4426_2246_cockpit-v2-module-tab-accessibility/9443_2122_cockpit-v2-tab-a11y.md` |
| `cockpit-v2-craft-polish-pass` | [indexed] (`2026-06-08T21:48:00.000Z`) | `lib/memory/features/cockpit-v2-craft-polish-pass/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/8919_2131_cockpit-v2-craft-polish-pass/8947_2130_cockpit-v2-craft-polish-pass.md` |
| `cockpit-v2-maintenance-toolkit-compliance-tests` | [indexed] (`2026-06-08T17:02:53.000Z`) | `lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/54350_0854_cockpit-v2-m…` |
| `cockpit-v2-local-scheduler-tick-and-run-history` | [indexed] (`2026-06-08T16:24:18.000Z`) | `lib/memory/features/cockpit-v2-local-scheduler-tick-and-run-history/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/54351_0854_cockpit-v2-a…` |
| `cockpit-v2-automation-registry-and-management-ui` | [indexed] (`2026-06-08T16:12:00.000Z`) | `lib/memory/features/cockpit-v2-automation-registry-and-management-ui/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/47315_1051_cockpit-v2-automation-registry-and-management-ui/54351_0854_cockpit-v2-…` |
| `cockpit-v2-active-memory-inbox-triage-multi-run-view` | [indexed] (`2026-06-08T11:05:00.000Z`) | `lib/memory/features/cockpit-v2-active-memory-inbox-triage-multi-run-view/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/49726_1011_cockpit-v2-active-memory-inbox-triage-multi-run-view/54352_0854_cockpit…` |
| `cockpit-v2-live-run-refresh-and-stage-artifact-drawer` | [indexed] (`2026-06-08T10:30:00.000Z`) | `lib/memory/features/cockpit-v2-live-run-refresh-and-stage-artifact-drawer/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/54352_0854_cockpi…` |
| `cockpit-v2-pipeline-command-center-and-human-gate-queue` | [indexed] (`2026-06-08T10:30:00.000Z`) | `lib/memory/features/cockpit-v2-pipeline-command-center-and-human-gate-queue/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/52646_0922_cockpit-v2-pipeline-command-center-and-human-gate-queue/54353_0854_cock…` |

## Risks and blockers

- **M1 ratified:** Bootstrap Phase 5 / M1 closure ratified 2026-05-31 (human GO
  recorded in
  `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/m1-closure-ratification-request.md`).
  M2 planning opens via inbox.
- xeremia-sandbox US-9 PoC and AC8 SDK smoke passed 2026-05-31 (no operator workarounds).
- Phoenix/Langfuse external trace verification deferred to M2 (`bootstrap-external-observability-phoenix-langfuse` backlog item).

## Operator notes

<!-- pan:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-06-09T02:41:41.696Z`

<!-- /pan:active-memory:operator-notes:auto -->



























- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `pnpm -w exec pan refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `pnpm -w exec pan close-artifacts`; set Active Feature manually when work starts — `pnpm -w exec pan close-artifacts` clears it to `(none)` when the archived inbox source matched.
