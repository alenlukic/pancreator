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

- `inbox-directory-hierarchy-migration` — migrate `src/inbox/` naming and layout
  to the same day- and time-oriented conventions as `src/work/` (alias:
  `inbox-convention-migration` from directive filename). **Gate:** engineering
  spec is at `human_approval` after round-1 clarify answers were folded inline
  (thread `status: ratified`).
- Intake sources: `src/inbox/in/inbox_convention_migration.md`;
  canonical spec `src/memory/features/inbox-directory-hierarchy-migration/spec.md`;
  round-1 clarify `src/inbox/threads/inbox-directory-hierarchy-migration/11700_2045_round-01-clarify.md`.

## Most recent shipped Features

| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |
|---|---|---|---|---|
| `bootstrap-state-fast-forward` | `2026-05-10T14:30:00Z` (operator close-out) | — | — | — |
| `active-memory-context-economy-pass-2` | `2026-05-10T03:02:00Z` | `src/memory/features/active-memory-context-economy-pass-2/delivery-report.md` | `src/inbox/out/81300_0125_2026-05-10-active-memory-context-economy-pass-2-delivery-report.md` | `src/inbox/archive/in/75480_0302_token-economy-enhanced.md` |
| `cursor-token-economy` | `2026-05-10T03:16:00Z` (operator close-out; delivery report staged 2026-05-09) | `src/memory/features/cursor-token-economy/delivery-report.md` | `src/inbox/out/50909_1005_2026-05-09-cursor-token-economy-delivery-report.md` | `src/inbox/archive/in/11951_2040_token_economy.md` |

Pass-2 extends pass-1 deferred scope; both close as a single operator session.

## Risks and blockers

- None recorded.

## Operator notes

- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Active-memory rotation has no automated owner yet; operators MUST update this
  file when a new Feature enters intake or when the active Feature ships.
