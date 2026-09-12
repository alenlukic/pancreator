import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getRunState,
  pauseRun,
  resumeRun,
  setRunStage,
  waiveGate,
} from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import type { StageOutput } from '../../src/lib/types.js'
import {
  checkpoint,
  failingVerify,
  submitStageOutput,
} from './delivery-helpers.js'

test('different verify failure reasons keep the remediation route', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@verify-failed-once-remediated',
  )
  const verifyStage = stageBySlug(workflow, 'verify')
  const remediateStage = stageBySlug(workflow, 'remediate')

  // The checkpoint already failed verify once on 'verify.acceptance_met'. A
  // disjoint signature is a new reason, so the tracker restarts at one.
  const different = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.tests_correct'],
    (output) => {
      output.data.verify = failingVerify('VF-DIFF-2')
    },
  )

  assert.equal(different.state.status, 'running')
  assert.equal(different.state.current_stage, 'remediate')
  assert.equal(different.state.same_reason_failures?.verify?.repeat_count, 1)
  assert.deepEqual(
    different.state.same_reason_failures?.verify?.last_signature,
    ['verify.tests_correct'],
  )

  submitStageOutput(root, runId, remediateStage, 'success')

  // A strict superset of the tracked signature is the same reason, so the
  // second occurrence pauses for the operator.
  const superset = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met', 'verify.tests_correct'],
    (output) => {
      output.data.verify = failingVerify('VF-SUP-2')
    },
  )

  assert.equal(superset.state.status, 'paused')
  assert.equal(superset.state.pending_action.type, 'operator_decision')
})

// The same-reason pause and every tracker reset share one test so the
// checkpoint clones are paid once. Each block below owns its own run.
test('verify same-reason failure twice pauses for operator_decision and the tracker resets on stage pass, waive-gate, and set-stage', () => {
  const failAcceptance = (output: StageOutput, findingId: string): void => {
    output.data.verify = failingVerify(findingId)
  }

  {
    const { root, runId, state, workflow } = checkpoint(
      'delivery@verify-failed-once',
    )
    const verifyStage = stageBySlug(workflow, 'verify')
    const remediateStage = stageBySlug(workflow, 'remediate')

    // The first same-reason failure routes to remediation and starts the
    // tracker without pausing.
    assert.equal(state.status, 'running')
    assert.equal(state.same_reason_failures?.verify?.repeat_count, 1)
    assert.equal(state.current_stage, 'remediate')

    // A pause and a resume keep the tracker, so the next same-reason failure
    // pauses the run.
    pauseRun(root, runId, 'Operator pauses before remediation continues.')
    resumeRun(
      root,
      runId,
      'remediate',
      'Resume remediation without forgiving verification.',
    )
    assert.equal(
      getRunState(root, runId).same_reason_failures?.verify?.repeat_count,
      1,
    )

    submitStageOutput(root, runId, remediateStage, 'success')

    const repeated = submitStageOutput(
      root,
      runId,
      verifyStage,
      'failure',
      ['verify.acceptance_met'],
      (output) => failAcceptance(output, 'VF-RESET-2'),
    )

    assert.equal(repeated.state.status, 'paused')
    assert.equal(repeated.state.pending_action.type, 'operator_decision')
  }

  {
    const { root, runId, workflow } = checkpoint('delivery@verify-failed-once')
    const verifyStage = stageBySlug(workflow, 'verify')
    const remediateStage = stageBySlug(workflow, 'remediate')

    // Set-stage to remediate clears the tracked verify memory too.
    setRunStage(
      root,
      runId,
      'remediate',
      'Operator repair targets remediation and clears verify memory.',
    )
    assert.equal(
      getRunState(root, runId).same_reason_failures?.verify,
      undefined,
    )

    submitStageOutput(root, runId, remediateStage, 'success')

    const afterRemediateRepair = submitStageOutput(
      root,
      runId,
      verifyStage,
      'failure',
      ['verify.acceptance_met'],
      (output) => failAcceptance(output, 'VF-RESET-3'),
    )

    assert.equal(afterRemediateRepair.state.status, 'running')
    assert.equal(afterRemediateRepair.state.current_stage, 'remediate')
    assert.equal(
      afterRemediateRepair.state.same_reason_failures?.verify?.repeat_count,
      1,
    )

    setRunStage(
      root,
      runId,
      'verify',
      'Operator repair clears same-reason memory.',
    )
    assert.equal(
      getRunState(root, runId).same_reason_failures?.verify,
      undefined,
    )

    submitStageOutput(
      root,
      runId,
      verifyStage,
      'failure',
      ['verify.acceptance_met'],
      (output) => failAcceptance(output, 'VF-RESET-4'),
    )
    submitStageOutput(root, runId, remediateStage, 'success')
    submitStageOutput(root, runId, verifyStage, 'success')
    assert.equal(
      getRunState(root, runId).same_reason_failures?.verify,
      undefined,
    )
  }

  {
    // After one remediation, the next same-reason failure pauses at verify
    // for an operator decision. A waiver clears the tracker.
    const { root, runId, workflow } = checkpoint(
      'delivery@verify-failed-once-remediated',
    )
    const verifyStage = stageBySlug(workflow, 'verify')
    const paused = submitStageOutput(
      root,
      runId,
      verifyStage,
      'failure',
      ['verify.acceptance_met'],
      (output) => failAcceptance(output, 'VF-RESET-6'),
    )
    assert.equal(paused.state.status, 'paused')
    assert.equal(paused.state.pending_action.type, 'operator_decision')
    assert.equal(paused.state.current_stage, 'verify')
    assert.match(paused.state.pause_reason ?? '', /same deterministic reason/u)

    const waived = waiveGate(root, runId, {
      stageSlug: 'verify',
      criterionIds: ['verify.acceptance_met'],
      note: 'Bounded verify miss is isolated and does not block downstream validation.',
    })

    assert.equal(waived.state.status, 'running')
    assert.equal(waived.state.current_stage, 'ship')
    assert.equal(
      getRunState(root, runId).same_reason_failures?.verify,
      undefined,
    )
  }
})
