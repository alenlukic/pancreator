# Ship validation report

Generated at: 2026-05-14T16:43:32Z

## node --test tests/*.test.mjs
TAP version 13
# Subtest: every ignore pattern line compiles to a matcher function
ok 1 - every ignore pattern line compiles to a matcher function
  ---
  duration_ms: 1.012083
  ...
# Subtest: classifyExclusiveTier separates handbook, active work, archival, durable JSON, internal source
ok 2 - classifyExclusiveTier separates handbook, active work, archival, durable JSON, internal source
  ---
  duration_ms: 0.476583
  ...
# Subtest: posixRel normalizes slashes
ok 3 - posixRel normalizes slashes
  ---
  duration_ms: 0.043417
  ...
# Subtest: tier char sums reconcile with total corpus and indexable partitioning
ok 4 - tier char sums reconcile with total corpus and indexable partitioning
  ---
  duration_ms: 31.286875
  ...
# Subtest: indexing policy excludes archival, full specs, and agent projections while keeping compact routes
ok 5 - indexing policy excludes archival, full specs, and agent projections while keeping compact routes
  ---
  duration_ms: 0.261709
  ...
# Subtest: CLI exits zero with eight tiers and aggregate labels
ok 6 - CLI exits zero with eight tiers and aggregate labels
  ---
  duration_ms: 103.837792
  ...
# Subtest: Cursor subagent projections expose standard and complex tiers
ok 7 - Cursor subagent projections expose standard and complex tiers
  ---
  duration_ms: 0.851833
  ...
# Subtest: persona and Cursor agent frontmatter avoids inline maxTurns comments
ok 8 - persona and Cursor agent frontmatter avoids inline maxTurns comments
  ---
  duration_ms: 1.021208
  ...
# fatal: not a git repository (or any of the parent directories): .git
# fatal: not a git repository (or any of the parent directories): .git
# fatal: not a git repository (or any of the parent directories): .git
# fatal: not a git repository (or any of the parent directories): .git
# Subtest: stemHasTimestampPrefix: detects SID_HHMM_ prefix
ok 9 - stemHasTimestampPrefix: detects SID_HHMM_ prefix
  ---
  duration_ms: 0.430792
  ...
# Subtest: parseFrontmatterFeatureId: reads feature_id
ok 10 - parseFrontmatterFeatureId: reads feature_id
  ---
  duration_ms: 0.125292
  ...
# Subtest: slugFeatureId: normalizes slug
ok 11 - slugFeatureId: normalizes slug
  ---
  duration_ms: 0.098291
  ...
# Subtest: planInboxConventionMigration: nested target shape for flat inbox/in file
ok 12 - planInboxConventionMigration: nested target shape for flat inbox/in file
  ---
  duration_ms: 8.212958
  ...
# Subtest: planInboxConventionMigration: thread file loses feature-dir primary locator
ok 13 - planInboxConventionMigration: thread file loses feature-dir primary locator
  ---
  duration_ms: 6.763209
  ...
# Subtest: planInboxConventionMigration: idempotent basename keeps SID_HHMM_ leaf
ok 14 - planInboxConventionMigration: idempotent basename keeps SID_HHMM_ leaf
  ---
  duration_ms: 6.817459
  ...
# Subtest: isMigratedThreadTaskSegment: matches work-style task directory token
ok 15 - isMigratedThreadTaskSegment: matches work-style task directory token
  ---
  duration_ms: 0.060458
  ...
# Subtest: planInboxConventionMigration: thread file in nested legacy subdirectory
ok 16 - planInboxConventionMigration: thread file in nested legacy subdirectory
  ---
  duration_ms: 6.063125
  ...
# Subtest: listLegacyInboxArtifactRows: skips migrated day/task subtrees under legacy feature
ok 17 - listLegacyInboxArtifactRows: skips migrated day/task subtrees under legacy feature
  ---
  duration_ms: 1.913583
  ...
# Subtest: listLegacyInboxArtifactRows: real repo returns sorted rows
ok 18 - listLegacyInboxArtifactRows: real repo returns sorted rows
  ---
  duration_ms: 5.899458
  ...
# Subtest: daysToFds: FDS calendar day yields 0
ok 19 - daysToFds: FDS calendar day yields 0
  ---
  duration_ms: 0.4295
  ...
# Subtest: daysToFds: day before FDS yields 1
ok 20 - daysToFds: day before FDS yields 1
  ---
  duration_ms: 0.110208
  ...
