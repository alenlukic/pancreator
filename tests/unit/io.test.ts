import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {createFixture} from '../helpers.js'
import {writeFileSync} from 'node:fs'
import {
  readJson,
  resolveInside,
  sha256,
  stableStringify,
  withFileLock,
  writeJsonAtomic,
} from '../../src/lib/io.js'

test('atomic JSON writes and stable hashes are deterministic', () => {
  const root = createFixture()
  const file = path.join(root, 'runtime', 'value.json')
  writeJsonAtomic(file, {b: 2, a: 1})
  assert.deepEqual(readJson(file), {b: 2, a: 1})
  assert.equal(sha256({a: 1, b: 2}), sha256({b: 2, a: 1}))
  assert.equal(stableStringify({b: 2, a: 1}), '{"a":1,"b":2}')
})

test('repository path resolution rejects escapes and locks serialize access', () => {
  const root = createFixture()
  assert.throws(
    () => resolveInside(root, '../escape'),
    /escapes repository root/,
  )
  const lock = path.join(root, 'runtime', '.lock')
  writeFileSync(lock, '99999999\n')
  const result = withFileLock(lock, () => 'ok')
  assert.equal(result, 'ok')
})
