import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EAGER_ONLY_POLICY_IDS,
  isPolicyLoad,
  normalizePolicyInstruction,
  normalizePolicyInstructions,
  filterPolicyInstructionsForCard,
  policyInstructionLoad,
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

test('normalizePolicyInstruction accepts every defined load trigger', () => {
  for (const load of [
    'tool:shell',
    'tool:delegation',
    'tool:browser',
    'tool:edit',
    'tool:git-remote',
    'tool:question',
    'tool:mcp:chrome-devtools',
    'event:tool_failure',
    'event:gate_failure',
    'event:validator_failure',
    'event:stall',
    'event:away',
    'event:pause',
    'event:resume',
    'event:retry',
    'event:submit',
    'event:operator_override',
    'path:**/*.ts',
  ]) {
    const instruction = normalizePolicyInstruction(
      { text: 'Agents MUST do the thing.', audience: ['agent'], load },
      'policy.instructions[0]',
    )

    assert.equal(instruction.load, load)
    assert.equal(isPolicyLoad(load), true)
  }
})

test('normalizePolicyInstruction rejects unknown load triggers', () => {
  for (const load of [
    'tool:teleport',
    'tool:',
    'tool:mcp:',
    'event:mood',
    'path:',
    'path:/etc/passwd',
    'path:../outside/**',
    'later',
    '',
    7,
  ]) {
    assert.throws(
      () =>
        normalizePolicyInstruction(
          { text: 'Agents MUST do the thing.', audience: ['agent'], load },
          'policy.instructions[0]',
        ),
      /\.load MUST be invocation/u,
      String(load),
    )
  }
})

test('normalizePolicyInstruction omits the default invocation load', () => {
  assert.deepEqual(
    normalizePolicyInstruction(
      {
        text: 'Agents MUST do the thing.',
        audience: ['agent'],
        load: 'invocation',
      },
      'policy.instructions[0]',
    ),
    { text: 'Agents MUST do the thing.', audience: ['agent'] },
  )
  assert.equal(
    policyInstructionLoad({ text: 'x', audience: ['agent'] }),
    'invocation',
  )
  assert.equal(policyInstructionLoad('Agents MUST do the thing.'), 'invocation')
})

test('normalizePolicyInstructions applies a policy-level default load', () => {
  const instructions = normalizePolicyInstructions(
    [
      { text: 'Agents MUST do the thing.', audience: ['agent'] },
      {
        text: 'Agents MUST do the other thing.',
        audience: ['agent'],
        load: 'event:stall',
      },
      'Agents MUST do the third thing.',
    ],
    'policy.instructions',
    { policyId: 'DELEGATE-001', defaultLoad: 'tool:delegation' },
  )

  assert.deepEqual(
    instructions.map((instruction) => instruction.load),
    ['tool:delegation', 'event:stall', 'tool:delegation'],
  )
})

test('normalizePolicyInstructions keeps eager-only policies at invocation', () => {
  for (const policyId of EAGER_ONLY_POLICY_IDS) {
    assert.throws(
      () =>
        normalizePolicyInstructions(
          [
            {
              text: 'Agents MUST do the thing.',
              audience: ['agent'],
              load: 'tool:shell',
            },
          ],
          'policy.instructions',
          { policyId },
        ),
      /MUST stay invocation/u,
      policyId,
    )
    assert.throws(
      () =>
        normalizePolicyInstructions(
          [{ text: 'Agents MUST do the thing.', audience: ['agent'] }],
          'policy.instructions',
          { policyId, defaultLoad: 'event:resume' },
        ),
      /MUST stay invocation/u,
      policyId,
    )
    assert.doesNotThrow(() =>
      normalizePolicyInstructions(
        [
          {
            text: 'Agents MUST do the thing.',
            audience: ['agent'],
            load: 'invocation',
          },
        ],
        'policy.instructions',
        { policyId },
      ),
    )
  }
})
