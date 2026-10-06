import assert from 'node:assert/strict'
import test from 'node:test'

import { greet, goodbye } from '../src/greet.mjs'

test('greet names the caller', () => {
  assert.equal(greet('toy'), 'Hello, toy!')
})

test('goodbye names the caller', () => {
  assert.equal(goodbye('toy'), 'Goodbye, toy!')
})
