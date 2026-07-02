import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  assessStage,
  createRun,
  decideRun,
  getRunState,
  pauseRun,
  prepareInvocation,
  resumeRun,
  setRunStage,
  submitOutput,
  waiveGate,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { nextSemanticVersion } from '../../src/lib/versioning.js'
import type { StageDefinition, StageOutcome } from '../../src/lib/types.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

test('full dev workflow persists gates and reaches operator-approved success', () => {
  const root = createFixture()
  const initialVersion = readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
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
    const expectedPrefix = String(99 - stageSequence).padStart(2, '0')

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

    assert.equal(
      submitted.record.outcome,
      'success',
      `${stageSlug}: ${JSON.stringify(submitted.record.evaluation)}`,
    )

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
  assert.deepEqual(
    final.stage_history.map((item) => item.invocation_id.slice(0, 2)),
    ['06', '05', '04', '03', '02', '01', '00'],
  )
  assert.equal(
    existsSync(path.join(root, `runtime/logs/workflows/${runId}/records`)),
    false,
  )
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
      .every((item) => item.record_path?.endsWith('.json')),
  )
  assert.equal(
    final.stage_history.some((item) =>
      item.record_path?.endsWith('.record.md'),
    ),
    false,
  )
  assert.equal(
    readFileSync(path.join(root, 'VERSION'), 'utf8').trim(),
    nextSemanticVersion(initialVersion, 'patch'),
  )
  const shipHistory = final.stage_history.find((item) => item.stage === 'ship')
  const scopeResult = shipHistory?.deterministic.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )
  const priorGateResult = shipHistory?.deterministic.find(
    (item) => item.id === 'ship.prior_gates_current',
  )

  assert.equal(scopeResult?.passed, true)
  assert.match(scopeResult?.explanation ?? '', /permitted release metadata/u)
  assert.equal(priorGateResult?.passed, true)
  assert.match(
    priorGateResult?.explanation ?? '',
    /do not invalidate the reviewed implementation fingerprint/u,
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
  assert.match(originalInvocation.invocation_id, /^99_intake-1_/u)

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
  assert.match(invocation.invocation_id, /^98_review-1_/u)

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

function submitStageOutput(
  root: string,
  runId: string,
  stage: StageDefinition,
  result: StageOutcome,
  failedCriterionIds: string[] = [],
) {
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stage, result)
  output.result = result

  for (const criterion of output.criteria) {
    criterion.result = failedCriterionIds.includes(criterion.id)
      ? 'fail'
      : 'pass'
  }

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  return submitOutput(root, runId, invocation.output.path)
}

test('implementation same-reason failure twice pauses before a third attempt', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Same-reason implementation fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(
    root,
    runId,
    'implement',
    'Seed implementation for direct self-loop testing.',
  )

  const first = submitStageOutput(root, runId, implementStage, 'failure', [
    'implement.acceptance_claimed',
  ])

  assert.equal(first.state.status, 'running')
  assert.equal(first.state.current_stage, 'implement')
  assert.equal(first.state.same_reason_failures?.implement?.repeat_count, 1)

  const second = submitStageOutput(root, runId, implementStage, 'failure', [
    'implement.acceptance_claimed',
  ])

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
  assert.equal(second.state.attempts.implement, 2)
  assert.match(second.state.pause_reason ?? '', /same deterministic reason/u)
})

test('unchanged pre-existing repository-check failures do not block implementation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Pre-existing repository failure fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: {
        probes: [],
        commands: [
          `node -e "console.error('known lint failure'); process.exit(1)"`,
        ],
      },
      fast: {
        probes: [],
        commands: [`node -e "process.exit(0)"`],
      },
    },
  })
  setRunStage(root, runId, 'implement', 'Exercise baseline-aware gates.')

  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)
  const baseline = getRunState(root, runId).repository_check_baselines?.static

  assert.equal(baseline?.status, 'failed')
  assert.ok(baseline && existsSync(path.join(root, baseline.artifact_path)))
  assert.ok(
    invocation.inputs.references.some(
      (reference) => reference.path === baseline?.artifact_path,
    ),
  )

  const output = makeOutput(root, invocation, implementStage)
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'review')
  assert.equal(staticResult?.passed, true)
  assert.equal(staticResult?.preexisting_failure, true)
  assert.equal(staticResult?.exit_code, 1)
  assert.equal(staticResult?.baseline_evidence_path, baseline?.artifact_path)
})

