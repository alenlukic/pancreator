import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { StageDefinition, StageOutcome } from '../../src/lib/types.js'
import {
  createFixture,
  makeAttestation,
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
    involvement: 'standard',
  })
  const runId = state.run_id
  const modelConfig = state.pipeline_config?.name

  assert.ok(modelConfig)
  assert.match(
    state.pipeline_config?.path ?? '',
    /pipeline-config\.snapshot\.json$/u,
  )

  const stageSlugs = ['intake', 'plan', 'implement', 'review', 'test', 'ship']

  for (const [stageSequence, stageSlug] of stageSlugs.entries()) {
    const prepared = prepareInvocation(root, runId)
    const invocation = prepared.invocation
    const expectedPrefix = String(99 - stageSequence).padStart(2, '0')

    assert.ok(invocation)
    assert.match(
      invocation.invocation_id,
      new RegExp(`^${expectedPrefix}_${stageSlug}-1_`, 'u'),
    )
    assert.equal(invocation.stage.slug, stageSlug)
    assert.equal(invocation.stage.model_config, modelConfig)
    assert.ok(invocation.stage.model.length > 0)

    const invocationValidationPath = resolveRunLayout(root, runId).validation(
      `${invocation.invocation_id}.invocation-validation.json`,
    ).absolute
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
    assert.equal(
      existsSync(path.join(root, invocation.output.operator_brief.source_path)),
      false,
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
  assert.equal(final.stage_history.length, 6)
  const finalLayout = resolveRunLayout(root, runId)
  const operatorFiles = readdirSync(finalLayout.operator.absolute)

  assert.equal(existsSync(finalLayout.state.absolute), true)
  assert.equal(operatorFiles.filter((item) => item.endsWith('.html')).length, 6)
  assert.equal(
    operatorFiles.some((item) => item.endsWith('.json')),
    false,
  )
  assert.deepEqual(
    final.stage_history.map((item) => item.invocation_id.slice(0, 2)),
    ['05', '04', '03', '02', '01', '00'],
  )
  assert.equal(
    existsSync(path.join(root, `runtime/logs/workflows/${runId}/records`)),
    false,
  )
  assert.ok(
    final.stage_history.every((item) => item.record_path?.endsWith('.json')),
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

test('dev intake is delegated to the intake writer and still awaits ratification', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Intake delegation run',
    involvement: 'standard',
  }).run_id
  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'intake')
  assert.equal(invocation.stage.persona, 'intake-writer')

  // The first stage of the run is now delegated, so it owes the same delivery
  // contract and read attestation every other worker stage owes.
  assert.equal(prepared.state.pending_action.type, 'invoke_agent')
  assert.equal(invocation.delegation?.mode, 'referenced')
  assert.equal(
    invocation.delegation?.cursor_agent_path,
    '.cursor/agents/pan-intake-writer.md',
  )
  assert.ok(invocation.contract_manifest)

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stageBySlug(workflow, 'intake')),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)
  const warnings = (
    submitted.record.evaluation.governance_artifact_warnings ?? []
  ).join('\n')

  assert.equal(submitted.record.outcome, 'success')
  assert.doesNotMatch(warnings, /[Dd]elegation/u)
  assert.doesNotMatch(warnings, /attestation/u)

  // Worker ownership must not change where the operator stops the run.
  assert.equal(submitted.state.status, 'awaiting_operator')
  assert.equal(submitted.state.pending_action.type, 'operator_approval')
  assert.equal(submitted.state.current_stage, 'intake')

  decideRun(root, runId, 'approve', 'fixture approval')
  assert.equal(getRunState(root, runId).current_stage, 'plan')
})

