import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, createRun } from '../helpers.js'
import { runWorkflow, setInvolvement } from './operator-involvement-helpers.js'

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

  assert.equal(stageBySlug(workflow, 'ship').gate, 'operator')
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

  // The plan gate lives in the planning workflow, so the profile is applied
  // to a planning run.
  const state = createRun(root, {
    workflowSlug: 'planning',
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
  // Escalation attaches by checkpoint role, not by stage slug. Ship already
  // stops for the operator, so the contract records only the verify escalation.
  assert.equal(stageBySlug(workflow, 'ship').gate, 'operator')
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
