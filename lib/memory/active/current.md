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

- `(none)`

## Most recent shipped Features

| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |
|---|---|---|---|---|
| `cockpit-v2-maintenance-toolkit-compliance-tests` | [indexed] (`2026-06-08T17:02:53.000Z`) | `lib/memory/features/cockpit-v2-maintenance-toolkit-compliance-tests/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/27260_1625_cockpit-v2-maintenance-toolkit-compliance-tests/54350_0854_cockpit-v2-mainte…` |
| `cockpit-v2-local-scheduler-tick-and-run-history` | [indexed] (`2026-06-08T16:24:18.000Z`) | `lib/memory/features/cockpit-v2-local-scheduler-tick-and-run-history/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/31248_1519_cockpit-v2-local-scheduler-tick-and-run-history/54351_0854_cockpit-v2-automa…` |
| `cockpit-v2-automation-registry-and-management-ui` | [indexed] (`2026-06-08T16:12:00.000Z`) | `lib/memory/features/cockpit-v2-automation-registry-and-management-ui/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/47315_1051_cockpit-v2-automation-registry-and-management-ui/54351_0854_cockpit-v2-autom…` |
| `cockpit-v2-active-memory-inbox-triage-multi-run-view` | [indexed] (`2026-06-08T11:05:00.000Z`) | `lib/memory/features/cockpit-v2-active-memory-inbox-triage-multi-run-view/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/49726_1011_cockpit-v2-active-memory-inbox-triage-multi-run-view/54352_0854_cockpit-v2-p…` |
| `cockpit-v2-live-run-refresh-and-stage-artifact-drawer` | [indexed] (`2026-06-08T10:30:00.000Z`) | `lib/memory/features/cockpit-v2-live-run-refresh-and-stage-artifact-drawer/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/51057_0949_cockpit-v2-live-run-refresh-and-stage-artifact-drawer/54352_0854_cockpit-v2-…` |
| `cockpit-v2-pipeline-command-center-and-human-gate-queue` | [indexed] (`2026-06-08T10:30:00.000Z`) | `lib/memory/features/cockpit-v2-pipeline-command-center-and-human-gate-queue/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/52646_0922_cockpit-v2-pipeline-command-center-and-human-gate-queue/54353_0854_cockpit-v…` |
| `cockpit-v2-ux-spec-and-information-architecture` | [indexed] (`2026-06-08T09:45:00.000Z`) | `lib/memory/features/cockpit-v2-ux-spec-and-information-architecture/delivery-report.md` | `—` | `.pan/archive/inbox/in/172967_06-08-26/53639_0906_cockpit-v2-ux-spec-and-information-architecture/54353_0854_cockpit-v2-ux-spe…` |
| `batch-feature-delivery-runs-sequential-parallel` | [indexed] (`2026-06-05T05:15:00.000Z`) | `lib/memory/features/batch-feature-delivery-runs-sequential-parallel/delivery-report.md` | `—` | `.pan/archive/inbox/in/172970_06-05-26/69803_0436_batch-feature-delivery-runs-sequential-parallel/71489_0408_batch-feature-del…` |
| `build-mode-inbox-scaffolding` | [indexed] (`2026-06-05T04:05:00.000Z`) | `lib/memory/features/build-mode-inbox-scaffolding/delivery-report.md` | `—` | `.pan/archive/inbox/in/172970_06-05-26/73472_0335_build-mode-inbox-scaffolding/19570_1833_build-mode-inbox-scaffolding.md` |
| `sampled-token-audit` | [indexed] (`2026-06-04T09:42:10.000Z`) | `lib/memory/features/sampled-token-audit/delivery-report.md` | `—` | `.pan/archive/inbox/in/172971_06-04-26/53589_0906_sampled-token-audit/53607_0906_sampled-token-audit.md` |

## Risks and blockers

- **M1 ratified:** Bootstrap Phase 5 / M1 closure ratified 2026-05-31 (human GO
  recorded in
  `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/m1-closure-ratification-request.md`).
  M2 planning opens via inbox.
- xeremia-sandbox US-9 PoC and AC8 SDK smoke passed 2026-05-31 (no operator workarounds).
- Phoenix/Langfuse external trace verification deferred to M2 (`bootstrap-external-observability-phoenix-langfuse` backlog item).

## Operator notes

<!-- pan:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-06-08T17:26:11.295Z`

<!-- /pan:active-memory:operator-notes:auto -->























- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `pnpm -w exec pan refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `pnpm -w exec pan close-artifacts`; set Active Feature manually when work starts — `pnpm -w exec pan close-artifacts` clears it to `(none)` when the archived inbox source matched.
