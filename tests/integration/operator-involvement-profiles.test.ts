import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { eventPath } from '../../src/lib/state.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'
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

test('the shipped long-horizon profile is listed and snapshots its mode', () => {
  const root = createFixture()
  const before = readFileSync(path.join(root, 'config.json'))
  const listed = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'dist', 'src', 'cli.js'), 'involvement'],
    { cwd: root, encoding: 'utf8' },
  )

  assert.equal(listed.status, 0, listed.stderr)
  const listing = JSON.parse(listed.stdout) as {
    active: string
    profiles: Record<string, Record<string, unknown>>
  }

  assert.equal(listing.active, 'standard')
  assert.deepEqual(listing.profiles['long-horizon']?.contracts, [
    'long_horizon',
  ])
  assert.deepEqual(listing.profiles['long-horizon']?.away_mode, {
    enabled: true,
    guardrails: {
      allowed_actions: [
        'approve',
        'reject',
        'revise',
        'resume',
        'set-stage',
        'waive-gate',
      ],
      max_decisions_per_run: 12,
      max_remediation_attempts_per_agent: 2,
    },
  })

  const state = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'request.md',
    involvement: 'long-horizon',
  })

  assert.equal(state.operator_involvement?.profile, 'long-horizon')
  assert.deepEqual(state.operator_involvement?.contracts, ['long_horizon'])
  assert.equal(
    state.operator_involvement?.applied_gates.plan?.run_gate,
    'supervisor',
  )
  assert.equal(state.away_mode?.enabled, true)
  assert.deepEqual(state.away_mode?.guardrails.allowed_actions, [
    'approve',
    'reject',
    'revise',
    'resume',
    'set-stage',
    'waive-gate',
  ])
  assert.equal(state.configuration_overrides, undefined)

  const invocation = prepareInvocation(root, state.run_id).invocation
  const policyIds = invocation?.policies.map((policy) => policy.id) ?? []

  assert.ok(policyIds.includes('HORIZON-001'))
  assert.equal(policyIds.includes('SINGLERUN-001'), false)
  assert.deepEqual(readFileSync(path.join(root, 'config.json')), before)
})

test('the long-horizon contract forces away mode on and records the override', () => {
  const root = createFixture()

  setInvolvement(root, {
    active: 'standard',
    profiles: {
      standard: { summary: 'Workflow gates.' },
      forced: {
        summary: 'Exercise contract arming.',
        contracts: ['long_horizon'],
        away_mode: {
          enabled: false,
          guardrails: {
            allowed_actions: ['resume'],
            max_decisions_per_run: 1,
            max_remediation_attempts_per_agent: 1,
          },
        },
      },
    },
  })
  const before = readFileSync(path.join(root, 'config.json'))
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    involvement: 'forced',
  })

  assert.equal(state.away_mode?.enabled, true)
  assert.deepEqual(state.away_mode?.guardrails.allowed_actions, ['resume'])
  assert.deepEqual(state.configuration_overrides, [
    {
      setting: 'away_mode.enabled',
      configured_value: false,
      applied_value: true,
      reason:
        "Involvement profile 'forced' carries the long_horizon contract, " +
        'which requires away mode for this run.',
    },
  ])

  // The override has to survive on the durable event stream, not only in the
  // returned state. Parsing the event keeps that proof independent of the key
  // order `JSON.stringify` happens to emit.
  const created = readFileSync(eventPath(root, state.run_id), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((event) => event.type === 'run_created')

  assert.ok(created, 'the run records a run_created event')
  assert.deepEqual(
    created.configuration_overrides,
    state.configuration_overrides,
  )
  assert.deepEqual(readFileSync(path.join(root, 'config.json')), before)
})
