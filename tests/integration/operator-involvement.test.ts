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
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflowFile, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  read,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import type {
  StageDefinition,
  StageOutcome,
  StageOutput,
} from '../../src/lib/types.js'

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
  mutate?: (output: StageOutput) => void,
) {
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stage, result)

  output.result = result
  mutate?.(output)
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  return {
    invocation,
    submitted: submitOutput(root, runId, invocation.output.path),
  }
}

/** A verify record whose graded verdict routes the run to remediation. */
function failingVerifyData(): Record<string, unknown> {
  return {
    verdict: 'fail_remedial',
    findings: [
      {
        id: 'VF-INV-1',
        severity: 'blocker',
        source: 'qa',
        statement: 'The workflow fixture does not advance.',
        evidence: ['fixture'],
      },
    ],
    qa_cases: [
      {
        id: 'TP-01',
        steps: 'Run workflow fixture',
        expected: 'advance',
        actual: 'stalled',
        result: 'fail',
      },
    ],
    acceptance_results: [
      { id: 'AC-01', result: 'fail', evidence: ['fixture'] },
    ],
    remediation_guidance:
      'Rerun the workflow fixture; the run stalls before ship.',
  }
}

test('the standard profile leaves every workflow-declared gate untouched', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Standard involvement run',
  })

  assert.equal(state.operator_involvement?.profile, 'standard')
  assert.deepEqual(state.operator_involvement?.contracts, [])
  assert.deepEqual(state.operator_involvement?.applied_gates, {})

  const workflow = runWorkflow(root, state.run_id)

  assert.equal(stageBySlug(workflow, 'plan').gate, 'operator')
  assert.equal(stageBySlug(workflow, 'verify').gate, 'stage_verdict')
})

test('an involvement profile rewrites gates in the run snapshot only', () => {
  const root = createFixture()

  setInvolvement(root, {
    active: 'standard',
    profiles: {
      standard: { summary: 'Workflow gates.' },
      'hands-off': {
        summary: 'Supervisor ratifies the plan.',
        gates: { plan: 'supervisor' },
      },
    },
  })

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Hands-off run',
    involvement: 'hands-off',
  })
  const workflow = runWorkflow(root, state.run_id)

  assert.equal(stageBySlug(workflow, 'plan').gate, 'supervisor')
  assert.deepEqual(state.operator_involvement?.applied_gates.plan, {
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

  assert.equal(stageBySlug(reloaded, 'plan').gate, 'supervisor')
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
        workflowSlug: 'delivery',
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
        workflowSlug: 'delivery',
        requestPath: 'request.md',
        title: 'Typo run',
      }),
    /which workflow 'delivery' does not define/u,
  )
})

test('an unknown profile name reports the available profiles', () => {
  const root = createFixture()

  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'delivery',
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
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Director run',
    involvement: 'technical-director',
  })
  const workflow = runWorkflow(root, state.run_id)

  assert.deepEqual(state.operator_involvement?.contracts, [
    'technical_director',
  ])
  // Escalation attaches by checkpoint role, not by stage slug. The plan already
  // stops for the operator, so the contract records only the verify escalation.
  assert.equal(stageBySlug(workflow, 'plan').gate, 'operator')
  assert.equal(stageBySlug(workflow, 'verify').gate, 'operator')
  assert.equal(
    state.operator_involvement?.applied_gates.verify?.source,
    'technical_director contract at independent_review checkpoint',
  )

  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)
  assert.ok(
    invocation.policies.some((policy) => policy.id === 'DIRECTOR-001'),
    'a contract-scoped lookup row must load DIRECTOR-001',
  )

  const card = readFileSync(
    resolveRunLayout(root, state.run_id).invocation(
      invocation.invocation_id,
      '.md',
    ).absolute,
    'utf8',
  )

  assert.match(card, /## 🎚️ Operator involvement/u)
  assert.match(
    card,
    /technical_director contract at independent_review checkpoint/u,
  )
})

