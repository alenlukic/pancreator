import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  createRun,
  decideRun,
  getRunState,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflowFile, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  read,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import type { StageDefinition, StageOutcome } from '../../src/lib/types.js'

function setInvolvement(root: string, value: unknown): void {
  const config = read(path.join(root, 'config.json')) as Record<string, unknown>

  config.operator_involvement = value
  writeJson(path.join(root, 'config.json'), config)
}

function runWorkflow(root: string, runId: string) {
  const state = getRunState(root, runId)

  return loadWorkflowFile(root, path.join(root, state.workflow_snapshot.path))
}

function submitStage(
  root: string,
  runId: string,
  stage: StageDefinition,
  result: StageOutcome = 'success',
) {
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stage, result)

  output.result = result
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  return {
    invocation,
    submitted: submitOutput(root, runId, invocation.output.path),
  }
}

test('the standard profile leaves every workflow-declared gate untouched', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Standard involvement run',
  })

  assert.equal(state.operator_involvement?.profile, 'standard')
  assert.deepEqual(state.operator_involvement?.contracts, [])
  assert.deepEqual(state.operator_involvement?.applied_gates, {})

  const workflow = runWorkflow(root, state.run_id)

  assert.equal(stageBySlug(workflow, 'plan').gate, 'supervisor')
  assert.equal(stageBySlug(workflow, 'review').gate, 'stage_verdict')
})

test('an involvement profile rewrites gates in the run snapshot only', () => {
  const root = createFixture()

  setInvolvement(root, {
    active: 'standard',
    profiles: {
      standard: { summary: 'Workflow gates.' },
      'hands-off': {
        summary: 'Supervisor ratifies intake.',
        gates: { intake: 'supervisor' },
      },
    },
  })

  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Hands-off run',
    involvement: 'hands-off',
  })
  const workflow = runWorkflow(root, state.run_id)

  assert.equal(stageBySlug(workflow, 'intake').gate, 'supervisor')
  assert.deepEqual(state.operator_involvement?.applied_gates.intake, {
    workflow_gate: 'operator',
    run_gate: 'supervisor',
    source: "profile 'hands-off' stage override",
  })

  // A run in flight must not be changed by later configuration edits.
  setInvolvement(root, {
    active: 'standard',
    profiles: { standard: { summary: 'Workflow gates.' } },
  })

  const reloaded = runWorkflow(root, state.run_id)

  assert.equal(stageBySlug(reloaded, 'intake').gate, 'supervisor')
})

test('a profile cannot lower a gate a stage declares non-relaxable', () => {
  const root = createFixture()

  setInvolvement(root, {
    active: 'reckless',
    profiles: {
      reckless: {
        summary: 'Try to auto-approve the release.',
        gates: { ship: 'next_stage' },
      },
    },
  })

  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'dev',
        requestPath: 'request.md',
        title: 'Reckless run',
      }),
    /gate_relaxable: false/u,
  )
})

test('a profile naming a stage the workflow lacks fails at init', () => {
  const root = createFixture()

  setInvolvement(root, {
    active: 'typo',
    profiles: {
      typo: { summary: 'Mistyped stage.', gates: { shipp: 'operator' } },
    },
  })

  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'dev',
        requestPath: 'request.md',
        title: 'Typo run',
      }),
    /which workflow 'dev' does not define/u,
  )
})

test('an unknown profile name reports the available profiles', () => {
  const root = createFixture()

  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'dev',
        requestPath: 'request.md',
        title: 'Unknown profile run',
        involvement: 'does-not-exist',
      }),
    /Available: /u,
  )
})

test('the technical_director contract escalates checkpoints and loads DIRECTOR-001', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Director run',
    involvement: 'technical-director',
  })
  const workflow = runWorkflow(root, state.run_id)

  assert.deepEqual(state.operator_involvement?.contracts, [
    'technical_director',
  ])
  // Escalation attaches by checkpoint role, not by stage slug.
  assert.equal(stageBySlug(workflow, 'plan').gate, 'operator')
  assert.equal(stageBySlug(workflow, 'review').gate, 'operator')
  assert.equal(
    state.operator_involvement?.applied_gates.plan?.source,
    'technical_director contract at technical_plan checkpoint',
  )

  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)
  assert.ok(
    invocation.policies.some((policy) => policy.id === 'DIRECTOR-001'),
    'a contract-scoped lookup row must load DIRECTOR-001',
  )

  const card = readFileSync(
    path.join(
      root,
      `runtime/logs/workflows/${state.run_id}/invocations/${invocation.invocation_id}.md`,
    ),
    'utf8',
  )

  assert.match(card, /## 🎚️ Operator involvement/u)
  assert.match(
    card,
    /technical_director contract at technical_plan checkpoint/u,
  )
})

