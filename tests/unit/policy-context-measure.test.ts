import assert from 'node:assert/strict'
import test from 'node:test'

import { deferredClauseGroups } from '../../src/lib/policy-deferred.js'
import { policyInstructionLoad } from '../../src/lib/policy-instructions.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import {
  measurePoliciesContext,
  measurePolicyContext,
} from '../../src/lib/policy-context-measure.js'

const REPO_ROOT = process.cwd()

test('BROWSER-001 reports zero eager bytes and nonzero deferred bytes', () => {
  const policy = loadPolicyCatalog(REPO_ROOT).get('BROWSER-001')

  assert.ok(policy)

  const measured = measurePolicyContext(policy)

  assert.equal(measured.eagerBytes, 0)
  assert.ok(measured.deferredBytes > 0)
  assert.deepEqual([...measured.deferredTriggers].sort(), [
    'tool:browser',
    'tool:delegation',
    'tool:shell',
  ])
})

test('eager-only policies report no deferred bytes and totals add up', () => {
  const catalog = loadPolicyCatalog(REPO_ROOT)
  const comms = catalog.get('COMMS-001')
  const browser = catalog.get('BROWSER-001')

  assert.ok(comms)
  assert.ok(browser)

  const measured = measurePolicyContext(comms)

  assert.ok(measured.eagerBytes > 0)
  assert.equal(measured.deferredBytes, 0)

  const totals = measurePoliciesContext([comms, browser])

  assert.equal(
    totals.eagerBytes,
    measured.eagerBytes + measurePolicyContext(browser).eagerBytes,
  )
  assert.equal(
    totals.deferredBytes,
    measurePolicyContext(browser).deferredBytes,
  )
})

test('PAUSE-001 defers its body to pause and keeps the agent ownership clause eager', () => {
  const pause = loadPolicyCatalog(REPO_ROOT).get('PAUSE-001')

  assert.ok(pause)

  const ownership = pause.instructions.at(-1)
  const measured = measurePolicyContext(pause)

  assert.ok(ownership)
  assert.deepEqual(measured.deferredTriggers, ['event:pause'])
  assert.equal(policyInstructionLoad(ownership), 'invocation')
  assert.ok(measured.eagerBytes > 0)
  assert.equal(policyInstructionLoad(pause.instructions[0]), 'event:pause')
})

test('AWAY-001 defers to the away state and keeps its disabled-run guards eager', () => {
  const away = loadPolicyCatalog(REPO_ROOT).get('AWAY-001')

  assert.ok(away)

  const eager = away.instructions
    .filter((entry) => policyInstructionLoad(entry) === 'invocation')
    .map((entry) => (typeof entry === 'string' ? entry : entry.text))

  assert.deepEqual(measurePolicyContext(away).deferredTriggers, ['event:away'])
  assert.deepEqual(eager, [
    'Away mode MUST act only when the run snapshot enables it.',
    'Disabled runs MUST keep every operator stop.',
  ])
})

test('DELEGATE-001 keeps the 60-second rule eager and defers watch mechanics', () => {
  const policy = loadPolicyCatalog(REPO_ROOT).get('DELEGATE-001')

  assert.ok(policy)

  const measured = measurePolicyContext(policy)
  const eager = policy.instructions.filter(
    (entry) => policyInstructionLoad(entry) === 'invocation',
  )
  const sixty = policy.instructions.find((entry) =>
    (typeof entry === 'string' ? entry : entry.text).startsWith(
      'The 60-second rule:',
    ),
  )
  const ownership = policy.instructions.find((entry) =>
    (typeof entry === 'string' ? entry : entry.text).startsWith(
      'The starting agent owns the subagent outcome',
    ),
  )

  assert.ok(sixty)
  assert.equal(policyInstructionLoad(sixty), 'invocation')
  assert.ok(ownership)
  assert.equal(policyInstructionLoad(ownership), 'invocation')
  assert.ok(eager.length > 0)
  assert.ok(measured.eagerBytes > 0)
  assert.ok(measured.deferredBytes > 0)
  assert.deepEqual([...measured.deferredTriggers].sort(), [
    'event:stall',
    'tool:delegation',
    'tool:shell',
  ])
})

test('SINGLERUN-001 defers the pause body to gate_failure and keeps exclusion eager', () => {
  const policy = loadPolicyCatalog(REPO_ROOT).get('SINGLERUN-001')

  assert.ok(policy)

  const exclusion = policy.instructions.at(-1)
  const measured = measurePolicyContext(policy)

  assert.ok(exclusion)
  assert.deepEqual(measured.deferredTriggers, ['event:gate_failure'])
  assert.equal(policyInstructionLoad(exclusion), 'invocation')
  assert.ok(measured.eagerBytes > 0)
  assert.equal(
    policyInstructionLoad(policy.instructions[0]),
    'event:gate_failure',
  )
})

test('ASK-001 defers the unavailable fallback to the question tool', () => {
  const policy = loadPolicyCatalog(REPO_ROOT).get('ASK-001')

  assert.ok(policy)

  const eager = policy.instructions
    .filter((entry) => policyInstructionLoad(entry) === 'invocation')
    .map((entry) => (typeof entry === 'string' ? entry : entry.text))

  assert.deepEqual(measurePolicyContext(policy).deferredTriggers, [
    'tool:question',
  ])
  assert.equal(eager.length, 3)
  assert.match(eager[0] ?? '', /MUST use the host question tool/u)
  assert.match(eager[1] ?? '', /operator_question/u)
  assert.match(eager[2] ?? '', /MUST NOT proceed on an assumed answer/u)
  assert.equal(
    policyInstructionLoad(policy.instructions[1]),
    'tool:question',
  )
})

test('ORCH-001 stays eager because every supervisor session needs it', () => {
  const orch = loadPolicyCatalog(REPO_ROOT).get('ORCH-001')

  assert.ok(orch)
  assert.deepEqual(deferredClauseGroups(orch, 'agent'), [])
})
