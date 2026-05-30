# Test report

Generated at: 2026-05-14T07:58:14Z

## git status
 M .cursor/agents/reviewer-standard.md
 M lib/internal/tools/migrate-inbox-convention.mjs
M  work/172995_05-11-26/60722_0707_inbox-convention-migration/handoff.md
AM work/172995_05-11-26/60722_0707_inbox-convention-migration/next-prompt.md
MM work/172995_05-11-26/60722_0707_inbox-convention-migration/run.log.jsonl
A  work/172995_05-11-26/60722_0707_inbox-convention-migration/state-repair.md
MM work/172995_05-11-26/60722_0707_inbox-convention-migration/state.json
 M tests/migrate-inbox-convention.test.mjs
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/branch.diff
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/diff-stat.txt
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/must-fix-coder-prompt.md
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/review.failed-before-mustfix.md
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/review.md
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/reviewer-rerun-prompt.md
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/staged-touch-set.txt
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/staged.diff
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/test-report.md
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/touch-set.txt
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/worktree-touch-set.txt
?? work/172995_05-11-26/60722_0707_inbox-convention-migration/worktree.diff

## node --test tests/*.test.mjs
TAP version 13
# Subtest: every ignore pattern line compiles to a matcher function
ok 1 - every ignore pattern line compiles to a matcher function
  ---
  duration_ms: 0.723875
  ...
# Subtest: classifyExclusiveTier separates handbook, active work, archival, durable JSON, internal source
ok 2 - classifyExclusiveTier separates handbook, active work, archival, durable JSON, internal source
  ---
  duration_ms: 0.500292
  ...
# Subtest: posixRel normalizes slashes
ok 3 - posixRel normalizes slashes
  ---
  duration_ms: 0.047708
  ...
# Subtest: tier char sums reconcile with total corpus and indexable partitioning
ok 4 - tier char sums reconcile with total corpus and indexable partitioning
  ---
  duration_ms: 30.204792
  ...
# Subtest: indexing policy excludes archival, full specs, and agent projections while keeping compact routes
ok 5 - indexing policy excludes archival, full specs, and agent projections while keeping compact routes
  ---
  duration_ms: 0.265583
  ...
# Subtest: CLI exits zero with eight tiers and aggregate labels
ok 6 - CLI exits zero with eight tiers and aggregate labels
  ---
  duration_ms: 108.49275
  ...
# Subtest: Cursor subagent projections expose standard and complex tiers
ok 7 - Cursor subagent projections expose standard and complex tiers
  ---
  duration_ms: 0.843875
  ...
# Subtest: persona and Cursor agent frontmatter avoids inline maxTurns comments
ok 8 - persona and Cursor agent frontmatter avoids inline maxTurns comments
  ---
  duration_ms: 1.108125
  ...
# fatal: not a git repository (or any of the parent directories): .git
# fatal: not a git repository (or any of the parent directories): .git
# fatal: not a git repository (or any of the parent directories): .git
# fatal: not a git repository (or any of the parent directories): .git
# Subtest: stemHasTimestampPrefix: detects SID_HHMM_ prefix
ok 9 - stemHasTimestampPrefix: detects SID_HHMM_ prefix
  ---
  duration_ms: 0.455167
  ...
# Subtest: parseFrontmatterFeatureId: reads feature_id
ok 10 - parseFrontmatterFeatureId: reads feature_id
  ---
  duration_ms: 0.124125
  ...
# Subtest: slugFeatureId: normalizes slug
ok 11 - slugFeatureId: normalizes slug
  ---
  duration_ms: 0.09425
  ...
# Subtest: planInboxConventionMigration: nested target shape for flat inbox/in file
ok 12 - planInboxConventionMigration: nested target shape for flat inbox/in file
  ---
  duration_ms: 8.191917
  ...
# Subtest: planInboxConventionMigration: thread file loses feature-dir primary locator
ok 13 - planInboxConventionMigration: thread file loses feature-dir primary locator
  ---
  duration_ms: 7.153667
  ...
# Subtest: planInboxConventionMigration: idempotent basename keeps SID_HHMM_ leaf
ok 14 - planInboxConventionMigration: idempotent basename keeps SID_HHMM_ leaf
  ---
  duration_ms: 6.051042
  ...
# Subtest: isMigratedThreadTaskSegment: matches work-style task directory token
ok 15 - isMigratedThreadTaskSegment: matches work-style task directory token
  ---
  duration_ms: 0.0675
  ...
# Subtest: planInboxConventionMigration: thread file in nested legacy subdirectory
ok 16 - planInboxConventionMigration: thread file in nested legacy subdirectory
  ---
  duration_ms: 6.125583
  ...
# Subtest: listLegacyInboxArtifactRows: skips migrated day/task subtrees under legacy feature
ok 17 - listLegacyInboxArtifactRows: skips migrated day/task subtrees under legacy feature
  ---
  duration_ms: 1.769125
  ...