test('a non-empty approval note becomes required context for the routed stage', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const intakeStage = stageBySlug(workflow, 'intake')
  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Approval note run',
    involvement: 'standard',
  }).run_id
  const first = prepareInvocation(root, runId).invocation

  assert.ok(first)
  writeJson(
    path.join(root, first.output.path),
    makeOutput(root, first, intakeStage),
  )
  writeCanonicalDelegation(root, first)
  assert.equal(
    submitOutput(root, runId, first.output.path).state.status,
    'awaiting_operator',
  )

  const directive =
    'Resolve whether the plan adopts cross-run cache persistence explicitly.'

  decideRun(root, runId, 'approve', directive)

  const feedback = getRunState(root, runId).operator_feedback?.at(-1)

  assert.ok(feedback)
  assert.equal(feedback.decision, 'approve')
  assert.equal(feedback.from_stage, 'intake')
  assert.equal(feedback.to_stage, 'plan')
  assert.equal(feedback.note, directive)
  assert.ok(existsSync(path.join(root, feedback.path)))
  assert.match(
    readFileSync(path.join(root, feedback.path), 'utf8'),
    /Operator directive attached to approval/u,
  )

  const plan = prepareInvocation(root, runId).invocation

  assert.ok(plan)
  assert.equal(plan.stage.slug, 'plan')

  const reference = plan.inputs.references.find(
    (entry) => entry.path === feedback.path,
  )

  assert.ok(reference)
  assert.equal(reference.retrieval, 'required')
})

test('an empty approval note records no operator feedback', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const intakeStage = stageBySlug(workflow, 'intake')
  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Plain approval run',
    involvement: 'standard',
  }).run_id
  const first = prepareInvocation(root, runId).invocation

  assert.ok(first)
  writeJson(
    path.join(root, first.output.path),
    makeOutput(root, first, intakeStage),
  )
  writeCanonicalDelegation(root, first)
  submitOutput(root, runId, first.output.path)
  decideRun(root, runId, 'approve')

  const state = getRunState(root, runId)

  assert.equal(state.current_stage, 'plan')
  assert.equal(state.operator_feedback, undefined)
})

test('an operator revision returns dev intake to the intake writer', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const intakeStage = stageBySlug(workflow, 'intake')
  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Intake revision run',
    involvement: 'standard',
  }).run_id
  const first = prepareInvocation(root, runId).invocation

  assert.ok(first)
  writeJson(
    path.join(root, first.output.path),
    makeOutput(root, first, intakeStage),
  )
  writeCanonicalDelegation(root, first)
  assert.equal(
    submitOutput(root, runId, first.output.path).state.status,
    'awaiting_operator',
  )

  const directive = 'Record the retention window as an explicit constraint.'
  decideRun(root, runId, 'revise', directive)

  const second = prepareInvocation(root, runId).invocation

  assert.ok(second)
  assert.equal(second.stage.slug, 'intake')
  assert.equal(second.stage.persona, 'intake-writer')
  assert.equal(second.attempt, 2)

  // A revision is a refinement, not a failed attempt, so it must not spend the
  // stage's retry budget.
  assert.equal(getRunState(root, runId).operator_revisions?.intake, 1)
  assert.equal(getRunState(root, runId).consecutive_failures, 0)

  const feedback = getRunState(root, runId).operator_feedback?.at(-1)

  assert.ok(feedback)
  assert.equal(feedback.decision, 'revise')
  assert.equal(feedback.to_stage, 'intake')
  assert.ok(
    second.inputs.references.some(
      (reference) => reference.path === feedback.path,
    ),
    'the revised card MUST carry the operator directive as an input',
  )
  assert.match(
    readFileSync(path.join(root, feedback.path), 'utf8'),
    /retention window/u,
  )

  writeJson(
    path.join(root, second.output.path),
    makeOutput(root, second, intakeStage),
  )
  writeCanonicalDelegation(root, second)

  const revised = submitOutput(root, runId, second.output.path)

  assert.equal(revised.record.outcome, 'success')
  assert.equal(revised.state.status, 'awaiting_operator')
  decideRun(root, runId, 'approve', 'fixture approval')
  assert.equal(getRunState(root, runId).current_stage, 'plan')
})

test('run preparation rejects live pipeline-config drift from its snapshot', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const configPath = path.join(root, 'config.json')
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
    involvement: 'standard',
  })
  const runId = state.run_id

  const intakeInvocation = prepareInvocation(root, runId).invocation
  assert.ok(intakeInvocation)
  writeJson(
    path.join(root, intakeInvocation.output.path),
    makeOutput(root, intakeInvocation, stageBySlug(workflow, 'intake')),
  )
  writeCanonicalDelegation(root, intakeInvocation)

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

