import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  DEFAULT_TEST_SCRATCH_PATH,
  testScratchDeclarationError,
  testScratchRoot,
} from '../../src/lib/test-scratch.js'
import { createTestTempDirectory } from '../temp.js'

function checkout(
  config: Record<string, unknown> | null,
  overrides?: Record<string, unknown>,
): string {
  const root = createTestTempDirectory('pancreator-test-scratch-')

  if (config) {
    writeFileSync(path.join(root, 'config.json'), JSON.stringify(config))
  }

  if (overrides) {
    writeFileSync(
      path.join(root, 'config_overrides.json'),
      JSON.stringify(overrides),
    )
  }

  return root
}

test('an undeclared scratch root stays inside the checkout', () => {
  for (const root of [
    checkout(null),
    checkout({ schema_version: 1 }),
    checkout({ schema_version: 1, test_scratch: {} }),
  ]) {
    assert.equal(
      testScratchRoot(root),
      path.join(root, DEFAULT_TEST_SCRATCH_PATH),
    )
  }
})

test('a declared root expands the home directory and names one child per checkout', () => {
  const home = createTestTempDirectory('pancreator-home-')
  const config = { test_scratch: { root: '~/Dev/scratch' } }
  const first = checkout(config)
  const second = checkout(config)
  const scratch = testScratchRoot(first, home)

  assert.equal(path.dirname(scratch), path.join(home, 'Dev', 'scratch'))
  assert.match(
    path.basename(scratch),
    new RegExp(`^${path.basename(first)}-[0-9a-f]{12}\\.noindex$`, 'u'),
  )
  assert.equal(testScratchRoot(first, home), scratch)
  assert.notEqual(testScratchRoot(second, home), scratch)
})

test('a relative root resolves against the checkout', () => {
  const root = checkout({ test_scratch: { root: 'scratch-area' } })

  assert.equal(
    path.dirname(testScratchRoot(root)),
    path.join(root, 'scratch-area'),
  )
})

test('config_overrides.json replaces the root, and null restores the default', () => {
  const home = createTestTempDirectory('pancreator-home-')
  const moved = checkout(
    { test_scratch: { root: '~/one' } },
    { test_scratch: { root: '~/two' } },
  )
  const restored = checkout(
    { test_scratch: { root: '~/one' } },
    { test_scratch: { root: null } },
  )
  const inherited = checkout(
    { test_scratch: { root: '~/one' } },
    { active_config: 'balanced' },
  )

  assert.equal(
    path.dirname(testScratchRoot(moved, home)),
    path.join(home, 'two'),
  )
  assert.equal(
    testScratchRoot(restored, home),
    path.join(restored, DEFAULT_TEST_SCRATCH_PATH),
  )
  assert.equal(
    path.dirname(testScratchRoot(inherited, home)),
    path.join(home, 'one'),
  )
})

test('a malformed declaration is refused rather than silently ignored', () => {
  assert.equal(testScratchDeclarationError(undefined), null)
  assert.equal(testScratchDeclarationError({ root: null }), null)
  assert.match(testScratchDeclarationError('~/x') ?? '', /MUST be an object/u)
  assert.match(
    testScratchDeclarationError({ root: '  ' }) ?? '',
    /non-empty path or null/u,
  )
  assert.match(
    testScratchDeclarationError({ root: 7 }) ?? '',
    /non-empty path or null/u,
  )

  const root = checkout({ test_scratch: { root: '' } })

  assert.throws(
    () => testScratchRoot(root),
    /config\.json: .*test_scratch\.root/u,
  )
})
