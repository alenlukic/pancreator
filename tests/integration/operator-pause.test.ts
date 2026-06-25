import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  decideRun,
  pauseRun,
  prepareInvocation,
  resumeRun,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { resolveRoots } from '../../src/lib/workspace/roots.js'
import { validateWorkflowChanges } from '../../src/lib/workspace/validate-changes.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

test('operator pause preserves supervisor gate and resume restores it', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Pause fixture',
  })
  const runId = state.run_id

  prepareInvocation(root, runId)
  const intakePrepared = prepareInvocation(root, runId)
  const intakeInvocation = intakePrepared.invocation

  assert.ok(intakeInvocation)

  writeJson(
    path.join(root, intakeInvocation.output.path),
    makeOutput(root, intakeInvocation, stageBySlug(workflow, 'intake')),
  )

  submitOutput(root, runId, intakeInvocation.output.path)
  decideRun(root, runId, 'approve', 'fixture approval')

  prepareInvocation(root, runId)
  const planPrepared = prepareInvocation(root, runId)
  const planInvocation = planPrepared.invocation

  assert.ok(planInvocation)

  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )
  writeCanonicalDelegation(root, planInvocation)

  const submitted = submitOutput(root, runId, planInvocation.output.path)

  assert.equal(submitted.state.status, 'awaiting_supervisor')
  assert.equal(submitted.state.pending_action.type, 'supervisor_assessment')

  const paused = pauseRun(root, runId, 'Need to edit the repo first.')

  assert.equal(paused.status, 'paused')
  assert.equal(paused.pending_action.type, 'operator_decision')
  assert.equal(paused.pause_reason, 'Need to edit the repo first.')
  assert.ok(paused.operator_pause)
  assert.equal(paused.operator_pause?.prior_status, 'awaiting_supervisor')
  assert.equal(
    paused.operator_pause?.prior_pending_action.type,
    'supervisor_assessment',
  )
  assert.equal(paused.current_invocation?.id, planInvocation.invocation_id)

  const resumed = resumeRun(root, runId)

  assert.equal(resumed.status, 'awaiting_supervisor')
  assert.equal(resumed.pending_action.type, 'supervisor_assessment')
  assert.equal(resumed.operator_pause, null)
  assert.equal(resumed.current_invocation?.id, planInvocation.invocation_id)
})

test('operator pause from running prepare_invocation resumes to prepare', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Pause fixture',
  })
  const runId = state.run_id

  const paused = pauseRun(root, runId, 'Stepping away.')

  assert.equal(paused.status, 'paused')
  assert.equal(paused.operator_pause?.prior_status, 'running')
  assert.equal(
    paused.operator_pause?.prior_pending_action.type,
    'prepare_invocation',
  )

  const resumed = resumeRun(root, runId)

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.pending_action.type, 'prepare_invocation')
})

test('operator changes made during a pause are ledgered and stale cards are replaced', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Paused operator edit fixture',
  })
  const runId = state.run_id
  const prepared = prepareInvocation(root, runId)
  const originalInvocation = prepared.invocation

  assert.ok(originalInvocation)
  assert.equal(originalInvocation.attempt, 1)

  pauseRun(root, runId, 'Operator is applying an authorized correction.')
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const operatorFix = true\n',
  )

  const resumed = resumeRun(root, runId, 'intake', 'Authorized operator fix.')

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.pending_action.type, 'prepare_invocation')
  assert.equal(resumed.current_invocation, null)
  assert.equal(resumed.attempts.intake, 0)
  assert.equal(resumed.operator_workspace_ratifications?.length, 1)
  assert.equal(
    resumed.accepted_workspace_fingerprint,
    resumed.operator_workspace_ratifications?.[0]?.workspace_fingerprint,
  )

  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: resumed.state_root,
  })
  const validation = validateWorkflowChanges({
    run_id: runId,
    state_root: roots.state_root,
    roots,
  })

  assert.equal(validation.status, 'passed')
  assert.equal(validation.ledger_entry_count, 1)

  const replacement = prepareInvocation(root, runId).invocation

  assert.ok(replacement)
  assert.equal(replacement.attempt, 1)
  assert.notEqual(replacement.invocation_id, originalInvocation.invocation_id)
  assert.equal(
    replacement.workspace_before.fingerprint,
    resumed.accepted_workspace_fingerprint,
  )
})

test('harness pause resume still restarts at prepare_invocation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Pause fixture',
  })
  const runId = state.run_id

  prepareInvocation(root, runId)
  const intakePrepared = prepareInvocation(root, runId)
  const intakeInvocation = intakePrepared.invocation

  assert.ok(intakeInvocation)

  writeJson(
    path.join(root, intakeInvocation.output.path),
    makeOutput(root, intakeInvocation, stageBySlug(workflow, 'intake')),
  )

  submitOutput(root, runId, intakeInvocation.output.path)
  decideRun(root, runId, 'approve', 'fixture approval')

  prepareInvocation(root, runId)
  const planPrepared = prepareInvocation(root, runId)
  const planInvocation = planPrepared.invocation

  assert.ok(planInvocation)

  const blockedOutput = makeOutput(
    root,
    planInvocation,
    stageBySlug(workflow, 'plan'),
  )

  blockedOutput.result = 'blocked'
  blockedOutput.summary = 'Need operator input before continuing.'

  writeJson(path.join(root, planInvocation.output.path), blockedOutput)
  writeCanonicalDelegation(root, planInvocation)

  const submitted = submitOutput(root, runId, planInvocation.output.path)

  assert.equal(submitted.state.status, 'paused')
  assert.equal(submitted.state.operator_pause, undefined)

  const resumed = resumeRun(root, runId, 'implement', 'Restart implementation.')

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.current_stage, 'implement')
  assert.equal(resumed.pending_action.type, 'prepare_invocation')
})