test('a retry may submit a merge-patch revision instead of the whole document', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Revision submission fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  setRunStage(root, runId, 'implement', 'Seed a failing first attempt.')

  const first = submitStageOutput(root, runId, implementStage, 'failure', [
    'implement.acceptance_claimed',
  ])
  const firstInvocationId = first.record.invocation_id
  const firstOutput = JSON.parse(
    readFileSync(
      path.join(root, first.state.stage_history[0].output_path),
      'utf8',
    ),
  ) as Record<string, Record<string, unknown>>

  assert.equal(first.record.outcome, 'failure')
  assert.equal(first.state.current_stage, 'implement')

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(invocation.attempt, 2)
  // The retry card names the prior invocation and teaches the revision form.
  const card = readFileSync(
    path.join(root, prepared.state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /"revises"/u)
  assert.ok(card.includes(firstInvocationId))

  // Author attempt 2's brief (paths differ per attempt), then submit only a
  // patch: flip the verdicts, attest to the new card, add the remediation.
  const template = makeOutput(root, invocation, implementStage)
  const patch = {
    revises: firstInvocationId,
    patch: {
      invocation_id: invocation.invocation_id,
      result: 'success',
      $operator: template.$operator,
      artifacts: template.artifacts,
      criteria: template.criteria,
      invocation_attestation: template.invocation_attestation,
      data: {
        implementation: {
          remediation: [
            {
              cause: 'Acceptance claim lacked evidence',
              action: 'Mapped every criterion to fixture evidence',
              evidence: ['request.md'],
            },
          ],
        },
      },
    },
  }

  writeJson(path.join(root, invocation.output.path), patch)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'review')

  const historyItem = submitted.state.stage_history.find(
    (item) => item.invocation_id === invocation.invocation_id,
  )

  assert.equal(historyItem?.revised_from, firstInvocationId)

  // The merged document carries attempt 1's untouched content plus the patch.
  const merged = JSON.parse(
    readFileSync(path.join(root, invocation.output.path), 'utf8'),
  ) as Record<string, Record<string, unknown>>

  assert.equal(
    merged.invocation_id as unknown as string,
    invocation.invocation_id,
  )
  assert.equal(merged.result as unknown as string, 'success')
  assert.deepEqual(
    (merged.data.implementation as Record<string, unknown>).changed_files,
    (firstOutput.data.implementation as Record<string, unknown>).changed_files,
  )
  assert.equal(
    (
      (merged.data.implementation as Record<string, unknown>)
        .remediation as unknown[]
    ).length,
    1,
  )

  // Resubmitting the same patch is idempotent.
  const replay = submitOutput(root, runId, invocation.output.path)

  assert.equal(replay.idempotent, true)
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

test('pre-implementation baselines capture only source-mutating gate profiles', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Workflow-wide baseline fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: { probes: [], commands: [`node -e "process.exit(1)"`] },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  setRunStage(root, runId, 'implement', 'Capture workflow-wide checks.')

  submitStageOutput(root, runId, implementStage, 'success')
  const baselines = getRunState(root, runId).repository_check_baselines ?? {}

  assert.equal(baselines.static?.status, 'passed')
  assert.equal(baselines.fast?.status, 'passed')
  // Baselines answer one question — did this run's own edits break a check —
  // so only the implement loop's profiles are captured. The expensive `full`
  // profile and the ship-stage configuration check never run before the coder
  // starts; their gates are judged on their own results.
  assert.equal(baselines.full, undefined)
  assert.equal(baselines.configuration, undefined)
})

test('a failed environment probe pauses before source-stage delegation', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Environment probe fixture',
  })

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: {
        environment_probes: ['node -e "process.exit(17)"'],
        probes: [],
        commands: ['node -e "process.exit(0)"'],
      },
      fast: { probes: [], commands: ['node -e "process.exit(0) /* fast */"'] },
      full: { probes: [], commands: ['node -e "process.exit(0) /* full */"'] },
      configuration: {
        probes: [],
        commands: ['node -e "process.exit(0) /* configuration */"'],
      },
    },
  })
  setRunStage(root, state.run_id, 'implement', 'Check the environment first.')

  const prepared = prepareInvocation(root, state.run_id)

  assert.equal(prepared.invocation, null)
  assert.equal(prepared.state.status, 'paused')
  assert.equal(prepared.state.pending_action.type, 'operator_decision')
  assert.match(prepared.state.pause_reason ?? '', /environment probe failed/u)
  assert.equal(prepared.state.repository_check_baselines, undefined)

  // The paused run must stay loadable: the persisted state digest has to match
  // the referenced state artifact after the baseline pointer is cleared.
  const reloaded = getRunState(root, state.run_id)

  assert.equal(reloaded.status, 'paused')
  assert.equal(reloaded.revision, prepared.state.revision)
})

