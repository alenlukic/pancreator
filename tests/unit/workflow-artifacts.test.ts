import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  archiveWorkflowDirectories,
  finalizeWorkflowArtifacts,
  migrateRunSuffixes,
  migrateWorkflowNames,
  migratedRunId,
  standardizeRuntimeFileNames,
} from '../../src/lib/workflow-artifacts.js'
function write(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

function writeWorkflowSnapshot(runDirectory: string): void {
  write(
    path.join(runDirectory, 'workflow.snapshot.json'),
    `${JSON.stringify({
      stages: [{ slug: 'plan' }, { slug: 'implement' }, { slug: 'verify' }],
    })}\n`,
  )
}

function writeEvents(runDirectory: string, invocationIds: string[]): void {
  const events = invocationIds.map((invocationId, index) =>
    JSON.stringify({
      schema_version: 1,
      type: 'invocation_prepared',
      timestamp: new Date(Date.UTC(2026, 5, 22, 21, index)).toISOString(),
      invocation_id: invocationId,
    }),
  )

  write(path.join(runDirectory, 'events.jsonl'), `${events.join('\n')}\n`)
}

function writeInvocation(
  runDirectory: string,
  runId: string,
  invocationId: string,
  index: number,
): void {
  write(
    path.join(runDirectory, 'invocations', `${invocationId}.json`),
    `${JSON.stringify({
      run_id: runId,
      invocation_id: invocationId,
      created_at: new Date(Date.UTC(2026, 5, 22, 21, index)).toISOString(),
      output: {
        path: `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`,
      },
    })}\n`,
  )
}

function writeState(
  rootOrDirectory: string,
  runId: string,
  status: 'running' | 'succeeded',
  invocationIds: string[] = [],
  createdAt = '2026-06-22T21:22:54.051Z',
): void {
  const runDirectory = invocationIds.length
    ? rootOrDirectory
    : path.join(rootOrDirectory, 'runtime/logs/workflows', runId)

  write(
    path.join(runDirectory, 'state.json'),
    `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      workflow_slug: 'delivery',
      title: 'fixture',
      status,
      pending_action: {
        type: status === 'running' ? 'prepare_invocation' : 'none',
      },
      stage_history: invocationIds.map((invocationId, index) => ({
        invocation_id: invocationId,
        submitted_at: new Date(Date.UTC(2026, 5, 22, 21, index)).toISOString(),
        record_path: `runtime/logs/workflows/${runId}/records/${invocationId}.md`,
      })),
      attempts: {},
      created_at: createdAt,
    })}\n`,
  )

  if (invocationIds.length === 0) {
    write(
      path.join(runDirectory, 'workflow.snapshot.json'),
      `${JSON.stringify({ stages: [{ slug: 'plan' }] })}\n`,
    )
    write(path.join(runDirectory, 'events.jsonl'), '')
  }
}

function writeLegacyArtifacts(
  runDirectory: string,
  runId: string,
  invocationIds: string[],
): void {
  invocationIds.forEach((invocationId) => {
    write(
      path.join(runDirectory, 'artifacts', `${invocationId}.md`),
      `Artifact ${invocationId}\n`,
    )
    write(
      path.join(runDirectory, 'artifacts', `${invocationId}.html`),
      `<main>Artifact ${invocationId}</main>\n`,
    )
    write(
      path.join(runDirectory, 'records', `${invocationId}.json`),
      `${JSON.stringify({
        run_id: runId,
        invocation_id: invocationId,
        artifacts: [
          {
            path: `runtime/logs/workflows/${runId}/artifacts/${invocationId}.md`,
          },
        ],
      })}\n`,
    )
    write(
      path.join(runDirectory, 'records', `${invocationId}.md`),
      `Record ${invocationId}\n`,
    )
  })
}

test('finalizeWorkflowArtifacts rejects non-terminal runs', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pancreator-finalize-'))
  const runId = '63379_Jun-22_5f354f23'

  writeState(root, runId, 'running')

  assert.throws(
    () => finalizeWorkflowArtifacts(root, runId),
    (error: unknown) =>
      error instanceof PanError && error.code === 'RUN_NOT_TERMINAL',
  )
})

