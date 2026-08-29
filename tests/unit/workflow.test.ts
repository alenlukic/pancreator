import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../helpers.js'
import {
  listWorkflowSlugs,
  loadStagePrompt,
  loadWorkflow,
  stageBySlug,
  validateWorkflow,
} from '../../src/lib/workflow.js'

test('delivery workflow is connected and stages are addressable', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  assert.equal(workflow.start_stage, 'plan')
  assert.equal(stageBySlug(workflow, 'ship').gate, 'operator')
})

test('loader assembles ordered stage files from the workflow index', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['plan', 'implement', 'verify', 'remediate', 'ship'],
  )
  assert.ok(workflow.stages.every((stage) => typeof stage.persona === 'string'))
})

test('delivery plan is worker-owned while intake stages stay supervisor-owned', () => {
  const root = createFixture()
  const deliveryPlan = stageBySlug(loadWorkflow(root, 'delivery'), 'plan')

  assert.equal(deliveryPlan.persona, 'planner')
  // Consolidating intake into plan must not relax the ratification gate or
  // widen the worker's workspace beyond runtime records.
  assert.equal(deliveryPlan.gate, 'operator')
  assert.equal(deliveryPlan.workspace_policy, 'runtime_only')

  for (const slug of ['design', 'prototype']) {
    assert.equal(
      stageBySlug(loadWorkflow(root, slug), 'intake').persona,
      'orchestrator',
    )
  }
})

test('listWorkflowSlugs finds every defined workflow', () => {
  const root = createFixture()
  assert.deepEqual(listWorkflowSlugs(root), [
    'delivery',
    'delivery-candidate',
    'design',
    'metacritic',
    'preflight',
    'prototype',
  ])
})

test('every workflow prompt obeys the optional brief contract', () => {
  const root = createFixture()

  for (const slug of listWorkflowSlugs(root)) {
    const workflow = loadWorkflow(root, slug)

    for (const stage of workflow.stages) {
      const prompt = loadStagePrompt(root, stage)

      assert.match(prompt, /output\.operator_brief/u)
      assert.match(prompt, /do not create/u)
    }
  }
})

test('a best-of-N candidate never stops for the operator', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery-candidate')

  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['plan', 'implement', 'verify', 'remediate'],
  )
  assert.ok(workflow.stages.every((stage) => stage.gate !== 'operator'))
  // A candidate ends at verification: shipping is the consolidation run's job.
  assert.equal(stageBySlug(workflow, 'verify').transitions.success, 'succeeded')
})

test('consolidation routes verify failure back to consolidate and keeps the ship gate', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'metacritic')

  assert.equal(workflow.start_stage, 'consolidate')

  const consolidate = stageBySlug(workflow, 'consolidate')
  const verify = stageBySlug(workflow, 'verify')
  const ship = stageBySlug(workflow, 'ship')

  assert.equal(consolidate.persona, 'metacritic')
  assert.equal(consolidate.workspace_policy, 'source_allowed')
  assert.equal(consolidate.transitions.success, 'verify')
  assert.equal(verify.transitions.failure, 'consolidate')
  assert.equal(verify.gate, 'stage_verdict')
  assert.equal(ship.gate, 'operator')
  assert.equal(ship.gate_relaxable, false)
  assert.deepEqual(consolidate.context.conditional_stage_outputs, [
    { stage: 'verify', selection: 'latest' },
  ])

  for (const key of [
    'consolidation.candidates',
    'consolidation.strategy',
    'implementation.changed_files',
    'acceptance_criteria',
    'acceptance_results',
  ]) {
    assert.ok(
      consolidate.required_data?.[key],
      `consolidate MUST require ${key}`,
    )
  }
})

test('loader fails when an indexed stage file is missing', () => {
  const root = createFixture()
  rmSync(
    path.join(root, 'library', 'workflows', 'delivery', 'stages', 'ship.json'),
  )
  assert.throws(
    () => loadWorkflow(root, 'delivery'),
    /missing stage file stages\/ship\.json/,
  )
})

test('live stage files require an explicit context projection', () => {
  const root = createFixture()
  const stagePath = path.join(
    root,
    'library',
    'workflows',
    'delivery',
    'stages',
    'ship.json',
  )
  const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as Record<
    string,
    unknown
  >

  delete stage.context
  writeFileSync(stagePath, `${JSON.stringify(stage)}\n`)

  assert.throws(() => loadWorkflow(root, 'delivery'), /context MUST be defined/)
})

test('workflow validation rejects unknown transition targets', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  workflow.stages[0].transitions.success = 'missing'
  assert.throws(
    () => validateWorkflow(root, workflow, 'fixture'),
    /unknown 'missing'/,
  )
})

test('prototype stages declare their precondition data and criteria', () => {
  // One fixture serves three read-only assertions on immutable stage files.
  const root = createFixture()
  const workflow = loadWorkflow(root, 'prototype')

  for (const [slug, dataKey, criterionId] of [
    [
      'approach',
      'technical_approach.preconditions',
      'approach.preconditions_verified',
    ],
    ['build', 'spike.precondition_checks', 'build.preconditions_rechecked'],
    [
      'evaluate',
      'evaluation.environment_blockers',
      'evaluate.environment_classified',
    ],
  ] as const) {
    const stage = stageBySlug(workflow, slug)

    assert.ok(stage.required_data?.[dataKey], `${slug} requires ${dataKey}`)
    assert.ok(
      stage.criteria.some((criterion) => criterion.id === criterionId),
      `${slug} declares ${criterionId}`,
    )
  }
})
