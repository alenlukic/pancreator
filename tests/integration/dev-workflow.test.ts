import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  assessStage,
  createRun,
  decideRun,
  getRunState,
  prepareInvocation,
  resumeRun,
  setRunStage,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

test('full dev workflow persists gates and reaches operator-approved success', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Fixture run',
  })
  const runId = state.run_id
  const modelConfig = state.pipeline_config?.name

  assert.ok(modelConfig)
  assert.match(
    state.pipeline_config?.path ?? '',
    /pipeline-config\.snapshot\.json$/u,
  )

  const stageSlugs = [
    'intake',
    'plan',
    'implement',
    'review',
    'test',
    'validate-changes',
    'ship',
  ]

  for (const [stageSequence, stageSlug] of stageSlugs.entries()) {
    const prepared = prepareInvocation(root, runId)
    const invocation = prepared.invocation
    const expectedPrefix = String(999 - stageSequence).padStart(3, '0')

    if (stageSlug === 'validate-changes') {
      assert.equal(invocation, null)
      assert.equal(prepared.state.current_stage, 'ship')
      assert.match(
        prepared.state.stage_history.at(-1)?.invocation_id ?? '',
        new RegExp(`^${expectedPrefix}_validate-changes-1_`, 'u'),
      )
      continue
    }

    assert.ok(invocation)
    assert.match(
      invocation.invocation_id,
      new RegExp(`^${expectedPrefix}_${stageSlug}-1_`, 'u'),
    )
    assert.equal(invocation.stage.slug, stageSlug)
    assert.equal(invocation.stage.model_config, modelConfig)
    assert.ok(invocation.stage.model.length > 0)

    const invocationValidationPath = path.join(
      root,
      `runtime/logs/workflows/${runId}/invocations/${invocation.invocation_id}.invocation-validation.json`,
    )
    assert.ok(existsSync(invocationValidationPath))

    const stage = stageBySlug(workflow, stageSlug)
    const output = makeOutput(root, invocation, stage)

    writeJson(path.join(root, invocation.output.path), output)

    if (stage.persona !== 'orchestrator') {
      writeCanonicalDelegation(root, invocation)
    }

    const submitted = submitOutput(root, runId, invocation.output.path)

    assert.equal(submitted.record.outcome, 'success')

    if (stageSlug === 'intake') {
      const repeated = submitOutput(root, runId, invocation.output.path)

      assert.equal(repeated.idempotent, true)
      assert.equal(repeated.record.invocation_id, invocation.invocation_id)
    }

    if (stageSlug === 'intake' || stageSlug === 'ship') {
      assert.equal(submitted.state.status, 'awaiting_operator')
      decideRun(root, runId, 'approve', 'fixture approval')
    } else if (stageSlug === 'plan') {
      assert.equal(submitted.state.status, 'awaiting_supervisor')
      assert.equal(submitted.state.pending_action.type, 'supervisor_assessment')

      if (submitted.state.pending_action.type !== 'supervisor_assessment') {
        throw new Error('Expected supervisor assessment action')
      }

      const assessmentPath = submitted.state.pending_action.output_path

      writeJson(path.join(root, assessmentPath), {
        schema_version: 1,
        assessment_id: randomUUID(),
        invocation_id: invocation.invocation_id,
        verdict: 'pass',
        summary: 'Plan is implementation-ready.',
        criteria: stage.criteria.map((criterion) => ({
          id: criterion.id,
          result: 'pass',
          evidence: [invocation.output.path],
          explanation: 'Fixture evidence',
        })),
      })
      assessStage(root, runId, assessmentPath)
    }
  }

  const final = getRunState(root, runId)

  assert.equal(final.status, 'succeeded')
  assert.equal(final.current_stage, null)
  assert.equal(final.stage_history.length, 7)
  const validateChangesHistory = final.stage_history.find(
    (item) => item.stage === 'validate-changes',
  )
  assert.ok(validateChangesHistory)
  assert.equal(
    validateChangesHistory.output_path,
    `runtime/workflows/${runId}/ledger-validation.json`,
  )
  assert.ok(
    final.stage_history
      .filter((item) => item.stage !== 'validate-changes')
      .every((item) => item.record_path),
  )
})

test('run preparation rejects live pipeline-config drift from its snapshot', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const configPath = path.join(root, 'project.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    active_config: string
  }

  config.active_config =
    config.active_config === 'default' ? 'complex' : 'default'
  writeJson(configPath, config)

  assert.throws(
    () => prepareInvocation(root, state.run_id),
    /live active mapping has changed/u,
  )
})

