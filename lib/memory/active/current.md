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
| `repository-layout-restructure-and-archive-migration` | [indexed] (`2026-05-30T07:00:00.000Z`) | `lib/memory/features/repository-layout-restructure-and-archive-migration/delivery-report.md` | `lib/inbox/out/172976_05-30-26/62732_0634_repository-layout-restructure-and-archive-migration-report-approval.md` | `archive/inbox/in/172976_05-30-26/65447_0549_repository-layout-restructure-and-archive-migration/65996_0540_repo-layout-r…` |
| `v0-ui-dashboard-subordinate-feature-pipeline-qa` | [indexed] (`2026-05-29T22:00:00.000Z`) | `lib/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/delivery-report.md` | `—` | `archive/inbox/in/172977_05-29-26/68034_0506_v0-ui-dashboard-subordinate-feature-pipeline-qa/70345_0427_v0-ui-dashboard-s…` |
| `feature-delivery-harness-wire-cursorrunner-through-run-and-advance` | [indexed] (`2026-05-29T12:00:00.000Z`) | `lib/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/delivery-report.md` | `—` | `archive/inbox/in/172978_05-28-26/24456_1712_feature-delivery-harness-wire-cursorrunner-through-run-and-advance/72021_035…` |
| `bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout` | [indexed] (`2026-05-28T01:00:00.000Z`) | `lib/memory/features/bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/delivery-report.md` | `—` | `archive/inbox/in/172979_05-27-26/16224_1929_bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/16605_1923_boo…` |
| `m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo` | [indexed] (`2026-05-27T17:35:30.000Z`) | `lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/delivery-report.md` | `—` | `archive/inbox/in/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-con…` |
| `ci-best-practices-batch` | [indexed] (`2026-05-26T18:23:19.000Z`) | `lib/memory/features/ci-best-practices-batch/delivery-report.md` | `—` | `archive/inbox/in/172980_05-26-26/24959_1704_ci-best-practices-batch/71701_0613_ci-best-practices-batch.md` |
| `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants` | [indexed] (`2026-05-26T12:00:00.000Z`) | `lib/memory/features/bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/delivery-report.md` | `—` | `archive/inbox/in/172980_05-26-26/54615_0849_bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants…` |
| `pancreator-adopter-scan` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-adopter-scan/delivery-report.md` | `—` | `—` |
| `pancreator-checkpointer-fs` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-checkpointer-fs/delivery-report.md` | `—` | `—` |
| `pancreator-cli` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-cli/delivery-report.md` | `—` | `—` |
| `pancreator-contract` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-contract/delivery-report.md` | `—` | `—` |
| `pancreator-contract-runner-llm-judge` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-contract-runner-llm-judge/delivery-report.md` | `—` | `—` |
| `pancreator-contract-runner-rego` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-contract-runner-rego/delivery-report.md` | `—` | `—` |
| `pancreator-contract-style` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-contract-style/delivery-report.md` | `—` | `—` |
| `pancreator-core` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-core/delivery-report.md` | `—` | `—` |
| `pancreator-env-isolation` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-env-isolation/delivery-report.md` | `—` | `—` |
| `pancreator-inbox` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-inbox/delivery-report.md` | `—` | `—` |
| `pancreator-intervention` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-intervention/delivery-report.md` | `—` | `—` |
| `pancreator-mcp-server` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-mcp-server/delivery-report.md` | `—` | `—` |
| `pancreator-memory` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-memory/delivery-report.md` | `—` | `—` |
| `pancreator-notifier` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-notifier/delivery-report.md` | `—` | `—` |
| `pancreator-persona` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-persona/delivery-report.md` | `—` | `—` |
| `pancreator-pipeline` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-pipeline/delivery-report.md` | `—` | `—` |
| `pancreator-policy` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-policy/delivery-report.md` | `—` | `—` |
| `pancreator-run-logger` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-run-logger/delivery-report.md` | `—` | `—` |
| `pancreator-runner-cursor` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-runner-cursor/delivery-report.md` | `—` | `—` |
| `pancreator-worktree` | [indexed] (`2026-05-26T09:34:14.000Z`) | `lib/memory/features/pancreator-worktree/delivery-report.md` | `—` | `—` |
| `cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref` | [indexed] (`2026-05-26T00:00:00.000Z`) | `lib/memory/features/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/delivery-report.md` | `—` | `archive/inbox/in/172981_05-25-26/22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory…` |
| `json-formatting` | [indexed] (`2026-05-24T00:00:00.000Z`) | `lib/memory/features/json-formatting/delivery-report.md` | `—` | `—` |
| `compliance-tests` | [indexed] (`—`) | `lib/memory/features/compliance-tests/delivery-report.md` | `—` | `archive/inbox/in/172991_05-15-26/68576_0457_compliance-tests.md` |
| `inbox-convention-migration` | [indexed] (`—`) | `lib/memory/features/inbox-convention-migration/delivery-report.md` | `—` | `—` |

## Risks and blockers

- Pass-2 extends pass-1 deferred scope; both close as a single operator session.
- Additional observability backend verification (Langfuse) deferred to M2 under backlog item `bootstrap-external-observability-phoenix-langfuse`; Phoenix Option A smoke tests pass as of `2026-05-27`.

## Operator notes

<!-- pan:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-05-30T18:44:33.919Z`

<!-- /pan:active-memory:operator-notes:auto -->















- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `pnpm -w exec pan refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `pnpm -w exec pan close-artifacts`; set Active Feature manually when work starts — `pnpm -w exec pan close-artifacts` clears it to `(none)` when the archived inbox source matched.
