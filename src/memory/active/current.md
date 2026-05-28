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
| `bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout` | [indexed] (`2026-05-28T01:00:00.000Z`) | `src/memory/features/bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/delivery-report.md` | `—` | `src/inbox/archive/in/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/16605_1923…` |
| `m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo` | [indexed] (`2026-05-27T17:35:30.000Z`) | `src/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/delivery-report.md` | `—` | `src/inbox/archive/in/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix…` |
| `ci-best-practices-batch` | [indexed] (`2026-05-26T18:23:19.000Z`) | `src/memory/features/ci-best-practices-batch/delivery-report.md` | `—` | `src/inbox/archive/in/172980_05-26-26/24959_1704_ci-best-practices-batch/71701_0613_ci-best-practices-batch.md` |
| `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants` | [indexed] (`2026-05-26T12:00:00.000Z`) | `src/memory/features/bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/delivery-report.md` | `—` | `src/inbox/archive/in/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-vari…` |
| `daedaline-adopter-scan` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-adopter-scan/delivery-report.md` | `—` | `—` |
| `daedaline-checkpointer-fs` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-checkpointer-fs/delivery-report.md` | `—` | `—` |
| `daedaline-cli` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-cli/delivery-report.md` | `—` | `—` |
| `daedaline-contract` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-contract/delivery-report.md` | `—` | `—` |
| `daedaline-contract-runner-llm-judge` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-contract-runner-llm-judge/delivery-report.md` | `—` | `—` |
| `daedaline-contract-runner-rego` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-contract-runner-rego/delivery-report.md` | `—` | `—` |
| `daedaline-contract-style` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-contract-style/delivery-report.md` | `—` | `—` |
| `daedaline-core` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-core/delivery-report.md` | `—` | `—` |
| `daedaline-env-isolation` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-env-isolation/delivery-report.md` | `—` | `—` |
| `daedaline-inbox` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-inbox/delivery-report.md` | `—` | `—` |
| `daedaline-intervention` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-intervention/delivery-report.md` | `—` | `—` |
| `daedaline-mcp-server` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-mcp-server/delivery-report.md` | `—` | `—` |
| `daedaline-memory` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-memory/delivery-report.md` | `—` | `—` |
| `daedaline-notifier` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-notifier/delivery-report.md` | `—` | `—` |
| `daedaline-persona` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-persona/delivery-report.md` | `—` | `—` |
| `daedaline-pipeline` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-pipeline/delivery-report.md` | `—` | `—` |
| `daedaline-policy` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-policy/delivery-report.md` | `—` | `—` |
| `daedaline-run-logger` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-run-logger/delivery-report.md` | `—` | `—` |
| `daedaline-runner-cursor` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-runner-cursor/delivery-report.md` | `—` | `—` |
| `daedaline-worktree` | [indexed] (`2026-05-26T09:34:14.000Z`) | `src/memory/features/daedaline-worktree/delivery-report.md` | `—` | `—` |
| `cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref` | [indexed] (`2026-05-26T00:00:00.000Z`) | `src/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/delivery-report.md` | `—` | `src/inbox/archive/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-me…` |
| `json-formatting` | [indexed] (`2026-05-24T00:00:00.000Z`) | `src/memory/features/json-formatting/delivery-report.md` | `—` | `—` |
| `compliance-tests` | [indexed] (`—`) | `src/memory/features/compliance-tests/delivery-report.md` | `—` | `src/inbox/archive/in/172991_05-15-26/68576_0457_compliance-tests.md` |
| `inbox-convention-migration` | [indexed] (`—`) | `src/memory/features/inbox-convention-migration/delivery-report.md` | `—` | `—` |

## Risks and blockers

- Pass-2 extends pass-1 deferred scope; both close as a single operator session.
- Additional observability backend verification (Langfuse) deferred to M2 under backlog item `bootstrap-external-observability-phoenix-langfuse`; Phoenix Option A smoke tests pass as of `2026-05-27`.

## Operator notes

<!-- ddl:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-05-28T00:45:27.739Z`

<!-- /ddl:active-memory:operator-notes:auto -->










- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `pnpm -w exec ddl refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `pnpm -w exec ddl close-artifacts`; set Active Feature manually when work starts — `pnpm -w exec ddl close-artifacts` clears it to `(none)` when the archived inbox source matched.
