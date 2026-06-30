import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const ROOT = process.cwd()
const BIN_DIR = path.join(ROOT, 'bin')
const SCRIPTS_DIR = path.join(ROOT, 'scripts')

test('durable automation lives under bin without file-type suffixes', () => {
  assert.equal(existsSync(BIN_DIR), true)

  const entries = readdirSync(BIN_DIR)
  assert.ok(entries.length > 0)

  for (const entry of entries) {
    assert.doesNotMatch(entry, /\.(sh|bash|mjs|js)$/u)
  }
})

test('repository scripts directory is not used for durable automation', () => {
  assert.equal(existsSync(SCRIPTS_DIR), false)
})