test('DIRECTOR-001 is absent from a run without the contract', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
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
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Checkpoint run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  // Plan stops at the technical_plan checkpoint the contract watches.
  const plan = submitStage(root, runId, stageBySlug(workflow, 'plan'))

  assert.equal(plan.submitted.state.status, 'awaiting_operator')
  assert.equal(
    'checkpoint' in plan.submitted.state.pending_action
      ? plan.submitted.state.pending_action.checkpoint
      : undefined,
    'technical_plan',
  )

  decideRun(root, runId, 'approve')
  submitStage(root, runId, stageBySlug(workflow, 'implement'))

  const verify = submitStage(root, runId, stageBySlug(workflow, 'verify'))

  assert.equal(verify.submitted.state.status, 'awaiting_operator')
  assert.equal(
    'checkpoint' in verify.submitted.state.pending_action
      ? verify.submitted.state.pending_action.checkpoint
      : undefined,
    'independent_review',
  )

  decideRun(root, runId, 'approve')

  // Ship is an ordinary operator gate; it carries no checkpoint.
  const ship = submitStage(root, runId, stageBySlug(workflow, 'ship'))

  assert.equal(ship.submitted.state.status, 'awaiting_operator')
  assert.equal(
    'checkpoint' in ship.submitted.state.pending_action
      ? ship.submitted.state.pending_action.checkpoint
      : undefined,
    undefined,
  )
})

test('a revise decision re-runs the stage without spending its retry budget', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Revision run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

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
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Empty revision run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  submitStage(root, runId, stageBySlug(workflow, 'plan'))

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
        workflowSlug: 'delivery',
        requestPath: 'request.md',
        title: 'Sweeping run',
      }),
    /delivery\/ship.*gate_relaxable: false/su,
  )
})

test('the independent_review checkpoint stops a passing verify too', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Passing verify checkpoint run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  submitStage(root, runId, stageBySlug(workflow, 'plan'))
  decideRun(root, runId, 'approve')
  submitStage(root, runId, stageBySlug(workflow, 'implement'))

  const verify = submitStage(root, runId, stageBySlug(workflow, 'verify'))

  assert.equal(verify.submitted.record.outcome, 'success')
  assert.equal(verify.submitted.state.status, 'awaiting_operator')
  assert.equal(
    verify.submitted.state.pending_action.type === 'operator_approval' &&
      verify.submitted.state.pending_action.outcome,
    'success',
  )
  assert.equal(
    'checkpoint' in verify.submitted.state.pending_action
      ? verify.submitted.state.pending_action.checkpoint
      : undefined,
    'independent_review',
  )

  const decided = decideRun(root, runId, 'approve', 'Proceed to release.')

  assert.equal(decided.current_stage, 'ship')
})

test('an operator gate stops a failed stage before its failure transition', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Failed verify checkpoint run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

  submitStage(root, runId, stageBySlug(workflow, 'plan'))
  decideRun(root, runId, 'approve')
  submitStage(root, runId, stageBySlug(workflow, 'implement'))

  const verify = submitStage(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'failure',
    (output) => {
      output.data.verify = failingVerifyData()
    },
  )

  assert.equal(verify.submitted.record.outcome, 'failure')
  // Without the stop, a failed verify would route straight to remediation and
  // spend the operator's decision for them.
  assert.equal(verify.submitted.state.status, 'awaiting_operator')
  assert.equal(verify.submitted.state.current_stage, 'verify')
  assert.equal(
    verify.submitted.state.pending_action.type === 'operator_approval' &&
      verify.submitted.state.pending_action.outcome,
    'failure',
  )
  assert.equal(
    verify.submitted.state.pending_action.type === 'operator_approval' &&
      verify.submitted.state.pending_action.proposed_transition,
    'remediate',
  )
  assert.equal(
    'checkpoint' in verify.submitted.state.pending_action
      ? verify.submitted.state.pending_action.checkpoint
      : undefined,
    'independent_review',
  )

  // Approval applies the recorded outcome, so the failure takes its own route.
  const decided = decideRun(root, runId, 'approve', 'Route the failure back.')

  assert.equal(decided.status, 'running')
  assert.equal(decided.current_stage, 'remediate')
})

test('an operator gate stops a blocked stage before its blocked transition', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Blocked plan checkpoint run',
    involvement: 'technical-director',
  })
  const runId = state.run_id
  const workflow = runWorkflow(root, runId)

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
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Specificity run',
  })
  const workflow = runWorkflow(root, state.run_id)

  // implement: the wildcard applies where nothing more specific does.
  assert.equal(stageBySlug(workflow, 'implement').gate, 'stage_verdict')
  // verify: the contract escalation outranks the wildcard.
  assert.equal(stageBySlug(workflow, 'verify').gate, 'operator')
  // plan: an explicit per-stage override outranks the contract.
  assert.equal(stageBySlug(workflow, 'plan').gate, 'supervisor')
  // ship: explicitly held at its declared gate.
  assert.equal(stageBySlug(workflow, 'ship').gate, 'operator')
})
