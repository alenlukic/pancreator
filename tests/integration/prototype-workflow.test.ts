import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { decideRun, prepareInvocation } from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import type { StageDefinition, StageOutcome } from '../../src/lib/types.js'
import { checkpoint, checksVariant } from './delivery-helpers.js'
import type { CheckpointVariant } from './delivery-helpers.js'

function checkProfiles(
  staticExit: number,
  fastExit: number,
): Record<string, unknown> {
  return {
    static: {
      probes: [],
      commands: [`node -e "process.exit(${staticExit})"`],
    },
    fast: { probes: [], commands: [`node -e "process.exit(${fastExit})"`] },
  }
}

function writeChecks(root: string, staticExit: number, fastExit: number): void {
  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: checkProfiles(staticExit, fastExit),
  })
}

function checks(
  key: string,
  staticExit: number,
  fastExit: number,
): CheckpointVariant {
  return checksVariant(key, checkProfiles(staticExit, fastExit))
}

function submitStage(
  root: string,
  runId: string,
  stage: StageDefinition,
  result: StageOutcome = 'success',
) {
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, stage.slug)

  const output = makeOutput(root, invocation, stage, result)

  output.result = result
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  return {
    invocation,
    submitted: submitAsSupervisor(root, runId, invocation.output.path),
  }
}

test('the prototype workflow runs intake to an operator-gated evaluation', () => {
  const root = createFixture()

  writeChecks(root, 0, 0)

  const workflow = loadWorkflow(root, 'prototype')
  const state = createRun(root, {
    workflowSlug: 'prototype',
    requestPath: 'request.md',
    title: 'Adapter spike',
  })
  const runId = state.run_id
  const intake = submitStage(root, runId, stageBySlug(workflow, 'intake'))

  assert.equal(intake.submitted.state.status, 'awaiting_operator')
  decideRun(root, runId, 'approve')

  // The approach stage is intentionally ungated: no supervisor assessment, which
  // is the main way this workflow spends less time on up-front design.
  const approach = submitStage(root, runId, stageBySlug(workflow, 'approach'))

  assert.equal(approach.submitted.state.status, 'running')
  assert.equal(approach.submitted.state.current_stage, 'build')

  const build = submitStage(root, runId, stageBySlug(workflow, 'build'))

  assert.equal(build.submitted.state.status, 'running')
  assert.equal(build.submitted.state.current_stage, 'evaluate')

  const evaluate = submitStage(root, runId, stageBySlug(workflow, 'evaluate'))

  assert.equal(evaluate.submitted.state.status, 'awaiting_operator')
  assert.equal(decideRun(root, runId, 'approve').status, 'succeeded')
})

test('a failing fast profile does not block a prototype build', () => {
  const { root, runId, workflow } = checkpoint(
    'prototype@build-prepared',
    checks('checks=fast-fails', 0, 1),
  )

  const build = submitStage(root, runId, stageBySlug(workflow, 'build'))
  const fastCheck = build.submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'build.fast_checks',
  )

  // A prototype measures test breadth and reports it, rather than gating on it.
  assert.ok(fastCheck, 'the fast profile must still be measured')
  assert.equal(fastCheck.hard, false)
  assert.equal(build.submitted.record.outcome, 'success')
  assert.equal(build.submitted.state.current_stage, 'evaluate')
})

test('a pre-existing static failure stays visible without blocking the spike', () => {
  const { root, runId, workflow } = checkpoint(
    'prototype@build-prepared',
    checks('checks=static-fails', 1, 0),
  )

  const build = submitStage(root, runId, stageBySlug(workflow, 'build'))
  const staticResult = build.submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'build.static',
  )

  // Breakage the spike did not introduce is evidence, not a blocker.
  assert.ok(staticResult)
  assert.equal(staticResult.preexisting_failure, true)
  assert.equal(build.submitted.record.outcome, 'success')
})

test('prototype stages resolve PROTO-001 and their own brief profiles', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'prototype',
    requestPath: 'request.md',
    title: 'Governance spike',
    operatorArtifacts: true,
  })
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)
  const brief = invocation.output.operator_brief

  assert.ok(brief)
  assert.ok(invocation.policies.some((policy) => policy.id === 'PROTO-001'))
  // design/intake and prototype/intake share a slug but need different briefs.
  assert.equal(brief.profile, 'prototype-brief')
  assert.deepEqual(brief.required_headings, [
    'objective',
    'technical questions',
    'success signals',
  ])
})

