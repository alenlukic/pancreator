import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolvePolicies } from '../../src/lib/policies.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { sharedFixture } from '../fixture-template.js'

test('the one-shot workflow has one implementer, no plan stage, and a bounded retry loop', () => {
  const workflow = loadWorkflow(sharedFixture(), 'one-shot')

  assert.equal(workflow.start_stage, 'implement')
  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['implement', 'ship'],
  )
  assert.equal(workflow.limits.max_stage_attempts, 3)

  const implement = stageBySlug(workflow, 'implement')

  assert.equal(implement.persona, 'spotfixer')
  assert.equal(implement.gate, 'next_stage')
  assert.equal(implement.workspace_policy, 'source_allowed')
  assert.equal(implement.transitions.success, 'ship')
  assert.equal(implement.transitions.blocked, 'paused')
  assert.ok(implement.required_data?.informal_plan)
  assert.ok(implement.required_data?.test_scenarios)
  assert.ok(implement.blocked_required_data?.['escalation.route'])

  const ship = stageBySlug(workflow, 'ship')

  assert.equal(ship.persona, 'release-steward')
  assert.equal(ship.gate, 'operator')
  // A ship failure that returned to implement would clear implement's
  // attempt count and restart the three-cycle bound.
  assert.equal(ship.transitions.failure, 'paused')
  assert.deepEqual(ship.context.required_stage_outputs, [
    { stage: 'implement', selection: 'latest_success' },
  ])
})

test('one-shot implement resolves spotfix policies and names no policy id', () => {
  const root = sharedFixture()
  const resolved = resolvePolicies(root, {
    persona: 'spotfixer',
    workflow: 'one-shot',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(resolved.includes('SPOT-001'))
  assert.ok(resolved.includes('SCENARIO-001'))
  assert.ok(resolved.includes('WORK-001'))

  const prompt = readFileSync(
    path.join(root, 'library/workflows/one-shot/prompts/implement.md'),
    'utf8',
  )

  assert.equal(
    /\b[A-Z][A-Z0-9]*-\d{3}\b/u.test(prompt),
    false,
    'the stage prompt MUST NOT restate a policy identifier',
  )
})
