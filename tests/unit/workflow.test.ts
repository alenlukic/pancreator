import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../helpers.js'
import {
  loadWorkflow,
  stageBySlug,
  validateWorkflow,
} from '../../src/lib/workflow.js'

test('delivery workflow starts at implement and stages are addressable', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  assert.equal(workflow.start_stage, 'implement')
  assert.equal(stageBySlug(workflow, 'ship').gate, 'operator')

  assert.deepEqual(
    workflow.stages.map((stage) => stage.slug),
    ['implement', 'verify', 'remediate', 'ship'],
  )
  assert.ok(workflow.stages.every((stage) => typeof stage.persona === 'string'))

  // Planning lives in its own workflow, so no delivery stage reads a plan
  // stage output; the ratified child specification arrives as the request.
  for (const stage of workflow.stages) {
    assert.ok(
      !(stage.context.required_stage_outputs ?? []).some(
        (selector) => selector.stage === 'plan',
      ),
      `${stage.slug} MUST NOT require a plan stage output`,
    )
  }

  // Every delivery stage reads the ratified child specification, so the
  // request stays a required reference rather than a conditional one.
  for (const stage of workflow.stages) {
    assert.equal(
      stage.context.request,
      'required',
      `${stage.slug} MUST receive the run request as a required reference`,
    )
  }
})

test('the planning plan stage is worker-owned while intake stages stay supervisor-owned', () => {
  const root = createFixture()
  const planningPlan = stageBySlug(loadWorkflow(root, 'planning'), 'plan')

  assert.equal(planningPlan.persona, 'planner')
  // Moving planning into its own workflow must not relax the ratification
  // gate or widen the worker's workspace beyond runtime records.
  assert.equal(planningPlan.gate, 'operator')
  assert.equal(planningPlan.workspace_policy, 'runtime_only')

  for (const slug of ['design', 'prototype']) {
    assert.equal(
      stageBySlug(loadWorkflow(root, slug), 'intake').persona,
      'orchestrator',
    )
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

test('shared delivery prompts locate the plan from the card rather than the request alone', () => {
  const root = createFixture()
  const conditionalLocation =
    'The plan is the `plan` stage output when the card lists one under its required inputs, otherwise the request the card delivers'
  const promptText = (promptPath: string): string =>
    readFileSync(path.join(root, promptPath), 'utf8').replace(/\s+/gu, ' ')

  // delivery and delivery-chunk deliver the ratified child specification as
  // the request; a best-of-N candidate delivers a plan stage output and only
  // a conditional request. One prompt set serves them all, so its plan
  // sentence must branch on what the card lists.
  const consumers: Array<[string, boolean]> = [
    ['delivery', false],
    ['delivery-chunk', false],
    ['delivery-candidate', true],
  ]

  for (const [slug, readsPlanOutput] of consumers) {
    const stages = loadWorkflow(root, slug).stages.filter(
      (stage) => stage.slug !== 'plan' && stage.slug !== 'ship',
    )

    assert.ok(stages.length > 0)

    for (const stage of stages) {
      const promptPath = stage.prompt_path ?? ''

      assert.ok(
        promptPath.startsWith('library/workflows/delivery/prompts/'),
        `${slug}/${stage.slug} MUST share the delivery prompt`,
      )
      assert.equal(
        (stage.context.required_stage_outputs ?? []).some(
          (selector) => selector.stage === 'plan',
        ),
        readsPlanOutput,
        `${slug}/${stage.slug} plan-output contract changed`,
      )

      const prompt = promptText(promptPath)

      assert.ok(
        prompt.includes(conditionalLocation),
        `${slug}/${stage.slug} prompt MUST locate the plan conditionally`,
      )
      assert.equal(
        prompt.includes('"the plan" means that request'),
        false,
        `${slug}/${stage.slug} prompt MUST NOT define the plan as the request`,
      )
    }
  }

  // Ship never follows plan directly, and delivery and metacritic share it.
  const shipPrompt = 'library/workflows/delivery/prompts/ship.md'

  for (const slug of ['delivery', 'metacritic']) {
    assert.equal(
      stageBySlug(loadWorkflow(root, slug), 'ship').prompt_path,
      shipPrompt,
    )
  }

  assert.ok(promptText(shipPrompt).includes(conditionalLocation))
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

  const stagePath = path.join(
    root,
    'library',
    'workflows',
    'design',
    'stages',
    'intake.json',
  )
  const stage = JSON.parse(readFileSync(stagePath, 'utf8')) as Record<
    string,
    unknown
  >

  delete stage.context
  writeFileSync(stagePath, `${JSON.stringify(stage)}\n`)

  assert.throws(() => loadWorkflow(root, 'design'), /context MUST be defined/)

  const workflow = loadWorkflow(root, 'prototype')
  workflow.stages[0].transitions.success = 'missing'
  assert.throws(
    () => validateWorkflow(root, workflow, 'fixture'),
    /unknown 'missing'/,
  )
})