# Subtest: listLegacyInboxArtifactRows: real repo returns sorted rows
ok 18 - listLegacyInboxArtifactRows: real repo returns sorted rows
  ---
  duration_ms: 6.276375
  ...
# Subtest: daysToFds: FDS calendar day yields 0
ok 19 - daysToFds: FDS calendar day yields 0
  ---
  duration_ms: 0.497833
  ...
# Subtest: daysToFds: day before FDS yields 1
ok 20 - daysToFds: day before FDS yields 1
  ---
  duration_ms: 0.102125
  ...
# Subtest: daysToFds: day after FDS throws (operator-deferred rollover)
ok 21 - daysToFds: day after FDS throws (operator-deferred rollover)
  ---
  duration_ms: 0.173709
  ...
# Subtest: daysToFds: today before FDS is strictly positive
ok 22 - daysToFds: today before FDS is strictly positive
  ---
  duration_ms: 0.058125
  ...
# Subtest: secondsRemainingInDay: 00:00:00 UTC yields SID
ok 23 - secondsRemainingInDay: 00:00:00 UTC yields SID
  ---
  duration_ms: 0.057209
  ...
# Subtest: secondsRemainingInDay: 23:59:59 UTC yields 1
ok 24 - secondsRemainingInDay: 23:59:59 UTC yields 1
  ---
  duration_ms: 0.038459
  ...
# Subtest: secondsRemainingInDayFromParts: 23:59:60 leap-second edge yields 0
ok 25 - secondsRemainingInDayFromParts: 23:59:60 leap-second edge yields 0
  ---
  duration_ms: 0.031791
  ...
# Subtest: hhmm: pads hours and minutes
ok 26 - hhmm: pads hours and minutes
  ---
  duration_ms: 0.04175
  ...
# Subtest: applyCollisionCounter: 2 collisions assign 0 then 1 to newer-first
ok 27 - applyCollisionCounter: 2 collisions assign 0 then 1 to newer-first
  ---
  duration_ms: 0.260625
  ...
# Subtest: applyCollisionCounter: 3 collisions use 0,1,2
ok 28 - applyCollisionCounter: 3 collisions use 0,1,2
  ---
  duration_ms: 0.473958
  ...
# Subtest: applyCollisionCounter: 5 collisions use 0 through 4
ok 29 - applyCollisionCounter: 5 collisions use 0 through 4
  ---
  duration_ms: 0.11125
  ...
# Subtest: chooseTimestamp: git rung wins over frontmatter
ok 30 - chooseTimestamp: git rung wins over frontmatter
  ---
  duration_ms: 0.058
  ...
# Subtest: chooseTimestamp: frontmatter when git absent
ok 31 - chooseTimestamp: frontmatter when git absent
  ---
  duration_ms: 0.857084
  ...
# Subtest: chooseTimestamp: mtime when git and frontmatter absent
ok 32 - chooseTimestamp: mtime when git and frontmatter absent
  ---
  duration_ms: 0.084875
  ...
# Subtest: chooseTimestamp: operator override replaces mtime (last precedence rung)
ok 33 - chooseTimestamp: operator override replaces mtime (last precedence rung)
  ---
  duration_ms: 0.048709
  ...
# Subtest: migrateTargetForWorkPath: snapshot shape for flat work task
ok 34 - migrateTargetForWorkPath: snapshot shape for flat work task
  ---
  duration_ms: 0.548792
  ...
# Subtest: migrateTargetForInboxPath: snapshot for thread round file
ok 35 - migrateTargetForInboxPath: snapshot for thread round file
  ---
  duration_ms: 0.104834
  ...
# Subtest: inventoryReferences: finds a known path string in repo
ok 36 - inventoryReferences: finds a known path string in repo
  ---
  duration_ms: 11.454375
  ...
# Subtest: operator-facing root keeps implementation under internal while tests and docs stay at root
ok 37 - operator-facing root keeps implementation under internal while tests and docs stay at root
  ---
  duration_ms: 0.861791
  ...
# Subtest: pancreator.yaml tracks live bootstrap state and embedded project root
ok 38 - pancreator.yaml tracks live bootstrap state and embedded project root
  ---
  duration_ms: 0.309584
  ...
# Subtest: configuration docs route project_root through adopter and handbook
ok 39 - configuration docs route project_root through adopter and handbook
  ---
  duration_ms: 0.218583
  ...
# Subtest: archived work day-directory prefixes match days from UTC day to Jan 1 2500
ok 40 - archived work day-directory prefixes match days from UTC day to Jan 1 2500
  ---
  duration_ms: 0.200459
  ...
# Subtest: active work day directories use canonical days-to-FDS prefixes
ok 41 - active work day directories use canonical days-to-FDS prefixes
  ---
  duration_ms: 0.2785
  ...