test('the default light level gates QA on the fast profile and never runs full', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Light verification fixture',
  })
  const runId = state.run_id
  const fullMarker = path.join(root, 'runtime', 'full-ran.txt')

  assert.equal(state.verification?.level, 'light')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: {
        probes: [],
        commands: [
          `node -e "require('node:fs').appendFileSync('runtime/full-ran.txt','x'); process.exit(1)"`,
        ],
      },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })

  setRunStage(root, runId, 'implement', 'Baseline the implement-loop profiles.')
  submitStageOutput(root, runId, stageBySlug(workflow, 'implement'), 'success')

  setRunStage(root, runId, 'test', 'Run QA under the light level.')
  const submitted = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'test'),
    'success',
  )
  const fullSuite = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'test.full_suite',
  )

  assert.ok(fullSuite)
  assert.equal(fullSuite.command, 'pan repository-check fast')
  assert.equal(fullSuite.verification_level, 'light')
  assert.equal(fullSuite.passed, true)
  assert.equal(submitted.record.outcome, 'success')
  // The broken full profile never executed at any point in the run.
  assert.equal(existsSync(fullMarker), false)
})

test('thorough verification runs full at QA on its own result', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Thorough verification fixture',
    verification: 'thorough',
  })
  const runId = state.run_id

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: { probes: [], commands: [`node -e "process.exit(1)"`] },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })

  setRunStage(root, runId, 'implement', 'Baseline the implement-loop profiles.')
  submitStageOutput(root, runId, stageBySlug(workflow, 'implement'), 'success')

  // Even under thorough, full is never baselined before implementation: the
  // operator opted into absolute judgment, so a pre-existing failure fails
  // the gate and needs an operator decision instead of passing on a delta.
  assert.equal(
    getRunState(root, runId).repository_check_baselines?.full,
    undefined,
  )

  setRunStage(root, runId, 'test', 'Run QA under the thorough level.')
  const submitted = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'test'),
    'success',
  )
  const fullSuite = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'test.full_suite',
  )

  assert.ok(fullSuite)
  assert.equal(fullSuite.command, 'pan repository-check full')
  assert.equal(fullSuite.passed, false)
  assert.equal(fullSuite.preexisting_failure, undefined)
  assert.equal(submitted.record.outcome, 'failure')
})

