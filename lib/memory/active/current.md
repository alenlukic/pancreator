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
    contentHash: 7d917d4
    note: "Most recent shipped Feature delivery report."
  - kind: lines
    path: lib/memory/handbook/inbox-lifecycle.md
    range: [60, 130]
    contentHash: 8542ae2
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
| `surface-opt-p4-tighten-cursor-agents-retrieval-contracts` | [indexed] (`2026-06-01T06:20:00.000Z`) | `lib/memory/features/surface-opt-p4-tighten-cursor-agents-retrieval-contracts/delivery-report.md` | `lib/inbox/out/172974_06-01-26/64308_0608_surface-opt-p4-tighten-cursor-agents-retrieval-contracts-report-approval.md` | `archive/inbox/in/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/75420_0303_surface-…` |
| `surface-opt-p3-cap-current-md-shipped-features-ledger` | [indexed] (`2026-06-01T05:42:00.000Z`) | `lib/memory/features/surface-opt-p3-cap-current-md-shipped-features-ledger/delivery-report.md` | `lib/inbox/out/172974_06-01-26/65992_0540_surface-opt-p3-cap-current-md-shipped-features-ledger-report-approval.md` | `archive/inbox/in/172974_06-01-26/67753_0510_surface-opt-p3-cap-current-md-shipped-features-ledger/75420_0303_surface-opt…` |
| `surface-opt-p2-fix-mcp-work-run-log-path` | [indexed] (`2026-06-01T05:15:00.000Z`) | `lib/memory/features/surface-opt-p2-fix-mcp-work-run-log-path/delivery-report.md` | `lib/inbox/out/172974_06-01-26/68098_0505_surface-opt-p2-fix-mcp-work-run-log-path-report-approval.md` | `archive/inbox/in/172974_06-01-26/69714_0438_surface-opt-p2-fix-mcp-work-run-log-path/75420_0303_surface-opt-p2-mcp-run-l…` |
| `surface-opt-p1-fix-mcp-memory-path` | [indexed] (`2026-06-01T04:35:00.000Z`) | `lib/memory/features/surface-opt-p1-fix-mcp-memory-path/delivery-report.md` | `lib/inbox/out/172974_06-01-26/70365_0427_surface-opt-p1-fix-mcp-memory-path-report-approval.md` | `archive/inbox/in/172974_06-01-26/71390_0410_surface-opt-p1-fix-mcp-memory-path/75420_0303_surface-opt-p1-mcp-memory-path…` |
| `bootstrap-phase-5-m1-exit-close-docs-bootstrap` | [indexed] (`2026-05-31T12:00:00.000Z`) | `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/delivery-report.md` | `—` | `archive/inbox/in/172976_05-30-26/27984_1613_bootstrap-phase-5-m1-exit-close-docs-bootstrap/60751_0707_bootstrap-phase-5-…` |
| `embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs` | [indexed] (`2026-05-31T04:30:00.000Z`) | `lib/memory/features/embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs/delivery-report.md` | `lib/inbox/out/172975_05-31-26/71230_0412_embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs-rep…` | `archive/inbox/in/172975_05-31-26/72723_0347_embedded-install-cursor-agent-sync-init-content-seeding-and-inbox-path-bugs/…` |
| `embedded-harness-install-project-root-pancreator-and-fresh-install-manifest` | [indexed] (`2026-05-30T21:05:00.000Z`) | `lib/memory/features/embedded-harness-install-project-root-pancreator-and-fresh-install-manifest/delivery-report.md` | `lib/inbox/out/172976_05-30-26/11654_2045_embedded-harness-install-project-root-pancreator-and-fresh-install-manifest-rep…` | `archive/inbox/in/172976_05-30-26/13143_2020_embedded-harness-install-project-root-pancreator-and-fresh-install-manifest/…` |
| `repository-layout-restructure-and-archive-migration` | [indexed] (`2026-05-30T07:00:00.000Z`) | `lib/memory/features/repository-layout-restructure-and-archive-migration/delivery-report.md` | `lib/inbox/out/172976_05-30-26/62732_0634_repository-layout-restructure-and-archive-migration-report-approval.md` | `archive/inbox/in/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/65996_0540_repo-layout-r…` |
| `v0-ui-dashboard-subordinate-feature-pipeline-qa` | [indexed] (`2026-05-29T22:00:00.000Z`) | `lib/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/delivery-report.md` | `—` | `archive/inbox/in/172977_05-29-26/68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa/70345_0427_v0-ui-dashboard-s…` |
| `feature-delivery-harness-wire-cursorrunner-through-run-and-advance` | [indexed] (`2026-05-29T12:00:00.000Z`) | `lib/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/delivery-report.md` | `—` | `archive/inbox/in/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/72021_035…` |

## Risks and blockers

- **M1 ratified:** Bootstrap Phase 5 / M1 closure ratified 2026-05-31 (human GO
  recorded in
  `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/m1-closure-ratification-request.md`).
  M2 planning opens via inbox.
- xeremia-sandbox US-9 PoC and AC8 SDK smoke passed 2026-05-31 (no operator workarounds).
- Phoenix/Langfuse external trace verification deferred to M2 (`bootstrap-external-observability-phoenix-langfuse` backlog item).

## Operator notes

<!-- pan:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-06-01T06:55:16.929Z`

<!-- /pan:active-memory:operator-notes:auto -->




- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `pnpm -w exec pan refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `pnpm -w exec pan close-artifacts`; set Active Feature manually when work starts — `pnpm -w exec pan close-artifacts` clears it to `(none)` when the archived inbox source matched.
