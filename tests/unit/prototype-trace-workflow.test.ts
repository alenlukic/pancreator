import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolvePolicies } from '../../src/lib/policies.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { sharedFixture } from '../fixture-template.js'

test('prototype-trace has one coder stage, an operator gate, and no ship', () => {
  const workflow = loadWorkflow(sharedFixture(), 'prototype-trace')

  assert.equal(workflow.start_stage, 'trace')
  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['trace'],
  )
  assert.equal(workflow.limits.max_stage_attempts, 3)

  const trace = stageBySlug(workflow, 'trace')

  assert.equal(trace.persona, 'coder')
  assert.equal(trace.gate, 'operator')
  assert.equal(trace.workspace_policy, 'source_allowed')
  assert.equal(trace.transitions.success, 'succeeded')
  assert.equal(trace.transitions.failure, 'trace')
  assert.equal(trace.transitions.blocked, 'paused')
  assert.ok(trace.required_data?.skeletons)
  assert.ok(trace.required_data?.trace_tests)
  assert.ok(trace.required_data?.interface_schema)
})

test('prototype-trace trace resolves TRACE-001 and names no policy id', () => {
  const root = sharedFixture()
  const resolved = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'prototype-trace',
    stage: 'trace',
  }).map((policy) => policy.id)

  assert.ok(resolved.includes('TRACE-001'))

  const prompt = readFileSync(
    path.join(root, 'library/workflows/prototype-trace/prompts/trace.md'),
    'utf8',
  )

  assert.equal(
    /\b[A-Z][A-Z0-9]*-\d{3}\b/u.test(prompt),
    false,
    'the stage prompt MUST NOT restate a policy identifier',
  )
})