test('a scaled QA timeout preserves the environment-blocked route', () => {
  const root = createFixture()
  const configuredTimeoutMs = 1_000
  const commandDelayMs = 1_500
  const resolvedTimeoutMs = 5_000

  // Under the light level the QA gate runs the fast profile, so the
  // infrastructure scenario and the timeout scaling both route through it.
  for (const [stageFile, criterionId] of [
    ['test.json', 'test.full_suite'],
    ['implement.json', 'implement.unit_tests'],
  ] as const) {
    const stagePath = path.join(root, 'library/workflows/dev/stages', stageFile)
    const stageDefinition = JSON.parse(
      readFileSync(stagePath, 'utf8'),
    ) as StageDefinition
    const criterion = stageDefinition.criteria.find(
      (item) => item.id === criterionId,
    )
    assert.ok(criterion)
    criterion.timeout_ms = resolvedTimeoutMs
    writeJson(stagePath, stageDefinition)
  }

  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'QA infrastructure fixture',
  })
  const environmentPath = path.join(root, 'runtime', 'environment.txt')
  const completionPath = path.join(root, 'runtime', 'completed.txt')
  // The emitted diagnostic must carry a genuine infrastructure artifact
  // shape (a pytest collection error): the classifier anchors on shapes, not
  // keyword substrings, so a line merely containing 'timeout' never counts.
  const infrastructureCommand =
    `node -e "const fs=require('node:fs'); ` +
    `setTimeout(() => { const value=fs.readFileSync('runtime/environment.txt','utf8').trim(); ` +
    `fs.appendFileSync('runtime/completed.txt',value+'\\n'); ` +
    `console.error('ERROR collecting tests/integration '+value); process.exit(1) }, ${commandDelayMs})"`

  writeFileSync(environmentPath, 'baseline\n')
  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: ['node -e "process.exit(0)"'] },
      fast: {
        timeout_ms: configuredTimeoutMs,
        probes: [],
        commands: [infrastructureCommand],
      },
      full: { probes: [], commands: ['node -e "process.exit(1) /* full */"'] },
      configuration: {
        probes: [],
        commands: ['node -e "process.exit(0) /* configuration */"'],
      },
    },
  })

  setRunStage(root, state.run_id, 'implement', 'Capture infrastructure state.')
  submitStageOutput(
    root,
    state.run_id,
    stageBySlug(workflow, 'implement'),
    'success',
  )
  const fastBaseline = getRunState(root, state.run_id)
    .repository_check_baselines?.fast
  assert.ok(fastBaseline)
  const baselineResult = JSON.parse(
    readFileSync(path.join(root, fastBaseline.artifact_path), 'utf8'),
  ) as {
    result: {
      timeout_ms: number
      results: Array<{
        kind: string
        exit_code: number | null
        stderr: string
        timed_out: boolean
        duration_ms: number
      }>
    }
  }
  const baselineCommand = baselineResult.result.results.find(
    (result) => result.kind === 'command',
  )

  assert.ok(baselineCommand)
  assert.equal(baselineResult.result.timeout_ms, resolvedTimeoutMs)
  assert.ok(baselineCommand.duration_ms > configuredTimeoutMs)
  assert.equal(baselineCommand.timed_out, false)
  assert.equal(baselineCommand.exit_code, 1)
  assert.match(
    baselineCommand.stderr,
    /ERROR collecting tests\/integration baseline/u,
  )
  // Baseline capture plus the implement gate's own fast run.
  assert.equal(readFileSync(completionPath, 'utf8'), 'baseline\nbaseline\n')

  writeFileSync(environmentPath, 'current\n')
  setRunStage(root, state.run_id, 'test', 'Recheck the QA infrastructure.')

  const submitted = submitStageOutput(
    root,
    state.run_id,
    stageBySlug(workflow, 'test'),
    'success',
  )
  const fullSuite = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'test.full_suite',
  )

  assert.equal(fullSuite?.timed_out, false)
  assert.equal(fullSuite?.command, 'pan repository-check fast')
  assert.equal(
    readFileSync(completionPath, 'utf8'),
    'baseline\nbaseline\ncurrent\n',
  )
  assert.equal(fullSuite?.environment_blocked, true)
  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.status, 'paused')
  assert.equal(submitted.state.pending_action.type, 'operator_decision')
  assert.equal(submitted.state.current_stage, 'test')
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
  assert.match(staticResult?.explanation ?? '', /introduced a new failure/u)
  assert.equal(staticResult?.repository_check_delta?.new.length, 1)
  assert.match(
    staticResult?.repository_check_delta?.new[0]?.diagnostic ?? '',
    /export const base = false/u,
  )
})

test('a repository-check gate credits an inherited failure the stage fixed', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Inherited failure repair fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: {
        probes: [],
        commands: [
          `node -e "const fs=require('node:fs'); const body=fs.readFileSync('src/base.ts','utf8'); if (body.includes('broken')) { console.error('inherited lint failure in src/base.ts'); process.exit(1) }"`,
        ],
      },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = broken\n')
  setRunStage(root, runId, 'implement', 'Baseline an inherited lint failure.')

  const first = prepareInvocation(root, runId).invocation

  assert.ok(first)
  assert.equal(
    getRunState(root, runId).repository_check_baselines?.static?.status,
    'failed',
  )

  const output = makeOutput(root, first, implementStage)
  writeJson(path.join(root, first.output.path), output)
  writeCanonicalDelegation(root, first)

  const inherited = submitOutput(root, runId, first.output.path)
  const beforeRepair = inherited.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(beforeRepair?.passed, true)
  assert.equal(beforeRepair?.preexisting_failure, true)

  // The same worker now repairs the inherited failure and submits the same stage
  // output again. Credit for the repair must not need an operator waiver.
  setRunStage(root, runId, 'implement', 'Repair the inherited lint failure.')
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = true\n')

  const second = prepareInvocation(root, runId).invocation

  assert.ok(second)

  const repaired = makeOutput(root, second, implementStage)
  const implementation = repaired.data.implementation as Record<string, unknown>

  implementation.changed_files = ['src/base.ts']
  writeJson(path.join(root, second.output.path), repaired)
  writeCanonicalDelegation(root, second)

  const submitted = submitOutput(root, runId, second.output.path)
  const afterRepair = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'review')
  assert.equal(afterRepair?.passed, true)
  assert.equal(afterRepair?.preexisting_failure, undefined)
  assert.equal(afterRepair?.repository_check_delta?.new.length, 0)
  assert.ok(
    afterRepair?.repository_check_delta?.fixed.some((diagnostic) =>
      /inherited lint failure/u.test(diagnostic.diagnostic),
    ),
    'the repaired diagnostic must be recorded as fixed',
  )
  assert.deepEqual(getRunState(root, runId).operator_gate_waivers ?? [], [])
})

