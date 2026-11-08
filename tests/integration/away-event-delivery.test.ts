import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deliverDeferredClauses,
  firedContext,
} from '../../src/lib/governance/prompt-context/deferred.js'
import { AWAY, checkpoint } from './delivery-helpers.js'

const shellCall = {
  hookEvent: 'postToolUse',
  toolName: 'Shell',
  toolInput: { command: 'pan status' },
  prompt: '',
}

test('a live away-mode run fires away and delivers the AWAY-001 body once', () => {
  const { root, state } = checkpoint('delivery@created', AWAY)

  assert.equal(state.away_mode?.enabled, true)

  const fired = firedContext(root, shellCall)

  assert.ok(fired.events.includes('away'))

  const delivered = deliverDeferredClauses(root, 'supervisor-conv', fired)

  assert.ok(delivered)
  assert.match(delivered, /AWAY-001/u)
  assert.match(delivered, /pan away decide/u)
  assert.doesNotMatch(delivered, /Disabled runs MUST keep every operator stop/u)
  assert.equal(deliverDeferredClauses(root, 'supervisor-conv', fired), null)
})

test('a run without away mode fires no away event', () => {
  const { root, state } = checkpoint('delivery@created')

  assert.notEqual(state.away_mode?.enabled, true)
  assert.ok(!firedContext(root, shellCall).events.includes('away'))
})
