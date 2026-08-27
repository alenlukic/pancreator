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

test('development workflow is connected and stages are addressable', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  assert.equal(workflow.start_stage, 'intake')
  assert.equal(stageBySlug(workflow, 'ship').gate, 'operator')
})

test('loader assembles ordered stage files from the workflow index', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['intake', 'plan', 'implement', 'review', 'test', 'ship'],
  )
  assert.ok(workflow.stages.every((stage) => typeof stage.persona === 'string'))
})

test('dev intake is worker-owned while other intake stages stay supervisor-owned', () => {
  const root = createFixture()
  const devIntake = stageBySlug(loadWorkflow(root, 'dev'), 'intake')

  assert.equal(devIntake.persona, 'intake-writer')
  // Moving the owner must not relax the ratification gate or widen the worker's
  // workspace beyond runtime records.
  assert.equal(devIntake.gate, 'operator')
  assert.equal(devIntake.workspace_policy, 'runtime_only')

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
    'design',
    'dev',
    'dev-candidate',
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
  const workflow = loadWorkflow(root, 'dev-candidate')

  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['intake', 'plan', 'implement', 'review', 'test'],
  )
  assert.ok(workflow.stages.every((stage) => stage.gate !== 'operator'))
  // A candidate ends at QA: shipping is the consolidation run's job.
  assert.equal(stageBySlug(workflow, 'test').transitions.success, 'succeeded')
})

test('consolidation routes every failure back to consolidate and keeps the ship gate', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'metacritic')

  assert.equal(workflow.start_stage, 'consolidate')

  const consolidate = stageBySlug(workflow, 'consolidate')
  const review = stageBySlug(workflow, 'review')
  const qa = stageBySlug(workflow, 'test')
  const ship = stageBySlug(workflow, 'ship')

  assert.equal(consolidate.persona, 'metacritic')
  assert.equal(consolidate.workspace_policy, 'source_allowed')
  assert.equal(consolidate.transitions.success, 'review')
  assert.equal(review.transitions.failure, 'consolidate')
  assert.equal(qa.transitions.failure, 'consolidate')
  assert.equal(review.gate, 'stage_verdict')
  assert.equal(qa.gate, 'stage_verdict')
  assert.equal(ship.gate, 'operator')
  assert.equal(ship.gate_relaxable, false)
  assert.deepEqual(consolidate.context.conditional_stage_outputs, [
    { stage: 'review', selection: 'latest' },
    { stage: 'test', selection: 'latest' },
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
  rmSync(path.join(root, 'library', 'workflows', 'dev', 'stages', 'ship.json'))
  assert.throws(
    () => loadWorkflow(root, 'dev'),
    /missing stage file stages\/ship\.json/,
  )
})

test('live stage files require an explicit context projection', () => {
  const root = createFixture()
  const stagePath = path.join(
    root,
    'library',
    'workflows',
    'dev',
    'stages',
    'ship.json',
  )
  const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as Record<
    string,
    unknown
  >

  delete stage.context
  writeFileSync(stagePath, `${JSON.stringify(stage)}\n`)

  assert.throws(() => loadWorkflow(root, 'dev'), /context MUST be defined/)
})

test('workflow validation rejects unknown transition targets', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  workflow.stages[0].transitions.success = 'missing'
  assert.throws(
    () => validateWorkflow(root, workflow, 'fixture'),
    /unknown 'missing'/,
  )
})
