import assert from 'node:assert/strict'
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
  createRun,
  decideRun,
  decideRunAsAway,
  getRunState,
  pauseRun,
  prepareInvocation,
  resumeRun,
  resumeRunAsAway,
  setRunStage,
  setRunStageAsAway,
  submitOutput,
} from '../../src/lib/engine.js'
import {
  awayModeTrigger,
  countAwayDecisions,
  readAwayDecisionLedger,
  recordAwayApplyResult,
  recordAwayEvaluation,
  recordDeterministicShipApproval,
} from '../../src/lib/away-mode.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { nextSemanticVersion } from '../../src/lib/versioning.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { TaskRecord } from '../../src/lib/types.js'
import {
  createFixture,
  makeOutput,
  read,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { BRIEFS, checkpoint } from './delivery-helpers.js'
import type { CheckpointVariant } from './delivery-helpers.js'

test('full delivery workflow persists gates and reaches operator-approved success', () => {
  const root = createFixture()
  const initialVersion = readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Fixture run',
    involvement: 'standard',
    operatorArtifacts: true,
  })
  const runId = state.run_id
  const modelConfig = state.pipeline_config?.name

  assert.ok(modelConfig)
  assert.match(
    state.pipeline_config?.path ?? '',
    /pipeline-config\.snapshot\.json$/u,
  )

  const stageSlugs = ['plan', 'implement', 'verify', 'ship']

  for (const [stageSequence, stageSlug] of stageSlugs.entries()) {
    const prepared = prepareInvocation(root, runId)
    const invocation = prepared.invocation
    const expectedPrefix = String(99 - stageSequence).padStart(2, '0')

    assert.ok(invocation)
    const brief = invocation.output.operator_brief

    assert.ok(brief)
    assert.match(
      invocation.invocation_id,
      new RegExp(`^${expectedPrefix}_${stageSlug}-1_`, 'u'),
    )
    assert.equal(invocation.stage.slug, stageSlug)
    assert.equal(invocation.stage.model_config, modelConfig)
    assert.ok(invocation.stage.model.length > 0)

    if (stageSlug === 'ship') {
      assert.equal(invocation.inputs.pr_description?.mode, 'fallback')
      assert.equal(invocation.output.artifacts?.length, 2)
      assert.match(
        invocation.output.artifacts?.[1]?.path ?? '',
        /operator\/pr-description\.md$/u,
      )
      assert.equal(
        invocation.requirements?.validation_requirements.find(
          (requirement) =>
            requirement.registry_id === 'PR-DESCRIPTION-VALIDATE-001',
        )?.resolved_target,
        invocation.output.artifacts?.[1]?.path,
      )
    }

    const invocationValidationPath = resolveRunLayout(root, runId).validation(
      `${invocation.invocation_id}.invocation-validation.json`,
    ).absolute
    assert.ok(existsSync(invocationValidationPath))

    const stage = stageBySlug(workflow, stageSlug)
    const output = makeOutput(
      root,
      invocation,
      stage,
      'success',
      stageSlug === 'ship' ? getRunState(root, runId) : undefined,
    )

    writeJson(path.join(root, invocation.output.path), output)
    writeCanonicalDelegation(root, invocation)

    const submitted = submitOutput(root, runId, invocation.output.path)

    assert.equal(
      submitted.record.outcome,
      'success',
      `${stageSlug}: ${JSON.stringify(submitted.record.evaluation)}`,
    )
    assert.equal(existsSync(path.join(root, brief.source_path)), false)

    if (stageSlug === 'verify') {
      assert.equal(submitted.state.current_stage, 'ship')
      assert.equal(
        existsSync(
          path.join(root, 'runtime', 'inbox', `${runId}-verify-warnings.md`),
        ),
        false,
      )
    }

    if (stageSlug === 'plan') {
      const repeated = submitOutput(root, runId, invocation.output.path)

      assert.equal(repeated.idempotent, true)
      assert.equal(repeated.record.invocation_id, invocation.invocation_id)
    }

    if (stageSlug === 'plan' || stageSlug === 'ship') {
      assert.equal(submitted.state.status, 'awaiting_operator')
      decideRun(root, runId, 'approve', 'fixture approval')
    }
  }

  const final = getRunState(root, runId)

  assert.equal(final.status, 'succeeded')
  assert.equal(final.current_stage, null)
  assert.equal(final.stage_history.length, 4)
  const finalLayout = resolveRunLayout(root, runId)
  const operatorFiles = readdirSync(finalLayout.operator.absolute)

  assert.equal(existsSync(finalLayout.state.absolute), true)
  assert.equal(operatorFiles.filter((item) => item.endsWith('.html')).length, 4)
  assert.equal(
    operatorFiles.some((item) => item.endsWith('.json')),
    false,
  )
  assert.deepEqual(
    final.stage_history.map((item) => item.invocation_id.slice(0, 2)),
    ['03', '02', '01', '00'],
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

// Away mode is snapshotted into the run at creation, so the event log holds no
// operator decision.
const AWAY: CheckpointVariant = {
  key: 'away',
  fixture: (root) => {
    const configPath = path.join(root, 'config.json')
    const config = read(configPath) as Record<string, unknown>

    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          ...config,
          away_mode: {
            enabled: true,
            guardrails: {
              allowed_actions: ['approve'],
              max_decisions_per_run: 1,
            },
          },
        },
        null,
        2,
      )}\n`,
    )
  },
  run: { title: 'Away continuation fixture' },
  decidePlan: (root, runId) => {
    const state = getRunState(root, runId)
    const planOutputPath = state.stage_history.at(-1)?.output_path ?? ''
    const blocker = awayModeTrigger(state)

    assert.ok(blocker)
    const decision = recordAwayEvaluation(root, state, blocker, {
      ranked_options: [
        {
          rank: 1,
          action: 'approve',
          feasible: true,
          rationale: 'Approve the ratified plan.',
          evidence: [planOutputPath],
          rollback_plan: {
            steps: ['Route a later run to plan.'],
            verification: 'Confirm the later run starts at plan.',
          },
        },
      ],
    })
    const next = decideRunAsAway(
      root,
      runId,
      'approve',
      decision.selected_action?.rationale ?? '',
    )

    recordAwayApplyResult(root, decision, 'applied')
    assert.equal(next.current_stage, 'implement')
    assert.equal(next.pending_action.type, 'prepare_invocation')
  },
}

test('enabled away mode continues after one decision and completes ship', () => {
  const { root, runId, state } = checkpoint(
    'delivery@ship-awaiting-operator',
    AWAY,
  )
  const shipOutputPath = state.stage_history.at(-1)?.output_path ?? ''

  assert.equal(state.stage_history.at(-1)?.stage, 'ship')

  const decision = recordDeterministicShipApproval(root, state, [
    resolveRunLayout(root, runId).state.relative,
    shipOutputPath,
  ])
  const next = decideRunAsAway(
    root,
    runId,
    'approve',
    decision.selected_action?.rationale ?? '',
  )

  recordAwayApplyResult(root, decision, 'applied')
  assert.equal(next.status, 'succeeded')
  assert.equal(next.pending_action.type, 'none')

  const ledger = readAwayDecisionLedger(root)

  assert.equal(countAwayDecisions(root, runId), 1)
  assert.deepEqual(
    ledger.map((record) => record.decision_kind),
    [
      'evaluated',
      'evaluated',
      'deterministic_ship_approval',
      'deterministic_ship_approval',
    ],
  )

  const events = readFileSync(
    resolveRunLayout(root, runId).events.absolute,
    'utf8',
  )

  assert.doesNotMatch(events, /operator_decision_recorded/u)
  assert.match(events, /away_decision_applied/u)
})

test('away resume cannot ratify workspace changes made during a pause', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Away ratification fixture',
  })
  const runId = state.run_id

  pauseRun(root, runId, 'Pause without workspace edits.')

  const awayResumed = resumeRunAsAway(root, runId)

  assert.equal(awayResumed.status, 'running')
  assert.equal(awayResumed.pending_action.type, 'prepare_invocation')
  assert.equal(awayResumed.operator_pause, null)
  assert.equal(awayResumed.operator_workspace_ratifications, undefined)
  assert.match(
    readFileSync(resolveRunLayout(root, runId).events.absolute, 'utf8'),
    /away_run_resumed/u,
  )

  pauseRun(root, runId, 'Pause before an external edit.')
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const externalEdit = true\n',
  )

  assert.throws(
    () => resumeRunAsAway(root, runId, 'plan', 'Resume past the edit.'),
    /cannot ratify workspace changes/u,
  )
  assert.equal(getRunState(root, runId).status, 'paused')

  const resumed = resumeRun(root, runId, 'plan', 'Authorized operator fix.')

  assert.equal(resumed.status, 'running')
  assert.equal(resumed.operator_workspace_ratifications?.length, 1)
})

test('away revise re-runs the stage without an operator revision allowance', () => {
  const { root, runId, state } = checkpoint('delivery@plan-awaiting-operator')

  assert.equal(state.pending_action.type, 'operator_approval')

  const revised = decideRunAsAway(
    root,
    runId,
    'revise',
    'Narrow the plan scope.',
  )

  assert.equal(revised.current_stage, 'plan')
  assert.equal(revised.pending_action.type, 'prepare_invocation')
  assert.equal(revised.operator_revisions?.plan, undefined)

  const feedback = revised.operator_feedback?.at(-1)

  assert.equal(feedback?.decision, 'revise')
  assert.equal(feedback?.source, 'away')
  assert.match(feedback?.path ?? '', /away-feedback-1\.md$/u)
})

test('ship cannot succeed without its declared PR artifact', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@ship-prepared',
    BRIEFS,
  )

  assert.ok(invocation)
  const stage = stageBySlug(workflow, 'ship')
  const output = makeOutput(root, invocation, stage)
  const prArtifact = invocation.output.artifacts?.[1]

  assert.ok(prArtifact)
  rmSync(path.join(root, prArtifact.path))
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'blocked')
  assert.match(
    submitted.record.evaluation.validation_errors.join('\n'),
    /artifact does not exist: .*operator\/pr-description\.md/u,
  )
})

test('ship cannot succeed when its PR artifact violates resolved authority', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@ship-prepared',
    BRIEFS,
  )

  assert.ok(invocation)
  const stage = stageBySlug(workflow, 'ship')
  const output = makeOutput(root, invocation, stage)
  const prArtifact = invocation.output.artifacts?.[1]

  assert.ok(prArtifact)
  writeFileSync(
    path.join(root, prArtifact.path),
    'A body without a conventional title or required sections.\n',
  )
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'blocked')
  assert.match(
    submitted.state.stage_history.at(-1)?.validation_errors.join('\n') ?? '',
    /harness validator PR-DESCRIPTION-VALIDATE-001 failed/u,
  )
})

test('a non-empty approval note becomes required context for the routed stage', () => {
  const prepared = checkpoint('delivery@plan-prepared')
  const first = prepared.invocation

  assert.ok(first)
  assert.equal(first.stage.slug, 'plan')
  assert.equal(first.stage.persona, 'planner')

  // The first stage of the run is delegated, so it owes the same delivery
  // contract and read attestation every other worker stage owes.
  assert.equal(prepared.state.pending_action.type, 'invoke_agent')
  assert.equal(first.delegation?.mode, 'referenced')
  assert.equal(
    first.delegation?.cursor_agent_path,
    '.cursor/agents/pan-planner.md',
  )
  assert.ok(first.contract_manifest)

  const { root, runId, state } = checkpoint('delivery@plan-awaiting-operator')
  const planHistory = state.stage_history.at(-1)

  assert.ok(planHistory?.record_path)

  const record = read(path.join(root, planHistory.record_path)) as TaskRecord
  const warnings = (record.evaluation.governance_artifact_warnings ?? []).join(
    '\n',
  )

  assert.equal(record.outcome, 'success')
  assert.doesNotMatch(warnings, /[Dd]elegation/u)
  assert.doesNotMatch(warnings, /attestation/u)

  // Worker ownership must not change where the operator stops the run.
  assert.equal(state.status, 'awaiting_operator')
  assert.equal(state.pending_action.type, 'operator_approval')
  assert.equal(state.current_stage, 'plan')

  const directive =
    'Adopt cross-run cache persistence explicitly during implementation.'

  decideRun(root, runId, 'approve', directive)

  const feedback = getRunState(root, runId).operator_feedback?.at(-1)

  assert.ok(feedback)
  assert.equal(feedback.decision, 'approve')
  assert.equal(feedback.from_stage, 'plan')
  assert.equal(feedback.to_stage, 'implement')
  assert.equal(feedback.note, directive)
  assert.ok(existsSync(path.join(root, feedback.path)))
  assert.match(
    readFileSync(path.join(root, feedback.path), 'utf8'),
    /Operator directive attached to approval/u,
  )
  assert.equal(getRunState(root, runId).current_stage, 'implement')

  const implement = prepareInvocation(root, runId).invocation

  assert.ok(implement)
  assert.equal(implement.stage.slug, 'implement')

  const reference = implement.inputs.references.find(
    (entry) => entry.path === feedback.path,
  )

  assert.ok(reference)
  assert.equal(reference.retrieval, 'required')
})

test('an empty approval note records no operator feedback', () => {
  const { root, runId } = checkpoint('delivery@plan-awaiting-operator')

  decideRun(root, runId, 'approve')

  const state = getRunState(root, runId)

  assert.equal(state.current_stage, 'implement')
  assert.equal(state.operator_feedback, undefined)
})

test('an operator revision returns the delivery plan to the planner', () => {
  const { root, runId, state, workflow } = checkpoint(
    'delivery@plan-awaiting-operator',
  )
  const planStage = stageBySlug(workflow, 'plan')

  assert.equal(state.status, 'awaiting_operator')

  assert.throws(
    () => decideRun(root, runId, 'revise', '   '),
    /MUST carry the operator directive/u,
  )

  const directive = 'Record the retention window as an explicit constraint.'
  decideRun(root, runId, 'revise', directive)

  const second = prepareInvocation(root, runId).invocation

  assert.ok(second)
  assert.equal(second.stage.slug, 'plan')
  assert.equal(second.stage.persona, 'planner')
  assert.equal(second.attempt, 2)

  // A revision is a refinement, not a failed attempt, so it must not spend the
  // stage's retry budget.
  assert.equal(getRunState(root, runId).operator_revisions?.plan, 1)
  assert.equal(getRunState(root, runId).consecutive_failures, 0)

  const feedback = getRunState(root, runId).operator_feedback?.at(-1)

  assert.ok(feedback)
  assert.equal(feedback.decision, 'revise')
  assert.equal(feedback.to_stage, 'plan')
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
    makeOutput(root, second, planStage),
  )
  writeCanonicalDelegation(root, second)

  const revised = submitOutput(root, runId, second.output.path)

  assert.equal(revised.record.outcome, 'success')
  assert.equal(revised.state.status, 'awaiting_operator')
  decideRun(root, runId, 'approve', 'fixture approval')
  assert.equal(getRunState(root, runId).current_stage, 'implement')
})

test('run preparation reports live pipeline-config drift from its snapshot', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    active_config: string
  }
  const snapshotted = config.active_config

  config.active_config =
    config.active_config === 'balanced' ? 'advanced' : 'balanced'
  writeJson(configPath, config)

  const prepared = prepareInvocation(root, state.run_id)

  assert.ok(prepared.invocation)
  assert.ok(
    prepared.advisories.some(
      (advisory) =>
        advisory.includes(`snapshotted pipeline config '${snapshotted}'`) &&
        advisory.includes('is now active'),
    ),
    `expected an active-config advisory, got ${JSON.stringify(prepared.advisories)}`,
  )
})

test('paused remediation note is attached to the next implement invocation', () => {
  const {
    root,
    runId,
    invocation: implementInvocation,
    workflow,
  } = checkpoint('delivery@implement-prepared')

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
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Fixture run',
  })
  const runId = state.run_id
  const originalInvocation = prepareInvocation(root, runId).invocation

  assert.ok(originalInvocation)
  assert.equal(originalInvocation.stage.slug, 'plan')
  assert.match(originalInvocation.invocation_id, /^99_plan-1_/u)

  assert.throws(
    () => setRunStage(root, runId, 'verify', '   '),
    /Stage repair note MUST be non-empty/u,
  )
  assert.throws(
    () => setRunStage(root, runId, 'missing', 'repair target'),
    /Workflow delivery has no stage 'missing'/u,
  )

  const note =
    'Repair the run by independently verifying the current workspace.'
  const repaired = setRunStage(root, runId, 'verify', note)

  assert.equal(repaired.status, 'running')
  assert.equal(repaired.current_stage, 'verify')
  assert.equal(repaired.pending_action.type, 'prepare_invocation')
  assert.equal(repaired.current_invocation, null)
  assert.equal(repaired.transition_count, 0)
  assert.equal(repaired.consecutive_failures, 0)
  assert.equal(repaired.operator_feedback?.at(-1)?.decision, 'set-stage')

  const invocation = prepareInvocation(root, runId).invocation
  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'verify')
  assert.equal(invocation.attempt, 1)
  assert.match(invocation.invocation_id, /^98_verify-1_/u)

  const feedback = getRunState(root, runId).operator_feedback?.at(-1)
  assert.ok(feedback)
  assert.equal(feedback.from_stage, 'plan')
  assert.equal(feedback.to_stage, 'verify')
  assert.ok(
    invocation.inputs.references.some(
      (reference) =>
        reference.path === feedback.path &&
        reference.description.startsWith('Operator stage repair'),
    ),
  )

  const feedbackBody = readFileSync(path.join(root, feedback.path), 'utf8')
  assert.match(feedbackBody, /independently verifying the current workspace/u)

  const eventsPath = resolveRunLayout(root, runId).events.absolute
  const operatorStageSetCount = (
    readFileSync(eventsPath, 'utf8').match(/operator_stage_set/gu) ?? []
  ).length

  assert.equal(operatorStageSetCount, 1)

  const awayRepaired = setRunStageAsAway(
    root,
    runId,
    'implement',
    'Skip ahead for a bounded repair.',
  )

  assert.equal(awayRepaired.current_stage, 'implement')
  assert.equal(awayRepaired.pending_action.type, 'prepare_invocation')

  const awayFeedback = awayRepaired.operator_feedback?.at(-1)

  assert.equal(awayFeedback?.decision, 'set-stage')
  assert.equal(awayFeedback?.source, 'away')
  assert.match(awayFeedback?.path ?? '', /away-feedback-2\.md$/u)

  const events = readFileSync(eventsPath, 'utf8')

  assert.match(events, /away_stage_set/u)
  assert.equal(
    (events.match(/operator_stage_set/gu) ?? []).length,
    operatorStageSetCount,
    'an away stage repair MUST NOT be recorded as an operator stage set',
  )
})
