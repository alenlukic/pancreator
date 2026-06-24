import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  acquireFileLock,
  canCancelFileLock,
  digestPath,
  releaseFileLock,
} from '../../src/lib/workspace/locks.js'

function makeLockFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-locks-'))
  const stateRoot = path.join(root, 'state')
  const filePath = path.join(root, 'tracked.ts')

  writeFileSync(filePath, 'export const value = 1\n')

  return { stateRoot, filePath }
}

test('cooperative locks reject conflicting acquisitions', () => {
  const fixture = makeLockFixture()
  const checksum = digestPath(fixture.filePath).checksum
  const lock = {
    schema_version: 1 as const,
    lock_id: randomUUID(),
    path: 'tracked.ts',
    canonical_path: path.resolve(fixture.filePath),
    workflow_id: 'run-1',
    stage: 'implement',
    stage_attempt: 1,
    invocation_id: 'implement-1',
    acquired_at_ms: Date.now(),
    expected_checksum: checksum,
  }

  acquireFileLock(fixture.stateRoot, lock)

  assert.throws(
    () =>
      acquireFileLock(fixture.stateRoot, {
        ...lock,
        lock_id: randomUUID(),
        workflow_id: 'run-2',
      }),
    /already held/u,
  )

  releaseFileLock(fixture.stateRoot, lock.canonical_path)
})

test('cancel policy rejects changed files', () => {
  const fixture = makeLockFixture()
  const before = digestPath(fixture.filePath)
  const lock = {
    schema_version: 1 as const,
    lock_id: randomUUID(),
    path: 'tracked.ts',
    canonical_path: path.resolve(fixture.filePath),
    workflow_id: 'run-1',
    stage: 'implement',
    stage_attempt: 1,
    invocation_id: 'implement-1',
    acquired_at_ms: Date.now(),
    expected_checksum: before.checksum,
  }

  writeFileSync(fixture.filePath, 'export const value = 2\n')

  assert.equal(
    canCancelFileLock(lock, digestPath(fixture.filePath).checksum),
    false,
  )
})
