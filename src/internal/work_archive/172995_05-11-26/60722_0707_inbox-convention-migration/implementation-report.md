# Implementation report — must-fix re-entry (60722_0707_inbox-convention-migration)

## Changed files

- `src/internal/tools/migrate-inbox-convention.mjs`
- `tests/migrate-inbox-convention.test.mjs`
- `src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md` (this file)

## Summary of fixes

### 1. Standalone inbox migration write safety

- `migrate-inbox-convention.mjs --write` **no longer** calls `planInboxConventionMigration` and applies a freshly computed plan.
- **`--write` requires `--manifest <path>`** to a persisted JSON document with schema `tesseract.inbox-convention-migration-manifest.v1` (the normal dry-run output).
- Apply path reads **`renames`** and **`referenceUpdates`** from that file only, then:
  - `applyInboxRenamesFromManifest` (moves, then empty-dir cleanup steps),
  - `applyReferenceUpdatesFromManifest` (imported from `migrate-timestamp-naming.mjs`) so cross-repo path strings match the approved manifest,
  - `writeInboxArtifactIndex`.
- **`TESSERACT_MIGRATION_GO=1`** is still required for `--write`.
- **Rollback / inversion safety:** unchanged for operators using `migrate-timestamp-naming.mjs --rollback --manifest <same-approved-file>`; that tool inverts `sourceRel` ↔ `targetRel` from the stored manifest. Inbox-only writes must still ship a dry-run manifest that rollback can consume if it includes the inbox steps.

**Routing:** Combined repo migrations that include work + inbox should continue to use **`migrate-timestamp-naming.mjs --write --manifest …`** with the **combined** timestamp manifest (not this standalone path).

### 2. Legacy thread discovery coverage

- Under each first-level legacy feature directory in `src/inbox/threads/<feature>/`, discovery **recurses** into subdirectories for files.
- **Skipped subtrees** (not treated as legacy sources): directories whose basename matches the **work-style day** pattern (`\d{6}_MM-DD-YY`) or the **migrated task-directory** heuristic (`\d+_\d{4}_…`, aligned with `buildBasename` output).
- **Notes:** paths containing `/notes/` are never traversed (defensive; canonical threads live under `src/inbox/threads`).
- `threadFeatureId` remains the **first-level feature slug** under `threads/` so feature resolution matches the prior flat behavior.

### 3. Export

- `isMigratedThreadTaskSegment` is exported for tests and reuse.

## Validation run

- `node --test tests/migrate-timestamp-naming.test.mjs tests/migrate-inbox-convention.test.mjs` — pass.
- `node src/internal/tools/check-phase-0a-scaffold.mjs` — pass.
- `node src/internal/tools/context-budget-report.mjs` — pass.
- `bash -n .cursor/hooks/enforce-policy-compliance.sh` — pass.

`node --test tests/*.test.mjs` reported one failure in `tests/context-budget-report.test.mjs` (Cursor agent projection tier expectations). That failure is **outside this touch set** and appears tied to current `.cursor/agents/**` content rather than these migration changes.

## Known caveats

- The migrated-task-directory skip rule uses a **heuristic** (`SID_HHMM_`–style prefix). A rarely named legacy subdirectory could match and be skipped; operators can rename such directories before migration if needed.
- Empty **nested** directories under a legacy feature tree may still require manual cleanup after thread moves; removal steps still target the legacy feature directory pattern from the planner as before.
