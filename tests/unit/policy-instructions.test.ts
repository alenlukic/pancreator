import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizePolicyInstruction,
  normalizePolicyInstructions,
  policyInstructionAppliesToCard,
  filterPolicyInstructionsForCard,
} from '../../src/lib/policy-instructions.js'
import type { PolicyInstruction } from '../../src/lib/types.js'

test('normalizePolicyInstruction normalizes string instructions to agent audience', () => {
  assert.deepEqual(
    normalizePolicyInstruction(
      'Agents MUST do the thing.',
      'policy.instructions[0]',
    ),
    { text: 'Agents MUST do the thing.', audience: ['agent'] },
  )
})

test('normalizePolicyInstruction accepts structured instruction objects', () => {
  assert.deepEqual(
    normalizePolicyInstruction(
      { text: 'Supervisors MUST do the thing.', audience: ['supervisor'] },
      'policy.instructions[0]',
    ),
    { text: 'Supervisors MUST do the thing.', audience: ['supervisor'] },
  )
})

test('normalizePolicyInstruction rejects invalid audience shapes', () => {
  assert.throws(
    () =>
      normalizePolicyInstruction(
        { text: 'Agents MUST do the thing.', audience: [] },
        'policy.instructions[0]',
      ),
    /audience MUST be a non-empty array/u,
  )
  assert.throws(
    () =>
      normalizePolicyInstruction(
        { text: 'Agents MUST do the thing.', audience: ['agent', 'agent'] },
        'policy.instructions[0]',
      ),
    /MUST NOT contain duplicates/u,
  )
  assert.throws(
    () =>
      normalizePolicyInstruction(
        { text: 'Agents MUST do the thing.', audience: ['unknown'] },
        'policy.instructions[0]',
      ),
    /MUST be one of agent, supervisor, harness, operator/u,
  )
})

test('normalizePolicyInstruction rejects a suppressing audience combination', () => {
  // The card filter returns false at every other audience once an instruction
  // carries `harness` or `operator`, so pairing either with a second audience
  // renders the instruction nowhere. Reject the pairing instead.
  for (const audience of [
    ['agent', 'operator'],
    ['operator', 'supervisor'],
    ['agent', 'harness'],
    ['harness', 'operator'],
  ]) {
    assert.throws(
      () =>
        normalizePolicyInstruction(
          { text: 'Agents MUST do the thing.', audience },
          'policy.instructions[0]',
        ),
      /MUST NOT combine '(?:harness|operator)' with another audience/u,
      `audience ${audience.join('+')} is accepted`,
    )
  }

  for (const audience of [['harness'], ['operator'], ['agent', 'supervisor']]) {
    assert.deepEqual(
      normalizePolicyInstruction(
        { text: 'Agents MUST do the thing.', audience },
        'policy.instructions[0]',
      ),
      { text: 'Agents MUST do the thing.', audience },
    )
  }
})

test('normalizePolicyInstructions rejects non-arrays', () => {
  assert.throws(
    () => normalizePolicyInstructions('not-an-array', 'policy.instructions'),
    /MUST be an array/u,
  )
})

test('policyInstructionAppliesToCard filters by card audience', () => {
  const agent: PolicyInstruction = {
    text: 'Agents MUST do the thing.',
    audience: ['agent'],
  }
  const supervisorOnly: PolicyInstruction = {
    text: 'Supervisors MUST do the thing.',
    audience: ['supervisor'],
  }
  const operatorOnly: PolicyInstruction = {
    text: 'Operators MUST do the thing.',
    audience: ['operator'],
  }
  const harnessOnly: PolicyInstruction = {
    text: 'The harness MUST do the thing.',
    audience: ['harness'],
  }

  assert.equal(policyInstructionAppliesToCard(agent, 'agent'), true)
  assert.equal(policyInstructionAppliesToCard(agent, 'supervisor'), true)
  assert.equal(policyInstructionAppliesToCard(agent, 'operator'), false)

  assert.equal(policyInstructionAppliesToCard(supervisorOnly, 'agent'), false)
  assert.equal(
    policyInstructionAppliesToCard(supervisorOnly, 'supervisor'),
    true,
  )
  assert.equal(
    policyInstructionAppliesToCard(supervisorOnly, 'operator'),
    false,
  )

  assert.equal(policyInstructionAppliesToCard(operatorOnly, 'agent'), false)
  assert.equal(
    policyInstructionAppliesToCard(operatorOnly, 'supervisor'),
    false,
  )
  assert.equal(policyInstructionAppliesToCard(operatorOnly, 'operator'), true)

  assert.equal(policyInstructionAppliesToCard(harnessOnly, 'agent'), false)
  assert.equal(policyInstructionAppliesToCard(harnessOnly, 'supervisor'), false)
  assert.equal(policyInstructionAppliesToCard(harnessOnly, 'operator'), false)
})

test('filterPolicyInstructionsForCard returns only applicable instructions', () => {
  const instructions: PolicyInstruction[] = [
    { text: 'Agents MUST do the thing.', audience: ['agent'] },
    { text: 'Supervisors MUST do the thing.', audience: ['supervisor'] },
    { text: 'Operators MUST do the thing.', audience: ['operator'] },
    { text: 'The harness MUST do the thing.', audience: ['harness'] },
  ]

  assert.deepEqual(filterPolicyInstructionsForCard(instructions, 'agent'), [
    { text: 'Agents MUST do the thing.', audience: ['agent'] },
  ])
  assert.deepEqual(
    filterPolicyInstructionsForCard(instructions, 'supervisor'),
    [
      { text: 'Agents MUST do the thing.', audience: ['agent'] },
      { text: 'Supervisors MUST do the thing.', audience: ['supervisor'] },
    ],
  )
  assert.deepEqual(filterPolicyInstructionsForCard(instructions, 'operator'), [
    { text: 'Operators MUST do the thing.', audience: ['operator'] },
  ])
})
