import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  decideRun,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import {
  attestationValidationPath,
  delegationPath,
  delegationValidationPath,
} from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type { Invocation } from '../../src/lib/types.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { checkpoint } from './delivery-helpers.js'

test('submit records missing delegation as an advisory governance warning', () => {
  const {
    root,
    runId,
    invocation: planInvocation,
    workflow,
  } = checkpoint('delivery@plan-prepared')

  assert.ok(planInvocation)
  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )

  const submitted = submitOutput(root, runId, planInvocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.status, 'awaiting_operator')
  assert.match(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).join('\n'),
    /Delegation artifact is missing/u,
  )
  assert.equal(submitted.state.stage_history.length, 1)
})

test('submit records mismatched delegation as advisory evidence before ship', () => {
  const {
    root,
    runId,
    invocation: planInvocation,
    workflow,
  } = checkpoint('delivery@plan-prepared')

  assert.ok(planInvocation)
  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )

  const delegationArtifact = path.join(
    root,
    delegationPath(runId, planInvocation.invocation_id, root),
  )
  writeFileSync(delegationArtifact, '# rewritten delegation prompt\n')

  const submitted = submitOutput(root, runId, planInvocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.status, 'awaiting_operator')
  assert.match(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).join('\n'),
    /Delegation validation failed/u,
  )

  const validationPath = path.join(
    root,
    delegationValidationPath(runId, planInvocation.invocation_id, root),
  )
  assert.ok(existsSync(validationPath))
  assert.equal(JSON.parse(readFileSync(validationPath, 'utf8')).status, 'fail')
})

test('submit succeeds when canonical delegation artifact is present', () => {
  // The checkpoint's plan was submitted with its canonical delegation in place.
  const { root, runId, state } = checkpoint('delivery@plan-awaiting-operator')

  assert.equal(state.stage_history.at(-1)?.outcome, 'success')
  assert.equal(state.status, 'awaiting_operator')

  decideRun(root, runId, 'approve', 'Plan is implementation-ready.')

  const implementInvocation = prepareInvocation(root, runId).invocation

  assert.ok(implementInvocation)
  assert.equal(
    implementInvocation.output.field_contract?.validators[0]?.registry_id,
    'IMPLEMENTATION-CLAIMS-VALIDATE-001',
  )
  assert.equal(
    implementInvocation.output.field_contract?.validators[0]?.enforcement,
    'blocks',
  )
  assert.ok(
    implementInvocation.output.field_contract?.fields.some(
      (field) =>
        field.path === 'data.acceptance_results[].evidence[]' &&
        field.accepted_shapes?.includes('pytest_node_id'),
    ),
  )

  assert.ok(implementInvocation.delegation)
  const contract = readFileSync(
    path.join(root, implementInvocation.delegation.canonical_markdown_path),
    'utf8',
  )

  assert.match(contract, /Shared field contract:/u)
  assert.match(
    contract,
    /path reference, prose observation, or pytest node id/u,
  )
  // The card states the tests_added and remediation shapes with an example,
  // so the required format no longer lives only inside the validator.
  assert.match(contract, /data\.implementation\.tests_added\[\]/u)
  assert.match(
    contract,
    /tests\/unit\/example\.test\.ts::adds provenance rows/u,
  )
  assert.match(contract, /data\.implementation\.remediation\[\]/u)
  assert.match(contract, /required keys: cause, action, evidence/u)
})

test('submit relocates workspace-root delegation artifact before validation', () => {
  const {
    root,
    runId,
    invocation: planInvocation,
    workflow,
  } = checkpoint('delivery@plan-prepared')

  assert.ok(planInvocation)
  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )

  const misplacedDelegation = path.join(root, '.delegation.md')
  const deliveredBody = path.join(
    root,
    planInvocation.delegation?.delivery_prompt_path ??
      planInvocation.delegation?.canonical_markdown_path ??
      '',
  )
  writeFileSync(misplacedDelegation, readFileSync(deliveredBody, 'utf8'))

  const submitted = submitOutput(root, runId, planInvocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(existsSync(misplacedDelegation), false)
  assert.equal(
    existsSync(
      path.join(
        root,
        delegationPath(runId, planInvocation.invocation_id, root),
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

/** Prepare a fixture delivery run's first delegated plan invocation. */
function prepareDelegatedPlan(root: string): {
  runId: string
  invocation: Invocation
} {
  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  }).run_id
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  return { runId, invocation }
}

test('submit rejects a delegated output with no read attestation', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@plan-prepared',
  )

  assert.ok(invocation)

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
    attestationValidationPath(runId, invocation.invocation_id, root),
  )

  assert.ok(existsSync(artifactPath))
  assert.equal(JSON.parse(readFileSync(artifactPath, 'utf8')).status, 'fail')
})

test('submit reports an unreadable contract reference as blocked', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const { runId, invocation } = prepareDelegatedPlan(root)
  const output = makeOutput(root, invocation, stageBySlug(workflow, 'plan'))
  const manifest = invocation.contract_manifest

  assert.ok(manifest)
  output.result = 'blocked'
  output.invocation_attestation = {
    invocation_id: invocation.invocation_id,
    model: invocation.stage.model,
    contract_path: manifest.contract_path,
    status: 'reference_failed',
    error: `EACCES: ${manifest.contract_path} could not be read`,
  }
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'blocked')

  // Plan's operator gate owns the transition: a blocked outcome waits for the
  // operator with a proposed pause instead of pausing unilaterally.
  assert.equal(submitted.state.status, 'awaiting_operator')

  if (submitted.state.pending_action.type !== 'operator_approval') {
    throw new Error('Expected an operator approval action')
  }

  assert.equal(submitted.state.pending_action.outcome, 'blocked')
  assert.equal(submitted.state.pending_action.proposed_transition, 'paused')

  const artifact = JSON.parse(
    readFileSync(
      path.join(
        root,
        attestationValidationPath(runId, invocation.invocation_id, root),
      ),
      'utf8',
    ),
  ) as { status: string; checks: Array<{ message: string }> }

  assert.equal(artifact.status, 'pass')
  assert.ok(
    artifact.checks.some((check) => check.message.includes('EACCES')),
    'the failed reference MUST name the path and error in evidence',
  )

  // Approval applies the recorded outcome: the run pauses.
  const decided = decideRun(root, runId, 'approve', 'Accept the pause.')

  assert.equal(decided.status, 'paused')
})
