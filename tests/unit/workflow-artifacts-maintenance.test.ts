import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  archiveWorkflowDirectories,
  finalizeWorkflowArtifacts,
  migrateRunSuffixes,
  maintainWorkflowRuntime,
  mutableRuntimeFiles,
  mutableRuntimeTraversalCount,
  standardizeRuntimeFileNames,
} from '../../src/lib/workflow-artifacts.js'
import { createTestTempDirectory } from '../temp.js'
import {
  write,
  writeEvents,
  writeInvocation,
  writeState,
  writeWorkflowSnapshot,
} from './workflow-artifacts-helpers.js'

test('workflow archive moves runs older than retention into archive directories', () => {
  const root = createTestTempDirectory('pancreator-archive-')
  const oldRunId = '63379_Jun-22-0158_5f354f23'
  const recentRunId = '63372_Jun-29-0158_6f354f23'

  const oldLogDirectory = path.join(root, 'runtime/logs/workflows', oldRunId)
  const oldStateDirectory = path.join(root, 'runtime/workflows', oldRunId)
  const tuneRecord = path.join(
    root,
    'runtime/tune-harness/records/archive-fixture.json',
  )

  writeState(root, oldRunId, 'succeeded')
  writeState(root, recentRunId, 'running', [], '2026-06-29T21:22:54.051Z')
  write(
    path.join(oldStateDirectory, 'modifications.jsonl'),
    `${JSON.stringify({
      path: `runtime/logs/workflows/${oldRunId}/state.json`,
    })}\n`,
  )
  write(
    path.join(oldLogDirectory, 'evidence', 'path.txt'),
    `runtime/workflows/${oldRunId}/modifications.jsonl\n`,
  )
  write(tuneRecord, '{"schema_version":1,"session_id":"x"}\n')
  const tuneRecordBefore = readFileSync(tuneRecord)

  const summary = archiveWorkflowDirectories(root, {
    retentionDays: 7,
    now: new Date('2026-07-01T22:00:00.000Z'),
  })

  assert.deepEqual(summary.run_ids, [oldRunId])
  assert.equal(summary.run_directories, 1)
  assert.equal(summary.state_directories, 1)
  assert.equal(existsSync(oldLogDirectory), false)
  assert.equal(existsSync(oldStateDirectory), false)
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/workflows/archive', oldRunId)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/workflows/archive', oldRunId)),
    true,
  )
  assert.ok(readFileSync(tuneRecord).equals(tuneRecordBefore))
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows', recentRunId, 'state.json'),
    ),
    true,
  )
  assert.match(
    readFileSync(
      path.join(
        root,
        'runtime/logs/workflows/archive',
        oldRunId,
        'evidence/path.txt',
      ),
      'utf8',
    ),
    /runtime\/workflows\/archive\//u,
  )

  assert.deepEqual(
    archiveWorkflowDirectories(root, {
      retentionDays: 7,
      now: new Date('2026-07-01T22:00:00.000Z'),
    }).run_ids,
    [],
  )
})

// `AUTO-001` lets a worker leave a task-specific script in the run's own
// directory, and nothing said who removes it. Finalization fires the moment a
// run closes, which is when an operator is still reading the record, so
// sweeping there would take evidence out from under the reader; leaving the
// scripts forever grows the runtime tree without bound.
test('retention sweeps run-local worker scripts and finalization keeps them', () => {
  const root = createTestTempDirectory('pancreator-scripts-')
  const runId = '63379_Jun-22-0158_5f354f23'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
  const script = path.join(runDirectory, 'scripts', 'check-delta.mjs')

  const invocationIds = ['plan-1-aaaaaaaa']

  writeWorkflowSnapshot(runDirectory)
  writeEvents(runDirectory, invocationIds)
  writeState(runDirectory, runId, 'succeeded', invocationIds)
  writeInvocation(runDirectory, runId, invocationIds[0], 0)
  write(script, "console.log('one-run helper')\n")

  finalizeWorkflowArtifacts(root, runId)

  assert.equal(
    existsSync(script),
    true,
    'the closing run keeps the script a reader may still need',
  )

  const summary = archiveWorkflowDirectories(root, {
    retentionDays: 7,
    now: new Date('2026-07-01T22:00:00.000Z'),
  })

  assert.deepEqual(summary.swept_script_run_ids, [runId])
  assert.equal(existsSync(script), false)
  // The sweep takes the scripts and nothing else: the rest of the run moves
  // into the archive intact.
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/archive', runId, 'scripts'),
    ),
    false,
  )
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/archive', runId, 'state.json'),
    ),
    true,
  )
})

