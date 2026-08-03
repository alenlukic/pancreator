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
import type { Invocation } from '../../src/lib/types.js'
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
  writeCanonicalDelegation(root, intakeInvocation)
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
  writeCanonicalDelegation(root, intakeInvocation)
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
  writeCanonicalDelegation(root, intakeInvocation)
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
  writeCanonicalDelegation(root, intakeInvocation)
  submitOutput(root, runId, intakeInvocation.output.path)
  decideRun(root, runId, 'approve', 'fixture approval')

  const planInvocation = prepareInvocation(root, runId).invocation
  assert.ok(planInvocation)
  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )

  const misplacedDelegation = path.join(root, '.delegation.md')
  const deliveredBody = path.join(
    root,
    planInvocation.delegation?.delivery_prompt_path ??
      `runtime/logs/workflows/${runId}/invocations/${planInvocation.invocation_id}.md`,
  )
  writeFileSync(misplacedDelegation, readFileSync(deliveredBody, 'utf8'))

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

/** Advance a fixture dev run to a prepared, delegated plan invocation. */
function prepareDelegatedPlan(root: string): {
  runId: string
  invocation: Invocation
} {
  const workflow = loadWorkflow(root, 'dev')
  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  }).run_id
  const intakeInvocation = prepareInvocation(root, runId).invocation

  assert.ok(intakeInvocation)
  writeJson(
    path.join(root, intakeInvocation.output.path),
    makeOutput(root, intakeInvocation, stageBySlug(workflow, 'intake')),
  )
  writeCanonicalDelegation(root, intakeInvocation)
  submitOutput(root, runId, intakeInvocation.output.path)
  decideRun(root, runId, 'approve', 'fixture approval')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  return { runId, invocation }
}

test('submit rejects a delegated output with no read attestation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const { runId, invocation } = prepareDelegatedPlan(root)
  const output = makeOutput(root, invocation, stageBySlug(workflow, 'plan'))

  delete output.invocation_attestation
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  assert.match(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).join('\n'),
    /Invocation read attestation failed/u,
  )

  const artifactPath = path.join(
    root,
    `runtime/logs/workflows/${runId}/invocations/${invocation.invocation_id}.attestation-validation.json`,
  )

  assert.ok(existsSync(artifactPath))
  assert.equal(JSON.parse(readFileSync(artifactPath, 'utf8')).status, 'fail')
})

test('submit rejects a read attestation with a stale digest', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const { runId, invocation } = prepareDelegatedPlan(root)
  const output = makeOutput(root, invocation, stageBySlug(workflow, 'plan'))
  const attestation = output.invocation_attestation

  assert.ok(attestation?.status === 'read')
  output.invocation_attestation = {
    ...attestation,
    sections: attestation.sections.map((section, index) =>
      index === 0 ? { id: section.id, sha256: 'stale' } : section,
    ),
  }
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
})

test('submit reports an unreadable contract reference as blocked', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const { runId, invocation } = prepareDelegatedPlan(root)
  const output = makeOutput(root, invocation, stageBySlug(workflow, 'plan'))
  const manifest = invocation.contract_manifest

  assert.ok(manifest)
  output.result = 'blocked'
  output.invocation_attestation = {
    invocation_id: invocation.invocation_id,
    contract_path: manifest.contract_path,
    status: 'reference_failed',
    error: `EACCES: ${manifest.contract_path} could not be read`,
  }
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'blocked')
  assert.equal(submitted.state.status, 'paused')

  const artifact = JSON.parse(
    readFileSync(
      path.join(
        root,
        `runtime/logs/workflows/${runId}/invocations/${invocation.invocation_id}.attestation-validation.json`,
      ),
      'utf8',
    ),
  ) as { status: string; checks: Array<{ message: string }> }

  assert.equal(artifact.status, 'pass')
  assert.ok(
    artifact.checks.some((check) => check.message.includes('EACCES')),
    'the failed reference MUST name the path and error in evidence',
  )
})
