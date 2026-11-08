import assert from 'node:assert/strict'
import test from 'node:test'

import { pauseRun } from '../../src/lib/engine.js'
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

test('a /pan-resume prompt against a paused run delivers the PAUSE-001 body', () => {
  const { root, runId } = checkpoint('delivery@created')
  const resumePrompt = {
    hookEvent: 'beforeSubmitPrompt',
    toolName: null,
    toolInput: {},
    prompt: `/pan-resume ${runId}`,
  }

  assert.ok(!firedContext(root, resumePrompt).events.includes('pause'))

  pauseRun(root, runId, 'operator edits the workspace')

  const fired = firedContext(root, resumePrompt)

  assert.ok(fired.events.includes('pause'))

  const delivered = deliverDeferredClauses(root, 'resume-conv', fired)

  assert.ok(delivered)
  assert.match(delivered, /PAUSE-001/u)
  assert.match(delivered, /MUST NOT auto-ratify workspace divergence/u)
})