test('DIRECTOR-001 is absent from a run without the contract', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'No contract run',
  })
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)
  assert.ok(!invocation.policies.some((policy) => policy.id === 'DIRECTOR-001'))
})

test('an operator gate under the contract records its checkpoint', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Checkpoint run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  // Intake is an ordinary operator gate; it carries no checkpoint.
  const intake = submitStage(root, runId, stageBySlug(workflow, 'intake'))

  assert.equal(intake.submitted.state.status, 'awaiting_operator')
  assert.equal(
    'checkpoint' in intake.submitted.state.pending_action
      ? intake.submitted.state.pending_action.checkpoint
      : undefined,
    undefined,
  )

  decideRun(root, runId, 'approve')

  const plan = submitStage(root, runId, stageBySlug(workflow, 'plan'))

  assert.equal(plan.submitted.state.status, 'awaiting_operator')
  assert.equal(
    'checkpoint' in plan.submitted.state.pending_action
      ? plan.submitted.state.pending_action.checkpoint
      : undefined,
    'technical_plan',
  )
})

test('a revise decision re-runs the stage without spending its retry budget', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Revision run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  submitStage(root, runId, stageBySlug(workflow, 'intake'))
  decideRun(root, runId, 'approve')
  submitStage(root, runId, stageBySlug(workflow, 'plan'))

  const revised = decideRun(
    root,
    runId,
    'revise',
    'Use the existing adapter instead of a new registry.',
  )

  assert.equal(revised.status, 'running')
  assert.equal(revised.current_stage, 'plan')
  assert.equal(revised.operator_revisions?.plan, 1)
  assert.equal(revised.consecutive_failures, 0)

  const feedback = revised.operator_feedback?.at(-1)

  assert.ok(feedback)
  assert.equal(feedback.decision, 'revise')
  assert.equal(feedback.from_stage, 'plan')
  assert.equal(feedback.to_stage, 'plan')

  const body = readFileSync(path.join(root, feedback.path), 'utf8')

  assert.match(body, /Operator revision directive/u)
  assert.match(body, /refinement directive, not a rejection/u)
  assert.match(body, /existing adapter instead of a new registry/u)

  // The ceiling rose by one, so the plan can still use its full failure budget.
  const next = prepareInvocation(root, runId).invocation

  assert.ok(next)
  assert.equal(next.stage.slug, 'plan')
  assert.equal(next.attempt, 2)
  assert.ok(
    next.inputs.references.some(
      (reference) => reference.path === feedback.path,
    ),
    'the revision directive must reach the worker as an input',
  )
})

test('revise requires the operator directive', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Empty revision run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  submitStage(root, runId, stageBySlug(workflow, 'intake'))

  assert.throws(
    () => decideRun(root, runId, 'revise', '   '),
    /MUST carry the operator directive/u,
  )
})

test('a relaxing wildcard must still exempt a non-relaxable stage explicitly', () => {
  const root = createFixture()

  setInvolvement(root, {
    active: 'sweeping',
    profiles: {
      sweeping: {
        summary: 'Relax everything with a wildcard.',
        gates: { '*': 'stage_verdict' },
      },
    },
  })

  // A blunt wildcard cannot quietly strip the release pause SHIP-001 requires.
  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'dev',
        requestPath: 'request.md',
        title: 'Sweeping run',
      }),
    /dev\/ship.*gate_relaxable: false/su,
  )
})

