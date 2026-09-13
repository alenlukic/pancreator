import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  clearStaleOperationMutex,
  readJson,
  resolveInside,
  sha256,
  stableStringify,
  withOperationMutex,
  writeJsonAtomic,
} from '../../src/lib/io.js'
import { createTestTempDirectory } from '../temp.js'

// The io helpers are pure filesystem primitives, so a bare temporary directory
// is enough.
function scratchRoot(): string {
  const root = createTestTempDirectory('pan-io-')

  mkdirSync(path.join(root, 'runtime'), { recursive: true })

  return root
}

test('atomic JSON writes and stable hashes are deterministic', () => {
  const root = scratchRoot()
  const file = path.join(root, 'runtime', 'value.json')
  writeJsonAtomic(file, { b: 2, a: 1 })
  assert.deepEqual(readJson(file), { b: 2, a: 1 })
  assert.equal(sha256({ a: 1, b: 2 }), sha256({ b: 2, a: 1 }))
  assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}')
})

test('repository path resolution rejects escapes and run operations serialize access', () => {
  const root = scratchRoot()
  assert.throws(
    () => resolveInside(root, '../escape'),
    /escapes repository root/,
  )
  const mutex = path.join(root, 'runtime', '.operation-mutex')
  writeFileSync(mutex, '99999999\n')
  const result = withOperationMutex(mutex, () => 'ok')
  assert.equal(result, 'ok')

  writeFileSync(mutex, '99999999\n')
  assert.equal(clearStaleOperationMutex(mutex), true)
  assert.equal(clearStaleOperationMutex(mutex), false)
})

test('a caller that asks to wait still refuses a mutex a live process holds', () => {
  const root = scratchRoot()
  const mutex = path.join(root, 'runtime', '.waiting-mutex')

  mkdirSync(path.dirname(mutex), { recursive: true })
  // This process is the live holder, so the wait can only expire. A refusal
  // that never arrives is the failure mode a bounded wait has to avoid.
  writeFileSync(mutex, `${process.pid}\n`)

  const started = Date.now()

  assert.throws(
    () =>
      withOperationMutex(mutex, () => 'unreachable', {
        waitForHolderMs: 200,
      }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'RUN_OPERATION_IN_PROGRESS',
  )
  assert.ok(
    Date.now() - started >= 200,
    'the caller refused before its wait expired',
  )

  // Nothing was left behind for the next caller, whose hold succeeds once
  // the holder releases.
  rmSync(mutex, { force: true })
  assert.equal(
    withOperationMutex(mutex, () => 'ok', { waitForHolderMs: 200 }),
    'ok',
  )
})
