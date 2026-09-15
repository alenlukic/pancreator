import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { pauseRun } from '../../src/lib/engine.js'
import { makeWorkflowRunId } from '../../src/lib/naming.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function write(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

test('status, resume, and archive preserve an unconverted v1 run', () => {
  const root = createFixture()
  const runId = createRun(root, {
    workflowSlug: 'delivery',
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
    stage: 'implement',
    attempt: 1,
    invocation_id: '99_implement-1_renamed-prefix',
    output_path: `runtime/logs/workflows/${runId}/outputs/99_implement-1_renamed-prefix.json`,
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
      'implement',
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

test('selects complete canceled or both inbox archives', () => {
  const canceledRoot = createFixture()
  const writeExpired = (
    root: string,
    status: 'complete' | 'canceled',
    fileName: string,
  ) => {
    const absolute = path.join(root, 'runtime/inbox', status, fileName)

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, `${status}\n`, 'utf8')
    utimesSync(
      absolute,
      new Date('2026-06-22T21:22:54.051Z'),
      new Date('2026-06-22T21:22:54.051Z'),
    )
  }

  writeExpired(canceledRoot, 'canceled', '63379_Jun-22-0158_flag-canceled.md')

  const canceledOnly = JSON.parse(
    execFileSync(
      process.execPath,
      [CLI, 'archive', '--days', '7', '--canceled', '--json'],
      { cwd: canceledRoot, encoding: 'utf8' },
    ) as string,
  ) as { archive: { inbox_files: string[] } }

  assert.deepEqual(canceledOnly.archive.inbox_files, [
    '63379_Jun-22-0158_flag-canceled.md',
  ])

  // No flag is the same selection as `--complete`, so the default run also
  // proves that an expired canceled item stays where it is.
  const completeRoot = createFixture()

  writeExpired(completeRoot, 'complete', '63379_Jun-22-0158_flag-complete.md')
  writeExpired(completeRoot, 'canceled', '63379_Jun-22-0158_kept-canceled.md')

  // RUNTIME-001 names the `pan archive` command as the owner of legacy
  // workflow-directory migration. The migration ordering itself is proved by
  // the direct `maintainWorkflowRuntime` test in inbox.test.ts; this legacy
  // run rides the spawn above so the command surface stays pinned without a
  // second process.
  const legacyRunId = '20200101T120000000Z-abcdef12'
  const createdAt = new Date('2020-01-01T12:00:00.000Z')
  const migratedRunId = makeWorkflowRunId(createdAt, 'old-fixture')
  const legacyLogDirectory = path.join(
    completeRoot,
    'runtime/logs/workflows',
    legacyRunId,
  )

  write(
    path.join(legacyLogDirectory, 'state.json'),
    `${JSON.stringify({
      schema_version: 1,
      run_id: legacyRunId,
      workflow_slug: 'delivery',
      title: 'old fixture',
      status: 'succeeded',
      pending_action: { type: 'none' },
      stage_history: [],
      attempts: {},
      created_at: createdAt.toISOString(),
    })}\n`,
  )
  write(
    path.join(legacyLogDirectory, 'workflow.snapshot.json'),
    '{"stages":[{"slug":"plan"}]}\n',
  )
  write(path.join(legacyLogDirectory, 'events.jsonl'), '')
  write(
    path.join(
      completeRoot,
      'runtime/workflows',
      legacyRunId,
      'modifications.jsonl',
    ),
    `${JSON.stringify({ run_id: legacyRunId })}\n`,
  )

  const completeOnly = JSON.parse(
    execFileSync(process.execPath, [CLI, 'archive', '--days', '7', '--json'], {
      cwd: completeRoot,
      encoding: 'utf8',
    }) as string,
  ) as {
    migration: { run_directories: number; state_directories: number }
    archive: {
      inbox_files: string[]
      run_directories: number
      state_directories: number
      run_ids: string[]
    }
  }

  assert.deepEqual(completeOnly.archive.inbox_files, [
    '63379_Jun-22-0158_flag-complete.md',
  ])
  assert.equal(completeOnly.migration.run_directories, 1)
  assert.equal(completeOnly.migration.state_directories, 1)
  assert.equal(completeOnly.archive.run_directories, 1)
  assert.equal(completeOnly.archive.state_directories, 1)
  assert.deepEqual(completeOnly.archive.run_ids, [migratedRunId])
  assert.equal(
    existsSync(
      path.join(
        completeRoot,
        'runtime/logs/workflows/archive',
        migratedRunId,
        'state.json',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        completeRoot,
        'runtime/workflows/archive',
        migratedRunId,
        'modifications.jsonl',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        completeRoot,
        'runtime/inbox/archive/63379_Jun-22-0158_flag-complete.md',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        completeRoot,
        'runtime/inbox/canceled/63379_Jun-22-0158_kept-canceled.md',
      ),
    ),
    true,
  )

  const bothRoot = createFixture()

  writeExpired(bothRoot, 'complete', '63379_Jun-22-0158_both-complete.md')
  writeExpired(bothRoot, 'canceled', '63379_Jun-22-0158_both-canceled.md')

  const both = JSON.parse(
    execFileSync(
      process.execPath,
      [CLI, 'archive', '--days', '7', '--complete', '--canceled', '--json'],
      { cwd: bothRoot, encoding: 'utf8' },
    ) as string,
  ) as { archive: { inbox_files: string[] } }

  assert.deepEqual(both.archive.inbox_files.sort(), [
    '63379_Jun-22-0158_both-canceled.md',
    '63379_Jun-22-0158_both-complete.md',
  ])
})
