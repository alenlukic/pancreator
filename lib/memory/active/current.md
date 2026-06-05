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

- `sampled-token-audit` — pipeline `complete` (`53589_0906_sampled-token-audit`); awaiting operator commit and `close-artifacts`

## Most recent shipped Features

| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |
|---|---|---|---|---|
| `sampled-token-audit` | [indexed] (`2026-06-04T09:42:10.000Z`) | `lib/memory/features/sampled-token-audit/delivery-report.md` | `—` | `archive/inbox/in/172971_06-04-26/53589_0906_sampled-token-audit/53607_0906_sampled-token-audit.md` |
| `token-economy-calibration-hardening` | [indexed] (`2026-06-04T07:42:09.000Z`) | `lib/memory/features/token-economy-calibration-hardening/delivery-report.md` | `—` | `archive/inbox/in/172971_06-04-26/60274_0715_token-economy-calibration-hardening/74107_0324_token-economy-calibration-har…` |
| `token-economy-prototype` | [indexed] (`2026-06-04T03:30:00.000Z`) | `lib/memory/features/token-economy-prototype/delivery-report.md` | `—` | `archive/inbox/in/172972_06-03-26/18834_1846_token-economy-prototype/18847_1845_token-economy-prototype.md` |
| `context-usage-test-harness` | [indexed] (`2026-06-02T20:30:00.000Z`) | `lib/memory/features/context-usage-test-harness/delivery-report.md` | `lib/inbox/out/172973_06-02-26/13760_2010_context-usage-test-harness-report-approval.md` | `archive/inbox/in/172973_06-02-26/15493_1941_context-usage-test-harness/15509_1941_context-usage-test.md` |
| `fd-pipeline-sdk-mode-retry-model-escalation-tiers` | [indexed] (`2026-06-02T18:10:16.000Z`) | `lib/memory/features/fd-pipeline-sdk-mode-retry-model-escalation-tiers/delivery-report.md` | `lib/inbox/out/172973_06-02-26/21184_1806_fd-pipeline-sdk-mode-retry-model-escalation-tiers-report-approval.md` | `archive/inbox/in/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/24815_1706_fd-pipeline-sdk…` |
| `surface-opt-p10-dashboard-safe-editing` | [indexed] (`2026-06-02T15:33:17.000Z`) | `lib/memory/features/surface-opt-p10-dashboard-safe-editing/delivery-report.md` | `lib/inbox/out/172973_06-02-26/55193_0840_surface-opt-p10-dashboard-safe-editing-report-approval.md` | `archive/inbox/in/172973_06-02-26/57500_0801_surface-opt-p10-dashboard-safe-editing/75420_0303_surface-opt-p10-dashboard-…` |
| `surface-opt-p9-dashboard-operator-cockpit` | [indexed] (`2026-06-02T06:20:00.000Z`) | `lib/memory/features/surface-opt-p9-dashboard-operator-cockpit/delivery-report.md` | `lib/inbox/out/172973_06-02-26/64121_0611_surface-opt-p9-dashboard-operator-cockpit-report-approval.md` | `archive/inbox/in/172973_06-02-26/65766_0543_surface-opt-p9-dashboard-operator-cockpit/75420_0303_surface-opt-p9-dashboar…` |
| `surface-opt-p4-tighten-cursor-agents-retrieval-contracts` | [indexed] (`2026-06-01T06:20:00.000Z`) | `lib/memory/features/surface-opt-p4-tighten-cursor-agents-retrieval-contracts/delivery-report.md` | `lib/inbox/out/172974_06-01-26/64308_0608_surface-opt-p4-tighten-cursor-agents-retrieval-contracts-report-approval.md` | `archive/inbox/in/172974_06-01-26/65645_0545_surface-opt-p4-tighten-cursor-agents-retrieval-contracts/75420_0303_surface-…` |
| `surface-opt-p3-cap-current-md-shipped-features-ledger` | [indexed] (`2026-06-01T05:42:00.000Z`) | `lib/memory/features/surface-opt-p3-cap-current-md-shipped-features-ledger/delivery-report.md` | `lib/inbox/out/172974_06-01-26/65992_0540_surface-opt-p3-cap-current-md-shipped-features-ledger-report-approval.md` | `archive/inbox/in/172974_06-01-26/67753_0510_surface-opt-p3-cap-current-md-shipped-features-ledger/75420_0303_surface-opt…` |
| `surface-opt-p2-fix-mcp-work-run-log-path` | [indexed] (`2026-06-01T05:15:00.000Z`) | `lib/memory/features/surface-opt-p2-fix-mcp-work-run-log-path/delivery-report.md` | `lib/inbox/out/172974_06-01-26/68098_0505_surface-opt-p2-fix-mcp-work-run-log-path-report-approval.md` | `archive/inbox/in/172974_06-01-26/69714_0438_surface-opt-p2-fix-mcp-work-run-log-path/75420_0303_surface-opt-p2-mcp-run-l…` |

## Risks and blockers

- **M1 ratified:** Bootstrap Phase 5 / M1 closure ratified 2026-05-31 (human GO
  recorded in
  `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/m1-closure-ratification-request.md`).
  M2 planning opens via inbox.
- xeremia-sandbox US-9 PoC and AC8 SDK smoke passed 2026-05-31 (no operator workarounds).
- Phoenix/Langfuse external trace verification deferred to M2 (`bootstrap-external-observability-phoenix-langfuse` backlog item).

## Operator notes

<!-- pan:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-06-04T18:07:29.334Z`

<!-- /pan:active-memory:operator-notes:auto -->














- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `pnpm -w exec pan refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `pnpm -w exec pan close-artifacts`; set Active Feature manually when work starts — `pnpm -w exec pan close-artifacts` clears it to `(none)` when the archived inbox source matched.
