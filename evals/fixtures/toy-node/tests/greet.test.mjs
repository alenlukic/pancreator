import assert from 'node:assert/strict'
import test from 'node:test'

import { greet } from '../src/greet.mjs'

test('greet names the caller', () => {
  assert.equal(greet('toy'), 'Hello, toy!')
})
