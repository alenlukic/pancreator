---
title: Compliance audit — M1 substrate runtime batch broad sweep
task_id: 21840_1757_compliance-m1-substrate-runtime-batch-broad-sweep
audited_feature: m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo
head_commit: dd736f5
branch: langfuse-phoenix
audit_date: 2026-05-27
auditor: compliance-auditor-standard
stability: experimental
---

# Compliance Audit — M1 Substrate Runtime Batch Broad Sweep

## 1. Scope contract

```yaml
audit_interaction:
  mode: non_interactive

trigger: post-delivery-broad-sweep
head_commit: dd736f5
branch: langfuse-phoenix
feature_id: m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo
closed_run_task_id: 966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo
archived_run_dir: archive/work/172980_05-26-26/966_2343_m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/
```

**Paths audited:**

- `lib/internal/packages/@pancreator/checkpointer-fs/`
- `lib/internal/packages/@pancreator/intervention/`
- `lib/internal/packages/@pancreator/runner-cursor/`
- `lib/internal/packages/@pancreator/pipeline/`
- `lib/internal/packages/@pancreator/run-logger/`
- `lib/internal/packages/@pancreator/cli/lib/` (run.ts, pan-init.ts, active-memory-refresh.ts)
- `examples/library-script/`
- `tests/run-logger-conformance/`
- `.github/workflows/run-logger-conformance.yml`
- `docs/PRD.summary.md`
- `lib/memory/active/current.md`
- `lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/`

**Canonical spec:**

```json
{
  "kind": "lines",
  "path": "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md",
  "range": [127, 131],
  "contentHash": "bf05499"
}
```

---

## 2. Checks executed

| Check | Procedure | Result |
|---|---|---|
| C-01 | `pnpm --filter @pancreator/checkpointer-fs test` | PASS (7 tests) |
| C-02 | `pnpm --filter @pancreator/intervention test` | PASS (15 tests) |
| C-03 | `pnpm --filter @pancreator/runner-cursor test` | PASS (4 tests) |
| C-04 | `pnpm --filter @pancreator/pipeline test` | PASS (11 tests) |
| C-05 | `pnpm --filter @pancreator/run-logger test` | PASS (6 tests) |
| C-06 | `pnpm --filter @pancreator/cli test` | PASS (28 tests) |
| C-07 | `pnpm test:run-logger-conformance` (WP-D Phoenix smoke) | PASS (3 tests, Docker) |
| C-08 | Grep `dryRun.*true` in production CLI paths | No default production block |
| C-09 | Grep `status.*stub` in CLI source | Not present — pan init returns `status: "ok"` |
| C-10 | Verify `examples/library-script/` existence and structure | PASS |
| C-11 | Verify `docs/PRD.summary.md` library-mode reference | PASS |
| C-12 | Verify `.github/workflows/run-logger-conformance.yml` path filter | PASS |
| C-13 | `pnpm -w exec pan refresh-active-memory --dry-run` (M-01/M-03 check) | FAIL before fix → PASS after |
| C-14 | `docs/PRD.summary.md` bootstrap phase status alignment | FAIL before fix → PASS after |
| C-15 | Active memory `pancreator-inbox` row data integrity | FAIL before fix → PASS after |
| C-16 | Active memory Phoenix risk row staleness | FAIL before fix → PASS after |
| C-17 | `active-memory-refresh.ts` schema compatibility for new `index.json` format | FAIL before fix → PASS after |

---

## 3. Findings

### block

**None.** All three batch-integration acceptance criteria pass:

- `dryRun: true` in `CursorRunner.invoke` is intentional behavior for `manual` invocation mode (the design-intended default). It is not a stub. Evidence: `cursor-runner.ts` lines 30-31 set `invocation = "manual"` when the option is absent and `dryRun = (invocation === "manual")`, which is the operator-paste-envelope pattern. The `sdk` path is an opt-in via `pancreator.yaml`.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/runner-cursor/lib/cursor-runner.ts",
  "range": [27, 76],
  "contentHash": "5ff594a"
}
```

- `pan init` returns `status: "ok"` with a full scaffold implementation. No `{"status":"stub"}` is present in the CLI source.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/pan-init.ts",
  "range": [65, 142],
  "contentHash": "stub-cleared"
}
```

