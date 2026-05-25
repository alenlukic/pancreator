# Delivery report — inbox-convention-migration

**Task id:** `60722_0707_inbox-convention-migration`  
**Feature id:** `inbox-convention-migration`

## Summary

This re-entry slice hardens the standalone inbox convention migration tool and extends legacy thread discovery so nested layout is handled safely. Review records `review_passes: true`, states that prior must-fix findings are resolved, and lists no must-fix items. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [1, 8],
  "contentHash": "1076c2b"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [1, 6],
  "contentHash": "40488da"
}
```


## Architecture

- **Standalone write safety:** `--write` no longer recomputes a fresh plan at apply time. Operators must supply `--manifest <path>` to persisted JSON with schema `tesseract.inbox-convention-migration-manifest.v1`; apply uses `renames`, `referenceUpdates`, `applyInboxRenamesFromManifest`, `applyReferenceUpdatesFromManifest`, and `writeInboxArtifactIndex`; `TESSERACT_MIGRATION_GO=1` remains required for writes. Combined work-plus-inbox migrations stay on `migrate-timestamp-naming.mjs --write --manifest …` with the combined timestamp manifest. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [9, 23],
  "contentHash": "4f7b470"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [13, 17],
  "contentHash": "dfa7d86"
}
```

- **Thread discovery:** Under each first-level legacy feature directory under `src/inbox/threads/<feature>/`, discovery recurses into subdirectories, skips work-style day and migrated-task-directory patterns, never traverses paths containing `/notes/`, and keeps `threadFeatureId` as the first-level feature slug. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [24, 29],
  "contentHash": "805b288"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [15, 16],
  "contentHash": "9d2b768"
}
```

- **Exports and tests:** `isMigratedThreadTaskSegment` is exported for tests and reuse; tests live in `tests/migrate-inbox-convention.test.mjs` per the changed-files list. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [31, 33],
  "contentHash": "6de1a36"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [15, 16],
  "contentHash": "9d2b768"
}
```


## Interfaces

- **Standalone inbox migration:** Persist the dry-run manifest, then apply with `--write --manifest <path>` and `TESSERACT_MIGRATION_GO=1`. Operators using `migrate-timestamp-naming.mjs --rollback --manifest <same-approved-file>` still invert `sourceRel` and `targetRel` from the stored manifest; inbox-only runs should still produce a rollback-capable manifest when inbox steps apply. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [9, 22],
  "contentHash": "ee1ad58"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [13, 17],
  "contentHash": "dfa7d86"
}
```

- **Combined migrations:** Use `migrate-timestamp-naming.mjs --write --manifest …` with the combined timestamp manifest—not the standalone inbox migration path—when scope spans work plus inbox. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [22, 23],
  "contentHash": "9dbc616"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [1, 6],
  "contentHash": "40488da"
}
```


## Tradeoffs, caveats, and follow-ups

- **Heuristic skips:** The migrated-task-directory skip rule can skip a rarely named legacy subdirectory; operators may rename beforehand. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [46, 46],
  "contentHash": "d68c587"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [1, 6],
  "contentHash": "40488da"
}
```

- **Manual cleanup:** Empty nested directories under a legacy feature tree may still require manual cleanup after thread moves. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [47, 47],
  "contentHash": "4141359"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [1, 6],
  "contentHash": "40488da"
}
```

- **Signal quality:** `node --test tests/*.test.mjs` may emit non-blocking `fatal: not a git repository` lines from subprocesses; reviewer marks this as a nit for later cleanup. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [35, 42],
  "contentHash": "2fb411c"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [18, 20],
  "contentHash": "d1cf127"
}
```


## Testing and verification

- Implementer ran targeted migration tests plus phase-0a scaffold, context-budget report, and policy hook `bash -n`; full `tests/*.test.mjs` produced an unrelated single failure in `context-budget-report.test.mjs` outside this touch set. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md",
  "range": [35, 42],
  "contentHash": "2fb411c"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [29, 34],
  "contentHash": "47b6be9"
}
```

- Reviewer re-ran `node --test tests/*.test.mjs` (48 tests, 0 failed) plus the same scaffold, context-budget, and `bash -n` gates; no remaining blockers. 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [29, 38],
  "contentHash": "fe56520"
}
```
 

```json
{
  "kind": "lines",
  "path": "src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md",
  "range": [36, 38],
  "contentHash": "44ee2d3"
}
```


## After human acceptance

Run exactly:

`pnpm -w exec tess advance 60722_0707_inbox-convention-migration --artifact src/memory/features/inbox-convention-migration/delivery-report.md`
