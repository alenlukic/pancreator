import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  getRunState,
  pauseRun,
  prepareInvocation,
  resumeRun,
  submitOutput,
} from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { checkpoint } from './delivery-helpers.js'

test('operator pause preserves supervisor gate and resume restores it', () => {
  // The delivery-candidate plan is the supervisor-gated stage.
  const {
    root,
    runId,
    state: submitted,
    invocation: planInvocation,
  } = checkpoint('delivery-candidate@plan-awaiting-supervisor')

  assert.ok(planInvocation)
  assert.equal(submitted.status, 'awaiting_supervisor')
  assert.equal(submitted.pending_action.type, 'supervisor_assessment')

  const paused = pauseRun(root, runId, 'Need to edit the repo first.')

  assert.equal(paused.status, 'paused')
  assert.equal(paused.pending_action.type, 'operator_decision')
  assert.equal(paused.pause_reason, 'Need to edit the repo first.')
  assert.ok(paused.operator_pause)
  assert.equal(paused.operator_pause?.prior_status, 'awaiting_supervisor')
  assert.equal(
    paused.operator_pause?.prior_pending_action.type,
    'supervisor_assessment',
  )
  assert.equal(paused.current_invocation?.id, planInvocation.invocation_id)

  assert.throws(
    () => resumeRun(root, runId, null, 'Attach this to the next worker.'),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('no active worker card to target'),
  )

  const resumed = resumeRun(root, runId)

  assert.equal(resumed.status, 'awaiting_supervisor')
  assert.equal(resumed.pending_action.type, 'supervisor_assessment')
  assert.equal(resumed.operator_pause, null)
  assert.equal(resumed.current_invocation?.id, planInvocation.invocation_id)
})

test('operator changes made during a pause are ratified and stale cards are replaced', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Paused operator edit fixture',
  })
  const runId = state.run_id

  const pausedBeforePrepare = pauseRun(root, runId, 'Stepping away.')

  assert.equal(pausedBeforePrepare.status, 'paused')
  assert.equal(pausedBeforePrepare.operator_pause?.prior_status, 'running')
  assert.equal(
    pausedBeforePrepare.operator_pause?.prior_pending_action.type,
    'prepare_invocation',
  )

  const resumedToPrepare = resumeRun(root, runId)

  assert.equal(resumedToPrepare.status, 'running')
  assert.equal(resumedToPrepare.pending_action.type, 'prepare_invocation')

  const prepared = prepareInvocation(root, runId)
  const firstInvocation = prepared.invocation

  assert.ok(firstInvocation)
  assert.equal(firstInvocation.attempt, 1)

  // A resume note with no stage replaces the prepared worker card.
  pauseRun(root, runId, 'Need an operator directive.')

  const notedResume = resumeRun(
    root,
    runId,
    null,
    'Preserve the compatibility boundary.',
  )

  assert.equal(notedResume.status, 'running')
  assert.equal(notedResume.pending_action.type, 'prepare_invocation')
  assert.equal(notedResume.current_invocation, null)

  const originalInvocation = prepareInvocation(root, runId).invocation

  assert.ok(originalInvocation)
  assert.notEqual(
    originalInvocation.invocation_id,
    firstInvocation.invocation_id,
  )

  const resumeFeedback = getRunState(root, runId).operator_feedback?.find(
    (item) =>
      item.decision === 'resume' &&
      item.note === 'Preserve the compatibility boundary.',
  )

  assert.ok(resumeFeedback)
  assert.ok(
    originalInvocation.inputs.references.some(
      (reference) => reference.path === resumeFeedback.path,
    ),
  )

  pauseRun(root, runId, 'Operator is applying an authorized correction.')
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const operatorFix = true\n',
  )

  const resumed = resumeRun(root, runId, 'plan', 'Authorized operator fix.')

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.pending_action.type, 'prepare_invocation')
  assert.equal(resumed.current_invocation, null)
  assert.equal(resumed.attempts.plan, 0)
  assert.equal(resumed.operator_workspace_ratifications?.length, 1)
  assert.equal(
    resumed.accepted_workspace_fingerprint,
    resumed.operator_workspace_ratifications?.[0]?.workspace_fingerprint,
  )

  const replacement = prepareInvocation(root, runId).invocation

  assert.ok(replacement)
  assert.equal(replacement.attempt, 1)
  assert.notEqual(replacement.invocation_id, originalInvocation.invocation_id)
  assert.equal(
    replacement.workspace_before.fingerprint,
    resumed.accepted_workspace_fingerprint,
  )
})

test('harness pause resume still restarts at prepare_invocation', () => {
  // A blocked plan under the supervisor gate pauses the run without an
  // operator pause record; delivery-candidate declares that gate.
  const {
    root,
    runId,
    invocation: planInvocation,
    workflow,
  } = checkpoint('delivery-candidate@plan-prepared')

  assert.ok(planInvocation)

  const blockedOutput = makeOutput(
    root,
    planInvocation,
    stageBySlug(workflow, 'plan'),
  )

  blockedOutput.result = 'blocked'
  blockedOutput.summary = 'Need operator input before continuing.'

  writeJson(path.join(root, planInvocation.output.path), blockedOutput)
  writeCanonicalDelegation(root, planInvocation)

  const submitted = submitOutput(root, runId, planInvocation.output.path)

  assert.equal(submitted.state.status, 'paused')
  assert.equal(submitted.state.operator_pause, undefined)

  const resumed = resumeRun(root, runId, 'implement', 'Restart implementation.')

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.current_stage, 'implement')
  assert.equal(resumed.pending_action.type, 'prepare_invocation')
})