# Subtest: planning/execution handoff contract is represented across active memory, pipeline, and personas
ok 42 - planning/execution handoff contract is represented across active memory, pipeline, and personas
  ---
  duration_ms: 0.251333
  ...
# Subtest: workspace, scripts, and workflow use conventional test and docs paths
ok 43 - workspace, scripts, and workflow use conventional test and docs paths
  ---
  duration_ms: 0.193875
  ...
# Subtest: Cursor indexing excludes active and archived work by default
ok 44 - Cursor indexing excludes active and archived work by default
  ---
  duration_ms: 0.077833
  ...
# Subtest: librarian owns completed work archival maintenance
ok 45 - librarian owns completed work archival maintenance
  ---
  duration_ms: 0.230417
  ...
# Subtest: live normative surfaces use three-level work placeholders
ok 46 - live normative surfaces use three-level work placeholders
  ---
  duration_ms: 3637.020292
  ...
# Subtest: policy-compliance hook accepts only canonical three-level artifacts
ok 47 - policy-compliance hook accepts only canonical three-level artifacts
  ---
  duration_ms: 0.187
  ...
# Subtest: Cursor implementation rules avoid broad src-wide activation
ok 48 - Cursor implementation rules avoid broad src-wide activation
  ---
  duration_ms: 0.134959
  ...
1..48
# tests 48
# suites 0
# pass 48
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3681.805333

## check-phase-0a-scaffold
passed

## context-budget-report
Context budget report (approximate chars; estimated tokens ~ ceil(chars/4), labeled rough, not tokenizer output)

Root: /Users/alen/Dev/pancreator

Tier group                           files     chars          est_tokens~(rough)
------------------------------------ --------- -------------- ----------------------
active memory                        4         9397           ~2350 (chars/4)
  scope: `lib/memory/active/**`
active work                          23        245763         ~61441 (chars/4)
  scope: `work/**`
durable memory                       142       301364         ~75341 (chars/4)
  scope: `lib/memory/features/**`, `lib/memory/adr/**`, `lib/memory/backlog/**`
archival memory                      91        412431         ~103108 (chars/4)
  scope: `archive/work/**`, `lib/inbox/out/**`, `archive/inbox/**`, `lib/inbox/threads/**`
internal operating content           92        470799         ~117700 (chars/4)
  scope: `lib/memory/handbook/**`, `lib/personas/**`, `lib/personas/skills/**`, `.cursor/rules/**`, `.cursor/agents/**`
product context                      5         163022         ~40756 (chars/4)
  scope: `docs/PRD.md`, `docs/PRD.summary.md`, `docs/PRD.index.md`, `docs/M1.index.md`, `docs/BOOTSTRAP.md`
source code & tests                  218       373522         ~93381 (chars/4)
  scope: `lib/internal/packages/**`, `lib/internal/tools/**`, `tests/**`
generated machine artifacts          36        842980         ~210745 (chars/4)
  scope: JSON manifests, `.dry-run|.write|.post-write.json`, `lib/memory/**`/index/report JSON, lockfile
(unclassified)                       29        124671         ~31168 (chars/4)
  scope: paths outside the eight groups

Approximate aggregates (sums use every scanned text file once)
  total corpus:              files=640 chars=2943949 est_tokens~(rough)~735988 (chars/4)
  active memory footprint:   files=4 chars=9397 est_tokens~(rough)~2350 (chars/4)
  indexable default context: files=395 chars=814486 est_tokens~(rough)~203622 (chars/4)
    (approx. Cursor semantic indexing set per lines in .cursorindexingignore at repo root)
  explicit-read-only corpus: files=245 chars=2129463 est_tokens~(rough)~532366 (chars/4)
    (files matching .cursorindexingignore; still reachable via explicit reads)

Cursor subagent projections (explicit-read/default-excluded)

  aliases:   files=12 chars=34591 est_tokens~(rough)~8648 (chars/4)
  standard:  files=12 chars=33999 est_tokens~(rough)~8500 (chars/4)
  complex:   files=12 chars=34919 est_tokens~(rough)~8730 (chars/4)
  all:       files=36 chars=103509 est_tokens~(rough)~25878 (chars/4)

Legacy single-path slices (for diffing older reports)

Legacy: Whole repo scan (every text file under root)
  files=640 chars=2946630 est_tokens~(rough)~736658 (chars/4)

Active work slice: work/**
  files=23 chars=248560 est_tokens~(rough)~62140 (chars/4)

Archived work slice: archive/work/**
  files=72 chars=876537 est_tokens~(rough)~219135 (chars/4)

Legacy slice: lib/memory/**
  files=202 chars=627495 est_tokens~(rough)~156874 (chars/4)


## enforce-policy-compliance bash syntax
passed

## node --check context-budget-report
not run

## node --check migrate-timestamp-naming
not run

## node --check repo-structure test
not run
