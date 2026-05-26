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
    contentHash: 7d917d4
    note: "Most recent shipped Feature delivery report."
  - kind: lines
    path: src/memory/handbook/inbox-lifecycle.md
    range: [60, 130]
    contentHash: 8542ae2
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

- `(none)`


## Most recent shipped Features

| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |
|---|---|---|---|---|
| `cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref` | [indexed] (`2026-05-26T00:00:00.000Z`) | `src/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/delivery-report.md` | `—` | `—` |
| `json-formatting` | [indexed] (`2026-05-24T00:00:00.000Z`) | `src/memory/features/json-formatting/delivery-report.md` | `—` | `—` |
| `compliance-tests` | [indexed] (`—`) | `src/memory/features/compliance-tests/delivery-report.md` | `—` | `—` |
| `inbox-convention-migration` | [indexed] (`—`) | `src/memory/features/inbox-convention-migration/delivery-report.md` | `—` | `—` |

## Risks and blockers

- Phoenix OTLP import remains open on the `tesseract-engineer` backlog.
- Pass-2 extends pass-1 deferred scope; both close as a single operator session.

## Operator notes

<!-- tess:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-05-26T00:56:00.000Z`

<!-- /tess:active-memory:operator-notes:auto -->




- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `tess refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `tess close-artifacts`; set Active Feature manually when work starts — `tess close-artifacts` clears it to `(none)` when the archived inbox source matched.