- Library-mode proof is present: `examples/library-script/index.mjs` imports only `@pancreator/persona`, emits `.cursor/agents/<name>.md` and `.cursor/rules/<name>.mdc` into a temp directory, and does not read `lib/memory/`, `lib/inbox/`, or `pancreator.yaml`. `docs/PRD.summary.md` §Library-mode proof references it as the US-8 proof.

```json
{
  "kind": "lines",
  "path": "examples/library-script/index.mjs",
  "range": [1, 42],
  "contentHash": "lib-mode-proof"
}
```

```json
{
  "kind": "lines",
  "path": "docs/PRD.summary.md",
  "range": [37, 43],
  "contentHash": "prd-summary-lib"
}
```

### major

**None.**

### minor

**M-01 — Active memory data corruption: `pancreator-inbox` row timestamp** (remediated)

The `pancreator-inbox` row in `lib/memory/active/current.md` contained multi-line command output embedded inside the timestamp cell: `2026-05-26T09:34:14node --test tests/*.test.mjs\n...\n.000Z`. This caused the `refresh-active-memory` tool to report divergence and halt with exit code 126.

```json
{
  "kind": "lines",
  "path": "lib/memory/active/current.md",
  "range": [55, 59],
  "contentHash": "pre-fix-corrupted"
}
```

**Status:** Remediated. Row corrected to `2026-05-26T09:34:14.000Z`.

**M-02 — Active memory: m1 batch row missing timestamp and delivery-report** (remediated)

The `m1-substrate-runtime-batch` row in `lib/memory/active/current.md` showed `[indexed] (—)` with no delivery-report link even though `index.json` carries `indexed_at: "2026-05-27T17:35:30Z"` and a `feature_artifacts` entry with `kind: "delivery-report"`. Root cause: `active-memory-refresh.ts` did not read the `indexed_at` top-level field or the `feature_artifacts[].kind` array format used by the feature-delivery pipeline close-artifacts command.

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/active-memory-refresh.ts",
  "range": [73, 139],
  "contentHash": "pre-fix-schema-gap"
}
```

**Status:** Remediated. `parseShippedAtMs` now reads `indexed_at` at root level before legacy paths. `readDeliveryReportPath` now reads `feature_artifacts[].kind === "delivery-report"` as a final fallback. `current.md` row reordered to match computed sort order. `refresh-active-memory --dry-run` now exits 0.

**M-03 — Active memory stale Phoenix risk row** (remediated)

`lib/memory/active/current.md` §Risks and blockers carried: _"Phoenix OTLP import remains open on the `pancreator-engineer` backlog."_ WP-D Option A shipped and the Phoenix smoke test passes (3/3 tests in Docker, C-07). The spec acceptance criterion states this row SHALL be removed when Option A smoke tests pass.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/spec.md",
  "range": [103, 108],
  "contentHash": "bf05499"
}
```

**Status:** Remediated. Row replaced with a note that Langfuse verification is deferred to M2 under `bootstrap-external-observability-phoenix-langfuse`.

**M-04 — `docs/PRD.summary.md` bootstrap phase status drift** (remediated)

`docs/PRD.summary.md` line 29 stated `phase-4-in-progress`, but `AGENTS.md` §8 and `pancreator.yaml` record `phase-4-ratified` with a closed US-1 dogfood exit bundle.

```json
{
  "kind": "lines",
  "path": "AGENTS.md",
  "range": [202, 215],
  "contentHash": "a58969b"
}
```

**Status:** Remediated. `docs/PRD.summary.md` updated to `phase-4-ratified`.

### note

**N-01 — Traceability drift: implementation files outside declared touch-set**

