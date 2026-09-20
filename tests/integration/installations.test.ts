import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  readProjectConfig,
  registeredInstallations,
  resolveRegisteredInstallation,
} from '../../src/lib/project-config.js'
import { createTestTempDirectory } from '../temp.js'

function configRoot(config: Record<string, unknown>): string {
  const root = createTestTempDirectory('pancreator-installations-')

  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify({ schema_version: 1, ...config }, null, 2)}
`,
  )

  return root
}

test('registered installations preserve declarations without probing paths', () => {
  const missingPath = path.join(
    createTestTempDirectory('pancreator-missing-parent-'),
    'does-not-exist',
  )
  const declared = [
    { id: 'first', path: '/tmp/pancreator-first' },
    { id: 'missing', path: missingPath },
    { id: 'third-install', path: '/tmp/pancreator-third' },
  ]
  const root = configRoot({ installations: declared })
  const absent = configRoot({})

  assert.deepEqual(registeredInstallations(root), declared)
  assert.deepEqual(registeredInstallations(absent), [])
  assert.deepEqual(resolveRegisteredInstallation(root, 'missing'), declared[1])
  assert.throws(
    () => resolveRegisteredInstallation(root, 'unknown'),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'UNKNOWN_INSTALLATION' &&
      error.message.includes('first, missing, third-install'),
  )
})

test('configuration loading rejects every malformed installation shape', () => {
  const cases: Array<[string, unknown]> = [
    ['non-array', {}],
    ['missing id', [{ path: '/tmp/pancreator' }]],
    ['invalid id', [{ id: 'Invalid_ID', path: '/tmp/pancreator' }]],
    [
      'duplicate id',
      [
        { id: 'same', path: '/tmp/one' },
        { id: 'same', path: '/tmp/two' },
      ],
    ],
    ['missing path', [{ id: 'missing-path' }]],
    ['relative path', [{ id: 'relative', path: 'relative/path' }]],
  ]

  for (const [label, installations] of cases) {
    const root = configRoot({ installations })

    assert.throws(
      () => readProjectConfig(root),
      (error: unknown) =>
        error instanceof PanError &&
        error.code === 'INVALID_PROJECT_CONFIG' &&
        error.message.includes('installations'),
      label,
    )
  }
})
