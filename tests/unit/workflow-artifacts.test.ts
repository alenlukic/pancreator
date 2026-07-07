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
  migrateWorkflowNames,
  migratedRunId,
} from '../../src/lib/workflow-artifacts.js'

function write(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

function writeWorkflowSnapshot(runDirectory: string): void {
  write(
    path.join(runDirectory, 'workflow.snapshot.json'),
    `${JSON.stringify({
      stages: [{ slug: 'intake' }, { slug: 'implement' }, { slug: 'review' }],
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
      workflow_slug: 'dev',
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
      `${JSON.stringify({ stages: [{ slug: 'intake' }] })}\n`,
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

test('finalizeWorkflowArtifacts finalizes terminal runs from persisted state', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pancreator-finalize-'))
  const runId = '63379_Jun-22_5f354f23'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)

  writeState(root, runId, 'succeeded')

  const summary = finalizeWorkflowArtifacts(root, runId)

  assert.equal(typeof summary.artifact_files, 'number')
  assert.equal(typeof summary.layout_files, 'number')
  assert.equal(typeof summary.updated_files, 'number')
  assert.equal(path.basename(runDirectory), runId)
})

test('workflow migration finalizes closed runs and consolidates artifacts', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pancreator-migration-'))
  const oldRunId = '20260622T212254051Z-5f354f23'
  const newRunId = migratedRunId(oldRunId)

  assert.equal(newRunId, '63379_Jun-22-0158_5f354f23')

  const logDirectory = path.join(root, 'runtime/logs/workflows', oldRunId)
  const stateDirectory = path.join(root, 'runtime/workflows', oldRunId)
  const oldInvocationIds = [
    'intake-1-02e65dfc',
    'implement-1-12e65dfc',
    'review-1-22e65dfc',
    'implement-2-32e65dfc',
    'review-2-42e65dfc',
  ]
  const newInvocationIds = [
    '04_intake-1_02e65dfc',
    '03_implement-1_12e65dfc',
    '02_review-1_22e65dfc',
    '01_implement-2_32e65dfc',
    '00_review-2_42e65dfc',
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
    '999_intake-1_02e65dfc',
    '997_implement-1_12e65dfc',
    '996_review-1_22e65dfc',
    '997_implement-2_32e65dfc',
    '996_review-2_42e65dfc',
  ]
  const sequencedInvocationIds = [
    '99_intake-1_02e65dfc',
    '98_implement-1_12e65dfc',
    '97_review-1_22e65dfc',
    '96_implement-2_32e65dfc',
    '95_review-2_42e65dfc',
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

test('migratedRunId upgrades day-only ids and ignores current-format ids', () => {
  assert.equal(
    migratedRunId(
      '63379_Jun-22_5f354f23',
      new Date('2026-06-22T21:22:54.051Z'),
    ),
    '63379_Jun-22-0158_5f354f23',
  )
  assert.equal(migratedRunId('63379_Jun-22-0158_5f354f23'), null)
})

test('workflow archive moves runs older than retention into archive directories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pancreator-archive-'))
  const oldRunId = '63379_Jun-22-0158_5f354f23'
  const recentRunId = '63372_Jun-29-0158_6f354f23'
  const oldLogDirectory = path.join(root, 'runtime/logs/workflows', oldRunId)
  const oldStateDirectory = path.join(root, 'runtime/workflows', oldRunId)

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
