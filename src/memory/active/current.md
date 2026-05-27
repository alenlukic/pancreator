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
| `ci-best-practices-batch` | [indexed] (`2026-05-26T18:23:19.000Z`) | `src/memory/features/ci-best-practices-batch/delivery-report.md` | `—` | `—` |
| `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants` | [indexed] (`2026-05-26T12:00:00.000Z`) | `src/memory/features/bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/delivery-report.md` | `—` | `—` |
| `tesseract-adopter-scan` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-adopter-scan/delivery-report.md` | `—` | `—` |
| `tesseract-checkpointer-fs` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-checkpointer-fs/delivery-report.md` | `—` | `—` |
| `tesseract-cli` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-cli/delivery-report.md` | `—` | `—` |
| `tesseract-contract` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-contract/delivery-report.md` | `—` | `—` |
| `tesseract-contract-runner-llm-judge` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-contract-runner-llm-judge/delivery-report.md` | `—` | `—` |
| `tesseract-contract-runner-rego` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-contract-runner-rego/delivery-report.md` | `—` | `—` |
| `tesseract-contract-style` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-contract-style/delivery-report.md` | `—` | `—` |
| `tesseract-core` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-core/delivery-report.md` | `—` | `—` |
| `tesseract-env-isolation` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-env-isolation/delivery-report.md` | `—` | `—` |
| `tesseract-inbox` | [indexed] (`2026-05-26T09:34:14node --test tests/*.test.mjs
node src/internal/tools/check-phase-0a-scaffold.mjs
node src/internal/tools/context-budget-report.mjs
bash -n .cursor/hooks/enforce-policy-compliance.sh
.000Z`) | `src/memory/features/tesseract-inbox/delivery-report.md` | `—` | `—` |
| `tesseract-intervention` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-intervention/delivery-report.md` | `—` | `—` |
| `tesseract-mcp-server` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-mcp-server/delivery-report.md` | `—` | `—` |
| `tesseract-memory` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-memory/delivery-report.md` | `—` | `—` |
| `tesseract-notifier` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-notifier/delivery-report.md` | `—` | `—` |
| `tesseract-persona` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-persona/delivery-report.md` | `—` | `—` |
| `tesseract-pipeline` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-pipeline/delivery-report.md` | `—` | `—` |
| `tesseract-policy` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-policy/delivery-report.md` | `—` | `—` |
| `tesseract-run-logger` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-run-logger/delivery-report.md` | `—` | `—` |
| `tesseract-runner-cursor` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-runner-cursor/delivery-report.md` | `—` | `—` |
| `tesseract-worktree` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/tesseract-worktree/delivery-report.md` | `—` | `—` |
| `cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref` | [indexed] (`2026-05-26T00:00:00.000Z`) | `src/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/delivery-report.md` | `—` | `—` |
| `json-formatting` | [indexed] (`2026-05-24T00:00:00.000Z`) | `src/memory/features/json-formatting/delivery-report.md` | `—` | `—` |
| `compliance-tests` | [indexed] (`—`) | `src/memory/features/compliance-tests/delivery-report.md` | `—` | `—` |
| `inbox-convention-migration` | [indexed] (`—`) | `src/memory/features/inbox-convention-migration/delivery-report.md` | `—` | `—` |
| `m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo` | [indexed] (`—`) | `—` | `—` | `—` |

## Risks and blockers

- Phoenix OTLP import remains open on the `tesseract-engineer` backlog.
- Pass-2 extends pass-1 deferred scope; both close as a single operator session.

## Operator notes

<!-- tess:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-05-27T17:36:33.622Z`

<!-- /tess:active-memory:operator-notes:auto -->







- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `pnpm -w exec tess refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `pnpm -w exec tess close-artifacts`; set Active Feature manually when work starts — `pnpm -w exec tess close-artifacts` clears it to `(none)` when the archived inbox source matched.
