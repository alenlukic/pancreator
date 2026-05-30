---
title: Timestamp Naming Conventions Review
feature_id: timestamp-naming-conventions
stage: review
verdict: pass-with-conditions
implement_commit: 7d7b62a1cbf1903def541c968dffacfd2c8744a5
references:
  - kind: lines
    path: lib/memory/features/timestamp-naming-conventions/spec.md
    range: [50, 129]
    contentHash: TBD-on-commit
    note: "Engineering Spec acceptance criteria, out-of-scope, and deferrals."
  - kind: lines
    path: archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/plan.md
    range: [1, 36]
    contentHash: TBD-on-commit
    note: "Plan stage architecture summary, touch set, execution steps, and verification plan."
  - kind: lines
    path: archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/touch-set.json
    range: [1, 130]
    contentHash: TBD-on-commit
    note: "Plan stage touch set with planned files, globs, and excluded globs."
  - kind: lines
    path: lib/memory/adr/0005-timestamp-naming-conventions.md
    range: [1, 64]
    contentHash: TBD-on-commit
    note: "Accepted ADR codifying the UTC naming policy and migration precedence."
  - kind: lines
    path: lib/internal/tools/migrate-timestamp-naming.mjs
    range: [1, 943]
    contentHash: TBD-on-commit
    note: "Migration helpers, exclusion list, dry-run manifest builder, and write-mode guard."
  - kind: lines
    path: archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest.dry-run.json
    range: [1, 40]
    contentHash: TBD-on-commit
    note: "Dry-run manifest with summary counters and rename rows."
---

## Verdict

`pass-with-conditions`. The implement slice encodes the timestamp naming
policy as a compliance descriptor, three Spec Contracts at `severity: block`,
and an audited migration tool with a green dry-run manifest, while keeping
write-mode behind `PANCREATOR_MIGRATION_GO=1`. Three `warn`-class findings
remain advisory and SHALL clear before the migration write commit.

## Touch-set conformance

| Path                                                                                                  | Op | In touch set? |
| ----------------------------------------------------------------------------------------------------- | -- | ------------- |
| `lib/internal/tests/compliance/timestamp-naming-conventions.yaml`                                                  | A  | yes           |
| `lib/memory/features/timestamp-naming-conventions/contracts/timestamp-naming.policy-descriptor.yaml`      | A  | yes           |
| `lib/memory/features/timestamp-naming-conventions/contracts/timestamp-naming.migration-precedence.yaml`   | A  | yes           |
| `lib/memory/features/timestamp-naming-conventions/contracts/timestamp-naming.reference-update-audit.yaml` | A  | yes           |
| `lib/internal/tools/migrate-timestamp-naming.mjs`                                                                  | A  | yes           |
| `lib/memory/handbook/inbox-lifecycle.md`                                                                  | M  | yes           |
| `lib/memory/features/timestamp-naming-conventions/index.json`                                             | M  | yes           |
| `lib/internal/tools/migrate-timestamp-naming.test.mjs`                                                             | A  | parent-ratified add #1 |
| `archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest.dry-run.json`                                   | A  | parent-ratified add #2 |
| `lib/memory/adr/0005-timestamp-naming-conventions.md`                                                     | A  | parent-ratified add #3 |
| `package.json`                                                                                        | M  | parent-ratified add #4 |
| `archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/adr-draft.md`                                                      | M  | annotated promotion stub (in feature workspace) |
| `archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/policy-compliance.json`                                            | M  | required policy-compliance gate artifact (AGENTS.md §5) |

The four parent-ratified additions match the coder's return message exactly.
Citation: `{kind: lines, path: archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/touch-set.json, range: [1, 130], contentHash: TBD-on-commit}`.

The undelivered touch-set operations (`migrate-in-scope-work-paths`,
`migrate-in-scope-inbox-paths`, three `update-migrated-path-references`
entries) MUST run during the post-supervisor migration commit. The plan and
ADR document the implement-vs-write split. Citation:
`{kind: lines, path: lib/memory/adr/0005-timestamp-naming-conventions.md, range: [54, 60], contentHash: TBD-on-commit}`.

## Acceptance-criteria coverage

