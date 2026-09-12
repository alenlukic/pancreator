import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createRun as createEngineRun } from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { listRunIds } from '../../src/lib/state.js'
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

  // Chunking policy stays with the standalone decomposition mode.
  assert.equal(
    resolved.includes('DECOMP-001'),
    false,
    'DECOMP-001 stays bound to the standalone decomposition mode',
  )
  assert.ok(
    resolvePolicies(root, {
      persona: 'decomposer',
      workflow: 'standalone',
      stage: 'decompose',
    })
      .map((policy) => policy.id)
      .includes('DECOMP-001'),
  )
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

  // The trace validator belongs to the consolidated-planning policy every
  // planner shares; the hierarchy validators belong to the cohort policy that
  // only the planning workflow resolves.
  const owners: Array<[string, string]> = [
    ['PLAN-TRACE-VALIDATE-001', 'PLAN-002'],
    ['COHORT-PLAN-VALIDATE-001', 'COHORT-001'],
    ['CHILD-SPEC-VALIDATE-001', 'COHORT-001'],
  ]

  for (const [registryId, policyId] of owners) {
    const requirement = bound.find((entry) => entry.registry_id === registryId)

    assert.ok(requirement, `${registryId} MUST bind at pre_submit`)
    assert.equal(requirement.policy_id, policyId)
    assert.equal(requirement.enforcement, 'required')
  }
})

test('a planning run routes on approval by default and --no-autostart opts out', () => {
  const root = createFixture()
  const requestPath = writeRequest(root)

  // The route is the default: a planning run created without any flag records
  // the choice explicitly, so the approval hook never has to guess.
  const routed = createRun(root, { workflowSlug: 'planning', requestPath })

  assert.equal(routed.workflow_slug, 'planning')
  assert.equal(routed.autostart_delivery, true)
  assert.equal(routed.autostart_cohort, undefined)

  // `--autostart` stays accepted as the explicit spelling of the default.
  assert.equal(
    createRun(root, {
      workflowSlug: 'planning',
      requestPath,
      autostartDelivery: true,
    }).autostart_delivery,
    true,
  )

  // `--no-autostart` stops the run at the ratified plan.
  assert.equal(
    createRun(root, {
      workflowSlug: 'planning',
      requestPath,
      autostartDelivery: false,
    }).autostart_delivery,
    false,
  )

  // Neither flag means anything to a workflow without a plan gate.
  for (const autostartDelivery of [true, false]) {
    assert.throws(
      () =>
        createEngineRun(root, {
          workflowSlug: 'delivery',
          requestPath,
          autostartDelivery,
        }),
      (error: unknown) =>
        error instanceof PanError && error.code === 'INVALID_ARGUMENT',
    )
  }

  // A delivery run records no routing field at all.
  assert.equal(
    createRun(root, { workflowSlug: 'delivery', requestPath })
      .autostart_delivery,
    undefined,
  )

  // Planning is the workflow a run without an explicit slug starts in, and it
  // carries the same routing default.
  const defaulted = createRun(root, { requestPath })

  assert.equal(defaulted.workflow_slug, 'planning')
  assert.equal(defaulted.current_stage, 'plan')
  assert.equal(defaulted.autostart_delivery, true)

  // `--max-parallel` is a routing argument, so it needs a routed run.
  assert.equal(
    createRun(root, {
      workflowSlug: 'planning',
      requestPath,
      autostartMaxParallel: 2,
    }).autostart_max_parallel,
    2,
  )
  assert.throws(
    () =>
      createEngineRun(root, {
        workflowSlug: 'planning',
        requestPath,
        autostartDelivery: false,
        autostartMaxParallel: 2,
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_ARGUMENT',
  )
})

test('a start stage the workflow does not own is refused before any run exists', () => {
  const root = createFixture()
  const requestPath = writeRequest(root)
  const before = listRunIds(root)

  assert.throws(
    () =>
      createEngineRun(root, {
        workflowSlug: 'planning',
        requestPath,
        startStage: 'verify',
      }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'STAGE_NOT_FOUND' &&
      error.message.includes("no stage 'verify'"),
  )
  // The check runs before the run directory is created, so a typo leaves no
  // half-built run behind.
  assert.deepEqual(listRunIds(root), before)
})
