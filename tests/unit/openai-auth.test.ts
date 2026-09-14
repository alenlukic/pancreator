import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  openAiAuthenticationReadiness,
  resolveOpenAiApiKey,
} from '../../src/lib/executors/openai-auth.js'
import { createTestTempDirectory } from '../temp.js'

const SECRET = 'sk-openai-super-secret-value'

function makeRoot(): string {
  return createTestTempDirectory('openai-auth-')
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

function withOpenAiApiKey<T>(value: string | undefined, run: () => T): T {
  const original = process.env.OPENAI_API_KEY

  if (value === undefined) {
    delete process.env.OPENAI_API_KEY
  } else {
    process.env.OPENAI_API_KEY = value
  }

  try {
    return run()
  } finally {
    if (original === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = original
    }
  }
}

function makeGitWorktreePair(): { mainRoot: string; worktreeRoot: string } {
  const mainRoot = makeRoot()
  const worktreeRoot = makeRoot()

  const git = (args: string[]): void => {
    const result = spawnSync('git', args, {
      cwd: mainRoot,
      encoding: 'utf8',
      timeout: 5_000,
    })

    assert.equal(
      result.status,
      0,
      `git ${args.join(' ')} failed: ${result.stderr}`,
    )
  }

  git(['init', '-q'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  writeFileSync(path.join(mainRoot, 'README.md'), 'fixture\n')
  git(['add', 'README.md'])
  git(['commit', '-q', '-m', 'fixture'])
  git(['worktree', 'add', '-q', '-b', 'openai-fixture', worktreeRoot])

  return { mainRoot, worktreeRoot }
}

test('a process credential outranks repository .env files', () => {
  const root = makeRoot()

  writeFileSync(path.join(root, '.env'), 'OPENAI_API_KEY=key-from-dotenv\n')

  withOpenAiApiKey('key-from-process', () => {
    assert.deepEqual(resolveOpenAiApiKey(root), {
      key: 'key-from-process',
      source: 'process_environment',
      sourcePath: null,
    })
  })
})

test('the caller .env supplies the key when the process lacks one', () => {
  const root = makeRoot()

  writeFileSync(path.join(root, '.env'), 'OPENAI_API_KEY=key-from-dotenv\n')

  withOpenAiApiKey(undefined, () => {
    assert.deepEqual(resolveOpenAiApiKey(root), {
      key: 'key-from-dotenv',
      source: 'dotenv',
      sourcePath: path.join(root, '.env'),
    })
  })
})

test('a linked worktree falls back to the main checkout .env', () => {
  const { mainRoot, worktreeRoot } = makeGitWorktreePair()

  writeFileSync(path.join(mainRoot, '.env'), `OPENAI_API_KEY=${SECRET}\n`)

  withOpenAiApiKey(undefined, () => {
    assert.deepEqual(resolveOpenAiApiKey(worktreeRoot), {
      key: SECRET,
      source: 'dotenv',
      sourcePath: path.join(mainRoot, '.env'),
    })
  })
})

test('a worktree .env outranks the main checkout .env', () => {
  const { mainRoot, worktreeRoot } = makeGitWorktreePair()

  writeFileSync(path.join(mainRoot, '.env'), 'OPENAI_API_KEY=key-from-main\n')
  writeFileSync(
    path.join(worktreeRoot, '.env'),
    'OPENAI_API_KEY=key-from-worktree\n',
  )

  withOpenAiApiKey(undefined, () => {
    assert.equal(resolveOpenAiApiKey(worktreeRoot).key, 'key-from-worktree')
  })
})

test('a nested caller directory finds its Git worktree root .env', () => {
  const { worktreeRoot } = makeGitWorktreePair()
  const nested = path.join(worktreeRoot, 'nested')

  mkdirSync(nested)
  writeFileSync(path.join(worktreeRoot, '.env'), `OPENAI_API_KEY=${SECRET}\n`)

  withOpenAiApiKey(undefined, () => {
    assert.equal(resolveOpenAiApiKey(nested).key, SECRET)
  })
})

test('a missing or keyless .env resolves to no key', () => {
  const root = makeRoot()

  writeFileSync(path.join(root, '.env'), 'UNRELATED=value\n')

  withOpenAiApiKey(undefined, () => {
    assert.deepEqual(resolveOpenAiApiKey(root), {
      key: null,
      source: null,
      sourcePath: null,
    })
  })
})

test('readiness advises a remedy when no .env exists', () => {
  const root = makeRoot()

  withOpenAiApiKey(undefined, () => {
    const readiness = openAiAuthenticationReadiness(root)

    assert.equal(readiness.key_available, false)
    assert.ok(
      readiness.advisories.some((advisory) =>
        advisory.includes('No .env file exists at'),
      ),
    )
  })
})

test('readiness reports an unreadable .env without throwing', () => {
  const root = makeRoot()

  mkdirSync(path.join(root, '.env'))

  withOpenAiApiKey(undefined, () => {
    const readiness = openAiAuthenticationReadiness(root)

    assert.equal(readiness.key_available, false)
    assert.equal(readiness.dotenv_files[0]?.parsable, false)
    assert.ok(
      readiness.advisories.some((advisory) =>
        advisory.includes('could not be read as an environment file'),
      ),
    )
  })
})

test('readiness never discloses the credential value or length', () => {
  const root = makeRoot()

  writeFileSync(path.join(root, '.env'), `OPENAI_API_KEY=${SECRET}\n`)

  withOpenAiApiKey(undefined, () => {
    const serialized = JSON.stringify(openAiAuthenticationReadiness(root))

    assert.doesNotMatch(serialized, new RegExp(SECRET, 'u'))
    assert.doesNotMatch(serialized, /sk-openai/u)
    assert.equal(countNumbers(openAiAuthenticationReadiness(root)), 0)
  })
})