| Spec clause (spec.md line)        | Coverage source                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------- |
| UTC time zone (54-55)             | ADR 0005 §Decision; migration helpers operate on UTC parts                       |
| FDS = 2500-01-01 (56-57)          | `FDS_UTC_MS` constant; `daysToFds: FDS calendar day yields 0` test               |
| SID = 86400 (58-59)               | `SID_SECONDS` constant; `secondsRemainingInDay: 00:00:00 UTC yields SID` test    |
| Work day + task scope (60-61)     | `listFlatWorkTasks` enumeration; compliance descriptor scope artifacts           |
| Inbox in/out/threads/archive (62-64) | `listInboxFiles` enumeration; compliance descriptor scope                     |
| `work/*/run.log.jsonl` excluded (65-66) | `isExcludedFromMigration` check on `/run.log.jsonl`                         |
| Day directory days-to-FDS prefix (67-68) | `daysToFds` + `pad6`; `migrateTargetForWorkPath` snapshot test            |
| Day directory MM-DD-YY suffix (69-70) | `mmDdYySuffix` helper; snapshot test regex                                  |
| Task subdir SID prefix (71-72)    | `secondsRemainingInDay`; snapshot regex `\d+_HHMM_slug`                          |
| Task subdir HHMM token (73-74)    | `hhmm`; `hhmm: pads hours and minutes` test                                      |
| Task subdir semantic suffix (75-76) | `migrateTargetForWorkPath` slug assignment                                     |
| Inbox out basename shape (77-79)  | `migrateTargetForInboxPath` (no out-specific test; thread test exercises shape)  |
| Inbox threads basename shape (80-82) | `migrateTargetForInboxPath: snapshot for thread round file`                   |
| Threads parent preserved (83-84)  | `migrateTargetForInboxPath` parent-path test                                     |
| Agent prefixes lib/inbox/in human items (85-87) | `lib/memory/handbook/inbox-lifecycle.md` §3c                               |
| Agent prefixes lib/inbox/threads human items (88-90) | `lib/memory/handbook/inbox-lifecycle.md` §3c                          |
| Collision counter inserted (91-93) | `applyCollisionCounter` + 3 collision tests                                     |
| Newest collision starts at 0 (94-95) | `applyCollisionCounter: 2 collisions assign 0 then 1 to newer-first`          |
| Counters increment by 1 (96-97)   | `applyCollisionCounter: 3 collisions use 0,1,2`                                  |
| HHMM tie-break via SID (98-100)   | SID-prefix encoding in `buildBasename`                                           |
| Cross-day artifacts under start-day (101-103) | `chooseTimestamp` git-oldest-add precedence; ADR 0005 §Decision      |
| Migrate threads round files (104-105) | `listInboxFiles` walks `lib/inbox/threads/<feature>/`; manifest contains them    |
| Update reference artifacts (106-107) | `inventoryReferences` + reference-update-audit Spec Contract                  |
| Update documentation artifacts (108-109) | `inventoryReferences` + reference-update-audit Spec Contract              |
| Update inbox-lifecycle.md (110-112) | `lib/memory/handbook/inbox-lifecycle.md` §3c (new section)                         |

Every acceptance clause maps to at least one executable surface or
descriptor. Citation:
`{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [54, 112], contentHash: TBD-on-commit}`.

## Layer-1 lint findings

