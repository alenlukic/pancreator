import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  acceptChange,
  assessStage,
  createRun,
  decideRun,
  getRunState,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import type { StageOutcome } from '../../src/lib/types.js'

test('accept-change re-baselines a stale fingerprint so ship approves without a review/test re-loop', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Accept-change fixture run',
  })
  const runId = state.run_id

  const submitStage = (
    stageSlug: string,
    outcome: StageOutcome = 'success',
  ) => {
    let prepared = prepareInvocation(root, runId)
    let invocation = prepared.invocation

    while (!invocation) {
      const run = getRunState(root, runId)

      assert.ok(run.current_stage, 'run should still have a stage to prepare')
      prepared = prepareInvocation(root, runId)
      invocation = prepared.invocation
    }

    assert.ok(invocation)
    assert.equal(invocation.stage.slug, stageSlug)

    const stage = stageBySlug(workflow, stageSlug)
    const output = makeOutput(root, invocation, stage, outcome)

    writeJson(path.join(root, invocation.output.path), output)

    if (stage.persona !== 'orchestrator') {
      writeCanonicalDelegation(root, invocation)
    }

    return {
      invocation,
      submitted: submitOutput(root, runId, invocation.output.path),
    }
  }

  for (const stageSlug of ['intake', 'plan', 'implement', 'review', 'test']) {
    const { invocation, submitted } = submitStage(stageSlug)

    assert.equal(submitted.record.outcome, 'success')

    if (stageSlug === 'intake') {
      decideRun(root, runId, 'approve', 'fixture approval')
    } else if (stageSlug === 'plan') {
      const action = submitted.state.pending_action

      assert.equal(action.type, 'supervisor_assessment')

      if (action.type !== 'supervisor_assessment') {
        throw new Error('Expected supervisor assessment action')
      }

      const stage = stageBySlug(workflow, stageSlug)

      writeJson(path.join(root, action.output_path), {
        schema_version: 1,
        assessment_id: randomUUID(),
        invocation_id: invocation.invocation_id,
        verdict: 'pass',
        summary: 'Plan is implementation-ready.',
        criteria: stage.criteria.map((criterion) => ({
          id: criterion.id,
          result: 'pass',
          evidence: [invocation.output.path],
          explanation: 'Fixture evidence',
        })),
      })
      assessStage(root, runId, action.output_path)
    }
  }

  // Operator intentionally changes a tracked file after QA certified the workspace.
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const intentional = true\n',
  )

  // validate-changes runs before ship and pauses for operator adjudication.
  const preparedValidation = prepareInvocation(root, runId)

  assert.equal(preparedValidation.invocation, null)
  assert.equal(preparedValidation.state.status, 'paused')
  assert.equal(
    preparedValidation.state.pending_action.type,
    'operator_decision',
  )

  // Operator waives anomalies and adopts the current workspace state.
  const accepted = acceptChange(
    root,
    runId,
    'intentional post-QA workspace update',
    true,
  )

  assert.equal(accepted.status, 'running')
  assert.equal(accepted.current_stage, 'ship')
  assert.ok(accepted.accepted_workspace_fingerprint)

  // Ship attempt: gate passes against the accepted baseline, not a stale rerun.
  const shipped = submitStage('ship', 'success')

  assert.equal(shipped.submitted.record.outcome, 'success')
  assert.equal(shipped.submitted.state.status, 'awaiting_operator')
  assert.equal(shipped.submitted.state.pending_action.type, 'operator_approval')

  const priorGates = shipped.submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'ship.prior_gates_current',
  )

  assert.ok(priorGates)
  assert.equal(priorGates.passed, true)

  const finalState = getRunState(root, runId)
  const reviewCount = finalState.stage_history.filter(
    (item) => item.stage === 'review',
  ).length
  const testCount = finalState.stage_history.filter(
    (item) => item.stage === 'test',
  ).length

  assert.equal(reviewCount, 1)
  assert.equal(testCount, 1)
})
