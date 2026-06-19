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
  - '{"kind":"lines","path":"lib/memory/features/memory-context/active-memory-context-economy-pass-2/index.json","range":[1,120],"contentHash":"d18eff8","note":"Most recent shipped Feature delivery report."}'
  - '{"kind":"lines","path":"lib/memory/handbook/inbox-lifecycle.md","range":[60,130],"contentHash":"29f20be","note":"Inbox lifecycle drives the next-Feature pickup procedure."}'
related:
  - /lib/memory/handbook/context-economy.md
  - /lib/memory/handbook/memory-tiers.md
  - /lib/memory/active/README.md
  - /lib/memory/active/runs.md
  - /lib/memory/active/handoffs.md
...

# Current focus

When an agent needs active-memory orientation, the agent SHALL read this file
before scanning broader `lib/memory/` trees unless
`lib/memory/handbook/simple-task-mode.md` blocks that read.

## Active Feature

- `(none)`

## Most recent shipped Features

| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |
|---|---|---|---|---|
| `command-center-home-ux-remediation-feature-delivery-directive` | [indexed] (`2026-06-18T18:30:00.000Z`) | `.pan/work/172957_06-18-26/70229_0429_command-center-home-ux-remediation-feature-delivery-directive/delivery-report.md` | `—` | `.pan/archive/inbox/in/172957_06-18-26/72063_0358_command-center-home-ux-remediation-fd.md` |
| `command-center-post-ship-remediation` | [indexed] (`2026-06-16T21:34:33.667Z`) | `.pan/archive/work/172959_06-16-26/61720_0651_command-center-post-ship-remediation/delivery-report.md` | `—` | `.pan/archive/inbox/in/172959_06-16-26/62115_0644_command-center-post-ship-remediation.md` |
| `batch-feature-delivery-runs-sequential-parallel` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172970_06-05-26/71489_0408_batch-feature-delivery-sequential-parallel.md` |
| `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172980_05-26-26/71700_0612_bootstrap-cruft-cleanup-batch.md` |
| `bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172979_05-27-26/16605_1923_bootstrap-de-hacking-pass.md` |
| `bootstrap-phase-5-m1-exit-close-docs-bootstrap` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172976_05-30-26/60751_0707_bootstrap-phase-5-m1-exit.md` |
| `build-mode-inbox-scaffolding` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172970_06-05-26/19570_1833_build-mode-inbox-scaffolding.md` |
| `ci-best-practices-batch` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172980_05-26-26/71701_0613_ci-best-practices-batch.md` |
| `cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md` |
| `command-center-active-memory-craft-enforcement` | [indexed] (`—`) | `—` | `—` | `.pan/archive/inbox/in/172966_06-09-26/82800_0059_cockpit-v2-active-memory-craft-enforcement.md` |

## Risks and blockers

- **M1 ratified:** Bootstrap Phase 5 / M1 closure ratified 2026-05-31 (human GO
  recorded in
  `lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/m1-closure-ratification-request.md`).
  M2 planning opens via inbox.
- xeremia-sandbox US-9 PoC and AC8 SDK smoke passed 2026-05-31 (no operator workarounds).
- Phoenix/Langfuse external trace verification deferred to M2 (`bootstrap-external-observability-phoenix-langfuse` backlog item).

## Operator notes

<!-- pan:active-memory:operator-notes:auto -->

- Active-memory refreshed (UTC): `2026-06-18T07:44:58.596Z`

<!-- /pan:active-memory:operator-notes:auto -->





































- Maintainers SHALL refresh `contentHash` fields when cited files change.
- During Phase 4 dogfood, planning stages SHOULD emit a compact handoff card and
  delegate execution to the next persona instead of continuing implementation in
  the same parent context.
- Run `pnpm -w exec pan refresh-active-memory [--dry-run]` before committing when shipped-feature rows or the managed refresh stamp drift from `status: indexed` artifacts outside `pnpm -w exec pan close-artifacts`; set Active Feature manually when work starts — `pnpm -w exec pan close-artifacts` clears it to `(none)` when the archived inbox source matched.
