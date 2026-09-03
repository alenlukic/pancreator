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
import { createFixture, createRun } from '../helpers.js'
import { makeWorkflowRunId } from '../../src/lib/naming.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'

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
    path.join(logDirectory, 'workflow.snapshot.json'),
    '{"stages":[{"slug":"plan"}]}\n',
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

test('archives migrated legacy complete items in one pass', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Legacy inbox fixture',
  })
  const statePath = resolveRunLayout(root, run.run_id).state.absolute
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
    status: string
    current_stage: string | null
    pending_action: { type: string }
    request: { source_path: string }
  }
  const legacyRelative = 'runtime/inbox/legacy-complete.md'
  const legacyAbsolute = path.join(root, legacyRelative)

  state.status = 'succeeded'
  state.current_stage = null
  state.pending_action = { type: 'none' }
  state.request.source_path = legacyRelative
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  write(legacyAbsolute, '# Legacy complete\n')
  utimesSync(
    legacyAbsolute,
    new Date('2026-06-22T21:22:54.051Z'),
    new Date('2026-06-22T21:22:54.051Z'),
  )

  const output = execFileSync(
    process.execPath,
    [CLI, 'archive', '--days', '7', '--json'],
    { cwd: root, encoding: 'utf8' },
  )
  const summary = JSON.parse(output) as {
    inbox_layout: { migrated_files: number }
    archive: { inbox_files: string[] }
  }
  const archivedName = summary.archive.inbox_files[0]

  assert.equal(summary.inbox_layout.migrated_files, 1)
  assert.equal(summary.archive.inbox_files.length, 1)
  assert.ok(archivedName)
  assert.equal(existsSync(legacyAbsolute), false)
  assert.equal(
    readFileSync(
      path.join(root, 'runtime/inbox/archive', archivedName),
      'utf8',
    ),
    '# Legacy complete\n',
  )
})

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

test('archives complete inbox items by default', () => {
  const root = createFixture()
  const writeStatusFile = (
    status: 'queue' | 'active' | 'canceled' | 'complete',
    fileName: string,
    modifiedAt: string,
  ): void => {
    const absolute = path.join(root, 'runtime/inbox', status, fileName)

    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, `${status} fixture\n`, 'utf8')
    utimesSync(absolute, new Date(modifiedAt), new Date(modifiedAt))
  }

  writeStatusFile(
    'queue',
    '63379_Jun-22-0158_old-queue.md',
    '2026-06-22T21:22:54.051Z',
  )
  writeStatusFile(
    'active',
    '63379_Jun-22-0158_old-active.md',
    '2026-06-22T21:22:54.051Z',
  )
  writeStatusFile(
    'canceled',
    '63379_Jun-22-0158_old-canceled.md',
    '2026-06-22T21:22:54.051Z',
  )
  writeStatusFile(
    'complete',
    '63379_Jun-22-0158_old-complete.md',
    '2026-06-22T21:22:54.051Z',
  )
  writeStatusFile(
    'complete',
    '63328_Aug-25-1200_fresh-complete.md',
    new Date().toISOString(),
  )

  const output = execFileSync(
    process.execPath,
    [CLI, 'archive', '--days', '7', '--json'],
    { cwd: root, encoding: 'utf8' },
  )
  const summary = JSON.parse(output) as {
    archive: { inbox_files: string[] }
  }

  assert.deepEqual(summary.archive.inbox_files, [
    '63379_Jun-22-0158_old-complete.md',
  ])
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/inbox/archive/63379_Jun-22-0158_old-complete.md',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/inbox/canceled/63379_Jun-22-0158_old-canceled.md',
      ),
    ),
    true,
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

  const completeRoot = createFixture()

  writeExpired(completeRoot, 'complete', '63379_Jun-22-0158_flag-complete.md')

  const completeOnly = JSON.parse(
    execFileSync(
      process.execPath,
      [CLI, 'archive', '--days', '7', '--complete', '--json'],
      { cwd: completeRoot, encoding: 'utf8' },
    ) as string,
  ) as { archive: { inbox_files: string[] } }

  assert.deepEqual(completeOnly.archive.inbox_files, [
    '63379_Jun-22-0158_flag-complete.md',
  ])

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
