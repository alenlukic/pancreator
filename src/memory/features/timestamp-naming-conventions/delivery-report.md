## Summary
The Feature defines a UTC-only naming policy for in-scope temporal artifacts, migrates existing paths with a dry-run-first workflow, and rewrites references that name migrated paths. It also updates `src/memory/handbook/inbox-lifecycle.md` so human-generated inbox artifacts use the same two time-prefix segments before downstream processing continues. The shipped slice keeps write-mode gated and leaves the actual rename pass for a later, auditable commit.

## Architecture
- The policy encodes UTC as the only time zone, fixes `FDS` at `2500-01-01T00:00:00Z`, and uses a reverse-chronological day/task naming scheme so `src/work/` and `src/inbox/` paths stay machine-checkable. `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [54, 90], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [35, 47], contentHash: TBD-on-commit}`
- The migration derives timestamps in deterministic precedence order, inventories rename targets before writes, and records reference updates in the dry-run manifest so the plan stays reversible. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/plan.md, range: [11, 21], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [47, 59], contentHash: TBD-on-commit}`
- The inbox-lifecycle change keeps actor ownership in the handbook layer, not the persona layer, so future roster changes do not break the obligation. `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [135, 147], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [29, 33], contentHash: TBD-on-commit}`

### Lineage
1. Intake closed after round-1 clarification, operator responses, and spec ratification. Commit anchors: `90f6110` -> `d26d4e1` -> `f2263fc`. `{kind: lines, path: src/inbox/threads/timestamp-naming-conventions/50991_0950_round-01-clarify.md, range: [1, 97], contentHash: TBD-on-commit}`; `{kind: lines, path: src/inbox/threads/timestamp-naming-conventions/round-01-clarify-human-responses.md, range: [1, 87], contentHash: TBD-on-commit}`
2. Plan authored the touch set, execution steps, verification plan, and rollback posture. Commit anchor: `1ca2afd`. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/plan.md, range: [1, 36], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/touch-set.json, range: [1, 130], contentHash: TBD-on-commit}`
3. Implement added the compliance descriptor, three Spec Contracts, the migration script, the inbox-lifecycle update, the feature-index promotion, and the dry-run manifest. Commit anchor: `7d7b62a`. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [40, 46], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest.dry-run.json, range: [1, 11], contentHash: TBD-on-commit}`
4. Review recorded a pass-with-conditions verdict, five green verification gates, and the remaining deferred runner wiring. Commit anchor: `635e5bb`. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [182, 199], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/features/timestamp-naming-conventions/index.json, range: [13, 37], contentHash: TBD-on-commit}`

## Interfaces
- `FDS_UTC_MS`, `SID_SECONDS`, and the timestamp helpers define the policy surface for UTC day math and reverse-chronological basenames. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [36, 129], contentHash: TBD-on-commit}`; `{kind: lines, path: tests/migrate-timestamp-naming.test.mjs, range: [20, 39], contentHash: TBD-on-commit}`
- `chooseTimestamp()` encodes the authoritative source order of git, frontmatter, filesystem mtime, then operator override. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [164, 184], contentHash: TBD-on-commit}`; `{kind: lines, path: tests/migrate-timestamp-naming.test.mjs, range: [115, 152], contentHash: TBD-on-commit}`
- `migrateTargetForWorkPath()` and `migrateTargetForInboxPath()` compute the planned rename targets for work tasks and inbox artifacts, including thread-parent preservation. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [248, 303], contentHash: TBD-on-commit}`; `{kind: lines, path: tests/migrate-timestamp-naming.test.mjs, range: [154, 185], contentHash: TBD-on-commit}`
- `inventoryReferences()`, `applyRenamesFromManifest()`, and `applyReferenceUpdatesFromManifest()` provide the dry-run audit and manifest-backed execution surfaces. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [305, 347], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [825, 854], contentHash: TBD-on-commit}`

## Tradeoffs
- The implement slice accepts a high-touch migration because the feature spans `src/work/`, `src/inbox/`, and reference artifacts, and the manifest must remain the rollback source of truth. `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [55, 59], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/plan.md, range: [30, 35], contentHash: TBD-on-commit}`
- The slice rejects immediate write-mode execution and keeps `TESSERACT_MIGRATION_GO=1` as the explicit guard before any rename write. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [896, 921], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [213, 229], contentHash: TBD-on-commit}`
- The slice accepts deferred contract-runner wiring because the Spec Contracts already pass through structural, test, and script evidence in this phase. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [124, 136], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/features/timestamp-naming-conventions/index.json, range: [21, 37], contentHash: TBD-on-commit}`