test('workflow migration finalizes closed runs and consolidates artifacts', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pancreator-migration-'))
  const oldRunId = '20260622T212254051Z-5f354f23'
  const newRunId = migratedRunId(oldRunId)

  assert.equal(newRunId, '63379_Jun-22-0158_5f354f23')
  assert.equal(
    migratedRunId(
      '63379_Jun-22_5f354f23',
      new Date('2026-06-22T21:22:54.051Z'),
    ),
    '63379_Jun-22-0158_5f354f23',
  )
  assert.equal(migratedRunId('63379_Jun-22-0158_5f354f23'), null)

  const logDirectory = path.join(root, 'runtime/logs/workflows', oldRunId)
  const stateDirectory = path.join(root, 'runtime/workflows', oldRunId)
  const oldInvocationIds = [
    'plan-1-02e65dfc',
    'implement-1-12e65dfc',
    'verify-1-22e65dfc',
    'implement-2-32e65dfc',
    'verify-2-42e65dfc',
  ]
  const newInvocationIds = [
    '04_plan-1_02e65dfc',
    '03_implement-1_12e65dfc',
    '02_verify-1_22e65dfc',
    '01_implement-2_32e65dfc',
    '00_verify-2_42e65dfc',
  ]

  writeWorkflowSnapshot(logDirectory)
  writeEvents(logDirectory, oldInvocationIds)
  writeState(logDirectory, oldRunId, 'succeeded', oldInvocationIds)
  writeLegacyArtifacts(logDirectory, oldRunId, oldInvocationIds)
  write(
    path.join(
      logDirectory,
      'evidence',
      '997_implement-2_d75285b9-installation-smoke.log',
    ),
    'Stage-owned evidence whose artifact-like filename is not an invocation.\n',
  )

  oldInvocationIds.forEach((invocationId, index) => {
    writeInvocation(logDirectory, oldRunId, invocationId, index)
  })

  write(
    path.join(stateDirectory, 'modifications.jsonl'),
    `${JSON.stringify({
      workflow_id: oldRunId,
      invocation_id: oldInvocationIds[3],
    })}\n`,
  )
  mkdirSync(path.join(root, 'runtime/logs/workflows/--help'), {
    recursive: true,
  })

  const summary = migrateWorkflowNames(root)
  const migratedLogDirectory = path.join(
    root,
    'runtime/logs/workflows',
    newRunId,
  )
  const migratedStateDirectory = path.join(root, 'runtime/workflows', newRunId)

  assert.equal(summary.run_directories, 1)
  assert.equal(summary.state_directories, 1)
  assert.equal(summary.removed_invalid_directories, 1)
  assert.equal(existsSync(logDirectory), false)
  assert.equal(existsSync(migratedLogDirectory), true)
  assert.equal(existsSync(stateDirectory), false)
  assert.equal(existsSync(migratedStateDirectory), true)
  assert.equal(existsSync(path.join(migratedLogDirectory, 'records')), false)

  newInvocationIds.forEach((invocationId) => {
    assert.equal(
      existsSync(
        path.join(migratedLogDirectory, 'invocations', `${invocationId}.json`),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          migratedLogDirectory,
          'artifacts/json',
          `${invocationId}.json`,
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          migratedLogDirectory,
          'artifacts/markdown',
          `${invocationId}.md`,
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          migratedLogDirectory,
          'artifacts/html',
          `${invocationId}.html`,
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          migratedLogDirectory,
          'artifacts/markdown',
          `${invocationId}.record.md`,
        ),
      ),
      false,
    )
  })

  assert.match(
    readFileSync(
      path.join(migratedStateDirectory, 'modifications.jsonl'),
      'utf8',
    ),
    new RegExp(`${newRunId}.*${newInvocationIds[3]}`, 'u'),
  )
  const migratedState = readFileSync(
    path.join(migratedLogDirectory, 'state.json'),
    'utf8',
  )

  assert.doesNotMatch(migratedState, /\.record\.md/u)
  assert.match(
    migratedState,
    new RegExp(`artifacts/json/${newInvocationIds[0]}\\.json`, 'u'),
  )
  assert.deepEqual(migrateWorkflowNames(root), {
    run_directories: 0,
    state_directories: 0,
    artifact_files: 0,
    artifact_layout_files: 0,
    updated_files: 0,
    removed_invalid_directories: 0,
  })
})

test('workflow migration repairs in-flight prefixes without finalizing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pancreator-migration-'))
  const runId = '63379_Jun-22_5f354f23'
  const migratedId = '63379_Jun-22-0158_5f354f23'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
  const groupedInvocationIds = [
    '999_plan-1_02e65dfc',
    '997_implement-1_12e65dfc',
    '996_verify-1_22e65dfc',
    '997_implement-2_32e65dfc',
    '996_verify-2_42e65dfc',
  ]
  const sequencedInvocationIds = [
    '99_plan-1_02e65dfc',
    '98_implement-1_12e65dfc',
    '97_verify-1_22e65dfc',
    '96_implement-2_32e65dfc',
    '95_verify-2_42e65dfc',
  ]

  writeWorkflowSnapshot(runDirectory)
  writeEvents(runDirectory, groupedInvocationIds)
  writeState(runDirectory, runId, 'running', groupedInvocationIds)
  writeLegacyArtifacts(runDirectory, runId, groupedInvocationIds)

  groupedInvocationIds.forEach((invocationId, index) => {
    writeInvocation(runDirectory, runId, invocationId, index)
  })

  migrateWorkflowNames(root)

  sequencedInvocationIds.forEach((invocationId) => {
    assert.equal(
      existsSync(
        path.join(
          root,
          'runtime/logs/workflows',
          migratedId,
          'invocations',
          `${invocationId}.json`,
        ),
      ),
      true,
    )
  })

  assert.deepEqual(migrateWorkflowNames(root), {
    run_directories: 0,
    state_directories: 0,
    artifact_files: 0,
    artifact_layout_files: 0,
    updated_files: 0,
    removed_invalid_directories: 0,
  })
})

test('workflow archive moves runs older than retention into archive directories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pancreator-archive-'))
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

test('runtime file names standardize onto the temporal prefix scheme', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pan-names-'))

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

test('run directory hash suffixes migrate to keyword suffixes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pan-suffixes-'))
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
  const root = mkdtempSync(
    path.join(os.tmpdir(), 'pan-suffix-worktree-current-'),
  )
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
  const root = mkdtempSync(path.join(os.tmpdir(), 'pan-archive-extended-'))
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
  const root = mkdtempSync(path.join(os.tmpdir(), 'pan-names-worktrees-'))

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
