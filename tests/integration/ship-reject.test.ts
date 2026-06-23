import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  assessStage,
  createRun,
  decideRun,
  getRunState,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type { RunState } from '../../src/lib/types.js'
import { createFixture, makeOutput, writeJson } from '../helpers.js'

function advanceToShipGate(root: string, runId: string): RunState {
  const workflow = loadWorkflow(root, 'dev')

  for (const stageSlug of [
    'intake',
    'plan',
    'implement',
    'review',
    'test',
    'ship',
  ]) {
    const prepared = prepareInvocation(root, runId)
    const invocation = prepared.invocation

    assert.ok(invocation)
    assert.equal(invocation.stage.slug, stageSlug)

    const stage = stageBySlug(workflow, stageSlug)
    const output = makeOutput(root, invocation, stage)

    writeJson(path.join(root, invocation.output.path), output)

    const submitted = submitOutput(root, runId, invocation.output.path)

    if (stageSlug === 'intake') {
      decideRun(root, runId, 'approve', 'fixture approval')
    } else if (stageSlug === 'plan') {
      if (submitted.state.pending_action.type !== 'supervisor_assessment') {
        throw new Error('Expected supervisor assessment action')
      }

      const assessmentPath = submitted.state.pending_action.output_path

      writeJson(path.join(root, assessmentPath), {
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
      assessStage(root, runId, assessmentPath)
    } else if (stageSlug === 'ship') {
      assert.equal(submitted.state.status, 'awaiting_operator')
    }
  }

  return getRunState(root, runId)
}

test('ship reject defaults to implement so remediation is possible', () => {
  const root = createFixture()
  const created = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Reject routing run',
  })
  const runId = created.run_id

  advanceToShipGate(root, runId)

  const decided = decideRun(root, runId, 'reject', 'Commit message is wrong.')

  assert.equal(decided.status, 'running')
  assert.equal(decided.current_stage, 'implement')
  assert.equal(decided.pending_action.type, 'prepare_invocation')
})

test('ship reject with --stage routes to the chosen stage and resets attempts', () => {
  const root = createFixture()
  const created = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Reject to plan run',
  })
  const runId = created.run_id

  const atGate = advanceToShipGate(root, runId)

  assert.equal(atGate.attempts.implement, 1)
  assert.equal(atGate.attempts.ship, 1)

  const decided = decideRun(
    root,
    runId,
    'reject',
    'Architecture is wrong; replan.',
    'plan',
  )

  assert.equal(decided.status, 'running')
  assert.equal(decided.current_stage, 'plan')
  assert.equal(decided.attempts.intake, 1)
  assert.equal(decided.attempts.plan, undefined)
  assert.equal(decided.attempts.implement, undefined)
  assert.equal(decided.attempts.ship, undefined)
  assert.equal(decided.consecutive_failures, 0)
})

test('operator rejection feedback is persisted and surfaced to the remediation worker', () => {
  const root = createFixture()
  const created = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Feedback carry run',
  })
  const runId = created.run_id

  advanceToShipGate(root, runId)

  const decided = decideRun(
    root,
    runId,
    'reject',
    'Rollback steps are not credible.',
  )

  assert.ok(decided.operator_feedback)
  assert.equal(decided.operator_feedback?.length, 1)

  const feedback = decided.operator_feedback?.[0]

  assert.ok(feedback)
  assert.equal(feedback.from_stage, 'ship')
  assert.equal(feedback.to_stage, 'implement')

  const feedbackBody = readFileSync(path.join(root, feedback.path), 'utf8')

  assert.match(feedbackBody, /Rollback steps are not credible/)
  assert.ok(existsSync(path.join(root, feedback.path)))

  const prepared = prepareInvocation(root, runId)

  assert.ok(prepared.invocation)
  assert.equal(prepared.invocation.stage.slug, 'implement')
  assert.ok(
    prepared.invocation.inputs.references.some(
      (reference) => reference.path === feedback.path,
    ),
    'remediation invocation should reference the operator feedback artifact',
  )
})
