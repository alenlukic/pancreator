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
    path: memory/features/active-memory-context-economy-pass-2/delivery-report.md
    range: [1, 120]
    contentHash: TBD-on-commit
    note: "Most recent shipped Feature delivery report."
  - kind: lines
    path: memory/handbook/inbox-lifecycle.md
    range: [60, 130]
    contentHash: TBD-on-commit
    note: "Inbox lifecycle drives the next-Feature pickup procedure."
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

- None. The repository is between Features.
- Operators SHALL pick the next Feature from `inbox/in/` per
  `memory/handbook/inbox-lifecycle.md` §1 and SHALL update this section before
  the new Feature enters the `intake` stage.

## Most recent shipped Features

| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |
|---|---|---|---|---|
| `active-memory-context-economy-pass-2` | `2026-05-10T03:02:00Z` | `memory/features/active-memory-context-economy-pass-2/delivery-report.md` | `inbox/out/81300_0125_2026-05-10-active-memory-context-economy-pass-2-delivery-report.md` | `inbox/archive/in/75480_0302_token-economy-enhanced.md` |
| `cursor-token-economy` | `2026-05-10T03:16:00Z` (operator close-out; delivery report staged 2026-05-09) | `memory/features/cursor-token-economy/delivery-report.md` | `inbox/out/50909_1005_2026-05-09-cursor-token-economy-delivery-report.md` | `inbox/archive/in/11951_2040_token_economy.md` |

Pass-2 extends pass-1 deferred scope; both close as a single operator session.

## Risks and blockers

- None recorded.

## Operator notes

- Maintainers SHALL refresh `contentHash` fields when cited files change.
- Active-memory rotation has no automated owner yet; operators MUST update this
  file when a new Feature enters intake or when the active Feature ships.