test('unchanged pre-existing full repository-check failures do not block QA', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Pre-existing QA failure fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')
  const reviewStage = stageBySlug(workflow, 'review')
  const testStage = stageBySlug(workflow, 'test')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: {
        probes: [],
        commands: [`node -e "process.exit(0)"`],
      },
      fast: {
        probes: [],
        commands: [`node -e "process.exit(0)"`],
      },
      full: {
        probes: [],
        commands: [
          `node -e "console.error('known full-suite failure'); process.exit(1)"`,
        ],
      },
      configuration: {
        probes: [],
        commands: [`node -e "process.exit(0)"`],
      },
    },
  })
  setRunStage(
    root,
    runId,
    'implement',
    'Exercise workflow-wide check baselines.',
  )

  submitStageOutput(root, runId, implementStage, 'success')
  const baselines = getRunState(root, runId).repository_check_baselines ?? {}
  const fullBaseline = baselines.full

  assert.equal(fullBaseline?.status, 'failed')
  assert.ok(
    fullBaseline && existsSync(path.join(root, fullBaseline.artifact_path)),
  )
  assert.equal(baselines.configuration?.status, 'passed')

  submitStageOutput(root, runId, reviewStage, 'success')

  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)

  const output = makeOutput(root, invocation, testStage)
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)
  const fullResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'test.full_suite',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'validate-changes')
  assert.equal(fullResult?.passed, true)
  assert.equal(fullResult?.preexisting_failure, true)
  assert.equal(fullResult?.exit_code, 1)
  assert.equal(fullResult?.baseline_evidence_path, fullBaseline?.artifact_path)
})

test('new repository-check diagnostics still block implementation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Repository regression fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: {
        probes: [],
        commands: [
          `node -e "const fs=require('node:fs'); console.error(fs.readFileSync('src/base.ts','utf8').trim()); process.exit(1)"`,
        ],
      },
      fast: {
        probes: [],
        commands: [`node -e "process.exit(0)"`],
      },
    },
  })
  setRunStage(root, runId, 'implement', 'Exercise regression-aware gates.')

  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')
  const output = makeOutput(root, invocation, implementStage)
  const implementation = output.data.implementation as Record<string, unknown>
  implementation.changed_files = ['src/base.ts']
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'implement')
  assert.equal(staticResult?.passed, false)
  assert.match(staticResult?.explanation ?? '', /new or changed failure/u)
})

test('review same-reason failure twice pauses for operator_decision', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Same-reason review fixture',
  })
  const runId = state.run_id
  const reviewStage = stageBySlug(workflow, 'review')
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'review', 'Seed review for same-reason testing.')

  const first = submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])

  assert.equal(first.state.status, 'running')
  assert.equal(first.state.current_stage, 'implement')
  assert.equal(first.state.same_reason_failures?.review?.repeat_count, 1)

  submitStageOutput(root, runId, implementStage, 'success')

  const second = submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
  assert.equal(second.state.current_stage, 'review')
  assert.match(second.state.pause_reason ?? '', /same deterministic reason/u)
})

test('test same-reason failure twice pauses for operator_decision', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Same-reason test fixture',
  })
  const runId = state.run_id
  const reviewStage = stageBySlug(workflow, 'review')
  const testStage = stageBySlug(workflow, 'test')
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'test', 'Seed test for same-reason testing.')

  const first = submitStageOutput(root, runId, testStage, 'failure', [
    'test.manual_cases',
  ])

  assert.equal(first.state.current_stage, 'implement')
  assert.equal(first.state.same_reason_failures?.test?.repeat_count, 1)

  submitStageOutput(root, runId, implementStage, 'success')
  submitStageOutput(root, runId, reviewStage, 'success')

  const second = submitStageOutput(root, runId, testStage, 'failure', [
    'test.manual_cases',
  ])

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
  assert.equal(second.state.current_stage, 'test')
})

