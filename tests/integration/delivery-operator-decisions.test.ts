import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  decideRun,
  getRunState,
  prepareInvocation,
  resumeRun,
  setRunStage,
  setRunStageAsAway,
} from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import {
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import { BRIEFS, checkpoint } from './delivery-helpers.js'

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

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'blocked')
  assert.match(
    submitted.state.stage_history.at(-1)?.validation_errors.join('\n') ?? '',
    /harness validator PR-DESCRIPTION-VALIDATE-001 failed/u,
  )
})

test('an operator revision returns the ratified plan to the planner', () => {
  const { root, runId, state, workflow } = checkpoint(
    'planning@plan-awaiting-operator',
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

  const revised = submitAsSupervisor(root, runId, second.output.path)

  assert.equal(revised.record.outcome, 'success')
  assert.equal(revised.state.status, 'awaiting_operator')
  decideRun(root, runId, 'approve', 'fixture approval')
  assert.equal(getRunState(root, runId).status, 'succeeded')
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

  const implementSubmitted = submitAsSupervisor(
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
  assert.equal(originalInvocation.stage.slug, 'implement')
  assert.match(originalInvocation.invocation_id, /^99_implement-1_/u)

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
  assert.equal(feedback.from_stage, 'implement')
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