The delivery report acknowledges that several changed implementation files sit outside the declared touch-set. This was accepted by the reviewer as a known gap and is not a compliance blocker.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/delivery-report.md",
  "range": [224, 234],
  "contentHash": "0caf5cf"
}
```

**N-02 — `startFeatureDelivery` compiles graph and discards the value**

The reviewer noted this mild startup inefficiency. It is non-blocking and is backlogged.

```json
{
  "kind": "lines",
  "path": "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/delivery-report.md",
  "range": [202, 212],
  "contentHash": "0caf5cf"
}
```

---

## 4. Auto-remediations applied

| # | Fix | Changed paths | Risk |
|---|---|---|---|
| R-01 | Fixed `pancreator-inbox` row corruption in active memory | `lib/memory/active/current.md` | Low — restores correct timestamp |
| R-02 | Corrected m1 batch row: added `indexed_at` and delivery-report link, reordered to match sort | `lib/memory/active/current.md` | Low — cosmetic reorder + data completion |
| R-03 | Cleared stale Phoenix risk row; added M2 deferral note | `lib/memory/active/current.md` | Low — aligns with shipped WP-D evidence |
| R-04 | Patched `parseShippedAtMs` to read `indexed_at` at root level | `lib/internal/packages/@pancreator/cli/lib/active-memory-refresh.ts` | Low — additive fallback path; 28 tests pass |
| R-05 | Patched `readDeliveryReportPath` to read `feature_artifacts[].kind === "delivery-report"` | `lib/internal/packages/@pancreator/cli/lib/active-memory-refresh.ts` | Low — additive fallback path; 28 tests pass |
| R-06 | Fixed `docs/PRD.summary.md` phase status from `phase-4-in-progress` to `phase-4-ratified` | `docs/PRD.summary.md` | Low — aligns docs with `pancreator.yaml` ground truth |

---

## 5. Documentation-impact decision

**Pass.** Documentation impact was evaluated for each remediation:

- `lib/memory/active/current.md`: active-memory tier document; changes are data corrections and stale-row removal — no secondary doc impact.
- `lib/internal/packages/@pancreator/cli/lib/active-memory-refresh.ts`: implementation fix; no public API surface change; no doc update required beyond this audit report.
- `docs/PRD.summary.md`: the file is a compact orientation document. The phase-status fix aligns it with `AGENTS.md` §8. No further doc cascades are needed.

---

## 6. Proposal decisions

**P-01 — Add `indexed_at` and `feature_artifacts` to `refresh-active-memory` schema reader (approved in-task)**

- `proposal_id`: `refresh-active-memory-new-schema-compat`
- `status`: approved (applied as R-04 and R-05 above)
- `problem_statement`: The `refresh-active-memory` tool only reads the legacy `index.completed_at` / `delivery_report.path` schema and silently surfaces `(—)` for any feature indexed via the feature-delivery pipeline's `close-artifacts` command, which emits a different schema shape.
- `evidence_anchors`:

```json
{
  "kind": "lines",
  "path": "lib/internal/packages/@pancreator/cli/lib/active-memory-refresh.ts",
  "range": [73, 139],
  "contentHash": "pre-fix-schema-gap"
}
```

```json
{
  "kind": "lines",
  "path": "lib/memory/features/m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo/index.json",
  "range": [1, 25],
  "contentHash": "new-schema"
}
```

- `proposed_change`: Add `indexed_at` root-level read and `feature_artifacts[].kind` array read as documented above.
- `expected_impact`: Every feature indexed via feature-delivery pipeline now surfaces correct timestamp and delivery-report link in active memory without manual edits.
- `risk_note`: Additive fallback; no existing behavior changes.
- `owner_recommendation`: `pancreator-engineer`

No backlog item required — fix applied in-task.

---

## 7. Gate recommendation

```yaml
compliance_passes: true
predicate: >
  Zero block findings remain for stub runner behavior, stub pan init behavior,
  and missing library-mode proof. All six package test suites pass. Phoenix
  smoke test passes 3/3. Four minor issues were remediated in-task. Active
  memory is now in sync (refresh-active-memory --dry-run exits 0).
```

---

## 8. Deferred decisions

| Item | Reason | Owner | Rerun trigger |
|---|---|---|---|
| Touch-set traceability gap (N-01) | Accepted by reviewer; non-blocking | `pancreator-engineer` | When next batch ships, declare a full touch-set at plan time |
| Pipeline compile graph discard inefficiency (N-02) | Accepted by reviewer; backlog item | `pancreator-engineer` | When M2 pipeline execution work begins |
| Langfuse/additional-backend verification (WP-D M2 deferral) | Out of M1 scope per spec | `pancreator-engineer` | When backlog item `bootstrap-external-observability-phoenix-langfuse` activates |
