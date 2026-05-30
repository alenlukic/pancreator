---
title: Implementation report — ci-best-practices-batch
task_id: 24959_1704_ci-best-practices-batch
feature_id: ci-best-practices-batch
stage: implement
status: complete
owner: coder
updated_at: 2026-05-26
review_reentry: 2026-05-26
---

# Summary

Implemented work packages **A → B → C → D** for `ci-best-practices-batch`: root test aggregation and CI wiring, compliance descriptor runner, citation refresh tool, and typed MCP read-only handlers. All mandated validation commands pass locally.

# WP-A — CI test aggregation

## Changes

- Added root `package.json` `"test"` script running `turbo run test` plus five `node --test` suites (repo-structure, migrate-json-formatting, migrate-timestamp-naming, migrate-inbox-convention, context-budget).
- Added noop `test` scripts to `@pancreator/core` and meta `pancreator` packages so turbo resolves every workspace participant.
- Updated `.github/workflows/phase-0a-scaffold.yml`: distinct `pnpm test` step after lint/typecheck/attw/publint; compliance runner step after tests; removed redundant per-suite CI steps superseded by `pnpm test`.
- Reconciled `compliance-auditor` persona and Cursor projections with explicit `Bash(pnpm test)` grant alongside `pnpm test:*`.
- Updated `tests/repo-structure.test.mjs` workflow assertions for the new CI shape.

## Blocker fixes (required for green `pnpm test`)

- Corrected `tsconfig.base.json` extends depth in 11 `@pancreator/*` packages (`../../../../` → `../../../../../`).
- Fixed stale repo-root resolution in `@pancreator/memory` and `@pancreator/persona` vitest fixtures.
- Normalized `src/memory/features/ci-best-practices-batch/index.json` to canonical two-space JSON (was `{}`).

# WP-B — Compliance descriptor runner

## Changes

- Created `src/internal/tools/run-compliance.mjs` with:
  - Descriptor discovery under `tests/compliance/*.yaml`
  - Structural validation against `tests/compliance/schemas/latest.yaml`
  - Pluggable per-id assertion adapters (`json-formatting`, `timestamp-naming-conventions`, severity-routing registry descriptors)
  - Non-zero exit on open `high` severity findings (block-equivalent)
  - `--run-id <task-id>` emission to `src/work/<day>/<id>/compliance-result.json`
- Added `tests/run-compliance.test.mjs`.
- Added root `devDependency` on `yaml` for descriptor parsing.
- Wired CI compliance step after `pnpm test`.

# WP-C — Citation refresh tool

## Changes

- Created `src/internal/tools/refresh-citations.mjs`:
  - Patches `TBD-on-commit` and stale abbreviated `contentHash` values
  - Reuses `resolveAbbrevLen` from `canonical-json-format.mjs`
  - Handles YAML frontmatter, Markdown fenced JSON, and standalone JSON
  - `--dry-run`, optional globs, idempotent writes
  - Refuses `src/inbox/notes/`; skips `src/inbox/{in,out,threads}/` with warnings
- Added `tests/refresh-citations.test.mjs` covering three surfaces, idempotency, notes refusal, and glob matching.

# WP-D — MCP read-only handlers

## Changes

- Added `src/internal/packages/@pancreator/mcp-server/src/pan-read-handlers.ts` with typed handlers for:
  - `pan.feature` (`action: list|show`) → `feature.list` / `feature.show` envelopes
  - `pan.status` → workspace bootstrap + active task summary (optional `taskId`)
  - `pan.memory` (`query`) → `memory.query` via `MemoryRouter` + active-memory scan
- Updated `pan-execute.ts`, `definitions.ts` input schemas, and `README.md` (wired read tools + deferred write tools table).
- Extended `pan-execute.test.ts` with direct handler tests and stdio MCP transport coverage asserting no `{"status":"stub"}` responses.
- Added `yaml` dependency to `@pancreator/mcp-server` for `pancreator.yaml` status reads.

# Files touched

| Path | WP |
|---|---|
| `package.json` | A, B |
| `pnpm-lock.yaml` | A, B |
| `turbo.json` | (unchanged; existing `test` task reused) |
| `.github/workflows/phase-0a-scaffold.yml` | A, B |
| `src/internal/packages/@pancreator/core/package.json` | A |
| `src/internal/packages/pancreator/package.json` | A |
| `src/internal/packages/@pancreator/*/tsconfig.json` (11 packages) | A blocker |
| `src/internal/packages/@pancreator/memory/src/memory-router.test.ts` | A blocker |
| `src/internal/packages/@pancreator/persona/src/tech-writer.roundtrip.test.ts` | A blocker |
| `src/internal/tools/run-compliance.mjs` | B |
| `src/internal/tools/refresh-citations.mjs` | C |
| `tests/run-compliance.test.mjs` | B |
| `tests/refresh-citations.test.mjs` | C |
| `tests/repo-structure.test.mjs` | A |
| `src/internal/packages/@pancreator/mcp-server/src/pan-read-handlers.ts` | D |
| `src/internal/packages/@pancreator/mcp-server/src/pan-execute.ts` | D |
| `src/internal/packages/@pancreator/mcp-server/src/definitions.ts` | D |
| `src/internal/packages/@pancreator/mcp-server/src/pan-execute.test.ts` | D |
| `src/internal/packages/@pancreator/mcp-server/src/definitions.test.ts` | D |
| `src/internal/packages/@pancreator/mcp-server/package.json` | D |
| `src/internal/packages/@pancreator/mcp-server/README.md` | D |
| `src/personas/compliance-auditor.md` | A |
| `.cursor/agents/compliance-auditor*.md` | A |
| `src/memory/features/ci-best-practices-batch/index.json` | A blocker |

