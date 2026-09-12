import assert from 'node:assert/strict'
import test from 'node:test'

import { decideRun } from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { checkpoint } from './delivery-helpers.js'
import {
  failingVerifyData,
  submitStage,
} from './operator-involvement-helpers.js'

test('an operator gate under the contract records its checkpoint', () => {
  // Plan stops at the technical_plan checkpoint the contract watches.
  const plan = checkpoint('planning[td]@plan-submitted')

  assert.equal(plan.state.status, 'awaiting_operator')
  assert.equal(
    'checkpoint' in plan.state.pending_action
      ? plan.state.pending_action.checkpoint
      : undefined,
    'technical_plan',
  )

  const {
    root,
    runId,
    state: verify,
    workflow,
  } = checkpoint('delivery[td]@verify-submitted')

  assert.equal(verify.stage_history.at(-1)?.stage, 'verify')
  assert.equal(verify.stage_history.at(-1)?.outcome, 'success')
  assert.equal(verify.status, 'awaiting_operator')
  assert.equal(
    verify.pending_action.type === 'operator_approval' &&
      verify.pending_action.outcome,
    'success',
  )
  assert.equal(
    'checkpoint' in verify.pending_action
      ? verify.pending_action.checkpoint
      : undefined,
    'independent_review',
  )

  const verifyDecided = decideRun(root, runId, 'approve', 'Proceed to release.')

  assert.equal(verifyDecided.current_stage, 'ship')

  // Ship is an ordinary operator gate; it carries no checkpoint.
  const ship = submitStage(root, runId, stageBySlug(workflow, 'ship'))

  assert.equal(ship.submitted.state.status, 'awaiting_operator')
  assert.equal(
    'checkpoint' in ship.submitted.state.pending_action
      ? ship.submitted.state.pending_action.checkpoint
      : undefined,
    undefined,
  )
})

test('an operator gate stops a failed stage before its failure transition', () => {
  const { root, runId, workflow } = checkpoint('delivery[td]@verify-prepared')

  const verify = submitStage(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'failure',
    (output) => {
      output.data.verify = failingVerifyData()
    },
  )

  assert.equal(verify.submitted.record.outcome, 'failure')
  // Without the stop, a failed verify would route straight to remediation and
  // spend the operator's decision for them.
  assert.equal(verify.submitted.state.status, 'awaiting_operator')
  assert.equal(verify.submitted.state.current_stage, 'verify')
  assert.equal(
    verify.submitted.state.pending_action.type === 'operator_approval' &&
      verify.submitted.state.pending_action.outcome,
    'failure',
  )
  assert.equal(
    verify.submitted.state.pending_action.type === 'operator_approval' &&
      verify.submitted.state.pending_action.proposed_transition,
    'remediate',
  )
  assert.equal(
    'checkpoint' in verify.submitted.state.pending_action
      ? verify.submitted.state.pending_action.checkpoint
      : undefined,
    'independent_review',
  )

  // Approval applies the recorded outcome, so the failure takes its own route.
  const decided = decideRun(root, runId, 'approve', 'Route the failure back.')

  assert.equal(decided.status, 'running')
  assert.equal(decided.current_stage, 'remediate')
})