test('the independent_review checkpoint stops a passing review too', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Passing review checkpoint run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  submitStage(root, runId, stageBySlug(workflow, 'intake'))
  decideRun(root, runId, 'approve')
  submitStage(root, runId, stageBySlug(workflow, 'plan'))
  decideRun(root, runId, 'approve')
  submitStage(root, runId, stageBySlug(workflow, 'implement'))

  const review = submitStage(root, runId, stageBySlug(workflow, 'review'))

  assert.equal(review.submitted.record.outcome, 'success')
  assert.equal(review.submitted.state.status, 'awaiting_operator')
  assert.equal(
    review.submitted.state.pending_action.type === 'operator_approval' &&
      review.submitted.state.pending_action.outcome,
    'success',
  )
  assert.equal(
    'checkpoint' in review.submitted.state.pending_action
      ? review.submitted.state.pending_action.checkpoint
      : undefined,
    'independent_review',
  )

  const decided = decideRun(root, runId, 'approve', 'Proceed to QA.')

  assert.equal(decided.current_stage, 'test')
})

test('an operator gate stops a failed stage before its failure transition', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Failed review checkpoint run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  submitStage(root, runId, stageBySlug(workflow, 'intake'))
  decideRun(root, runId, 'approve')
  submitStage(root, runId, stageBySlug(workflow, 'plan'))
  decideRun(root, runId, 'approve')
  submitStage(root, runId, stageBySlug(workflow, 'implement'))

  const review = submitStage(
    root,
    runId,
    stageBySlug(workflow, 'review'),
    'failure',
  )

  assert.equal(review.submitted.record.outcome, 'failure')
  // Without the stop, a failed review would route straight to implementation and
  // spend the operator's decision for them.
  assert.equal(review.submitted.state.status, 'awaiting_operator')
  assert.equal(review.submitted.state.current_stage, 'review')
  assert.equal(
    review.submitted.state.pending_action.type === 'operator_approval' &&
      review.submitted.state.pending_action.outcome,
    'failure',
  )
  assert.equal(
    review.submitted.state.pending_action.type === 'operator_approval' &&
      review.submitted.state.pending_action.proposed_transition,
    'implement',
  )
  assert.equal(
    'checkpoint' in review.submitted.state.pending_action
      ? review.submitted.state.pending_action.checkpoint
      : undefined,
    'independent_review',
  )

  // Approval applies the recorded outcome, so the failure takes its own route.
  const decided = decideRun(root, runId, 'approve', 'Route the failure back.')

  assert.equal(decided.status, 'running')
  assert.equal(decided.current_stage, 'implement')
})

test('an operator gate stops a blocked stage before its blocked transition', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Blocked plan checkpoint run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  submitStage(root, runId, stageBySlug(workflow, 'intake'))
  decideRun(root, runId, 'approve')

  const plan = submitStage(
    root,
    runId,
    stageBySlug(workflow, 'plan'),
    'blocked',
  )

  assert.equal(plan.submitted.record.outcome, 'blocked')
  assert.equal(plan.submitted.state.status, 'awaiting_operator')
  assert.equal(
    plan.submitted.state.pending_action.type === 'operator_approval' &&
      plan.submitted.state.pending_action.outcome,
    'blocked',
  )

  const decided = decideRun(root, runId, 'approve', 'Accept the pause.')

  assert.equal(decided.status, 'paused')
})

test('gates resolve by ascending specificity', () => {
  const root = createFixture()

  setInvolvement(root, {
    active: 'specificity',
    profiles: {
      specificity: {
        summary: 'Exercise every layer of gate resolution.',
        gates: { '*': 'stage_verdict', ship: 'operator', plan: 'supervisor' },
        contracts: ['technical_director'],
      },
    },
  })

  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Specificity run',
  })
  const workflow = runWorkflow(root, state.run_id)

  // implement: the wildcard applies where nothing more specific does.
  assert.equal(stageBySlug(workflow, 'implement').gate, 'stage_verdict')
  // review: the contract escalation outranks the wildcard.
  assert.equal(stageBySlug(workflow, 'review').gate, 'operator')
  // plan: an explicit per-stage override outranks the contract.
  assert.equal(stageBySlug(workflow, 'plan').gate, 'supervisor')
  // ship: explicitly held at its declared gate.
  assert.equal(stageBySlug(workflow, 'ship').gate, 'operator')
})
