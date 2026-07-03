import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abortRun,
  assessStage,
  createRun,
  getRunState,
  pauseRun,
  prepareInvocation,
  setRunStage,
  submitOutput,
  waiveGate,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

test('explicit gate waiver advances a bounded miss and tracks its spotfix case', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Gate waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'implement', 'Initialize tracked workspace state.')
  prepareInvocation(root, runId)
  setRunStage(root, runId, 'review', 'Exercise operator gate waiver flow.')

  const reviewInvocation = prepareInvocation(root, runId).invocation

  assert.ok(reviewInvocation)

  const reviewOutput = makeOutput(
    root,
    reviewInvocation,
    stageBySlug(workflow, 'review'),
  )
  const acceptance = reviewOutput.criteria.find(
    (criterion) => criterion.id === 'review.acceptance_met',
  )

  assert.ok(acceptance)
  acceptance.result = 'fail'
  acceptance.explanation = 'AC-9 is bounded and remains incomplete.'
  reviewOutput.result = 'failure'

  writeJson(path.join(root, reviewInvocation.output.path), reviewOutput)
  writeCanonicalDelegation(root, reviewInvocation)

  const reviewed = submitOutput(root, runId, reviewInvocation.output.path)

  assert.equal(reviewed.record.outcome, 'failure')
  assert.equal(reviewed.state.current_stage, 'implement')

  setRunStage(root, runId, 'review', 'Return to the exhausted review gate.')
  pauseRun(root, runId, 'Operator is adjudicating one bounded review miss.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'review',
    criterionIds: ['review.acceptance_met'],
    note: 'Eight of nine acceptance criteria are independently complete; AC-9 is isolated to one bounded follow-up and does not invalidate the delivered behavior.',
    deferredAcceptanceCriteria: ['AC-9'],
    createSpotfixCase: true,
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'test')
  assert.equal(
    waived.waiver.source_invocation_id,
    reviewInvocation.invocation_id,
  )
  assert.equal(waived.waiver.criterion_ids.length, 1)
  assert.ok(waived.waiver.spotfix_case_path)
  assert.ok(existsSync(path.join(root, waived.waiver.artifact_path)))
  assert.ok(
    existsSync(path.join(root, waived.waiver.spotfix_case_path ?? 'missing')),
  )
  assert.match(
    readFileSync(
      path.join(root, waived.waiver.spotfix_case_path ?? 'missing'),
      'utf8',
    ),
    /lightweight eligibility MUST be re-verified/u,
  )

  const testInvocation = prepareInvocation(root, runId).invocation

  assert.ok(testInvocation)
  assert.equal(testInvocation.stage.slug, 'test')

  writeJson(
    path.join(root, testInvocation.output.path),
    makeOutput(root, testInvocation, stageBySlug(workflow, 'test')),
  )
  writeCanonicalDelegation(root, testInvocation)
  submitOutput(root, runId, testInvocation.output.path)

  const validation = prepareInvocation(root, runId)

  assert.equal(validation.invocation, null)
  assert.equal(validation.state.current_stage, 'ship')

  const shipInvocation = prepareInvocation(root, runId).invocation

  assert.ok(shipInvocation)

  writeJson(
    path.join(root, shipInvocation.output.path),
    makeOutput(
      root,
      shipInvocation,
      stageBySlug(workflow, 'ship'),
      'success',
      getRunState(root, runId),
    ),
  )
  writeCanonicalDelegation(root, shipInvocation)

  const shipped = submitOutput(root, runId, shipInvocation.output.path)
  const priorGates = shipped.record.evaluation.deterministic.find(
    (criterion) => criterion.id === 'ship.prior_gates_current',
  )

  assert.equal(shipped.record.outcome, 'success')
  assert.equal(shipped.state.status, 'awaiting_operator')
  assert.equal(priorGates?.passed, true)
  assert.match(
    priorGates?.explanation ?? '',
    /Operator-waived review evidence/u,
  )
})

