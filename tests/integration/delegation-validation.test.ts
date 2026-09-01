import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { decideRun } from '../../src/lib/engine.js'
import {
  attestationValidationPath,
  delegationPath,
  delegationValidationPath,
} from '../../src/lib/validation.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
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

  const submitted = submitAsSupervisor(root, runId, planInvocation.output.path)

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

  const submitted = submitAsSupervisor(root, runId, planInvocation.output.path)

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

  const submitted = submitAsSupervisor(root, runId, planInvocation.output.path)

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

test('submit rejects a delegated output with no read attestation', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@plan-prepared',
  )

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'plan'))

  delete output.invocation_attestation
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

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
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@plan-prepared',
  )

  assert.ok(invocation)
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

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'blocked')

  // Plan's operator gate owns the transition: a blocked outcome waits for the
  // operator with a proposed pause instead of pausing unilaterally.
  assert.equal(submitted.state.status, 'awaiting_operator')

  if (submitted.state.pending_action.type !== 'operator_approval') {
    throw new Error('Expected an operator approval action')
  }

  assert.equal(submitted.state.pending_action.outcome, 'blocked')
  assert.equal(submitted.state.pending_action.proposed_transition, 'paused')

  const decided = decideRun(root, runId, 'approve', 'Accept the pause.')

  assert.equal(decided.status, 'paused')
})
