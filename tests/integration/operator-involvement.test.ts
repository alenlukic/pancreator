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
import { checkpoint } from './delivery-helpers.js'

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

  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)
  assert.ok(!invocation.policies.some((policy) => policy.id === 'DIRECTOR-001'))
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

  // A blunt wildcard cannot quietly strip the release pause SHIP-001 requires.
  setInvolvement(root, {
    active: 'sweeping',
    profiles: {
      sweeping: {
        summary: 'Relax everything with a wildcard.',
        gates: { '*': 'stage_verdict' },
      },
    },
  })
  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'delivery',
        requestPath: 'request.md',
        title: 'Sweeping run',
      }),
    /delivery\/ship.*gate_relaxable: false/su,
  )

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

test('an operator gate under the contract records its checkpoint', () => {
  // Plan stops at the technical_plan checkpoint the contract watches.
  const plan = checkpoint('delivery[td]@plan-submitted')

  assert.equal(plan.state.status, 'awaiting_operator')
  assert.equal(
    'checkpoint' in plan.state.pending_action
      ? plan.state.pending_action.checkpoint
      : undefined,
    'technical_plan',
  )

  const {
    root,
    runId,
    state: verify,
    workflow,
  } = checkpoint('delivery[td]@verify-submitted')

  // The independent_review checkpoint stops a passing verify too.
  assert.equal(verify.stage_history.at(-1)?.stage, 'verify')
  assert.equal(verify.stage_history.at(-1)?.outcome, 'success')
  assert.equal(verify.status, 'awaiting_operator')
  assert.equal(
    verify.pending_action.type === 'operator_approval' &&
      verify.pending_action.outcome,
    'success',
  )
  assert.equal(
    'checkpoint' in verify.pending_action
      ? verify.pending_action.checkpoint
      : undefined,
    'independent_review',
  )

  const verifyDecided = decideRun(root, runId, 'approve', 'Proceed to release.')

  assert.equal(verifyDecided.current_stage, 'ship')

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

test('an operator gate stops a failed stage before its failure transition', () => {
  const { root, runId, workflow } = checkpoint('delivery[td]@verify-prepared')

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
