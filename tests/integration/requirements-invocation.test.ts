import assert from 'node:assert/strict'
import test from 'node:test'

import { buildValidationMap } from '../../src/lib/requirements/map.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { createFixture } from '../helpers.js'

test('validation map is stable for fixed inputs', () => {
  const root = createFixture()
  const first = buildValidationMap(root)
  const second = buildValidationMap(root)

  assert.deepEqual(first, second)
  assert.ok(first.length > 0)
})

test('out-of-workflow resolve matches workflow manifest shape', () => {
  const root = createFixture()
  const manifest = resolveRequirements(root, {
    persona: 'coder',
    workflow: 'dev',
    stage: 'implement',
    invocation: { output_path: 'runtime/logs/workflows/x/outputs/y.json' },
  })

  assert.equal(manifest.schema_version, 1)
  assert.ok(Array.isArray(manifest.validation_requirements))
  assert.ok(typeof manifest.manifest_hash === 'string')
})
