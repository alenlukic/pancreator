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

import {
  migrateWorkflowNames,
  migratedRunId,
} from '../../src/migrations/migrate-workflow-names.js'

function write(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

function writeWorkflowSnapshot(runDirectory: string): void {
  write(
    path.join(runDirectory, 'workflow.snapshot.json'),
    `${JSON.stringify({
      stages: [{ slug: 'intake' }, { slug: 'implement' }, { slug: 'review' }],
    })}
`,
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

test('workflow naming migration uses chronological run sequence', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pancreator-migration-'))
  const oldRunId = '20260622T212254051Z-5f354f23'
  const newRunId = migratedRunId(oldRunId)

  assert.equal(newRunId, '63379_Jun-22_5f354f23')

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
    '999_intake-1_02e65dfc',
    '998_implement-1_12e65dfc',
    '997_review-1_22e65dfc',
    '996_implement-2_32e65dfc',
    '995_review-2_42e65dfc',
  ]

  writeWorkflowSnapshot(logDirectory)
  writeEvents(logDirectory, oldInvocationIds)

  oldInvocationIds.forEach((invocationId, index) => {
    writeInvocation(logDirectory, oldRunId, invocationId, index)
  })

  const assessedInvocationId = oldInvocationIds[2]

  write(
    path.join(
      logDirectory,
      'assessments',
      `assessment-${assessedInvocationId}.request.json`,
    ),
    `${JSON.stringify({
      run_id: oldRunId,
      invocation_id: assessedInvocationId,
    })}\n`,
  )
  write(
    path.join(stateDirectory, 'baseline.json'),
    `${JSON.stringify({ workflow_id: oldRunId })}\n`,
  )
  write(
    path.join(stateDirectory, 'modifications.jsonl'),
    `${JSON.stringify({
      workflow_id: oldRunId,
      invocation_id: oldInvocationIds[3],
    })}\n`,
  )
  write(
    path.join(root, 'runtime/logs/orchestrator/events.jsonl'),
    `${JSON.stringify({ run_id: oldRunId })}\n`,
  )

  const summary = migrateWorkflowNames(root)
  const migratedLogDirectory = path.join(
    root,
    'runtime/logs/workflows',
    newRunId,
  )
  const migratedStateDirectory = path.join(root, 'runtime/workflows', newRunId)

  assert.equal(summary.run_directories, 1)
  assert.equal(summary.state_directories, 1)
  assert.equal(summary.artifact_files, 6)
  assert.equal(existsSync(logDirectory), false)
  assert.equal(existsSync(migratedLogDirectory), true)
  assert.equal(existsSync(stateDirectory), false)
  assert.equal(existsSync(migratedStateDirectory), true)

  newInvocationIds.forEach((invocationId) => {
    assert.equal(
      existsSync(
        path.join(migratedLogDirectory, 'invocations', `${invocationId}.json`),
      ),
      true,
    )
  })

  assert.equal(
    existsSync(
      path.join(
        migratedLogDirectory,
        'assessments',
        `${newInvocationIds[2]}.assessment-request.json`,
      ),
    ),
    true,
  )
  assert.match(
    readFileSync(
      path.join(migratedStateDirectory, 'modifications.jsonl'),
      'utf8',
    ),
    new RegExp(`${newRunId}.*${newInvocationIds[3]}`, 'u'),
  )
  assert.deepEqual(migrateWorkflowNames(root), {
    run_directories: 0,
    state_directories: 0,
    artifact_files: 0,
    updated_files: 0,
  })
})

test('workflow naming migration repairs prior stage-grouped prefixes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pancreator-migration-'))
  const runId = '63379_Jun-22_5f354f23'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
  const groupedInvocationIds = [
    '999_intake-1_02e65dfc',
    '997_implement-1_12e65dfc',
    '996_review-1_22e65dfc',
    '997_implement-2_32e65dfc',
    '996_review-2_42e65dfc',
  ]
  const sequencedInvocationIds = [
    '999_intake-1_02e65dfc',
    '998_implement-1_12e65dfc',
    '997_review-1_22e65dfc',
    '996_implement-2_32e65dfc',
    '995_review-2_42e65dfc',
  ]

  writeWorkflowSnapshot(runDirectory)
  writeEvents(runDirectory, groupedInvocationIds)
  write(
    path.join(runDirectory, 'request.md'),
    'Cross-run reference: 994_review-2_71ad38d4\n',
  )

  groupedInvocationIds.forEach((invocationId, index) => {
    writeInvocation(runDirectory, runId, invocationId, index)
  })

  const summary = migrateWorkflowNames(root)

  assert.equal(summary.run_directories, 0)
  assert.equal(summary.state_directories, 0)
  assert.equal(summary.artifact_files, 4)

  sequencedInvocationIds.forEach((invocationId) => {
    assert.equal(
      existsSync(
        path.join(runDirectory, 'invocations', `${invocationId}.json`),
      ),
      true,
    )
  })
  assert.equal(
    readFileSync(path.join(runDirectory, 'request.md'), 'utf8'),
    'Cross-run reference: 994_review-2_71ad38d4\n',
  )

  assert.deepEqual(migrateWorkflowNames(root), {
    run_directories: 0,
    state_directories: 0,
    artifact_files: 0,
    updated_files: 0,
  })
})