test('runtime file names standardize onto the temporal prefix scheme', () => {
  const root = createTestTempDirectory('pan-names-')

  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-archive-utils.md'),
    '# File prefix standardization\n',
  )
  write(
    path.join(
      root,
      'runtime/inbox/queue/request-20260812T035755Z-worktree-management.md',
    ),
    'Manage worktrees.\n',
  )
  write(
    path.join(root, 'runtime/inbox/queue/request-20260810T054345Z-6df4ab84.md'),
    'Implement a best-of-n mode for the dev workflow.\n',
  )
  write(
    path.join(
      root,
      'runtime/pr-descriptions/20260803T165512Z-invocation-fixes-against-main.md',
    ),
    'PR body.\n',
  )
  write(
    path.join(root, 'runtime/logs/workflows/some-run/state.json'),
    `${JSON.stringify({
      request: {
        source_path: 'runtime/inbox/queue/2026-08-14-archive-utils.md',
      },
    })}\n`,
  )

  const summary = standardizeRuntimeFileNames(root)

  assert.equal(summary.renamed_files, 4)
  assert.equal(
    existsSync(
      path.join(root, 'runtime/inbox/queue/63326_Aug-14-0720_archive-utils.md'),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/inbox/queue/63328_Aug-12-1203_worktree-management.md',
      ),
    ),
    true,
  )
  // The opaque hex slug is replaced by keywords from the file content.
  assert.equal(
    existsSync(
      path.join(root, 'runtime/inbox/queue/63330_Aug-10-1097_implement-be.md'),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/pr-descriptions/63337_Aug-03-0425_invocation-fixes-against-main.md',
      ),
    ),
    true,
  )
  // Persisted references follow the rename.
  assert.match(
    readFileSync(
      path.join(root, 'runtime/logs/workflows/some-run/state.json'),
      'utf8',
    ),
    /runtime\/inbox\/queue\/63326_Aug-14-0720_archive-utils\.md/u,
  )
  // A second pass finds nothing left to standardize.
  assert.equal(standardizeRuntimeFileNames(root).renamed_files, 0)
})

test('runtime filename standardization covers research and benchmarks', () => {
  const root = createTestTempDirectory('pan-runtime-temporal-files-')

  write(path.join(root, 'runtime/research/plain-note.md'), '# Research\n')
  write(
    path.join(root, 'runtime/benchmarks/benchmark-1789980890366.json'),
    '{}\n',
  )
  // A run record that cites the research note follows the rename.
  const record = path.join(root, 'runtime/logs/workflows/some-run/notes.json')

  write(
    record,
    `${JSON.stringify({ source: 'runtime/research/plain-note.md' })}\n`,
  )

  const summary = standardizeRuntimeFileNames(root)
  const renamedResearch = summary.renames['runtime/research/plain-note.md']

  assert.equal(summary.renamed_files, 2)
  assert.ok(renamedResearch)
  assert.ok(summary.renames['runtime/benchmarks/benchmark-1789980890366.json'])
  assert.equal(summary.updated_files, 1)
  assert.equal(JSON.parse(readFileSync(record, 'utf8')).source, renamedResearch)
})

