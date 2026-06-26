import assert from 'node:assert/strict'
import test from 'node:test'

import { validateProjectionDrift } from '../../src/lib/projection.js'
import { createFixture } from '../helpers.js'

test('projection drift validation runs on fixture repository', () => {
  const root = createFixture()
  const result = validateProjectionDrift(root)

  assert.equal(typeof result.regeneration_command, 'string')
})
