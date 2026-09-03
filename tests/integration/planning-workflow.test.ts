import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createRun as createEngineRun } from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, createRun, sharedFixture } from '../helpers.js'

function writeRequest(root: string): string {
  const relative = 'planning-request.md'

  writeFileSync(
    path.join(root, relative),
    '# Request\n\nCarve one ratified plan into cohorts.\n',
  )

  return relative
}

test('the planning workflow holds one operator-gated plan stage', () => {
  const workflow = loadWorkflow(sharedFixture(), 'planning')

  assert.equal(workflow.start_stage, 'plan')
  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['plan'],
  )

  const stage = stageBySlug(workflow, 'plan')

  assert.equal(stage.persona, 'planner')
  assert.equal(stage.gate, 'operator')
  assert.equal(stage.workspace_policy, 'runtime_only')
  assert.equal(stage.checkpoint, 'technical_plan')
  assert.equal(stage.transitions.success, 'succeeded')

  // The delivery plan stage's own criteria ids are kept, so a run contract that
  // attaches by criterion id keeps attaching after the split.
  assert.deepEqual(stage.criteria.map((criterion) => criterion.id).sort(), [
    'intake.request_covered',
    'plan.complete_mapping',
    'plan.implementation_ready',
    'plan.proportionate',
    'plan.test_plan_covers',
  ])

  for (const key of [
    'product_spec',
    'engineering_plan',
    'acceptance_criteria',
    'test_plan',
    'open_question_dispositions',
    'cohort_plan',
    'cohort_plan.parent_spec_path',
    'cohort_plan.chunks',
    'cohort_plan.edges',
    'cohort_plan.cohorts',
  ]) {
    assert.ok(
      stage.required_data?.[key],
      `the planning stage MUST require data.${key}`,
    )
  }
})

test('the planning stage resolves its governance from policy, not prompt text', () => {
  const root = sharedFixture()
  const resolved = resolvePolicies(root, {
    persona: 'planner',
    workflow: 'planning',
    stage: 'plan',
  }).map((policy) => policy.id)

  assert.ok(resolved.includes('PLAN-002'))
  assert.ok(resolved.includes('COHORT-001'))
  assert.ok(resolved.includes('CONTRACT-001'))
  assert.ok(resolved.includes('ENG-001'))

  const prompt = readFileSync(
    path.join(root, 'library/workflows/planning/prompts/plan.md'),
    'utf8',
  )

  assert.equal(
    /\b[A-Z][A-Z0-9]*-\d{3}\b/u.test(prompt),
    false,
    'the stage prompt MUST NOT restate a policy identifier',
  )
})

test('the standalone decomposition mode keeps its own chunking policy', () => {
  const root = sharedFixture()
  const planning = resolvePolicies(root, {
    persona: 'planner',
    workflow: 'planning',
    stage: 'plan',
  }).map((policy) => policy.id)

  assert.equal(
    planning.includes('DECOMP-001'),
    false,
    'DECOMP-001 stays bound to the standalone decomposition mode',
  )

  const decomposition = resolvePolicies(root, {
    persona: 'decomposer',
    workflow: 'standalone',
    stage: 'decompose',
  }).map((policy) => policy.id)

  assert.ok(decomposition.includes('DECOMP-001'))
})

test('the planning stage binds the plan and cohort validators at pre-submit', () => {
  const manifest = resolveRequirements(sharedFixture(), {
    persona: 'planner',
    workflow: 'planning',
    stage: 'plan',
  })
  const bound = manifest.validation_requirements.filter(
    (requirement) => requirement.phase === 'pre_submit',
  )

  for (const registryId of [
    'PLAN-TRACE-VALIDATE-001',
    'COHORT-PLAN-VALIDATE-001',
    'CHILD-SPEC-VALIDATE-001',
  ]) {
    const requirement = bound.find((entry) => entry.registry_id === registryId)

    assert.ok(requirement, `${registryId} MUST bind at pre_submit`)
    assert.equal(requirement.policy_id, 'PLAN-002')
    assert.equal(requirement.enforcement, 'required')
  }
})

test('--autostart is recorded for a planning run and refused elsewhere', () => {
  const root = createFixture()
  const requestPath = writeRequest(root)
  const state = createRun(root, {
    workflowSlug: 'planning',
    requestPath,
    autostartCohort: true,
  })

  assert.equal(state.workflow_slug, 'planning')
  assert.equal(state.autostart_cohort, true)

  assert.throws(
    () =>
      createEngineRun(root, {
        workflowSlug: 'delivery',
        requestPath,
        autostartCohort: true,
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_ARGUMENT',
  )
})

test('a planning run without the flag records no autostart', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'planning',
    requestPath: writeRequest(root),
  })

  assert.equal(state.autostart_cohort, undefined)
})
