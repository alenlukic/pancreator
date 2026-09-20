import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyOperatorInvolvement,
  parseOperatorInvolvement,
  selectInvolvementProfile,
} from '../../src/lib/operator-involvement.js'
import type {
  OperatorInvolvementFile,
  OperatorInvolvementProfile,
} from '../../src/lib/types.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { sharedFixture } from '../fixture-template.js'

const ROOT = sharedFixture()

function involvementFile(
  profiles: Record<string, OperatorInvolvementProfile>,
  active = Object.keys(profiles)[0],
): OperatorInvolvementFile {
  return { active, profiles }
}

function applyTo(
  slug: string,
  profiles: Record<string, OperatorInvolvementProfile>,
  name?: string,
) {
  const workflow = loadWorkflow(ROOT, slug)
  const resolved = applyOperatorInvolvement(
    workflow,
    selectInvolvementProfile(involvementFile(profiles), name),
  )

  return { workflow, resolved }
}

test('a profile cannot lower a gate a stage declares non-relaxable', () => {
  assert.throws(
    () =>
      applyTo('delivery', {
        reckless: {
          summary: 'Try to auto-approve the release.',
          gates: { ship: 'next_stage' },
          contracts: ['long_horizon'],
        },
      }),
    /gate_relaxable: false/u,
  )

  // A blunt wildcard cannot quietly strip the release pause SHIP-001 requires.
  assert.throws(
    () =>
      applyTo('delivery', {
        sweeping: {
          summary: 'Relax everything with a wildcard.',
          gates: { '*': 'stage_verdict' },
        },
      }),
    /delivery\/ship.*gate_relaxable: false/su,
  )

  assert.throws(
    () =>
      applyTo(
        'delivery',
        { standard: { summary: 'Workflow gates.' } },
        'does-not-exist',
      ),
    /Available: /u,
  )
})

test('gates resolve by ascending specificity', () => {
  const { workflow } = applyTo('delivery', {
    specificity: {
      summary: 'Exercise every layer of gate resolution.',
      gates: { '*': 'stage_verdict', ship: 'operator' },
      contracts: ['technical_director'],
    },
  })

  // implement: the wildcard applies where nothing more specific does.
  assert.equal(stageBySlug(workflow, 'implement').gate, 'stage_verdict')
  // verify: the contract escalation outranks the wildcard.
  assert.equal(stageBySlug(workflow, 'verify').gate, 'operator')
  // ship: explicitly held at its declared gate.
  assert.equal(stageBySlug(workflow, 'ship').gate, 'operator')

  // plan: an explicit per-stage override outranks the contract, which would
  // otherwise hold the technical_plan checkpoint at an operator gate.
  const planning = applyTo('planning', {
    'planning-specificity': {
      summary: 'An explicit stage override against the contract.',
      gates: { plan: 'supervisor' },
      contracts: ['technical_director'],
    },
  })

  assert.equal(stageBySlug(planning.workflow, 'plan').gate, 'supervisor')
  assert.equal(
    planning.resolved.applied_gates.plan?.source,
    "profile 'planning-specificity' stage override",
  )
})

test('a valid shared profile skips stage keys absent from one workflow', () => {
  const delivery = applyTo('delivery', {
    shared: {
      summary: 'The plan gate belongs to the planning workflow.',
      gates: { plan: 'supervisor' },
    },
  })

  assert.deepEqual(delivery.resolved.applied_gates, {})
  assert.equal(stageBySlug(delivery.workflow, 'ship').gate, 'operator')
})

test('profiles parse long-horizon contracts and validated away-mode guardrails', () => {
  const parsed = parseOperatorInvolvement({
    operator_involvement: {
      active: 'long-horizon',
      profiles: {
        'long-horizon': {
          summary: 'Unattended between preflight and post-run.',
          contracts: ['long_horizon'],
          away_mode: {
            enabled: true,
            guardrails: {
              allowed_actions: ['approve', 'resume'],
              max_decisions_per_run: 4,
              max_remediation_attempts_per_agent: 2,
            },
          },
        },
      },
    },
  })

  assert.deepEqual(parsed.profiles['long-horizon']?.contracts, ['long_horizon'])
  assert.deepEqual(parsed.profiles['long-horizon']?.away_mode, {
    enabled: true,
    guardrails: {
      allowed_actions: ['approve', 'resume'],
      max_decisions_per_run: 4,
      max_remediation_attempts_per_agent: 2,
    },
  })

  assert.throws(
    () =>
      parseOperatorInvolvement({
        operator_involvement: {
          active: 'invalid',
          profiles: {
            invalid: {
              summary: 'Invalid action.',
              away_mode: {
                enabled: true,
                guardrails: { allowed_actions: ['push'] },
              },
            },
          },
        },
      }),
    /allowed_actions MUST contain only/u,
  )
})
