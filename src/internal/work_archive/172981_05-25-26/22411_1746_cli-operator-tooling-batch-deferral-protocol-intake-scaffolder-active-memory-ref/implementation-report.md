# Implementation report — cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref

- **Task id:** `22411_1746_cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref`
- **Feature id:** `cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref`
- **Stage:** implement (coder) — **round-2 MUST-FIX remediation** (2026-05-25)
- **Prior review:** `review.md` round 2 (`must_fix`)

## Remediation summary (this pass)

### MUST-FIX 1 — `ddl refresh-active-memory` apply path (`run.ts`, `run.test.ts`)

- **Root cause:** Conflict detection compared full `## Operator notes` inner text, so a fresh `buildManagedOperatorSlice(now)` timestamp always differed from the on-disk managed block and forced exit **126** before `writeFile`.
- **Fix:** `canonicalizeManagedOperatorNotesAuto` + `operatorNotesSectionConflictFree` replace only the ddl-managed region between `<!-- ddl:active-memory:operator-notes:auto -->` markers with a fixed placeholder before normalized equality. Active Feature + shipped table comparisons are unchanged; human text outside the markers still drives conflicts.
- **Test:** New vitest seeds a temp `current.md` with a stale ISO inside the auto block, matching derived Active Feature / shipped table, runs **`refresh-active-memory` without `--dry-run`**, asserts exit **0**, asserts `now` ISO in file, human bullet preserved, stale ISO gone.

### MUST-FIX 2 — Per-verb `tracking_intake` (`run.ts`, `run.test.ts`, `ddl-execute.ts`, `ddl-execute.test.ts`)

- **Fix:** `defaultDeferredTrackingIntake(cfg.verb)` routes **`ddl init`** to `src/inbox/in/172981_05-25-26/64500_0605_ddl-init-and-create-daedaline-install-paths.md`; other deferred CLI verbs keep the batch inbox path. MCP: exported `deferredToolTrackingIntake` mirrors the same paths (`ddl.init` → `64500…`, others → `64488…`).
- **Tests:** CLI matrix asserts explicit per-row `tracking_intake`; MCP asserts full `64500…` path on `ddl.init` and adds `ddl.lint` → batch path.

### MUST-FIX 3 — AGENTS.md §6 structure

- Restored **`### 6.1 — Compliance-run trigger guidance`** above the three compliance bullets; renumbered operator-tooling items as **6–8** (deferral protocol, intake new, refresh-active-memory).

## Verification (mandatory — executed 2026-05-25 after fixes)

| Command | Exit |
|---------|------|
| `pnpm --filter @daedaline/cli exec vitest run` | **0** (22 tests) |
| `pnpm --filter @daedaline/mcp-server exec vitest run` | **0** (9 tests) |
| `node --test tests/*.test.mjs` | **0** (78 tests) |
| `pnpm -w exec ddl refresh-active-memory` | **0** (live repo; JSON `status: ok` with `path`) |

**Live refresh without `--dry-run` exits 0:** **yes** (was 126 before remediation).

## Earlier delivery context (unchanged intent)

This feature batch still covers: deferred envelopes (exit **125**), `ddl intake new`, `ddl refresh-active-memory` with dry-run/apply and conflict **126** for real mismatches, and MCP deferral parity.

## Files touched this remediation

- `src/internal/packages/@daedaline/cli/src/run.ts`
- `src/internal/packages/@daedaline/cli/src/run.test.ts`
- `src/internal/packages/@daedaline/mcp-server/src/ddl-execute.ts`
- `src/internal/packages/@daedaline/mcp-server/src/ddl-execute.test.ts`
- `AGENTS.md`
- Optional: `src/memory/active/current.md` refreshed when live `ddl refresh-active-memory` apply runs (managed timestamp / derived slices only).

## Next operator steps

1. **What:** Re-run review / advance when satisfied. **How:** Use the task’s review and `ddl advance` flow per `handoff.md` (do not run `ddl advance` from the agent).

2. **What:** Spot-check deferral JSON. **How:** `pnpm -w exec ddl init` → `tracking_intake` ends with `64500_0605_ddl-init-and-create-daedaline-install-paths.md`; other stub verbs still cite the batch directive.
