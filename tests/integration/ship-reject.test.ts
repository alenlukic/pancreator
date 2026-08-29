import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { decideRun, prepareInvocation } from '../../src/lib/engine.js'
import { checkpoint } from './delivery-helpers.js'

test('ship reject defaults to a paused operator decision instead of an implementation loop', () => {
  const { root, runId, state } = checkpoint('delivery@ship-awaiting-operator')

  assert.equal(state.status, 'awaiting_operator')

  const decided = decideRun(root, runId, 'reject', 'Commit message is wrong.')

  assert.equal(decided.status, 'paused')
  assert.equal(decided.current_stage, 'ship')
  assert.equal(decided.pending_action.type, 'operator_decision')
})

test('ship reject with --stage routes to the chosen stage and resets attempts', () => {
  const {
    root,
    runId,
    state: atGate,
  } = checkpoint('delivery@ship-awaiting-operator')

  // A stage the run has already left holds no retry counter: max_stage_attempts
  // bounds retries of the active stage, not lifetime visits. The per-attempt
  // history remains in stage_history.
  assert.equal(atGate.status, 'awaiting_operator')
  assert.equal(atGate.attempts.implement, undefined)
  assert.equal(atGate.attempts.ship, 1)
  assert.equal(
    atGate.stage_history.filter((item) => item.stage === 'implement').length,
    1,
  )

  const decided = decideRun(
    root,
    runId,
    'reject',
    'Architecture is wrong; replan.',
    'plan',
  )

  assert.equal(decided.status, 'running')
  assert.equal(decided.current_stage, 'plan')
  assert.equal(decided.attempts.plan, undefined)
  assert.equal(decided.attempts.implement, undefined)
  assert.equal(decided.attempts.ship, undefined)
  assert.equal(decided.consecutive_failures, 0)

  assert.ok(decided.operator_feedback)
  const feedback = decided.operator_feedback?.find(
    (item) => item.decision === 'reject' && item.to_stage === 'plan',
  )

  assert.ok(feedback)
  assert.equal(feedback.from_stage, 'ship')
  assert.equal(feedback.to_stage, 'plan')
  assert.ok(existsSync(path.join(root, feedback.path)))

  const feedbackBody = readFileSync(path.join(root, feedback.path), 'utf8')

  assert.match(feedbackBody, /Architecture is wrong; replan/u)

  const prepared = prepareInvocation(root, runId)

  assert.ok(prepared.invocation)
  assert.equal(prepared.invocation.stage.slug, 'plan')
  assert.ok(
    prepared.invocation.inputs.references.some(
      (reference) => reference.path === feedback.path,
    ),
    'remediation invocation should reference the operator feedback artifact',
  )
})
