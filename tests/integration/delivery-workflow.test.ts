import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  decideRun,
  getRunState,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type { StageOutput } from '../../src/lib/types.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeEvidenceReports,
  writeJson,
} from '../helpers.js'
import { checkpoint, submitCurrentStage } from './delivery-helpers.js'

interface VerifyShape {
  verdict: string
  findings: Record<string, unknown>[]
  qa_cases: Record<string, unknown>[]
  acceptance_results: Record<string, unknown>[]
  remediation_guidance?: string
  severity_rationale?: string
}

function failingVerify(
  verdict: 'fail_remedial' | 'fail_severe',
  findingId: string,
): VerifyShape {
  return {
    verdict,
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
    ...(verdict === 'fail_severe'
      ? {
          severity_rationale:
            'The implementation approach cannot satisfy the acceptance criteria.',
        }
      : {}),
  }
}

function warningVerify(): VerifyShape {
  return {
    verdict: 'pass_with_warnings',
    findings: [
      {
        id: 'VF-WARN-1',
        severity: 'high',
        source: 'review',
        statement: 'Duplicated parsing logic should be consolidated.',
        evidence: ['src/base.ts'],
      },
    ],
    qa_cases: [
      {
        id: 'TP-01',
        steps: 'Run workflow fixture',
        expected: 'advance',
        actual: 'advance',
        result: 'pass',
      },
    ],
    acceptance_results: [
      { id: 'AC-01', result: 'pass', evidence: ['fixture'] },
    ],
  }
}

/** Marks exactly one hard criterion failed so signatures stay distinct. */
function failOnly(output: StageOutput, failingCriterionId: string): void {
  output.criteria = output.criteria.map((criterion) => ({
    ...criterion,
    result: criterion.id === failingCriterionId ? 'fail' : 'pass',
  }))
}

function runStage(
  root: string,
  runId: string,
  expectedStage: string,
  mutate?: (output: StageOutput) => void,
  result: 'success' | 'failure' = 'success',
): ReturnType<typeof submitOutput> {
  const workflow = loadWorkflow(root, 'delivery')
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, expectedStage)

  const stage = stageBySlug(workflow, expectedStage)
  const output = makeOutput(root, invocation, stage, result)

  mutate?.(output)
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  writeEvidenceReports(root, invocation)

  return submitOutput(root, runId, invocation.output.path)
}

function advanceToVerify(root: string): string {
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Delivery fixture run',
  })
  const runId = state.run_id

  const plan = runStage(root, runId, 'plan')

  assert.equal(plan.record.outcome, 'success')
  assert.equal(plan.state.status, 'awaiting_operator')
  decideRun(root, runId, 'approve', 'fixture approval')

  const implement = runStage(root, runId, 'implement')

  assert.equal(implement.record.outcome, 'success')
  assert.equal(getRunState(root, runId).current_stage, 'verify')

  return runId
}

test('delivery severe verdict escalates the remediator and warnings reach the inbox', () => {
  const root = createFixture()
  const runId = advanceToVerify(root)

  const firstVerify = runStage(
    root,
    runId,
    'verify',
    (output) => {
      output.data.verify = failingVerify('fail_severe', 'VF-SEV-1')
      failOnly(output, 'verify.acceptance_met')
    },
    'failure',
  )

  assert.equal(
    firstVerify.record.outcome,
    'failure',
    JSON.stringify(firstVerify.record.evaluation),
  )
  assert.equal(getRunState(root, runId).current_stage, 'remediate')

  const remediateInvocation = prepareInvocation(root, runId).invocation

  assert.ok(remediateInvocation)
  assert.equal(remediateInvocation.stage.slug, 'remediate')
  assert.equal(remediateInvocation.stage.persona, 'remediator-severe')
  assert.ok(remediateInvocation.stage.model.length > 0)

  const workflow = loadWorkflow(root, 'delivery')
  const remediateStage = stageBySlug(workflow, 'remediate')
  const remediateOutput = makeOutput(root, remediateInvocation, remediateStage)

  writeJson(path.join(root, remediateInvocation.output.path), remediateOutput)
  writeCanonicalDelegation(root, remediateInvocation)

  const remediated = submitOutput(root, runId, remediateInvocation.output.path)

  assert.equal(
    remediated.record.outcome,
    'success',
    JSON.stringify(remediated.record.evaluation),
  )
  assert.equal(remediated.record.stage.persona, 'remediator-severe')
  assert.equal(getRunState(root, runId).current_stage, 'verify')

  const secondVerify = runStage(root, runId, 'verify', (output) => {
    output.data.verify = warningVerify()
  })

  assert.equal(
    secondVerify.record.outcome,
    'success',
    JSON.stringify(secondVerify.record.evaluation),
  )
  assert.equal(getRunState(root, runId).current_stage, 'ship')

  const inboxPath = path.join(
    root,
    'runtime',
    'inbox',
    `${runId}-verify-warnings.md`,
  )

  assert.ok(existsSync(inboxPath))
  const inbox = readFileSync(inboxPath, 'utf8')

  assert.match(inbox, /VF-WARN-1/u)
  assert.match(inbox, /Duplicated parsing logic/u)
})

test('delivery remedial verdict keeps the base remediator persona', () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')

  const verify = submitCurrentStage(
    root,
    runId,
    'failure',
    ['verify.cases_executed'],
    (output) => {
      output.data.verify = failingVerify('fail_remedial', 'VF-REM-1')
    },
  )

  assert.equal(verify.invocation.stage.slug, 'verify')
  assert.equal(verify.record.outcome, 'failure')
  assert.equal(getRunState(root, runId).current_stage, 'remediate')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.persona, 'remediator')
})

test('delivery verify resolves parallel evidence workers and gates submission on their reports', () => {
  const { root, runId, state, invocation, workflow } = checkpoint(
    'delivery@verify-prepared',
  )

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'verify')

  const workers = invocation.evidence_workers ?? []

  assert.deepEqual(
    workers.map((worker) => [worker.role, worker.persona]),
    [
      ['review', 'reviewer'],
      ['qa', 'qa-tester'],
    ],
  )

  for (const worker of workers) {
    assert.ok(worker.model.length > 0)
    assert.ok(worker.agent.length > 0)

    const briefPath = path.join(root, worker.brief_path)

    assert.ok(existsSync(briefPath), `brief missing: ${worker.brief_path}`)
    assert.ok(
      readFileSync(briefPath, 'utf8').includes(worker.evidence_path),
      'brief names the evidence report path',
    )
  }

  const markdownPath = state.current_invocation?.markdown_path ?? ''
  const card = readFileSync(path.join(root, markdownPath), 'utf8')

  assert.match(card, /Parallel evidence reports/u)

  const procedure = readFileSync(
    path.join(root, markdownPath.replace(/\.md$/u, '.supervisor.md')),
    'utf8',
  )

  assert.match(procedure, /Launch every parallel evidence worker/u)

  const stage = stageBySlug(workflow, 'verify')
  const output = makeOutput(root, invocation, stage)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  // Missing reports reject the submission outright without spending an
  // attempt; persisting them makes the same submission succeed.
  for (const worker of invocation.evidence_workers ?? []) {
    rmSync(path.join(root, worker.evidence_path), { force: true })
  }

  assert.throws(
    () => submitOutput(root, runId, invocation.output.path),
    /Evidence report for role 'review'/u,
  )

  writeEvidenceReports(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(
    submitted.record.outcome,
    'success',
    JSON.stringify(submitted.record.evaluation),
  )
})