### Deferrals and follow-ups
- `timestamp-naming-conventions-migration-write` MUST wait for the `human_approval` gate, MUST require `TESSERACT_MIGRATION_GO=1`, and MUST use the manifest as the rollback map if a partial write occurs. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [876, 921], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [213, 229], contentHash: TBD-on-commit}`
- `timestamp-naming-conventions-l2-contenthash-mix` MUST move into the librarian refresh pass so the mixed `contentHash` discipline clears after indexing. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [109, 116], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/handbook/inbox-lifecycle.md, range: [135, 147], contentHash: TBD-on-commit}`
- `timestamp-naming-conventions-runner-not-wired` MUST remain blocked on the contract-runner panel wiring in Phase 5. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [124, 136], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/features/timestamp-naming-conventions/index.json, range: [28, 37], contentHash: TBD-on-commit}`
- `timestamp-naming-conventions-post-2500-rollover` MUST stay operator-deferred beyond this slice. `{kind: lines, path: src/memory/features/timestamp-naming-conventions/spec.md, range: [123, 129], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/features/timestamp-naming-conventions/index.json, range: [171, 176], contentHash: TBD-on-commit}`

### Risks and rollback
- The migration remains high-touch because it rewrites many `src/work/` and `src/inbox/` paths, so the team MUST keep the write pass separate from the review pass. `{kind: lines, path: src/memory/adr/0005-timestamp-naming-conventions.md, range: [53, 60], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/plan.md, range: [30, 35], contentHash: TBD-on-commit}`
- The script MUST keep the `TESSERACT_MIGRATION_GO=1` guard, `--strict-references` audit, and manifest-backed rollback path intact so the later write commit stays auditable. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [876, 921], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [789, 818], contentHash: TBD-on-commit}`
- The dry-run manifest MUST remain the empirical proof of plan correctness until write-mode runs in a separate commit. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest.dry-run.json, range: [1, 11], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [148, 180], contentHash: TBD-on-commit}`

### Next steps
1. `supervisor` MUST stage the implement-plus-review slice for the next `human_approval` gate and MUST not auto-push. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [223, 229], contentHash: TBD-on-commit}`; `{kind: lines, path: src/memory/features/timestamp-naming-conventions/index.json, range: [13, 19], contentHash: TBD-on-commit}`
2. After `human_approval`, the follow-up task MUST run migration write-mode and MUST land the renames plus reference updates in a single commit. `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [896, 921], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [172, 180], contentHash: TBD-on-commit}`

## Usage guidelines
1. `chooseTimestamp()` MUST prefer git when a commit timestamp exists, as the tests show git beats frontmatter and mtime. `{kind: lines, path: tests/migrate-timestamp-naming.test.mjs, range: [115, 133], contentHash: TBD-on-commit}`
2. `migrateTargetForWorkPath()` MUST derive the `src/work/<days-to-FDS>_<MM-DD-YY>/<SID>_<HHMM>_<slug>/` shape for flat work tasks. `{kind: lines, path: tests/migrate-timestamp-naming.test.mjs, range: [154, 164], contentHash: TBD-on-commit}`
3. `migrateTargetForInboxPath()` MUST preserve the `src/inbox/threads/<feature>/` parent while it computes the new basename for thread files. `{kind: lines, path: tests/migrate-timestamp-naming.test.mjs, range: [166, 185], contentHash: TBD-on-commit}`

## Testing
The delivered slice adds boundary coverage for timestamp precedence, day rollover, collision numbering, basename shaping, and reference inventory, while the reviewer’s gates stayed green and the strict-reference dry-run stayed clean. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [184, 199], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/tools/migrate-timestamp-naming.mjs, range: [774, 818], contentHash: TBD-on-commit}`

### Acceptance criteria → coverage
| Spec clause | Coverage source |
| --- | --- |
| UTC time zone | ADR 0005 Decision; UTC helper coverage |
| FDS = 2500-01-01 | `daysToFds()` boundary tests |
| SID = 86400 | `secondsRemainingInDay()` boundary tests |
| Work day + task scope | `migrateTargetForWorkPath()` snapshot test |
| Inbox in/out/threads/archive | `migrateTargetForInboxPath()` and inventory scope |
| `src/work/*/*/run.log.jsonl` excluded | migration exclusion guard |
| Day directory prefix/suffix | `daysToFds()` and `mmDdYySuffix()` helpers |
| Task subdir SID / HHMM / semantic suffix | `secondsRemainingInDay()`, `hhmm()`, and basename builder |
| Inbox parent preserved | thread-path snapshot test |
| Collision counter inserted | collision-counter tests |
| Reference and documentation updates | strict-reference audit plus review coverage |
| Inbox lifecycle update | `src/memory/handbook/inbox-lifecycle.md` §3c |

### Verification
- `pnpm typecheck` - pass. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [184, 191], contentHash: TBD-on-commit}`
- `pnpm lint` - pass. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [184, 191], contentHash: TBD-on-commit}`
- `pnpm run check:phase0a` - pass. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [184, 191], contentHash: TBD-on-commit}`
- `pnpm migration:test` - pass. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [184, 191], contentHash: TBD-on-commit}`
- `pnpm -r run test` - pass. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [184, 191], contentHash: TBD-on-commit}`
- `node src/internal/tools/migrate-timestamp-naming.mjs --dry-run --strict-references` - pass, with `renames=35`, `referenceUpdates=451`, and `collisionWarnings=0`. `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest.dry-run.json, range: [1, 11], contentHash: TBD-on-commit}`; `{kind: lines, path: src/internal/work_archive/173009_04-27-26/50991_0950_timestamp-naming-conventions/review.md, range: [128, 130], contentHash: TBD-on-commit}`
