import assert from 'node:assert/strict'
import test from 'node:test'

import { auditDirectives } from '../../src/lib/governance/audit-directives.js'
import { createFixture } from '../helpers.js'

test('directive audit passes on fixture repository', () => {
  const root = createFixture()
  const result = auditDirectives(root)

  assert.equal(result.errors.length, 0)
})
