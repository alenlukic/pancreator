import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

// The io helpers are pure filesystem primitives; a bare temporary directory is
// all they need.
function scratchRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-io-'))

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

  // A dead operation mutex is removed explicitly for status recovery; a
  // second clear reports that nothing was left to remove.
  writeFileSync(mutex, '99999999\n')
  assert.equal(clearStaleOperationMutex(mutex), true)
  assert.equal(clearStaleOperationMutex(mutex), false)
})