test('different review failure reasons keep remediation route to implement', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Different-reason review fixture',
  })
  const runId = state.run_id
  const reviewStage = stageBySlug(workflow, 'review')
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(
    root,
    runId,
    'review',
    'Seed review for different-reason testing.',
  )

  submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])
  submitStageOutput(root, runId, implementStage, 'success')

  const second = submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.tests_correct',
  ])

  assert.equal(second.state.status, 'running')
  assert.equal(second.state.current_stage, 'implement')
  assert.equal(second.state.same_reason_failures?.review?.repeat_count, 1)
  assert.deepEqual(second.state.same_reason_failures?.review?.last_signature, [
    'review.tests_correct',
  ])
})

test('strict superset review failures trigger same-reason pause', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Superset review fixture',
  })
  const runId = state.run_id
  const reviewStage = stageBySlug(workflow, 'review')
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'review', 'Seed review for superset testing.')

  submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])
  submitStageOutput(root, runId, implementStage, 'success')

  const second = submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
    'review.tests_correct',
  ])

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
})

test('same-reason tracker resets on stage pass, waive-gate, and set-stage', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Same-reason reset fixture',
  })
  const runId = state.run_id
  const reviewStage = stageBySlug(workflow, 'review')
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'review', 'Seed review for reset testing.')
  submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])
  assert.equal(
    getRunState(root, runId).same_reason_failures?.review?.repeat_count,
    1,
  )

  setRunStage(
    root,
    runId,
    'review',
    'Operator repair clears same-reason memory.',
  )
  assert.equal(getRunState(root, runId).same_reason_failures?.review, undefined)

  submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])
  submitStageOutput(root, runId, implementStage, 'success')
  submitStageOutput(root, runId, reviewStage, 'success')
  assert.equal(getRunState(root, runId).same_reason_failures?.review, undefined)

  setRunStage(root, runId, 'review', 'Prepare waiver reset coverage.')
  const failed = submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])
  assert.equal(failed.state.current_stage, 'implement')
  submitStageOutput(root, runId, implementStage, 'success')
  const paused = submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])
  assert.equal(paused.state.status, 'paused')

  const waived = waiveGate(root, runId, {
    stageSlug: 'review',
    criterionIds: ['review.acceptance_met'],
    note: 'Bounded review miss is isolated and does not block downstream validation.',
  })

  assert.equal(waived.state.status, 'running')
  assert.equal(waived.state.current_stage, 'test')
  assert.equal(getRunState(root, runId).same_reason_failures?.review, undefined)
})

test('set-stage to implement clears tracked review same-reason memory', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Set-stage to implement reset fixture',
  })
  const runId = state.run_id
  const reviewStage = stageBySlug(workflow, 'review')
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'review', 'Seed review for set-stage reset testing.')
  submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])
  assert.equal(
    getRunState(root, runId).same_reason_failures?.review?.repeat_count,
    1,
  )
  assert.equal(getRunState(root, runId).current_stage, 'implement')

  setRunStage(
    root,
    runId,
    'implement',
    'Operator repair targets implement and clears review memory.',
  )
  assert.equal(getRunState(root, runId).same_reason_failures?.review, undefined)

  submitStageOutput(root, runId, implementStage, 'success')

  const second = submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])

  assert.equal(second.state.status, 'running')
  assert.equal(second.state.current_stage, 'implement')
  assert.equal(second.state.same_reason_failures?.review?.repeat_count, 1)
})

test('ordinary resume preserves same-reason tracker across implement work', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Resume preserves tracker fixture',
  })
  const runId = state.run_id
  const reviewStage = stageBySlug(workflow, 'review')
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'review', 'Seed review for resume testing.')
  submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])
  assert.equal(
    getRunState(root, runId).same_reason_failures?.review?.repeat_count,
    1,
  )

  pauseRun(root, runId, 'Operator pauses before remediation continues.')
  resumeRun(
    root,
    runId,
    'implement',
    'Resume remediation without forgiving review.',
  )
  assert.equal(
    getRunState(root, runId).same_reason_failures?.review?.repeat_count,
    1,
  )

  submitStageOutput(root, runId, implementStage, 'success')

  const second = submitStageOutput(root, runId, reviewStage, 'failure', [
    'review.acceptance_met',
  ])

  assert.equal(second.state.status, 'paused')
  assert.equal(second.state.pending_action.type, 'operator_decision')
})