test('an elided inherited failure stays carried from the full baseline', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Large inherited failure fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')
  const largeFailure =
    `node -e "const fs=require('node:fs');` +
    `process.stderr.write(fs.readFileSync('src/diagnostics.txt','utf8'));` +
    `process.exit(1)"`

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [largeFailure] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  writeFileSync(
    path.join(root, 'src/diagnostics.txt'),
    `${Array.from({ length: 5000 }, (_, index) => `stable diagnostic ${index}`).join('\n')}\n`,
  )
  setRunStage(root, runId, 'implement', 'Compare a large inherited failure.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const baseline = getRunState(root, runId).repository_check_baselines?.static

  assert.ok(baseline)

  const baselineArtifact = JSON.parse(
    readFileSync(path.join(root, baseline.artifact_path), 'utf8'),
  ) as { full_result_path?: string }

  assert.ok(baselineArtifact.full_result_path)

  writeFileSync(
    path.join(root, 'src/diagnostics.txt'),
    'stable diagnostic 2500\n',
  )

  const output = makeOutput(root, invocation, implementStage)
  const implementation = output.data.implementation as Record<string, unknown>

  implementation.changed_files = ['src/diagnostics.txt']
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(staticResult?.passed, true)
  assert.equal(staticResult?.repository_check_delta?.new.length, 0)
  assert.ok(
    staticResult?.repository_check_delta?.carried.some((diagnostic) =>
      diagnostic.diagnostic.includes('stable diagnostic 2500'),
    ),
  )
  assert.equal(
    staticResult?.baseline_evidence_path,
    baselineArtifact.full_result_path,
  )
})

test('a missing baseline artifact pauses the run before delegation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Missing baseline fixture',
  })
  const runId = state.run_id

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: { probes: [], commands: [`node -e "process.exit(0) /* full */"`] },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  setRunStage(root, runId, 'implement', 'Capture baselines to delete one.')
  submitStageOutput(root, runId, stageBySlug(workflow, 'implement'), 'success')

  const baseline = getRunState(root, runId).repository_check_baselines?.static

  assert.ok(baseline)
  rmSync(path.join(root, baseline.artifact_path))

  setRunStage(root, runId, 'implement', 'Re-enter implementation without one.')

  const prepared = prepareInvocation(root, runId)

  // A gate judged against a baseline cannot run without it, and the worker
  // cannot influence that fault, so the stage attempt must not be spent.
  assert.equal(prepared.invocation, null)
  assert.equal(prepared.state.status, 'paused')
  assert.equal(prepared.state.pending_action.type, 'operator_decision')
  assert.match(prepared.state.pause_reason ?? '', /cannot be delegated/u)
  assert.match(prepared.state.pause_reason ?? '', /implement\.lint/u)
  assert.match(
    prepared.state.pause_reason ?? '',
    /baseline artifact is missing/u,
  )
})

test('a wiped baseline map degrades gates to absolute judgment without recapture', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Missing baseline map fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  setRunStage(root, runId, 'implement', 'Capture baselines before damage.')
  submitStageOutput(root, runId, implementStage, 'success')

  const statePath = resolveRunLayout(root, runId).state.absolute
  const damagedState = JSON.parse(readFileSync(statePath, 'utf8')) as Record<
    string,
    unknown
  >

  damagedState.repository_check_baselines = {}
  writeJson(statePath, damagedState)
  setRunStage(root, runId, 'implement', 'Re-enter with no baseline pointers.')

  // The capture-once invariant holds: nothing is recaptured after
  // implementation. An absent pointer under a verification level means the
  // gate is judged on its own result instead of failing closed, so the run
  // proceeds without an operator pause.
  const submitted = submitStageOutput(root, runId, implementStage, 'success')
  const staticResult = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(staticResult?.passed, true)
  assert.equal(staticResult?.baseline_evidence_path, undefined)
  assert.deepEqual(getRunState(root, runId).repository_check_baselines, {})
})