| # | Severity | Citation                                                                                                                                     | Issue                                                                                                                                                   | Suggested fix                                                                                                              |
| - | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| L1 | warn    | `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/contracts/timestamp-naming.migration-precedence.yaml, range: [16, 20], contentHash: TBD-on-commit}` | The reference cites `lib/internal/tools/migrate-timestamp-naming.mjs` line range `[1, 120]` while the `chooseTimestamp` symbol resides at lines `173-193`. The cited range MUST cover the named symbol per PRD §4.6 dual-anchor rule. | Update the range to `[164, 195]` so the citation covers `chooseTimestamp`'s declaration and body.                          |
| L2 | warn    | `{kind: lines, path: lib/memory/handbook/inbox-lifecycle.md, range: [48, 52], contentHash: TBD-on-commit}` | The new §3c reference entry uses `contentHash: TBD-on-commit` while the surrounding entries already carry sha256 hashes; mixed discipline in one frontmatter block weakens Layer-1 audit. | Refresh `contentHash` for the §3c reference during the post-commit hash-refresh pass, or hold the dogfood pattern by tagging all entries `TBD-on-commit` until librarian indexing. |
| L3 | info    | `{kind: lines, path: lib/internal/tools/migrate-timestamp-naming.mjs, range: [305, 409], contentHash: TBD-on-commit}` | `inventoryReferences` scans `work/` including the dry-run manifest itself, so re-running with `--strict-references` inflates `referenceUpdateRows` (committed: 451; second run: 1700) because the manifest text contains every legacy path token it plans to rewrite. | Either exclude `archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest*.json` from `inventoryReferences` scan roots, or regenerate the dry-run manifest immediately before the write-mode commit so counters track reality. |
| L4 | info    | `{kind: lines, path: lib/memory/features/timestamp-naming-conventions/spec.md, range: [65, 66], contentHash: TBD-on-commit}` | The spec keeps `work/*/run.log.jsonl` out of naming-policy scope; the migration preserves its basename but moves the file when the parent task directory renames. The behaviour matches the spec ("not renamed" reads as "basename preserved"), but the delivery report SHOULD make the path-vs-basename distinction explicit. | Tech-writer documents the basename-preservation guarantee in the delivery report.                                          |

The four contract YAMLs, ADR 0005, the inbox-lifecycle §3c addition, plan
verification clauses, and the migration-script header docs use RFC 2119
keywords, EARS templates, atomic clauses, active voice, present tense,
glossary-resolved nouns, and quantified numerics. No weasel-word violations
surfaced.

## Spec Contracts execution