test('paused remediation note is attached to the next implement invocation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Fixture run',
  })
  const runId = state.run_id

  const intakeInvocation = prepareInvocation(root, runId).invocation
  assert.ok(intakeInvocation)
  writeJson(
    path.join(root, intakeInvocation.output.path),
    makeOutput(root, intakeInvocation, stageBySlug(workflow, 'intake')),
  )
  const intakeSubmitted = submitOutput(
    root,
    runId,
    intakeInvocation.output.path,
  )
  assert.equal(intakeSubmitted.state.status, 'awaiting_operator')
  decideRun(root, runId, 'approve', 'fixture approval')

  const planInvocation = prepareInvocation(root, runId).invocation
  assert.ok(planInvocation)
  writeJson(
    path.join(root, planInvocation.output.path),
    makeOutput(root, planInvocation, stageBySlug(workflow, 'plan')),
  )
  writeCanonicalDelegation(root, planInvocation)
  const planSubmitted = submitOutput(root, runId, planInvocation.output.path)
  assert.equal(planSubmitted.state.status, 'awaiting_supervisor')

  if (planSubmitted.state.pending_action.type !== 'supervisor_assessment') {
    throw new Error('Expected supervisor assessment action')
  }

  writeJson(path.join(root, planSubmitted.state.pending_action.output_path), {
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
  assessStage(root, runId, planSubmitted.state.pending_action.output_path)

  const implementInvocation = prepareInvocation(root, runId).invocation
  assert.ok(implementInvocation)
  const blockedOutput = makeOutput(
    root,
    implementInvocation,
    stageBySlug(workflow, 'implement'),
    'blocked',
  )
  blockedOutput.summary = 'Implementation paused for a remediation restart.'
  writeJson(path.join(root, implementInvocation.output.path), blockedOutput)
  writeCanonicalDelegation(root, implementInvocation)

  const implementSubmitted = submitOutput(
    root,
    runId,
    implementInvocation.output.path,
  )
  assert.equal(implementSubmitted.state.status, 'paused')
  assert.equal(
    implementSubmitted.state.pending_action.type,
    'operator_decision',
  )

  const note =
    'Review the existing implementation carefully and refactor it before proceeding.'
  const resumed = resumeRun(root, runId, 'implement', note)
  assert.equal(resumed.status, 'running')
  assert.equal(resumed.pending_action.type, 'prepare_invocation')
  assert.equal(resumed.operator_feedback?.at(-1)?.decision, 'resume')

  const reprepared = prepareInvocation(root, runId).invocation
  assert.ok(reprepared)
  assert.equal(reprepared.stage.slug, 'implement')
  assert.equal(reprepared.attempt, 2)

  const feedback = getRunState(root, runId).operator_feedback?.at(-1)
  assert.ok(feedback)
  assert.equal(feedback.to_stage, 'implement')
  assert.ok(
    reprepared.inputs.references.some(
      (reference) => reference.path === feedback.path,
    ),
  )

  const feedbackBody = readFileSync(path.join(root, feedback.path), 'utf8')
  assert.match(feedbackBody, /refactor it before proceeding/u)
})

test('operator set-stage bypasses transitions and injects repair context', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Fixture run',
  })
  const runId = state.run_id
  const originalInvocation = prepareInvocation(root, runId).invocation

  assert.ok(originalInvocation)
  assert.equal(originalInvocation.stage.slug, 'intake')
  assert.match(originalInvocation.invocation_id, /^999_intake-1_/u)

  const note =
    'Repair the run by independently reviewing the current workspace.'
  const repaired = setRunStage(root, runId, 'review', note)

  assert.equal(repaired.status, 'running')
  assert.equal(repaired.current_stage, 'review')
  assert.equal(repaired.pending_action.type, 'prepare_invocation')
  assert.equal(repaired.current_invocation, null)
  assert.equal(repaired.transition_count, 0)
  assert.equal(repaired.consecutive_failures, 0)
  assert.equal(repaired.operator_feedback?.at(-1)?.decision, 'set-stage')

  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'review')
  assert.equal(invocation.attempt, 1)
  assert.match(invocation.invocation_id, /^998_review-1_/u)

  const feedback = getRunState(root, runId).operator_feedback?.at(-1)
  assert.ok(feedback)
  assert.equal(feedback.from_stage, 'intake')
  assert.equal(feedback.to_stage, 'review')
  assert.ok(
    invocation.inputs.references.some(
      (reference) =>
        reference.path === feedback.path &&
        reference.description.startsWith('Operator stage repair'),
    ),
  )

  const feedbackBody = readFileSync(path.join(root, feedback.path), 'utf8')
  assert.match(feedbackBody, /independently reviewing the current workspace/u)
})

test('operator set-stage requires a valid target and non-empty repair note', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })

  assert.throws(
    () => setRunStage(root, state.run_id, 'review', '   '),
    /Stage repair note MUST be non-empty/u,
  )
  assert.throws(
    () => setRunStage(root, state.run_id, 'missing', 'repair target'),
    /Workflow dev has no stage 'missing'/u,
  )
})