// `pan archive` renamed all 13 queued harness repair intakes out of the shape
// `REPAIR-001` mandates and left 20 by-name cross-references dangling, because
// standardization rewrites a bare file name that the reference repair, which
// maps whole relative paths, cannot follow.
test('standardization leaves policy-mandated inbox names and their citations alone', () => {
  const root = createTestTempDirectory('pan-names-policy-')
  const intake =
    'harness-repair-20260917T215829Z-build-release-sync-and-validator-routing.md'
  const related = 'harness-repair-20260918T061754Z-int-con-ship-scope-window.md'
  const escalation = 'spotfix-escalation-20260918T083300Z-pan-archive.md'

  write(
    path.join(root, 'runtime/inbox/queue', intake),
    `# Build intake\n\nLand \`${related}\` first.\n`,
  )
  write(path.join(root, 'runtime/inbox/queue', related), '# Consistency\n')
  write(path.join(root, 'runtime/inbox/queue', escalation), '# Escalation\n')
  // An ordinary request in the same directory still standardizes, so the
  // exemption is the mandated name rather than the directory.
  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-archive-utils.md'),
    'Ordinary request.\n',
  )

  const summary = standardizeRuntimeFileNames(root)

  assert.deepEqual(Object.keys(summary.renames), [
    'runtime/inbox/queue/2026-08-14-archive-utils.md',
  ])
  assert.equal(existsSync(path.join(root, 'runtime/inbox/queue', intake)), true)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue', related)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue', escalation)),
    true,
  )
  // The cross-reference still resolves, which is the contract the rename broke.
  const citation = readFileSync(
    path.join(root, 'runtime/inbox/queue', intake),
    'utf8',
  ).match(/`([^`]+)`/u)

  assert.ok(citation)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue', citation[1])),
    true,
  )
})

// The exemption is bounded by the mandated shape. A name that only borrows the
// prefix carries no UTC timestamp, so it has no age of its own and must still
// be standardized rather than sit unarchivable in a status directory.
test('a policy prefix without a mandated UTC timestamp still standardizes', () => {
  const root = createTestTempDirectory('pan-names-policy-near-miss-')
  const nearMisses = [
    'harness-repair-notes.md',
    'harness-repair-2026-09-17-draft.md',
    'spotfix-escalation-20260918T0833Z-truncated.md',
  ]

  for (const name of nearMisses) {
    write(path.join(root, 'runtime/inbox/queue', name), 'Near miss.\n')
  }

  assert.equal(standardizeRuntimeFileNames(root).renamed_files, 3)

  for (const name of nearMisses) {
    assert.equal(
      existsSync(path.join(root, 'runtime/inbox/queue', name)),
      false,
      name,
    )
  }
})

// Standardization is what gave an inbox item an archivable age, so exempting a
// name must not make it immortal in a terminal status directory.
test('a policy-mandated inbox item still archives on the age its name carries', () => {
  const root = createTestTempDirectory('pan-archive-policy-')
  const stale = 'harness-repair-20260622T211500Z-test-issues-flaky-lane.md'
  const fresh = 'harness-repair-20260629T211500Z-compliance-card-drift.md'

  write(path.join(root, 'runtime/inbox/complete', stale), '# Stale\n')
  write(path.join(root, 'runtime/inbox/complete', fresh), '# Fresh\n')

  const summary = archiveWorkflowDirectories(root, {
    retentionDays: 7,
    now: new Date('2026-07-01T22:00:00.000Z'),
  })

  assert.deepEqual(summary.inbox_files, [stale])
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/archive', stale)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/complete', fresh)),
    true,
  )
})

test('run directory hash suffixes migrate to keyword suffixes', () => {
  const root = createTestTempDirectory('pan-suffixes-')
  const first = '63379_Jun-22-0158_5f354f23'
  const second = '63379_Jun-22-0157_6f354f23'
  const sameMinute = '63379_Jun-22-0158_7f354f23'

  writeState(root, first, 'succeeded')
  writeState(root, second, 'succeeded')
  writeState(root, sameMinute, 'succeeded')
  write(
    path.join(root, 'runtime/workflows', first, 'modifications.jsonl'),
    `${JSON.stringify({ run_id: first })}\n`,
  )
  write(
    path.join(
      root,
      'runtime/logs/sessions/63379_Jun-22-0158_aaaa1111',
      'pair-card.md',
    ),
    '# Pair programming\n',
  )
  write(
    path.join(
      root,
      'runtime/logs/best-of-n/63379_Jun-22-0158_bbbb2222',
      'state.json',
    ),
    `${JSON.stringify({
      bon_id: '63379_Jun-22-0158_bbbb2222',
      request: {
        source_path: 'runtime/inbox/2026-06-22-output-simplification.md',
      },
    })}\n`,
  )

  const summary = migrateRunSuffixes(root)

  // All runs share the fixture title, so the same-minute run keeps the keywords
  // with an ordinal.
  assert.equal(summary.run_directories, 3)
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/63379_Jun-22-0158_fixture-2'),
    ),
    true,
  )
  assert.equal(summary.session_directories, 1)
  assert.equal(summary.best_of_n_directories, 1)
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/63379_Jun-22-0158_fixture'),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/63379_Jun-22-0157_fixture'),
    ),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/workflows/63379_Jun-22-0158_fixture')),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/sessions/63379_Jun-22-0158_pair')),
    true,
  )
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/best-of-n/63379_Jun-22-0158_output-simpl'),
    ),
    true,
  )
  assert.match(
    readFileSync(
      path.join(
        root,
        'runtime/workflows/63379_Jun-22-0158_fixture/modifications.jsonl',
      ),
      'utf8',
    ),
    /63379_Jun-22-0158_fixture/u,
  )
  // A second pass has nothing hex-suffixed left.
  assert.equal(migrateRunSuffixes(root).run_directories, 0)
})

test('suffix migration skips best-of-N sessions with live worktrees at the current root', () => {
  const root = createTestTempDirectory('pan-suffix-worktree-current-')
  const bonId = '63379_Jun-22-0158_dddd4444'
  const legacyBonId = '63379_Jun-22-0158_cccc3333'

  for (const id of [bonId, legacyBonId]) {
    write(
      path.join(root, 'runtime/logs/best-of-n', id, 'state.json'),
      `${JSON.stringify({
        bon_id: id,
        request: { source_path: 'runtime/inbox/2026-06-22-live-session.md' },
      })}\n`,
    )
  }
  mkdirSync(path.join(root, 'worktrees', bonId, 'slot-a'), {
    recursive: true,
  })
  // The legacy runtime/worktrees location counts as live just the same.
  mkdirSync(path.join(root, 'runtime/worktrees', legacyBonId, 'slot-a'), {
    recursive: true,
  })

  const summary = migrateRunSuffixes(root)

  assert.equal(summary.best_of_n_directories, 0)
  assert.deepEqual(
    [...summary.skipped_directories].sort(),
    [
      `runtime/logs/best-of-n/${bonId}`,
      `runtime/logs/best-of-n/${legacyBonId}`,
    ].sort(),
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/best-of-n', legacyBonId)),
    true,
  )
})

test('archival covers best-of-N sessions and temporal runtime files', () => {
  const root = createTestTempDirectory('pan-archive-extended-')
  const oldBonId = '63379_Jun-22-0158_output-simpl'
  const freshBonId = '63372_Jun-29-0158_other-keywor'

  const oldSessionId = '63379_Jun-22-0158_aaaaaaaa'
  const freshSessionId = '63372_Jun-29-0158_bbbbbbbb'
  const oldSession = path.join(root, 'runtime/logs/sessions', oldSessionId)
  const freshSession = path.join(root, 'runtime/logs/sessions', freshSessionId)

  write(path.join(oldSession, 'pair-card.md'), '# Pair programming\n')
  write(path.join(freshSession, 'pair-card.md'), '# Pair programming\n')
  write(
    path.join(root, 'runtime/logs/best-of-n', oldBonId, 'state.json'),
    `${JSON.stringify({
      bon_id: oldBonId,
      created_at: '2026-06-22T21:22:54.051Z',
    })}\n`,
  )
  write(
    path.join(root, 'runtime/logs/best-of-n', freshBonId, 'state.json'),
    `${JSON.stringify({
      bon_id: freshBonId,
      created_at: '2026-06-29T21:22:54.051Z',
    })}\n`,
  )
  write(
    path.join(root, 'runtime/inbox/complete/63379_Jun-22-0158_stale-reques.md'),
    'Stale request.\n',
  )
  write(
    path.join(root, 'runtime/inbox/complete/63372_Jun-29-0158_fresh-reques.md'),
    'Fresh request.\n',
  )
  write(
    path.join(
      root,
      'runtime/pr-descriptions/63379_Jun-22-0158_stale-pr-against-main.md',
    ),
    'Stale PR body.\n',
  )

  const summary = archiveWorkflowDirectories(root, {
    retentionDays: 7,
    now: new Date('2026-07-01T22:00:00.000Z'),
  })

  assert.deepEqual(summary.bon_ids, [oldBonId])
  assert.equal(summary.best_of_n_directories, 1)
  assert.deepEqual(summary.inbox_files, ['63379_Jun-22-0158_stale-reques.md'])
  assert.deepEqual(summary.pr_description_files, [
    '63379_Jun-22-0158_stale-pr-against-main.md',
  ])
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/best-of-n/archive', oldBonId)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/best-of-n', freshBonId)),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/inbox/archive/63379_Jun-22-0158_stale-reques.md',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/inbox/complete/63372_Jun-29-0158_fresh-reques.md',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/pr-descriptions/archive/63379_Jun-22-0158_stale-pr-against-main.md',
      ),
    ),
    true,
  )
  // Standalone cards live outside the workflow tree but are just as disposable;
  // without this they accumulate for the life of the installation.
  assert.deepEqual(summary.session_ids, [oldSessionId])
  assert.equal(summary.session_directories, 1)
  assert.equal(existsSync(oldSession), false)
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/sessions/archive', oldSessionId)),
    true,
  )
  // A session inside the retention window is untouched.
  assert.equal(existsSync(freshSession), true)
})

test('runtime name standardization never scans or rewrites worktree checkouts', () => {
  const root = createTestTempDirectory('pan-names-worktrees-')

  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-scoped-rename.md'),
    'Scoped rename fixture.\n',
  )
  // A reference inside a worktree checkout must stay untouched: worktrees are
  // target source trees, not runtime records.
  write(
    path.join(root, 'runtime/worktrees/operator/wt/notes.md'),
    'see runtime/inbox/queue/2026-08-14-scoped-rename.md\n',
  )
  write(
    path.join(root, 'runtime/logs/orchestrator/events.jsonl'),
    `${JSON.stringify({ path: 'runtime/inbox/queue/2026-08-14-scoped-rename.md' })}\n`,
  )

  const summary = standardizeRuntimeFileNames(root)

  assert.equal(summary.renamed_files, 1)
  assert.match(
    readFileSync(
      path.join(root, 'runtime/logs/orchestrator/events.jsonl'),
      'utf8',
    ),
    /63326_Aug-14-0720_scoped-rename\.md/u,
  )
  assert.equal(
    readFileSync(
      path.join(root, 'runtime/worktrees/operator/wt/notes.md'),
      'utf8',
    ),
    'see runtime/inbox/queue/2026-08-14-scoped-rename.md\n',
  )
})

// AC-025. The standardizer scanned two directory sets through two copies of
// the same loop, and a fix applied to one copy silently skipped the other.
test('the runtime name standardizer holds one traversal helper', () => {
  const source = readFileSync(
    'src/lib/workflow-artifacts/temporal-names.ts',
    'utf8',
  )
  const standardizer = source.slice(
    source.indexOf('function standardizeTemporalFileNamesIn'),
    source.indexOf('export interface RunSuffixMigrationSummary'),
  )

  // One traversal, in the helper. The two copies this replaced differed only
  // in the directory they walked, so a repair applied to one left the other
  // behind.
  assert.equal(standardizer.match(/readdirSync\(/gu)?.length, 1, standardizer)
  assert.match(
    standardizer,
    /standardizeTemporalFileNamesIn\(\s*root,\s*parentRelative,\s*mappings,\s*mutableFileSet,/u,
  )
})

test('name standardization is unchanged across the directories it already scanned', () => {
  const root = createTestTempDirectory('pan-names-one-helper-')

  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-first.md'),
    'First fixture.\n',
  )
  write(
    path.join(root, 'runtime/logs/sessions/2026-08-12-second/notes.md'),
    'Second fixture.\n',
  )

  const summary = standardizeRuntimeFileNames(root)

  assert.equal(summary.renamed_files, 1)
  assert.equal(
    existsSync(
      path.join(root, 'runtime/inbox/queue/63326_Aug-14-0720_first.md'),
    ),
    true,
  )
})

test('mutable runtime rewrites include durable records and exclude scratch and unknown directories', () => {
  const root = createTestTempDirectory('pancreator-mutable-runtime-')
  const runtimeRoot = path.join(root, 'runtime')

  const durable = path.join(
    runtimeRoot,
    'logs',
    'workflows',
    'run',
    'state.json',
  )
  // Two durable series the first allowlist missed: a run id lives in both, and
  // neither is reachable through a `runtime/logs` entry.
  const allocations = path.join(runtimeRoot, 'release', 'allocations.jsonl')
  const series = path.join(runtimeRoot, 'fast-wall-series.jsonl')

  const scratch = path.join(runtimeRoot, 'tmp', 'scratch.txt')
  const unknown = path.join(runtimeRoot, 'future-area', 'record.json')

  write(durable, '{}\n')
  write(allocations, '{}\n')
  write(series, '{}\n')
  write(scratch, 'scratch\n')
  write(unknown, '{}\n')

  assert.deepEqual(
    mutableRuntimeFiles(runtimeRoot).sort(),
    [series, allocations, durable].sort(),
  )
})

// AC-010. The rewrite population was narrowed to an allowlist, and a durable
// run id outside `runtime/logs` is the reference that narrowing can silently
// drop: an append-only audit row that kept a retired id outlives the run.
test('a run-id migration rewrites durable records outside the workflow logs', () => {
  const root = createTestTempDirectory('pancreator-durable-rewrite-')
  const runId = '63379_Jun-22-0158_5f354f23'
  const allocations = path.join(root, 'runtime/release/allocations.jsonl')
  const series = path.join(root, 'runtime/fast-wall-series.jsonl')

  writeState(root, runId, 'succeeded')
  write(
    allocations,
    `${JSON.stringify({ schema_version: 1, version: '6.22.0', run_id: runId })}\n`,
  )
  write(
    series,
    `${JSON.stringify({ schema_version: 3, run_id: runId, wall_clock_ms: 1 })}\n`,
  )

  const summary = migrateRunSuffixes(root)
  const migrated = '63379_Jun-22-0158_fixture'

  assert.equal(summary.run_directories, 1)
  assert.match(readFileSync(allocations, 'utf8'), /63379_Jun-22-0158_fixture/u)
  assert.match(readFileSync(series, 'utf8'), /63379_Jun-22-0158_fixture/u)
  assert.equal(readFileSync(allocations, 'utf8').includes(runId), false)
  assert.equal(readFileSync(series, 'utf8').includes(runId), false)
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/workflows', migrated)),
    true,
  )
})

// AC-011. The guard has to fail when a pass walks the runtime tree again, so
// it counts the walks themselves and the fixture gives two passes real
// mappings: a counter read after a no-op maintenance proves nothing.
test('runtime maintenance walks the mutable population once across all passes', () => {
  const root = createTestTempDirectory('pancreator-runtime-scan-')

  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-first.md'),
    'First fixture.\n',
  )
  writeState(root, '63379_Jun-22-0158_5f354f23', 'succeeded')

  const before = mutableRuntimeTraversalCount()
  const summary = maintainWorkflowRuntime(root, { retentionDays: 36500 })

  assert.equal(summary.names.renamed_files, 1)
  assert.equal(summary.suffixes.run_directories, 1)
  assert.equal(mutableRuntimeTraversalCount() - before, 1)
})