test('a repository-check gate fails closed when its baseline disappears', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Fail-closed baseline fixture',
  })
  const runId = state.run_id
  const implementStage = stageBySlug(workflow, 'implement')

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  setRunStage(root, runId, 'implement', 'Baseline a green static profile.')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const baseline = getRunState(root, runId).repository_check_baselines?.static

  assert.ok(baseline)

  const output = makeOutput(root, invocation, implementStage)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  rmSync(path.join(root, baseline.artifact_path))

  const submitted = submitOutput(root, runId, invocation.output.path)
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  // A green exit code is not evidence of parity when the comparison the gate
  // depends on cannot be made.
  assert.equal(staticResult?.passed, false)
  assert.match(staticResult?.explanation ?? '', /baseline artifact is missing/u)
  assert.equal(submitted.record.outcome, 'failure')
})

test('an incompatible baseline artifact pauses the run before delegation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Incompatible baseline fixture',
  })
  const runId = state.run_id

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: [`node -e "process.exit(0)"`] },
      fast: { probes: [], commands: [`node -e "process.exit(0)"`] },
      full: { probes: [], commands: [`node -e "process.exit(0) /* full */"`] },
      configuration: { probes: [], commands: [`node -e "process.exit(0)"`] },
    },
  })
  setRunStage(root, runId, 'implement', 'Capture baselines to corrupt one.')
  submitStageOutput(root, runId, stageBySlug(workflow, 'implement'), 'success')

  const baseline = getRunState(root, runId).repository_check_baselines?.static

  assert.ok(baseline)
  writeJson(path.join(root, baseline.artifact_path), {
    schema_version: 1,
    profile: 'static',
    result: { status: 'failed' },
  })

  setRunStage(root, runId, 'implement', 'Re-enter implementation.')

  const prepared = prepareInvocation(root, runId)

  assert.equal(prepared.invocation, null)
  assert.equal(prepared.state.status, 'paused')
  assert.match(prepared.state.pause_reason ?? '', /incompatible with its gate/u)
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

test('governance and artifact defects are advisory before ship and never loop to implementation', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Governance warning fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'review', 'Exercise advisory validation routing.')
  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)
  assert.equal(
    existsSync(path.join(root, invocation.output.operator_brief.source_path)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, invocation.output.operator_brief.rendered_path)),
    false,
  )

  writeJson(path.join(root, invocation.output.path), {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: 'success',
    invocation_attestation: makeAttestation(invocation),
  })

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'test')
  assert.equal(submitted.state.status, 'running')
  assert.ok(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).length > 0,
  )
  assert.equal(
    existsSync(path.join(root, invocation.output.operator_brief.rendered_path)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, invocation.output.operator_brief.source_path)),
    true,
  )
  assert.equal(
    existsSync(
      resolveRunLayout(root, runId).artifactJson(
        'governance-artifact-issues.json',
      ).absolute,
    ),
    true,
  )
})

test('ship owns governance artifact review and pauses instead of looping to implementation', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Ship governance fixture',
  })
  const runId = state.run_id

  setRunStage(root, runId, 'ship', 'Exercise ship-stage escalation.')
  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)
  writeJson(path.join(root, invocation.output.path), {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: 'success',
    invocation_attestation: makeAttestation(invocation),
  })

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  // Ship carries an operator gate, so the failure stops for a decision before it
  // takes the failure route.
  assert.equal(submitted.state.status, 'awaiting_operator')
  assert.equal(submitted.state.pending_action.type, 'operator_approval')
  assert.equal(
    submitted.state.pending_action.type === 'operator_approval' &&
      submitted.state.pending_action.outcome,
    'failure',
  )
  assert.equal(submitted.state.current_stage, 'ship')
  assert.notEqual(submitted.state.current_stage, 'implement')
  assert.ok(
    (submitted.record.evaluation.governance_artifact_warnings ?? []).length > 0,
  )

  const decided = decideRun(root, runId, 'approve', 'Accept the failure route.')

  assert.equal(decided.status, 'paused')
  assert.equal(decided.current_stage, 'ship')
})
