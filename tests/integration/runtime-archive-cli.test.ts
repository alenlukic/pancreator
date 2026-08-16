import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createRun, pauseRun } from '../../src/lib/engine.js'
import { createFixture } from '../helpers.js'
import { makeWorkflowRunId } from '../../src/lib/naming.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function write(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

test('pan archive migrates and archives old workflow directories', () => {
  const root = createFixture()
  const legacyRunId = '20200101T120000000Z-abcdef12'
  const createdAt = new Date('2020-01-01T12:00:00.000Z')
  // Prefix migration preserves the hex fragment; suffix migration then
  // replaces it with keywords derived from the run title.
  const currentRunId = makeWorkflowRunId(createdAt, 'old-fixture')
  const logDirectory = path.join(root, 'runtime/logs/workflows', legacyRunId)
  const stateDirectory = path.join(root, 'runtime/workflows', legacyRunId)

  write(
    path.join(logDirectory, 'state.json'),
    `${JSON.stringify({
      schema_version: 1,
      run_id: legacyRunId,
      workflow_slug: 'dev',
      title: 'old fixture',
      status: 'succeeded',
      pending_action: { type: 'none' },
      stage_history: [],
      attempts: {},
      created_at: createdAt.toISOString(),
    })}\n`,
  )
  write(
    path.join(logDirectory, 'workflow.snapshot.json'),
    '{"stages":[{"slug":"intake"}]}\n',
  )
  write(path.join(logDirectory, 'events.jsonl'), '')
  write(
    path.join(stateDirectory, 'modifications.jsonl'),
    `${JSON.stringify({ run_id: legacyRunId })}\n`,
  )

  const output = execFileSync(
    process.execPath,
    [CLI, 'archive', '--days', '7', '--json'],
    { cwd: root, encoding: 'utf8' },
  )
  const summary = JSON.parse(output) as {
    migration: { run_directories: number; state_directories: number }
    archive: {
      run_directories: number
      state_directories: number
      run_ids: string[]
    }
  }

  assert.equal(summary.migration.run_directories, 1)
  assert.equal(summary.migration.state_directories, 1)
  assert.equal(summary.archive.run_directories, 1)
  assert.equal(summary.archive.state_directories, 1)
  assert.deepEqual(summary.archive.run_ids, [currentRunId])
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/logs/workflows/archive',
        currentRunId,
        'state.json',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/workflows/archive',
        currentRunId,
        'modifications.jsonl',
      ),
    ),
    true,
  )
})

test('status, resume, and archive preserve an unconverted v1 run', () => {
  const root = createFixture()
  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  }).run_id

  pauseRun(root, runId, 'legacy layout fixture')

  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
  const agentDirectory = path.join(runDirectory, 'agent')
  const operatorDirectory = path.join(runDirectory, 'operator')

  for (const entry of readdirSync(agentDirectory)) {
    renameSync(path.join(agentDirectory, entry), path.join(runDirectory, entry))
  }
  renameSync(
    path.join(operatorDirectory, 'request.md'),
    path.join(runDirectory, 'request.md'),
  )
  rmSync(agentDirectory, { recursive: true })
  rmSync(operatorDirectory, { recursive: true })

  const statePath = path.join(runDirectory, 'state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
    schema_version: number
    workflow_snapshot: { path: string }
    pipeline_config: { path: string }
    request: { stored_path: string }
    stage_history: unknown[]
  }

  state.schema_version = 1
  state.workflow_snapshot.path = `runtime/logs/workflows/${runId}/workflow.snapshot.json`
  state.pipeline_config.path = `runtime/logs/workflows/${runId}/pipeline-config.snapshot.json`
  state.request.stored_path = `runtime/logs/workflows/${runId}/request.md`
  state.stage_history.push({
    stage: 'intake',
    attempt: 1,
    invocation_id: '99_intake-1_renamed-prefix',
    output_path: `runtime/logs/workflows/${runId}/outputs/99_intake-1_renamed-prefix.json`,
    outcome: 'success',
    submitted_at: new Date().toISOString(),
    workspace_fingerprint: 'legacy-fixture',
    validation_errors: [],
    deterministic: [],
  })
  write(statePath, `${JSON.stringify(state)}\n`)
  write(
    path.join(runDirectory, 'events.jsonl'),
    `${JSON.stringify({ type: 'state_persisted', state_after_omitted: true })}\n`,
  )

  const status = JSON.parse(
    execFileSync(process.execPath, [CLI, 'status', runId, '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  ) as { status: string }

  assert.equal(status.status, 'paused')

  execFileSync(
    process.execPath,
    [
      CLI,
      'resume',
      runId,
      '--stage',
      'intake',
      '--note',
      'resume legacy fixture',
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  execFileSync(
    process.execPath,
    [CLI, 'archive', '--days', '36500', '--json'],
    { cwd: root, encoding: 'utf8' },
  )

  assert.equal(existsSync(statePath), true)
  assert.equal(
    existsSync(path.join(runDirectory, 'agent', 'state.json')),
    false,
  )
})
