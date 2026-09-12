import assert from 'node:assert/strict'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  assertNoShellGate,
  checkpoint,
  failingVerify,
  submitStageOutput,
} from './delivery-helpers.js'

test('a failing verify verdict routes without executing any repository-check profile', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')
  const verifyStage = stageBySlug(workflow, 'verify')

  assert.equal(
    verifyStage.criteria.some((item) => item.type === 'shell'),
    false,
  )

  const failed = submitStageOutput(
    root,
    runId,
    verifyStage,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('VF-GATE-1')
    },
  )

  assert.equal(failed.record.outcome, 'failure')
  assert.equal(failed.state.current_stage, 'remediate')
  assertNoShellGate(failed.record.evaluation.deterministic)

  // The scope state criterion still evaluates when no shell gate exists.
  const scope = failed.record.evaluation.deterministic.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )

  assert.ok(scope)
  assert.equal(scope.skipped, undefined)

  // The remedial verdict keeps the base remediator persona.
  const remediate = prepareInvocation(root, runId).invocation

  assert.ok(remediate)
  assert.equal(remediate.stage.persona, 'remediator')
})

test('an unevaluated verify criterion blocks success', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')
  const verifyStage = stageBySlug(workflow, 'verify')

  const submitted = submitStageOutput(
    root,
    runId,
    verifyStage,
    'success',
    [],
    (output) => {
      const criterion = output.criteria.find(
        (item) => item.id === 'verify.tests_correct',
      )

      assert.ok(criterion)
      criterion.result = 'unevaluated'
    },
  )
  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'remediate')
  assertNoShellGate(submitted.record.evaluation.deterministic)
  assert.match(
    submitted.record.evaluation.validation_errors.join('\n'),
    /Criterion 'verify\.tests_correct' remains unevaluated/u,
  )
  assert.doesNotMatch(
    submitted.record.evaluation.validation_errors.join('\n'),
    /criteria '.+' is unevaluated;/u,
  )
})

test('a blocked verify submission pauses without product-field errors', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')
  const verifyStage = stageBySlug(workflow, 'verify')

  const submitted = submitStageOutput(
    root,
    runId,
    verifyStage,
    'blocked',
    [],
    (output) => {
      output.criteria = output.criteria.map((criterion) => ({
        ...criterion,
        result: 'skipped',
        explanation: 'Verification lacks the required evidence.',
      }))
      output.data.verify = {
        blocking_reason: 'Required evidence reports are missing.',
        missing_evidence_paths: ['review-evidence.md', 'qa-evidence.md'],
      }
    },
  )
  assert.equal(submitted.record.outcome, 'blocked')
  assert.equal(submitted.state.status, 'paused')
  assert.equal(submitted.state.current_stage, 'verify')
  assert.deepEqual(submitted.record.evaluation.validation_errors, [])
  assertNoShellGate(submitted.record.evaluation.deterministic)
})

test('implementation same-reason failure twice pauses before a third attempt', () => {
  const {
    root,
    runId,
    state: first,
    workflow,
  } = checkpoint('delivery@implement-failed-once')
  const implementStage = stageBySlug(workflow, 'implement')

  assert.equal(first.status, 'running')
  assert.equal(first.current_stage, 'implement')
  assert.equal(first.same_reason_failures?.implement?.repeat_count, 1)

  const second = submitStageOutput(root, runId, implementStage, 'failure', [
    'implement.acceptance_claimed',
  ])

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
  assert.equal(second.state.attempts.implement, 2)
  assert.match(second.state.pause_reason ?? '', /same deterministic reason/u)
})
