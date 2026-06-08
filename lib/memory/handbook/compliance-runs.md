---
title: Compliance Run Triggers
slug: compliance-runs
stability: experimental
bootstrap-only: false
phase: bootstrap
owners: [compliance-auditor, supervisor]
purpose: |
  When agents and operators SHALL run compliance descriptors under
  `tests/compliance/` and how first-slice manual execution differs from
  deferred scheduler automation.
references:
  - kind: lines
    path: AGENTS.md
    range: [203, 208]
    contentHash: b953d77
    note: "AGENTS §6.2 binds agents to compliance-run triggers after structure changes."
  - kind: lines
    path: lib/memory/features/compliance-tests/manual-runbook.md
    range: [1, 52]
    contentHash: a207354
    note: "Manual runbook defines operator-on-demand and structure-change modes."
related:
  - /AGENTS.md
  - /lib/memory/features/compliance-tests/manual-runbook.md
  - /tests/compliance/schemas/latest.yaml
---

# Compliance Run Triggers

## When to run

During automation-deferred phases, agents SHALL support manual invocation via
`operator-on-demand` and SHALL run descriptors under `tests/compliance/` against
`tests/compliance/schemas/latest.yaml`.

Agents SHALL trigger a compliance run after create, modify, or delete changes
that touch personas, skills, pipeline definitions, documented operational
primitives, testing infrastructure, operator interfaces, or milestone
ratification artifacts.

Scheduled cadence stays backlog-tracked until runtime scheduler wiring lands;
agents SHALL NOT assume automatic cadence execution in the first slice.

## Invocation modes

| Mode | When | Action |
|---|---|---|
| `structure-change` | Immediately after a qualifying structure change lands | Run `tests/compliance/*.yaml` manually |
| `operator-on-demand` | Operator or agent requests an ad hoc run | Run all descriptors in `tests/compliance/` |
| `scheduled-cadence` | Deferred | Maintain backlog linkage; do not assume automation |

See `lib/memory/features/compliance-tests/manual-runbook.md` for the full
structure-change matrix and manual execution protocol.
