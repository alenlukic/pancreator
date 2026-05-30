---
title: Compliance remediation — M1 substrate runtime batch broad sweep
task_id: 21840_1757_compliance-m1-substrate-runtime-batch-broad-sweep
date: 2026-05-27
auditor: compliance-auditor-standard
stability: experimental
---

# Compliance Remediation

## Files changed

| File | Change | Finding |
|---|---|---|
| `lib/memory/active/current.md` | Fixed `pancreator-inbox` row data corruption (embedded command output in timestamp cell) | M-01 |
| `lib/memory/active/current.md` | Corrected m1 batch row: added `indexed_at` timestamp and delivery-report path; reordered row to top | M-02 |
| `lib/memory/active/current.md` | Removed stale "Phoenix OTLP import remains open" risk row; replaced with M2 deferral note | M-03 |
| `lib/internal/packages/@pancreator/cli/lib/active-memory-refresh.ts` | `parseShippedAtMs`: added root-level `indexed_at` read before legacy `index.completed_at` path | M-02 |
| `lib/internal/packages/@pancreator/cli/lib/active-memory-refresh.ts` | `readDeliveryReportPath`: added `feature_artifacts[].kind === "delivery-report"` fallback | M-02 |
| `docs/PRD.summary.md` | Updated bootstrap phase status from `phase-4-in-progress` to `phase-4-ratified` | M-04 |

## Verification

- `pnpm --filter @pancreator/cli test`: 28/28 passed after `active-memory-refresh.ts` changes.
- `pnpm -w exec pan refresh-active-memory --dry-run`: exits 0 after all `current.md` and tooling fixes.
- Phoenix smoke test (`pnpm test:run-logger-conformance`): 3/3 passed.

## Unresolved findings checklist

- [ ] N-01 — Touch-set traceability drift: implementation files outside touch-set. Owner: `pancreator-engineer`. Trigger: next batch plan stage.
- [ ] N-02 — `startFeatureDelivery` pipeline compile graph discard. Owner: `pancreator-engineer`. Trigger: M2 pipeline execution work.
- [ ] WP-D M2 deferral — Langfuse / additional-backend verification. Owner: `pancreator-engineer`. Trigger: backlog item `bootstrap-external-observability-phoenix-langfuse`.

## Next owner routing

| Finding | Owner | Action |
|---|---|---|
| N-01 | `pancreator-engineer` | Declare a complete touch-set at the next batch plan stage |
| N-02 | `pancreator-engineer` | Trim `startFeatureDelivery` compile-discard pattern during M2 |
| WP-D M2 | `pancreator-engineer` | Activate `bootstrap-external-observability-phoenix-langfuse` backlog item when M2 starts |
