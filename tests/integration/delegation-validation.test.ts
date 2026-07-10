import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  assessStage,
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

test('submit records missing delegation as an advisory governance warning', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const runId = state.run_id

  const intakeInvocation = prepareInvocation(root, runId).invocation
  assert.ok(intakeInvocation)
  writeJson(
    path.join(root, intakeInvocation.output.path),
    makeOutput(root, intakeInvocation, stageBySlug(workflow, 'intake')),
  )
  submitOutput(root, runId, intakeInvocation.output.path)
  decideRun(root, runId, 'approve', 'fixture approval')

  const planInvocation = prepareInvocation(root, runId).invocation
  assert.ok(planInvocation)
  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )

  const submitted = submitOutput(root, runId, planInvocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.status, 'awaiting_supervisor')
  assert.match(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).join('\n'),
    /Delegation artifact is missing/u,
  )
  assert.equal(submitted.state.stage_history.length, 2)
})

test('submit records mismatched delegation as advisory evidence before ship', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const runId = state.run_id

  const intakeInvocation = prepareInvocation(root, runId).invocation
  assert.ok(intakeInvocation)
  writeJson(
    path.join(root, intakeInvocation.output.path),
    makeOutput(root, intakeInvocation, stageBySlug(workflow, 'intake')),
  )
  submitOutput(root, runId, intakeInvocation.output.path)
  decideRun(root, runId, 'approve', 'fixture approval')

  const planInvocation = prepareInvocation(root, runId).invocation
  assert.ok(planInvocation)
  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )

  const delegationPath = path.join(
    root,
    `runtime/logs/workflows/${runId}/invocations/${planInvocation.invocation_id}.delegation.md`,
  )
  writeFileSync(delegationPath, '# rewritten delegation prompt\n')

  const submitted = submitOutput(root, runId, planInvocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.status, 'awaiting_supervisor')
  assert.match(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).join('\n'),
    /Delegation validation failed/u,
  )

  const validationPath = path.join(
    root,
    `runtime/logs/workflows/${runId}/invocations/${planInvocation.invocation_id}.delegation-validation.json`,
  )
  assert.ok(existsSync(validationPath))
  assert.equal(JSON.parse(readFileSync(validationPath, 'utf8')).status, 'fail')
})

test('submit succeeds when canonical delegation artifact is present', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const runId = state.run_id

  const intakeInvocation = prepareInvocation(root, runId).invocation
  assert.ok(intakeInvocation)
  writeJson(
    path.join(root, intakeInvocation.output.path),
    makeOutput(root, intakeInvocation, stageBySlug(workflow, 'intake')),
  )
  submitOutput(root, runId, intakeInvocation.output.path)
  decideRun(root, runId, 'approve', 'fixture approval')

  const planInvocation = prepareInvocation(root, runId).invocation
  assert.ok(planInvocation)
  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )
  writeCanonicalDelegation(root, planInvocation)

  const submitted = submitOutput(root, runId, planInvocation.output.path)
  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.status, 'awaiting_supervisor')

  if (submitted.state.pending_action.type !== 'supervisor_assessment') {
    throw new Error('Expected supervisor assessment action')
  }

  writeJson(path.join(root, submitted.state.pending_action.output_path), {
    schema_version: 1,
    assessment_id: randomUUID(),
    invocation_id: planInvocation.invocation_id,
    verdict: 'pass',
    summary: 'Plan is implementation-ready.',
    criteria: stageBySlug(workflow, 'plan').criteria.map((criterion) => ({
      id: criterion.id,
      result: 'pass',
      evidence: [planInvocation.output.path],
      explanation: 'Fixture evidence',
    })),
  })
  assessStage(root, runId, submitted.state.pending_action.output_path)
})

test('submit relocates workspace-root delegation artifact before validation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const runId = state.run_id

  const intakeInvocation = prepareInvocation(root, runId).invocation
  assert.ok(intakeInvocation)
  writeJson(
    path.join(root, intakeInvocation.output.path),
    makeOutput(root, intakeInvocation, stageBySlug(workflow, 'intake')),
  )
  submitOutput(root, runId, intakeInvocation.output.path)
  decideRun(root, runId, 'approve', 'fixture approval')

  const planInvocation = prepareInvocation(root, runId).invocation
  assert.ok(planInvocation)
  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )

  const misplacedDelegation = path.join(root, '.delegation.md')
  const canonicalDelegation = path.join(
    root,
    `runtime/logs/workflows/${runId}/invocations/${planInvocation.invocation_id}.md`,
  )
  writeFileSync(misplacedDelegation, readFileSync(canonicalDelegation, 'utf8'))

  const submitted = submitOutput(root, runId, planInvocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(existsSync(misplacedDelegation), false)
  assert.equal(
    existsSync(
      path.join(
        root,
        `runtime/logs/workflows/${runId}/invocations/${planInvocation.invocation_id}.delegation.md`,
      ),
    ),
    true,
  )
  assert.ok(
    submitted.record.evaluation.deterministic.some(
      (item) => item.id === 'scope.no_unapproved_changes' && item.passed,
    ),
  )
})