| `clause.id`                                   | kind  | severity | result                       | runner output / evidence                                                                                          |
| --------------------------------------------- | ----- | -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pancreator.features.timestamp_naming.policy_descriptor`     | tests | block    | deferred-runner-not-wired (structural pass) | Compliance descriptor parses and lists `structure-change` + `operator-on-demand`; no rego/llm-judge runner panel wired in this slice. Citation: `{kind: lines, path: lib/internal/tests/compliance/timestamp-naming-conventions.yaml, range: [1, 18], contentHash: TBD-on-commit}`. |
| `pancreator.features.timestamp_naming.migration_precedence` | tests | block    | deferred-runner-not-wired (test pass)        | `pnpm migration:test` exercises four `chooseTimestamp` precedence cases (git, frontmatter, mtime, override) and exits 18/18 green. Citation: `{kind: lines, path: lib/internal/tools/migrate-timestamp-naming.test.mjs, range: [115, 152], contentHash: TBD-on-commit}`. |
| `pancreator.features.timestamp_naming.reference_update_audit` | tests | block    | deferred-runner-not-wired (script pass)      | `node lib/internal/tools/migrate-timestamp-naming.mjs --dry-run --strict-references` returns exit 0 with `strictReferenceAudit.staleRows: []`. Citation: `{kind: lines, path: lib/internal/tools/migrate-timestamp-naming.mjs, range: [789, 818], contentHash: TBD-on-commit}`. |

The contract-runner panel (`@pancreator/contract-runner-llm-judge` and
`@pancreator/contract-runner-rego`) is not wired against per-feature
Spec Contracts in this dogfood slice, so each row records
`deferred-runner-not-wired` plus the manual structural or executable
evidence reviewed.

## Migration safety properties

| # | Property                                                                                              | Result | Citation                                                                                                  |
| - | ----------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| P1 | The intake directive and operator response NEVER appear as rename candidates.                        | pass   | `{kind: lines, path: lib/internal/tools/migrate-timestamp-naming.mjs, range: [433, 457], contentHash: TBD-on-commit}` (`EXCLUDED_SOURCES` set + `isExcludedFromMigration`)                                                                                                                                                                                                                                                                                       |
| P2 | `work/*/run.log.jsonl` NEVER receives a rename plan; basename SHALL stay `run.log.jsonl`.            | pass   | `{kind: lines, path: lib/internal/tools/migrate-timestamp-naming.mjs, range: [449, 456], contentHash: TBD-on-commit}` (`/run.log.jsonl` short-circuits inclusion); manifest spot-check confirms zero file-level rename rows for `run.log.jsonl`.                                                                                                                                                                                                                  |
| P3 | Write mode requires `PANCREATOR_MIGRATION_GO=1` AND `--write`.                                        | pass   | `{kind: lines, path: lib/internal/tools/migrate-timestamp-naming.mjs, range: [896, 921], contentHash: TBD-on-commit}` (env-var guard with stderr message and non-zero exit when missing)                                                                                                                                                                                                                                                                          |
| P4 | `--strict-references` audit fails loudly (non-zero exit) when uncovered legacy hits exist.           | pass   | `{kind: lines, path: lib/internal/tools/migrate-timestamp-naming.mjs, range: [789, 938], contentHash: TBD-on-commit}` (`stale.length > 0` -> `console.error` + `process.exitCode = 1`)                                                                                                                                                                                                                                                                            |
| P5 | Existing day-directory paths matching `^\d{6}_\d{2}-\d{2}-\d{2}$` are skipped on re-run.             | pass   | `{kind: lines, path: lib/internal/tools/migrate-timestamp-naming.mjs, range: [463, 483], contentHash: TBD-on-commit}` (`isDayDirectoryName` guard inside `listFlatWorkTasks`)                                                                                                                                                                                                                                                                                     |

## Dry-run sanity spot checks

Five entries sampled with `random.seed(42)`:

| # | Source                                                            | UTC instant                | days→FDS | MM-DD-YY  | SID prefix | HHMM | Slug                                              | Manifest target                                                                            | Status |
| - | ----------------------------------------------------------------- | -------------------------- | -------- | --------- | ---------- | ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| 1 | `archive/work/173010_04-26-26/23777_1723_policy-compliance-gate-2026-04-26/`                         | 2026-04-26T17:23:43Z      | 173010   | 04-26-26  | 23777      | 1723 | `policy-compliance-gate-2026-04-26`               | `archive/work/173010_04-26-26/23777_1723_policy-compliance-gate-2026-04-26/`                       | pass   |
| 2 | `archive/work/173009_04-27-26/51356_0944_bootstrap-phase-4-pipeline-roster/`                         | 2026-04-27T09:44:04Z      | 173009   | 04-27-26  | 51356      | 0944 | `bootstrap-phase-4-pipeline-roster`               | `archive/work/173009_04-27-26/51356_0944_bootstrap-phase-4-pipeline-roster/`                       | pass   |
| 3 | `archive/work/173009_04-27-26/55075_0842_pancreator-worktree-env-isolation-impl/`                     | 2026-04-27T08:42:05Z      | 173009   | 04-27-26  | 55075      | 0842 | `pancreator-worktree-env-isolation-impl`           | `archive/work/173009_04-27-26/55075_0842_pancreator-worktree-env-isolation-impl/`                   | pass   |
| 4 | `archive/work/173009_04-27-26/55309_0838_pancreator-persona-pipeline-runner-impl/`                    | 2026-04-27T08:38:11Z      | 173009   | 04-27-26  | 55309      | 0838 | `pancreator-persona-pipeline-runner-impl`          | `archive/work/173009_04-27-26/55309_0838_pancreator-persona-pipeline-runner-impl/`                  | pass   |
| 5 | `archive/work/173009_04-27-26/55884_0828_pancreator-observability-impl/`                              | 2026-04-27T08:28:36Z      | 173009   | 04-27-26  | 55884      | 0828 | `pancreator-observability-impl`                    | `archive/work/173009_04-27-26/55884_0828_pancreator-observability-impl/`                            | pass   |

Independent re-derivation (`days = floor((FDS_UTC - day_start_UTC) / 86400)`,
`SID_prefix = 86400 - (h*3600 + m*60 + s)`, `HHMM = pad2(h)+pad2(m)`)
matches every manifest target byte-for-byte.

Manifest-wide structural sweep across all 35 rows: every `work-task-dir`
target matches `^work/\d{6}_\d{2}-\d{2}-\d{2}/\d+_\d{4}_[a-z0-9-]+/$`; every
`inbox-file` target matches the inbox basename regex; zero duplicate targets;
`summary.collisionWarnings: 0` matches the empty `collisions` list and is
consistent with the absence of duplicate basename groups across the 19 work
tasks and 16 inbox files. Citation:
`{kind: lines, path: archive/work/173009_04-27-26/50991_0950_timestamp-naming-conventions/migration-manifest.dry-run.json, range: [1, 11], contentHash: TBD-on-commit}`.

## Reference-update audit

`node lib/internal/tools/migrate-timestamp-naming.mjs --dry-run --strict-references` exits
`0`. The strict audit reports `strictReferenceAudit.staleRows: []` (zero
uncovered legacy references). Re-running the dry-run inflates
`referenceUpdateRows` from 451 to 1700 because `inventoryReferences` scans
the dry-run manifest file itself; finding L3 documents the
self-amplification effect and the recommended scan-root carveout or
regenerate-before-write workaround.

## Verification gates

| Gate                       | Command                                                              | Result | Notes                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck                  | `pnpm typecheck`                                                     | pass   | `tsc -p tsconfig.base.json` exits 0 in 0.97s.                                                                                                                    |
| lint                       | `pnpm lint`                                                          | pass   | `eslint .` exits 0 in 0.94s; `tools/*.mjs` excluded by ignore globs per the migration script's file-header note.                                                 |
| phase-0a scaffold          | `pnpm run check:phase0a`                                             | pass   | `node lib/internal/tools/check-phase-0a-scaffold.mjs` exits 0.                                                                                                                |
| migration tests            | `pnpm migration:test`                                                | pass   | `node --test lib/internal/tools/migrate-timestamp-naming.test.mjs` reports `# pass 18 / # fail 0`.                                                                            |
| package tests              | `pnpm -r run test`                                                   | pass   | All workspaces (vitest + node:test) report green; no regressions vs implement-stage commit.                                                                      |
| migration dry-run + strict | `node lib/internal/tools/migrate-timestamp-naming.mjs --dry-run --strict-references` | pass   | Exit 0; `staleRows: []`; basename derivations match independent re-derivation for all 5 sampled rows and the 35-row structural sweep.                            |

Coverage delta: the implement slice introduces 18 new node:test cases under
`lib/internal/tools/migrate-timestamp-naming.test.mjs` covering FDS rollover, SID
boundaries, HHMM padding, collision counters at depths 2/3/5,
`chooseTimestamp` precedence, and the `migrate*` snapshot shapes. Every
helper that the migration manifest depends on has at least one boundary
test. The Spec Contracts and the compliance descriptor cover the policy
surfaces beyond the helpers; runner-panel wiring remains future work.

## Findings

1. `[warn]` Citation range mismatch in
   `lib/memory/features/timestamp-naming-conventions/contracts/timestamp-naming.migration-precedence.yaml`
   (see L1).
2. `[warn]` Mixed `contentHash` discipline in
   `lib/memory/handbook/inbox-lifecycle.md` references frontmatter (see L2).
3. `[info]` `inventoryReferences` scans the dry-run manifest itself,
   producing self-amplifying counts on re-run; recommend scan-root carveout
   or regenerate-before-write (see L3).
4. `[info]` Tech-writer SHOULD note the `run.log.jsonl` basename-preservation
   guarantee explicitly in the delivery report (see L4).
5. `[info]` Migration write-mode (`--write` under `PANCREATOR_MIGRATION_GO=1`)
   remains intentionally deferred to a post-supervisor commit; supervisor
   ratifies the write run from a quiescent repository state per ADR 0005.
6. `[info]` Spec Contract runner-panel wiring is deferred at the substrate
   level; review treats per-clause structural/test/script evidence as the
   gate-passing surrogate for this slice and routes the wiring task to the
   contract-runner-llm-judge backlog.

No `block` findings.

## Recommended next step

Dispatch `tech-writer` for the report stage. Tech-writer SHOULD incorporate
findings L1–L4 into the Delivery Report's Verification and Open Items
sections, and SHOULD reference the `block`-class properties P1–P5 as
evidence of safe-write readiness. The supervisor SHALL run the migration
write-mode commit only after tech-writer reports and human ratification.
