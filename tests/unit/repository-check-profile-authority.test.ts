import assert from 'node:assert/strict'
import test from 'node:test'

import { assertRepositoryCheckProfileAllowed } from '../../src/lib/repository-checks.js'

test('verify agents cannot run the full profile owned by the ship gate', () => {
  assert.throws(
    () => assertRepositoryCheckProfileAllowed('full', 'verify', 'agent'),
    (error: unknown) => {
      assert.match(String(error), /VERIFY-001/u)
      assert.match(String(error), /ship release gate/u)
      return true
    },
  )

  assert.doesNotThrow(() =>
    assertRepositoryCheckProfileAllowed('fast', 'verify', 'agent'),
  )
  assert.doesNotThrow(() =>
    assertRepositoryCheckProfileAllowed('full', 'ship', 'harness'),
  )
})
