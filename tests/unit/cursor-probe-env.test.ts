import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  cursorAuthenticationReadiness,
  probeEnvironment,
} from '../../src/lib/executors/cursor-probe.js'

const SECRET = 'sk-cursor-super-secret-value'

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'pan-probe-env-'))
}

/** Make an embedded harness at `<target>/.pancreator`, below the target. */
function makeEmbeddedInstallation(): { target: string; harness: string } {
  const target = makeRoot()
  const harness = path.join(target, '.pancreator')

  mkdirSync(harness, { recursive: true })
  writeFileSync(
    path.join(harness, 'config.json'),
    `${JSON.stringify({
      schema_version: 1,
      workspace_root: '..',
      state_root: 'runtime',
      installation_mode: 'embedded',
    })}\n`,
  )

  return { target, harness }
}

function countNumbers(value: unknown): number {
  if (typeof value === 'number') {
    return 1
  }

  if (Array.isArray(value)) {
    return value.reduce<number>((total, item) => total + countNumbers(item), 0)
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce<number>(
      (total, item) => total + countNumbers(item),
      0,
    )
  }

  return 0
}

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
  const root = makeRoot()

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
  const root = makeRoot()

  writeFileSync(path.join(root, '.env'), 'CURSOR_API_KEY=key-from-dotenv\n')

  withCursorApiKey('key-from-process', () => {
    // No override environment is needed: the inherited one already works.
    assert.equal(probeEnvironment(root), undefined)
  })
})

test('a missing or keyless .env yields no override environment', () => {
  const bare = makeRoot()
  const keyless = makeRoot()

  writeFileSync(path.join(keyless, '.env'), 'UNRELATED=value\n')

  withCursorApiKey(undefined, () => {
    assert.equal(probeEnvironment(bare), undefined)
    assert.equal(probeEnvironment(keyless), undefined)
  })
})

test('an embedded probe reads the target workspace root .env', () => {
  const { target, harness } = makeEmbeddedInstallation()

  writeFileSync(path.join(target, '.env'), 'CURSOR_API_KEY=key-from-target\n')

  withCursorApiKey(undefined, () => {
    const env = probeEnvironment(harness)

    assert.ok(env)
    assert.equal(env.CURSOR_API_KEY, 'key-from-target')
  })
})

test('an installation .env outranks the target workspace root .env', () => {
  const { target, harness } = makeEmbeddedInstallation()

  writeFileSync(path.join(harness, '.env'), 'CURSOR_API_KEY=key-from-harness\n')
  writeFileSync(path.join(target, '.env'), 'CURSOR_API_KEY=key-from-target\n')

  withCursorApiKey(undefined, () => {
    assert.equal(probeEnvironment(harness)?.CURSOR_API_KEY, 'key-from-harness')
  })
})

test('readiness reports the process environment as the resolved source', () => {
  const root = makeRoot()

  withCursorApiKey(SECRET, () => {
    const readiness = cursorAuthenticationReadiness(root)

    assert.equal(readiness.key_available, true)
    assert.equal(readiness.source, 'process_environment')
    assert.equal(readiness.source_path, null)
    assert.deepEqual(readiness.advisories, [])
  })
})

test('readiness names the .env that supplies the credential', () => {
  const { target, harness } = makeEmbeddedInstallation()

  writeFileSync(path.join(target, '.env'), `CURSOR_API_KEY=${SECRET}\n`)

  withCursorApiKey(undefined, () => {
    const readiness = cursorAuthenticationReadiness(harness)

    assert.equal(readiness.key_available, true)
    assert.equal(readiness.source, 'dotenv')
    assert.equal(readiness.source_path, path.join(target, '.env'))
    assert.deepEqual(readiness.advisories, [])
    assert.deepEqual(
      readiness.dotenv_files.map((file) => file.path),
      [path.join(harness, '.env'), path.join(target, '.env')],
    )
  })
})

test('readiness advises both remedies when no .env exists at all', () => {
  const root = makeRoot()

  withCursorApiKey(undefined, () => {
    const readiness = cursorAuthenticationReadiness(root)

    assert.equal(readiness.key_available, false)
    assert.equal(readiness.source, null)
    assert.deepEqual(readiness.dotenv_files, [
      {
        path: path.join(root, '.env'),
        exists: false,
        parsable: null,
        declares_key: null,
      },
    ])
    assert.ok(
      readiness.advisories.some((advisory) =>
        advisory.includes('No .env file exists at'),
      ),
    )
    assert.ok(
      readiness.advisories.some(
        (advisory) =>
          advisory.includes(`CURSOR_API_KEY=<key> to ${root}`) &&
          advisory.includes('cursor-agent login'),
      ),
    )
  })
})

test('readiness distinguishes a .env that declares no credential', () => {
  const root = makeRoot()

  writeFileSync(path.join(root, '.env'), 'UNRELATED=value\nCURSOR_API_KEY=\n')

  withCursorApiKey(undefined, () => {
    const readiness = cursorAuthenticationReadiness(root)

    assert.equal(readiness.key_available, false)
    assert.equal(readiness.dotenv_files[0]?.exists, true)
    assert.equal(readiness.dotenv_files[0]?.parsable, true)
    assert.equal(readiness.dotenv_files[0]?.declares_key, false)
    assert.ok(
      readiness.advisories.some((advisory) =>
        advisory.includes('declares no non-empty CURSOR_API_KEY'),
      ),
    )
  })
})

test('readiness reports an unreadable .env instead of throwing', () => {
  const root = makeRoot()

  // A directory at the `.env` path fails the same read step that malformed
  // content fails.
  mkdirSync(path.join(root, '.env'))

  withCursorApiKey(undefined, () => {
    const readiness = cursorAuthenticationReadiness(root)

    assert.equal(readiness.key_available, false)
    assert.equal(readiness.dotenv_files[0]?.exists, true)
    assert.equal(readiness.dotenv_files[0]?.parsable, false)
    assert.equal(readiness.dotenv_files[0]?.declares_key, null)
    assert.ok(
      readiness.advisories.some((advisory) =>
        advisory.includes('could not be read as an environment file'),
      ),
    )
    assert.equal(probeEnvironment(root), undefined)
  })
})

test('readiness never discloses the credential or its length', () => {
  const root = makeRoot()

  writeFileSync(path.join(root, '.env'), `CURSOR_API_KEY=${SECRET}\n`)

  withCursorApiKey(undefined, () => {
    const readiness = cursorAuthenticationReadiness(root)
    const serialized = JSON.stringify(readiness)

    assert.doesNotMatch(serialized, new RegExp(SECRET, 'u'))
    assert.doesNotMatch(serialized, /sk-cursor/u)
    assert.doesNotMatch(serialized, new RegExp(SECRET.slice(0, 8), 'u'))
    assert.doesNotMatch(serialized, new RegExp(SECRET.slice(-8), 'u'))
    // The length can only surface as a number, and the report carries none.
    assert.equal(countNumbers(readiness), 0)
  })
})
