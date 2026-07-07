import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

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
  const currentRunId = makeWorkflowRunId(createdAt, 'abcdef12')
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
