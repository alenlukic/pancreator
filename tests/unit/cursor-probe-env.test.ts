import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { probeEnvironment } from '../../src/lib/executors/cursor-probe.js'

function withCursorApiKey<T>(value: string | undefined, run: () => T): T {
  const original = process.env.CURSOR_API_KEY

  if (value === undefined) {
    delete process.env.CURSOR_API_KEY
  } else {
    process.env.CURSOR_API_KEY = value
  }

  try {
    return run()
  } finally {
    if (original === undefined) {
      delete process.env.CURSOR_API_KEY
    } else {
      process.env.CURSOR_API_KEY = original
    }
  }
}

test('the repository .env supplies the probe credential when the process lacks it', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-probe-env-'))

  writeFileSync(
    path.join(root, '.env'),
    'CURSOR_API_KEY=key-from-dotenv\nOTHER_SECRET=must-not-leak\n',
  )

  withCursorApiKey(undefined, () => {
    const env = probeEnvironment(root)

    assert.ok(env)
    assert.equal(env.CURSOR_API_KEY, 'key-from-dotenv')
    // The loader must not mutate the parent process environment.
    assert.equal(process.env.CURSOR_API_KEY, undefined)
  })
})

test('an existing process credential outranks the repository .env', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-probe-env-'))

  writeFileSync(path.join(root, '.env'), 'CURSOR_API_KEY=key-from-dotenv\n')

  withCursorApiKey('key-from-process', () => {
    // No override environment is needed: the inherited one already works.
    assert.equal(probeEnvironment(root), undefined)
  })
})

test('a missing or keyless .env yields no override environment', () => {
  const bare = mkdtempSync(path.join(tmpdir(), 'pan-probe-env-'))
  const keyless = mkdtempSync(path.join(tmpdir(), 'pan-probe-env-'))

  writeFileSync(path.join(keyless, '.env'), 'UNRELATED=value\n')

  withCursorApiKey(undefined, () => {
    assert.equal(probeEnvironment(bare), undefined)
    assert.equal(probeEnvironment(keyless), undefined)
  })
})
