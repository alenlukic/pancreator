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
    path: src/memory/features/active-memory-context-economy-pass-2/delivery-report.md
    range: [1, 120]
    contentHash: TBD-on-commit
    note: "Most recent shipped Feature delivery report."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [60, 130]
    contentHash: TBD-on-commit
    note: "Inbox lifecycle drives the next-Feature pickup procedure."
related:
  - /src/memory/handbook/context-economy.md
  - /src/memory/handbook/memory-tiers.md
  - /src/memory/active/README.md
  - /src/memory/active/runs.md
  - /src/memory/active/handoffs.md
---

# Current focus

When an agent needs active-memory orientation, the agent SHALL read this file
before scanning broader `src/memory/` trees unless `simple task mode` blocks that
read per `src/memory/handbook/context-economy.md`.

## Active Feature

- *(none)*. Pick up the next canonical queue item from `src/inbox/in/`.

## Most recent shipped Features

| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |
|---|---|---|---|---|
| `us-1-dogfood-phase-4-exit` | `2026-05-19T00:00:00Z` (ratification close-out) | `src/memory/features/us-1-dogfood-phase-4-exit/delivery-report.md` | `src/inbox/out/2026-05-19T02-26-26Z-us-1-dogfood-phase-4-exit-delivery-report.md` | `src/inbox/archive/in/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/us-1-dogfood-phase-4-exit.md` |
| `bootstrap-state-fast-forward` | `2026-05-10T14:30:00Z` (operator close-out) | — | — | — |
| `active-memory-context-economy-pass-2` | `2026-05-10T03:02:00Z` | `src/memory/features/active-memory-context-economy-pass-2/delivery-report.md` | `src/inbox/out/172996_05-10-26/25121_1701_active-memory-context-economy-pass-2_delivery-report/81300_0125_2026-05-10-active-memory-context-economy-pass-2-delivery-report.md` | `src/inbox/archive/in/172996_05-10-26/81349_0124_active-memory-context-economy-pass-2_token-economy-enhanced/75480_0302_token-economy-enhanced.md` |
| `cursor-token-economy` | `2026-05-10T03:16:00Z` (operator close-out; delivery report staged 2026-05-09) | `src/memory/features/cursor-token-economy/delivery-report.md` | `src/inbox/out/172996_05-10-26/25121_1701_cursor-token-economy-delivery-report/50909_1005_2026-05-09-cursor-token-economy-delivery-report.md` | `src/inbox/archive/in/172997_05-09-26/11951_2040_cursor-token-economy_token-economy/11951_2040_token_economy.md` |

Pass-2 extends pass-1 deferred scope; both close as a single operator session.

## Risks and blockers

- Phoenix OTLP import remains open on the `tesseract-engineer` backlog.

## Operator notes

- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Active-memory rotation has no automated owner yet; operators MUST update this
  file when a new Feature enters intake or when the active Feature ships.