# Review re-entry

Addressed reviewer must-fix items **MF-01** and **MF-02** without changing WP A–D behavior.

| Finding | Fix |
|---|---|
| **MF-01** — `run-compliance` tests coupled to active task id | `tests/run-compliance.test.mjs` now uses a synthetic `src/work/99999_test_fixture/run_compliance_test_fixture/` directory created in setup and removed in teardown for `parseArgs`, `resolveRunOutputDir`, and `--run-id` emission coverage. Suite no longer depends on `24959_1704_ci-best-practices-batch` surviving archival. |
| **MF-02** — incomplete touch-set | `touch-set.json` stage set to `implement`; added 11 blocker `tsconfig.json` paths, `@pancreator/persona/tsconfig.json`, vitest fixture files, `pnpm-lock.yaml`, `tests/repo-structure.test.mjs`, `src/memory/features/ci-best-practices-batch/index.json`, and `pan-read-handlers.ts` (39 paths total). |

# Validation results

| Command | Result | Notes |
|---|---|---|
| `pnpm test` | **PASS** | turbo vitest + root node suites |
| `node src/internal/tools/run-compliance.mjs` | **PASS** | 5 descriptors, `status: pass`, exit 0 |
| `node --test tests/run-compliance.test.mjs` | **PASS** | 9 tests; synthetic work-dir fixture |
| `node --test tests/refresh-citations.test.mjs` | **PASS** | 9 tests |
| `pnpm --filter @pancreator/mcp-server test` | **PASS** | includes stdio transport read-tool suite |
| `node --test tests/*.test.mjs` | **PASS** | full root node suite |
| `node src/internal/tools/check-phase-0a-scaffold.mjs` | **PASS** | exit 0 |
| `node src/internal/tools/context-budget-report.mjs` | **PASS** | exit 0 |
| `bash -n .cursor/hooks/enforce-policy-compliance.sh` | **PASS** | syntax ok |

# CI wallclock notes

Local `pnpm test` completes in ~4 seconds (cold turbo ~5s with package rebuilds). Replacing three discrete node-test CI steps with one `pnpm test` plus compliance adds modest overhead; measured local total remains far below the **3-minute** PR budget target from the spec.

# Documentation impact evaluation

Per `src/memory/handbook/documentation-impact-contract.md`:

| Surface | Action |
|---|---|
| `@pancreator/mcp-server/README.md` | **Updated** — wired read tools and deferred write-tool table |
| `src/personas/compliance-auditor.md` + Cursor projections | **Updated** — canonical `pnpm test` grant |
| Handbook / AGENTS.md | **No change required** — CI and tool behavior documented in feature delivery artifacts |
| `src/memory/features/ci-best-practices-batch/delivery-report.md` | **Deferred** — review/ship stage owns delivery report |
| Operator runbook for `refresh-citations.mjs` | **Deferred** — tool self-documents via `--dry-run` JSON report; tech-writer may add handbook pointer at ship |

# Deferrals / blockers

- **WP-C bulk repo sweep not executed in this stage.** Tool and tests land ready; operator/librarian sweep of 501 `TBD-on-commit` placeholders remains a follow-up (inbox immutability constraints preserved).
- **`pan compliance run` CLI verb** remains deferred per spec out-of-scope.
- **MCP write tools** remain on structured deferral envelopes (`pan.init`, `pan.run`, `pan.approve`, `pan.contracts`, `pan.lint`).
- **Pre-existing package test path/tsconfig debt** required minimal blocker fixes outside the original touch-set so `turbo run test` could pass; changes are test-only or one-line tsconfig corrections with no product semantics change.

## Next operator steps

**What:** Re-run review on the implement stage after MF-01/MF-02 fixes (paste bounded reviewer prompt only).

**How:**

```bash
cd /Users/alen/Dev/pancreator
node --test tests/run-compliance.test.mjs
node --test tests/*.test.mjs
pnpm test
node src/internal/tools/run-compliance.mjs
```

Read-only: confirm `touch-set.json` lists 39 paths and `stage` is `implement`; confirm `tests/run-compliance.test.mjs` uses `run_compliance_test_fixture`, not `24959_1704_ci-best-practices-batch`.

**What:** After review passes, advance the feature-delivery run with the implementation report artifact.

**How:**

```bash
cd /Users/alen/Dev/pancreator
pnpm -w exec pan advance 24959_1704_ci-best-practices-batch --artifact src/work/172980_05-26-26/24959_1704_ci-best-practices-batch/implementation-report.md
```

**When to choose:** Only after human accepts reviewer `review_passes: true`.

**Impact:** Moves ledger to the next pipeline stage; does not commit or push.