# Subtest: daysToFds: day after FDS throws (operator-deferred rollover)
ok 21 - daysToFds: day after FDS throws (operator-deferred rollover)
  ---
  duration_ms: 0.176417
  ...
# Subtest: daysToFds: today before FDS is strictly positive
ok 22 - daysToFds: today before FDS is strictly positive
  ---
  duration_ms: 0.059792
  ...
# Subtest: secondsRemainingInDay: 00:00:00 UTC yields SID
ok 23 - secondsRemainingInDay: 00:00:00 UTC yields SID
  ---
  duration_ms: 0.057708
  ...
# Subtest: secondsRemainingInDay: 23:59:59 UTC yields 1
ok 24 - secondsRemainingInDay: 23:59:59 UTC yields 1
  ---
  duration_ms: 0.039
  ...
# Subtest: secondsRemainingInDayFromParts: 23:59:60 leap-second edge yields 0
ok 25 - secondsRemainingInDayFromParts: 23:59:60 leap-second edge yields 0
  ---
  duration_ms: 0.041375
  ...
# Subtest: hhmm: pads hours and minutes
ok 26 - hhmm: pads hours and minutes
  ---
  duration_ms: 0.045125
  ...
# Subtest: applyCollisionCounter: 2 collisions assign 0 then 1 to newer-first
ok 27 - applyCollisionCounter: 2 collisions assign 0 then 1 to newer-first
  ---
  duration_ms: 0.261333
  ...
# Subtest: applyCollisionCounter: 3 collisions use 0,1,2
ok 28 - applyCollisionCounter: 3 collisions use 0,1,2
  ---
  duration_ms: 0.48975
  ...
# Subtest: applyCollisionCounter: 5 collisions use 0 through 4
ok 29 - applyCollisionCounter: 5 collisions use 0 through 4
  ---
  duration_ms: 0.118375
  ...
# Subtest: chooseTimestamp: git rung wins over frontmatter
ok 30 - chooseTimestamp: git rung wins over frontmatter
  ---
  duration_ms: 0.057125
  ...
# Subtest: chooseTimestamp: frontmatter when git absent
ok 31 - chooseTimestamp: frontmatter when git absent
  ---
  duration_ms: 0.871125
  ...
# Subtest: chooseTimestamp: mtime when git and frontmatter absent
ok 32 - chooseTimestamp: mtime when git and frontmatter absent
  ---
  duration_ms: 0.06
  ...
# Subtest: chooseTimestamp: operator override replaces mtime (last precedence rung)
ok 33 - chooseTimestamp: operator override replaces mtime (last precedence rung)
  ---
  duration_ms: 0.052333
  ...
# Subtest: migrateTargetForWorkPath: snapshot shape for flat work task
ok 34 - migrateTargetForWorkPath: snapshot shape for flat work task
  ---
  duration_ms: 0.177208
  ...
# Subtest: migrateTargetForInboxPath: snapshot for thread round file
ok 35 - migrateTargetForInboxPath: snapshot for thread round file
  ---
  duration_ms: 0.5345
  ...
# Subtest: inventoryReferences: finds a known path string in repo
ok 36 - inventoryReferences: finds a known path string in repo
  ---
  duration_ms: 12.145416
  ...
# Subtest: operator-facing root keeps implementation under internal while tests and docs stay at root
ok 37 - operator-facing root keeps implementation under internal while tests and docs stay at root
  ---
  duration_ms: 0.654417
  ...
# Subtest: pancreator.yaml tracks live bootstrap state and embedded project root
ok 38 - pancreator.yaml tracks live bootstrap state and embedded project root
  ---
  duration_ms: 0.355125
  ...
# Subtest: configuration docs route project_root through adopter and handbook
ok 39 - configuration docs route project_root through adopter and handbook
  ---
  duration_ms: 0.241125
  ...
# Subtest: archived work day-directory prefixes match days from UTC day to Jan 1 2500
ok 40 - archived work day-directory prefixes match days from UTC day to Jan 1 2500
  ---
  duration_ms: 0.201125
  ...
# Subtest: active work day directories use canonical days-to-FDS prefixes
ok 41 - active work day directories use canonical days-to-FDS prefixes
  ---
  duration_ms: 0.301958
  ...
# Subtest: planning/execution handoff contract is represented across active memory, pipeline, and personas
ok 42 - planning/execution handoff contract is represented across active memory, pipeline, and personas
  ---
  duration_ms: 0.297875
  ...
# Subtest: workspace, scripts, and workflow use conventional test and docs paths
ok 43 - workspace, scripts, and workflow use conventional test and docs paths
  ---
  duration_ms: 0.224333
  ...
