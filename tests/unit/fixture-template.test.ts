import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertFixtureTemplateWithinLimit,
  MAX_FIXTURE_TEMPLATE_BYTES,
} from '../fixture-template.js'

test('fixture template size guard permits the limit and names an excess', () => {
  assert.doesNotThrow(() =>
    assertFixtureTemplateWithinLimit({
      bytes: MAX_FIXTURE_TEMPLATE_BYTES,
      files: 100,
    }),
  )

  const measured = MAX_FIXTURE_TEMPLATE_BYTES + 1024

  assert.throws(
    () =>
      assertFixtureTemplateWithinLimit({
        bytes: measured,
        files: 101,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes(String(measured)) &&
      error.message.includes('30 MB limit'),
  )
})