test('gate waivers can override a failed supervisor assessment', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Supervisor gate waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'plan', 'Exercise supervisor gate waiver flow.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stageBySlug(workflow, 'plan')),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.state.pending_action.type, 'supervisor_assessment')

  if (submitted.state.pending_action.type !== 'supervisor_assessment') {
    throw new Error('Expected supervisor assessment action')
  }

  const assessmentPath = submitted.state.pending_action.output_path
  const criteria = stageBySlug(workflow, 'plan').criteria.map((criterion) => ({
    id: criterion.id,
    result:
      criterion.id === 'plan.complete_mapping'
        ? ('fail' as const)
        : ('pass' as const),
    evidence: [invocation.output.path],
    explanation:
      criterion.id === 'plan.complete_mapping'
        ? 'One bounded mapping remains incomplete.'
        : 'Criterion is satisfied.',
  }))

  writeJson(path.join(root, assessmentPath), {
    schema_version: 1,
    assessment_id: randomUUID(),
    invocation_id: invocation.invocation_id,
    verdict: 'fail',
    criteria,
    summary: 'One bounded plan mapping remains incomplete.',
  })
  assessStage(root, runId, assessmentPath)
  pauseRun(root, runId, 'Operator accepts the bounded plan exception.')

  const waived = waiveGate(root, runId, {
    criterionIds: ['plan.complete_mapping'],
    note: 'The missing mapping is isolated and does not block implementation.',
  })

  assert.equal(waived.state.current_stage, 'implement')
  assert.equal(waived.waiver.source_evidence_path, assessmentPath)
  assert.equal(waived.waiver.criterion_ids[0], 'plan.complete_mapping')
})

test('gate waivers honor partial scope after workspace drift', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Flexible gate waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'implement', 'Initialize tracked workspace state.')
  prepareInvocation(root, runId)
  setRunStage(root, runId, 'review', 'Create a multi-criterion failure.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'review'))

  for (const criterionId of ['review.acceptance_met', 'review.tests_correct']) {
    const criterion = output.criteria.find((item) => item.id === criterionId)

    assert.ok(criterion)
    criterion.result = 'fail'
    criterion.explanation = `${criterionId} remains unresolved.`
  }

  output.result = 'failure'

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  const failed = submitOutput(root, runId, invocation.output.path)

  assert.equal(failed.state.current_stage, 'implement')

  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const drifted = true\n',
  )

  const waived = waiveGate(root, runId, {
    stageSlug: 'review',
    criterionIds: ['review.acceptance_met'],
    targetStage: 'test',
    note: 'Waive only acceptance coverage. The operator accepts the separate test concern and the current workspace exactly as it stands.',
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'test')
  assert.deepEqual(waived.waiver.criterion_ids, ['review.acceptance_met'])
  assert.equal(waived.waiver.whole_stage_bypass, true)
  assert.match(
    readFileSync(path.join(root, waived.waiver.artifact_path), 'utf8'),
    /whole_stage_bypass/u,
  )
  assert.notEqual(
    waived.waiver.source_workspace_fingerprint,
    waived.waiver.workspace_fingerprint,
  )
  assert.match(
    readFileSync(path.join(root, waived.waiver.artifact_path), 'utf8'),
    /accepts the separate test concern and the current workspace exactly as it stands/u,
  )
})

test('gate waivers can bypass malformed output without another agent attempt', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Malformed output waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'implement', 'Initialize tracked workspace state.')
  prepareInvocation(root, runId)
  setRunStage(root, runId, 'review', 'Create malformed review evidence.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'review'))
  output.invocation_id = 'wrong-invocation-id'

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  assert.ok(submitted.record.evaluation.validation_errors.length > 0)

  const waived = waiveGate(root, runId, {
    stageSlug: 'review',
    note: 'The malformed review record is paperwork only. Proceed directly to test without paying for another review attempt.',
  })

  assert.equal(waived.state.current_stage, 'test')
  assert.deepEqual(waived.waiver.criterion_ids, ['*'])
  assert.ok((waived.waiver.validation_errors ?? []).length > 0)
  assert.match(
    readFileSync(path.join(root, waived.waiver.artifact_path), 'utf8'),
    /Known malformed or missing evidence/u,
  )
})

test('gate waivers can bypass an unattempted stage', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Pre-attempt waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'test', 'Operator elects not to run QA.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'test',
    note: 'Skip QA entirely and continue to validate-changes.',
  })

  assert.equal(waived.state.current_stage, 'validate-changes')
  assert.equal(waived.waiver.source_attempt, 0)
  assert.deepEqual(waived.waiver.criterion_ids, ['*'])
})

test('operator waiver can redirect a terminal run', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Terminal override fixture',
  })
  const runId = state.run_id

  abortRun(root, runId, 'Initial operator decision.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'test',
    targetStage: 'ship',
    note: 'Reopen the canceled run at ship. This directive supersedes the prior cancellation.',
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'ship')
})