# Subtest: Cursor indexing excludes active and archived work by default
ok 44 - Cursor indexing excludes active and archived work by default
  ---
  duration_ms: 0.178208
  ...
# Subtest: librarian owns completed work archival maintenance
ok 45 - librarian owns completed work archival maintenance
  ---
  duration_ms: 0.288666
  ...
# Subtest: live normative surfaces use three-level work placeholders
ok 46 - live normative surfaces use three-level work placeholders
  ---
  duration_ms: 3702.455625
  ...
# Subtest: policy-compliance hook accepts only canonical three-level artifacts
ok 47 - policy-compliance hook accepts only canonical three-level artifacts
  ---
  duration_ms: 0.1625
  ...
# Subtest: Cursor implementation rules avoid broad src-wide activation
ok 48 - Cursor implementation rules avoid broad src-wide activation
  ---
  duration_ms: 0.107083
  ...
1..48
# tests 48
# suites 0
# pass 48
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3744.467125

## check-phase-0a-scaffold

## context-budget-report
Context budget report (approximate chars; estimated tokens ~ ceil(chars/4), labeled rough, not tokenizer output)

Root: /Users/alen/Dev/pancreator

Tier group                           files     chars          est_tokens~(rough)
------------------------------------ --------- -------------- ----------------------
active memory                        4         9397           ~2350 (chars/4)
  scope: `src/memory/active/**`
active work                          24        255658         ~63915 (chars/4)
  scope: `src/work/**`
durable memory                       142       301364         ~75341 (chars/4)
  scope: `src/memory/features/**`, `src/memory/adr/**`, `src/memory/backlog/**`
archival memory                      91        412431         ~103108 (chars/4)
  scope: `src/internal/work_archive/**`, `src/inbox/out/**`, `src/inbox/archive/**`, `src/inbox/threads/**`
internal operating content           92        470790         ~117698 (chars/4)
  scope: `src/memory/handbook/**`, `src/personas/**`, `src/skills/**`, `.cursor/rules/**`, `.cursor/agents/**`
product context                      5         163022         ~40756 (chars/4)
  scope: `docs/PRD.md`, `docs/PRD.summary.md`, `docs/PRD.index.md`, `docs/M1.index.md`, `docs/BOOTSTRAP.md`
source code & tests                  218       373522         ~93381 (chars/4)
  scope: `src/internal/packages/**`, `src/internal/tools/**`, `tests/**`
generated machine artifacts          37        850506         ~212627 (chars/4)
  scope: JSON manifests, `.dry-run|.write|.post-write.json`, `src/memory/**`/index/report JSON, lockfile
(unclassified)                       29        124671         ~31168 (chars/4)
  scope: paths outside the eight groups

Approximate aggregates (sums use every scanned text file once)
  total corpus:              files=642 chars=2961361 est_tokens~(rough)~740341 (chars/4)
  active memory footprint:   files=4 chars=9397 est_tokens~(rough)~2350 (chars/4)
  indexable default context: files=395 chars=814486 est_tokens~(rough)~203622 (chars/4)
    (approx. Cursor semantic indexing set per lines in .cursorindexingignore at repo root)
  explicit-read-only corpus: files=247 chars=2146875 est_tokens~(rough)~536719 (chars/4)
    (files matching .cursorindexingignore; still reachable via explicit reads)

Cursor subagent projections (explicit-read/default-excluded)

  aliases:   files=12 chars=34591 est_tokens~(rough)~8648 (chars/4)
  standard:  files=12 chars=33990 est_tokens~(rough)~8498 (chars/4)
  complex:   files=12 chars=34919 est_tokens~(rough)~8730 (chars/4)
  all:       files=36 chars=103500 est_tokens~(rough)~25875 (chars/4)

Legacy single-path slices (for diffing older reports)

Legacy: Whole repo scan (every text file under root)
  files=642 chars=2964042 est_tokens~(rough)~741011 (chars/4)

Active work slice: src/work/**
  files=24 chars=258455 est_tokens~(rough)~64614 (chars/4)

Archived work slice: src/internal/work_archive/**
  files=72 chars=876537 est_tokens~(rough)~219135 (chars/4)

Legacy slice: src/memory/**
  files=203 chars=635021 est_tokens~(rough)~158756 (chars/4)


## enforce-policy-compliance bash syntax

## node --check context-budget-report

## node --check migrate-timestamp-naming

## node --check repo-structure test
