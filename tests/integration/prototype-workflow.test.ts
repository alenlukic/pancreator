import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  decideRun,
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
    submitted: submitOutput(root, runId, invocation.output.path),
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