test('the technical_director contract escalates the prototype approach stage', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'prototype',
    requestPath: 'request.md',
    title: 'Directed spike',
    involvement: 'technical-director',
  })

  // The same contract that escalates delivery/plan escalates prototype/approach,
  // because it attaches by checkpoint role rather than by stage slug.
  assert.deepEqual(state.operator_involvement?.applied_gates.approach, {
    workflow_gate: 'next_stage',
    run_gate: 'operator',
    source: 'technical_director contract at technical_plan checkpoint',
  })
})

test('a blocked approach result routes the run to paused', () => {
  const root = createFixture()

  writeChecks(root, 0, 0)

  const workflow = loadWorkflow(root, 'prototype')
  const state = createRun(root, {
    workflowSlug: 'prototype',
    requestPath: 'request.md',
    title: 'Blocked spike',
  })
  const runId = state.run_id

  submitStage(root, runId, stageBySlug(workflow, 'intake'))
  decideRun(root, runId, 'approve')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'approach')

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'approach'))
  const approachData = output.data as {
    technical_approach: Record<string, unknown>
  }

  approachData.technical_approach.preconditions = [
    {
      id: 'PRE-01',
      affected_questions: ['TQ-01'],
      check: 'fixture auth probe',
      status: 'unavailable',
      evidence: ['missing credential'],
      volatile: true,
    },
  ]
  output.result = 'blocked'
  output.criteria = output.criteria.map((criterion) => ({
    ...criterion,
    result:
      criterion.id === 'approach.preconditions_verified' ? 'fail' : 'pass',
  }))

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.state.status, 'paused')
  assert.equal(submitted.state.current_stage, 'approach')
  assert.throws(
    () => prepareInvocation(root, runId),
    /Run is not running: paused/u,
  )
})

test('operator-authorized narrowing lets approach advance to build', () => {
  const root = createFixture()

  writeChecks(root, 0, 0)

  const workflow = loadWorkflow(root, 'prototype')
  const state = createRun(root, {
    workflowSlug: 'prototype',
    requestPath: 'request.md',
    title: 'Narrowed spike',
  })
  const runId = state.run_id
  const layout = path.join('runtime/logs/workflows', runId, 'agent')
  const decisionPath = `${layout}/decisions/operator-feedback-1.md`

  submitStage(root, runId, stageBySlug(workflow, 'intake'))
  // The harness records the approval note on the operator-feedback ledger,
  // which the validator reads.
  decideRun(root, runId, 'approve', 'Exclude TQ-01 from this spike.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'approach'))
  const approachData = output.data as {
    technical_approach: Record<string, unknown>
  }

  approachData.technical_approach.preconditions = [
    {
      id: 'PRE-01',
      affected_questions: ['TQ-01'],
      check: 'fixture auth probe',
      status: 'unavailable',
      evidence: ['missing credential'],
      volatile: true,
      exclusions: [
        {
          excluded_questions: ['TQ-01'],
          operator_decision_path: decisionPath,
        },
      ],
    },
    {
      id: 'PRE-02',
      affected_questions: ['TQ-02'],
      check: 'fixture dependency',
      status: 'ready',
      evidence: ['ready'],
      volatile: false,
    },
  ]

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.state.status, 'running')
  assert.equal(submitted.state.current_stage, 'build')
})

test('environment_blocked evaluation waits at the operator gate', () => {
  const { root, runId, workflow } = checkpoint('prototype@build-prepared')

  submitStage(root, runId, stageBySlug(workflow, 'build'))

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(
    invocation.output.required_data['evaluation.environment_blockers'],
    'array',
  )
  assert.ok(
    invocation.rubric.some(
      (criterion) => criterion.id === 'evaluate.environment_classified',
    ),
  )

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'evaluate'))
  const evaluation = (output.data as { evaluation: Record<string, unknown> })
    .evaluation

  evaluation.verdict = 'environment_blocked'
  evaluation.environment_blockers = [
    {
      id: 'ENV-01',
      description: 'Missing CURSOR_API_KEY',
      evidence: ['pan doctor reports no CURSOR_API_KEY'],
      affected_questions: ['TQ-01'],
    },
  ]
  evaluation.question_results = [
    {
      question_id: 'TQ-01',
      result: 'unanswered',
      cause: 'environment',
      evidence: ['credential missing'],
      discard_condition_met: false,
    },
  ]
  evaluation.recommendation = 'Provision the environment and rerun the spike.'

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.state.status, 'awaiting_operator')
  assert.equal(submitted.record.outcome, 'success')
})
