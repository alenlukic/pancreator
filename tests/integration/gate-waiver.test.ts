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

/** A remedial verify verdict whose data stays consistent with a failed stage. */
function failingVerify(findingId: string): Record<string, unknown> {
  return {
    verdict: 'fail_remedial',
    findings: [
      {
        id: findingId,
        severity: 'blocker',
        source: 'qa',
        statement: 'The workflow fixture does not advance.',
        evidence: ['fixture'],
      },
    ],
    qa_cases: [
      {
        id: 'TP-01',
        steps: 'Run workflow fixture',
        expected: 'advance',
        actual: 'stalled',
        result: 'fail',
      },
    ],
    acceptance_results: [
      { id: 'AC-01', result: 'fail', evidence: ['fixture'] },
    ],
    remediation_guidance:
      'Rerun the workflow fixture; the run stalls before ship.',
  }
}

test('explicit gate waiver advances a bounded miss and tracks its spotfix case', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Gate waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'implement', 'Initialize tracked workspace state.')
  prepareInvocation(root, runId)
  setRunStage(root, runId, 'verify', 'Exercise operator gate waiver flow.')

  const verifyInvocation = prepareInvocation(root, runId).invocation

  assert.ok(verifyInvocation)

  const verifyOutput = makeOutput(
    root,
    verifyInvocation,
    stageBySlug(workflow, 'verify'),
  )
  const acceptance = verifyOutput.criteria.find(
    (criterion) => criterion.id === 'verify.acceptance_met',
  )

  assert.ok(acceptance)
  acceptance.result = 'fail'
  acceptance.explanation = 'AC-9 is bounded and remains incomplete.'
  verifyOutput.result = 'failure'
  verifyOutput.data.verify = failingVerify('VF-WAIVE-1')

  writeJson(path.join(root, verifyInvocation.output.path), verifyOutput)
  writeCanonicalDelegation(root, verifyInvocation)

  const verified = submitOutput(root, runId, verifyInvocation.output.path)

  assert.equal(verified.record.outcome, 'failure')
  assert.equal(verified.state.current_stage, 'remediate')

  setRunStage(root, runId, 'verify', 'Return to the exhausted verify gate.')
  pauseRun(root, runId, 'Operator is adjudicating one bounded verify miss.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    criterionIds: ['verify.acceptance_met'],
    note: 'Eight of nine acceptance criteria are independently complete; AC-9 is isolated to one bounded follow-up and does not invalidate the delivered behavior.',
    deferredAcceptanceCriteria: ['AC-9'],
    createSpotfixCase: true,
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'ship')
  assert.equal(
    waived.waiver.source_invocation_id,
    verifyInvocation.invocation_id,
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

  const shipInvocation = prepareInvocation(root, runId).invocation

  assert.ok(shipInvocation)
  assert.equal(shipInvocation.stage.slug, 'ship')

  const shipOutput = makeOutput(
    root,
    shipInvocation,
    stageBySlug(workflow, 'ship'),
    'success',
    getRunState(root, runId),
  )

  writeJson(path.join(root, shipInvocation.output.path), shipOutput)
  writeCanonicalDelegation(root, shipInvocation)

  const shipped = submitOutput(root, runId, shipInvocation.output.path)
  const priorGates = shipped.record.evaluation.deterministic.find(
    (criterion) => criterion.id === 'ship.prior_gates_current',
  )

  assert.equal(
    shipped.record.outcome,
    'success',
    JSON.stringify(shipped.record.evaluation),
  )
  assert.equal(shipped.state.status, 'awaiting_operator')
  assert.equal(priorGates?.passed, true)
  assert.match(
    priorGates?.explanation ?? '',
    /Operator-waived review and QA evidence/u,
  )
})

test('gate waivers can override a failed supervisor assessment', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery-candidate')
  const state = createRun(root, {
    workflowSlug: 'delivery-candidate',
    requestPath: 'request.md',
    title: 'Supervisor gate waiver fixture',
  })
  const runId = state.run_id

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'plan')
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
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Flexible gate waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'implement', 'Initialize tracked workspace state.')
  prepareInvocation(root, runId)
  setRunStage(root, runId, 'verify', 'Create a multi-criterion failure.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'verify'))

  for (const criterionId of ['verify.acceptance_met', 'verify.tests_correct']) {
    const criterion = output.criteria.find((item) => item.id === criterionId)

    assert.ok(criterion)
    criterion.result = 'fail'
    criterion.explanation = `${criterionId} remains unresolved.`
  }

  output.result = 'failure'
  output.data.verify = failingVerify('VF-DRIFT-1')

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  const failed = submitOutput(root, runId, invocation.output.path)

  assert.equal(failed.state.current_stage, 'remediate')

  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const drifted = true\n',
  )

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    criterionIds: ['verify.acceptance_met'],
    targetStage: 'ship',
    note: 'Waive only acceptance coverage. The operator accepts the separate test concern and the current workspace exactly as it stands.',
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'ship')
  assert.deepEqual(waived.waiver.criterion_ids, ['verify.acceptance_met'])
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

test('malformed governance output is advisory and advances without another agent attempt', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Malformed output advisory fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'implement', 'Initialize tracked workspace state.')
  prepareInvocation(root, runId)
  setRunStage(root, runId, 'verify', 'Create malformed verify evidence.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'verify'))
  output.invocation_id = 'wrong-invocation-id'

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'ship')
  assert.ok(submitted.record.evaluation.validation_errors.length > 0)
  assert.ok(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).length > 0,
  )
  assert.ok((submitted.state.governance_artifact_issues ?? []).length > 0)
})

test('explicit product failure remains blocking even when its governance output is malformed', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Malformed failure routing fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'verify', 'Exercise product-failure routing.')
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'verify'))
  output.invocation_id = 'wrong-invocation-id'
  output.result = 'failure'
  output.data.verify = failingVerify('VF-MALFORMED-1')
  const acceptance = output.criteria.find(
    (criterion) => criterion.id === 'verify.acceptance_met',
  )

  assert.ok(acceptance)
  acceptance.result = 'fail'
  acceptance.explanation = 'The implementation does not meet acceptance.'

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'remediate')
  assert.ok(submitted.record.evaluation.validation_errors.length > 0)
  assert.ok(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).length > 0,
  )
})

test('gate waivers can bypass an unattempted stage', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Pre-attempt waiver fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'verify', 'Operator elects not to run verification.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    note: 'Skip verification entirely and continue to ship.',
  })

  assert.equal(waived.state.current_stage, 'ship')
  assert.equal(waived.waiver.source_attempt, 0)
  assert.deepEqual(waived.waiver.criterion_ids, ['*'])
})

test('operator waiver can redirect a terminal run', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Terminal override fixture',
  })
  const runId = state.run_id

  abortRun(root, runId, 'Initial operator decision.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'verify',
    targetStage: 'ship',
    note: 'Reopen the canceled run at ship. This directive supersedes the prior cancellation.',
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'ship')
})
