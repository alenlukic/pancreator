import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import {
  orderedWorkerActions,
  renderSupervisorProcedureMarkdown,
} from '../../src/lib/render.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type { StageOutput } from '../../src/lib/types.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeEvidenceReports,
  writeJson,
} from '../helpers.js'
import { createRun, submitAsSupervisor } from '../run-helpers.js'
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

function runStage(
  root: string,
  runId: string,
  expectedStage: string,
  mutate?: (output: StageOutput) => void,
  result: 'success' | 'failure' = 'success',
): ReturnType<typeof submitAsSupervisor> {
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

  return submitAsSupervisor(root, runId, invocation.output.path)
}

test('delivery severe verdict escalates the remediator and warnings reach the inbox', () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')

  const firstVerify = submitCurrentStage(
    root,
    runId,
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      output.data.verify = failingVerify('fail_severe', 'VF-SEV-1')
    },
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

  const remediated = submitAsSupervisor(
    root,
    runId,
    remediateInvocation.output.path,
  )

  assert.equal(
    remediated.record.outcome,
    'success',
    JSON.stringify(remediated.record.evaluation),
  )
  assert.equal(remediated.record.stage.persona, 'remediator-severe')
  assert.equal(getRunState(root, runId).current_stage, 'verify')

  const secondVerify = runStage(root, runId, 'verify', (output) => {
    Object.assign(output.data.verify as object, warningVerify())
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
    'queue',
    `${runId}-verify-warnings.md`,
  )

  assert.ok(existsSync(inboxPath))
  const inbox = readFileSync(inboxPath, 'utf8')

  assert.match(inbox, /VF-WARN-1/u)
  assert.match(inbox, /Duplicated parsing logic/u)
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
    () => submitAsSupervisor(root, runId, invocation.output.path),
    /Evidence report for role 'review'/u,
  )

  writeEvidenceReports(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(
    submitted.record.outcome,
    'success',
    JSON.stringify(submitted.record.evaluation),
  )
})

test('plan and verify cards render the complete shared field contract', () => {
  const root = createFixture()
  const planningRunId = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'request.md',
    title: 'Shared field contract planning run',
  }).run_id
  const plan = prepareInvocation(root, planningRunId)
  const planPath = plan.state.current_invocation?.markdown_path

  assert.ok(planPath)
  const planCard = readFileSync(path.join(root, planPath), 'utf8')

  for (const fieldPath of [
    'data.acceptance_criteria[].id',
    'data.acceptance_criteria[].maps_to',
    'data.acceptance_criteria[].verification',
    'data.test_plan[]',
    'data.open_question_dispositions[].id',
    'data.open_question_dispositions[].answer',
    'data.verification_recommendation',
  ]) {
    assert.ok(planCard.includes(`\`${fieldPath}\``), fieldPath)
  }

  for (const result of ['unevaluated', 'skipped', 'not_applicable']) {
    assert.ok(planCard.includes(`  - \`${result}\`:`))
  }

  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Shared field contract run',
  }).run_id

  setRunStage(root, runId, 'verify', 'Inspect the verify field contract.')

  const verify = prepareInvocation(root, runId)
  const verifyPath = verify.state.current_invocation?.markdown_path

  assert.ok(verifyPath)
  const verifyCard = readFileSync(path.join(root, verifyPath), 'utf8')
  const stepsPath = '`data.verify.qa_cases[].steps`'

  assert.equal(verifyCard.split(stepsPath).length - 1, 1)
})

// AC-006. The verify stage owes three launches and a supervisor that started
// with the verifier wasted the stage: the evidence reports it consumes did
// not exist yet. The order is the instruction, so it is numbered, and the
// prepare response carries the same list the card does.
test('a prepared verify stage reports its evidence workers before the verifier', () => {
  const { invocation } = checkpoint('delivery@verify-prepared')

  assert.ok(invocation)

  const actions = orderedWorkerActions(invocation)
  const declared = invocation.evidence_workers ?? []

  assert.equal(declared.length, 2)
  assert.equal(actions.length, declared.length + 1)
  assert.deepEqual(
    actions.map((item) => item.order),
    [1, 2, 3],
  )
  assert.deepEqual(
    actions.map((item) => item.role),
    ['evidence', 'evidence', 'stage'],
  )
  assert.deepEqual(
    actions.slice(0, declared.length).map((item) => item.persona),
    declared.map((worker) => worker.persona),
  )

  // The rendered procedure numbers the same three actions in the same order.
  const procedure = renderSupervisorProcedureMarkdown(invocation)
  const positions = actions.map((item) =>
    procedure.indexOf(`${item.order}. \`${item.agent}\``),
  )

  for (const position of positions) {
    assert.notEqual(position, -1, procedure)
  }

  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
  )
})

// AC-005. The render case assigns the command itself and then finds it, so a
// harness that dropped `--invocation` would still pass it. The resolution is
// the contract, and only a real prepared invocation proves it.
test('a prepared invocation resolves the output validate command with all three arguments', () => {
  const { invocation } = checkpoint('delivery@verify-prepared')

  assert.ok(invocation)

  const command = invocation.delegation?.output_validate_command

  assert.ok(command, 'the prepared delegation carries the resolved command')
  assert.ok(command.includes(`--run ${invocation.run_id}`), command)
  assert.ok(command.includes(`--file ${invocation.output.path}`), command)

  const snapshot = command.split('--invocation ')[1]?.trim()

  assert.ok(snapshot?.endsWith('.json'), command)
  assert.ok(snapshot?.includes(invocation.invocation_id), command)

  // The supervisor reads it from the procedure, so the resolution must survive
  // the render it actually acts on.
  assert.ok(
    renderSupervisorProcedureMarkdown(invocation).includes(command),
    command,
  )
})

// The same list reaches the supervisor through the prepare response, which is
// what a supervisor reading JSON acts on.
test('the prepare response carries the ordered worker actions', () => {
  const { root, runId } = checkpoint('delivery@implement-baselined')

  setRunStage(root, runId, 'verify', 'Enter verify to prepare it.')

  const stdout = execFileSync(
    process.execPath,
    [
      path.join(process.cwd(), 'dist', 'src', 'cli.js'),
      'prepare',
      runId,
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  const response = JSON.parse(stdout) as {
    worker_actions?: Array<{ order: number; role: string; agent: string }>
  }

  assert.ok(response.worker_actions, stdout)
  assert.deepEqual(
    response.worker_actions.map((item) => item.order),
    [1, 2, 3],
  )
  assert.equal(response.worker_actions.at(-1)?.role, 'stage')
})

/**
 * Placeholder replacements, keyed by the field a scaffold exemplar carries.
 * Filling by the exemplar's own keys is what binds this case to the scaffold:
 * a field the exemplar omits is never filled, so the submission is refused and
 * the omission fails here rather than in a worker's attempt.
 */
const EXEMPLAR_FILL: Record<string, unknown> = {
  id: 'VF-1',
  severity: 'low',
  source: 'review',
  statement: 'The fixture records one non-blocking observation.',
  steps: 'Run the delivery fixture through the verify stage.',
  expected: 'The stage submits.',
  actual: 'The stage submitted.',
  result: 'pass',
  evidence: ['tests/integration/delivery-workflow.test.ts'],
}

function fillExemplars(items: unknown, index: number): void {
  if (!Array.isArray(items)) {
    return
  }

  for (const [position, item] of items.entries()) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>

    for (const key of Object.keys(record)) {
      assert.ok(key in EXEMPLAR_FILL, `no fill value for ${key}`)

      const value = EXEMPLAR_FILL[key]

      record[key] =
        key === 'id'
          ? `${['VF', 'QA', 'AC'][index]}-${position + 1}`
          : Array.isArray(value)
            ? [...value]
            : value
    }
  }
}

// AC-015 of the 2026-09-19 compliance intake, and R-06 of this run's
// verification: the criterion names an end-to-end fixture run, and the first
// attempt proved it by calling the validator against a hand-written
// `required_data` map. The seam that matters is between what a verify stage
// really resolves and what the scaffold shows, so the case has to walk the
// whole chain: the run's own stage contract, `pan output scaffold`, a worker
// that fills only what the scaffold showed it, and `pan submit`.
test('a verify output scaffolded from the real stage contract submits unrepaired', () => {
  const { root, runId } = checkpoint('delivery@verify-prepared')
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'verify')

  const outputPath = invocation.output.path

  rmSync(path.join(root, outputPath), { force: true })
  execFileSync(
    process.execPath,
    [
      path.join(process.cwd(), 'dist/src/cli.js'),
      'output',
      'scaffold',
      runId,
      '--invocation',
      resolveRunLayout(root, runId).invocation(
        invocation.invocation_id,
        '.json',
      ).relative,
      '--output',
      outputPath,
    ],
    { cwd: root, encoding: 'utf8' },
  )

  const output = JSON.parse(
    readFileSync(path.join(root, outputPath), 'utf8'),
  ) as StageOutput
  const verify = (output.data as Record<string, unknown>).verify as Record<
    string,
    unknown
  >

  assert.ok(verify)
  fillExemplars(verify.findings, 0)
  fillExemplars(verify.qa_cases, 1)
  fillExemplars(verify.acceptance_results, 2)

  verify.verdict = 'pass_with_warnings'
  // The card names the gate evidence a verification has to cite, and the
  // scaffold leaves the array empty because a forgotten exemplar would read
  // as a citation of evidence that does not exist.
  verify.gate_evidence_citations = (invocation.inputs.references ?? [])
    .filter((reference) => reference.gate_evidence?.current === true)
    .map((reference) => ({
      profile: reference.gate_evidence?.profile,
      fingerprint: reference.gate_evidence?.fingerprint,
      evidence_path: reference.path,
    }))

  assert.ok(Array.isArray(verify.gate_evidence_citations))

  output.summary = 'The fixture verification completed with one warning.'
  output.result = 'success'

  for (const criterion of output.criteria) {
    criterion.result = 'pass'
    criterion.evidence = ['tests/integration/delivery-workflow.test.ts']
    criterion.explanation = 'The fixture stage passed this criterion.'
  }

  const attestation = output.invocation_attestation as unknown as {
    status: string
    guidance?: { status: string; reason: string; final_line: string }[]
  }

  attestation.status = 'read'

  for (const guidance of attestation.guidance ?? []) {
    guidance.status = 'skipped'
    guidance.reason = 'The fixture stage reads no guidance.'
    guidance.final_line = ''
  }

  writeJson(path.join(root, outputPath), output)
  writeCanonicalDelegation(root, invocation)
  writeEvidenceReports(root, invocation)

  const submitted = submitAsSupervisor(root, runId, outputPath)

  assert.equal(
    submitted.record.outcome,
    'success',
    JSON.stringify(submitted.record.evaluation, null, 2),
  )
})
