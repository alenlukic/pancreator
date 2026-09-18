import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  initCohortSession,
  integrateCohort,
  loadCohortState,
  maybeStartDelivery,
  startCohort,
} from '../../src/lib/cohorts.js'
import {
  prepareInvocation,
  validateOutputForSubmission,
} from '../../src/lib/engine.js'
import { composeDesignWorkflow } from '../../src/lib/design-composition.js'
import { PanError } from '../../src/lib/errors.js'
import { listRunIds, loadState } from '../../src/lib/state.js'
import { validateRepository } from '../../src/lib/validation.js'
import {
  loadWorkflow,
  loadWorkflowFile,
  stageBySlug,
} from '../../src/lib/workflow.js'
import { createFixture, makeOutput } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import { checkpoint, submitCurrentStage } from './delivery-helpers.js'
import {
  prepareValidationFixture,
  readJson,
  writeJsonFile,
} from './validation-helpers.js'
import {
  CLI,
  commitInChunk,
  git,
  markSucceeded,
  ratifiedPlanRun,
} from './cohort-helpers.js'

function request(root: string): string {
  const relative = 'design-composition-request.md'

  writeFileSync(path.join(root, relative), '# Request\n\nInclude design.\n')
  return relative
}

function snapshot(root: string, runId: string) {
  const state = loadState(root, runId)
  return loadWorkflowFile(root, path.join(root, state.workflow_snapshot.path))
}

test('run creation snapshots design composition while off-option graphs stay unchanged', () => {
  const existing = checkpoint('delivery@created')

  assert.deepEqual(
    stageBySlug(existing.workflow, 'verify').evidence_workers?.map(
      (worker) => worker.role,
    ),
    ['review', 'qa'],
  )

  const root = createFixture()
  const requestPath = request(root)
  const plainPlanning = createRun(root, {
    workflowSlug: 'planning',
    requestPath,
  })
  const designedPlanning = createRun(root, {
    workflowSlug: 'planning',
    requestPath,
    design: true,
  })

  assert.equal(plainPlanning.design_composition, undefined)
  assert.equal(plainPlanning.current_stage, 'plan')
  assert.equal(plainPlanning.limits.max_total_transitions, 4)
  assert.deepEqual(
    snapshot(root, plainPlanning.run_id).stages.map((stage) => stage.slug),
    ['plan'],
  )

  assert.equal(designedPlanning.design_composition, true)
  assert.equal(designedPlanning.current_stage, 'design')
  assert.equal(designedPlanning.limits.max_total_transitions, 8)
  const planningWorkflow = snapshot(root, designedPlanning.run_id)
  assert.equal(planningWorkflow.start_stage, 'design')
  assert.equal(
    stageBySlug(planningWorkflow, 'design').transitions.success,
    'plan',
  )

  for (const slug of ['delivery', 'delivery-chunk']) {
    const plain = createRun(root, { workflowSlug: slug, requestPath })
    const designed = createRun(root, {
      workflowSlug: slug,
      requestPath,
      design: true,
    })

    assert.equal(plain.design_composition, undefined)
    assert.deepEqual(
      stageBySlug(snapshot(root, plain.run_id), 'verify').evidence_workers?.map(
        (worker) => worker.role,
      ),
      ['review', 'qa'],
    )
    assert.deepEqual(
      stageBySlug(
        snapshot(root, designed.run_id),
        'verify',
      ).evidence_workers?.map((worker) => worker.role),
      ['review', 'qa', 'design-review', 'design-qa'],
    )
  }
})

test('the CLI exposes with-design and refuses unsupported workflows before creating a run', () => {
  const root = createFixture()
  const requestPath = request(root)
  const help = execFileSync(process.execPath, [CLI, 'help'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.match(help, /pan init .*--with-design/u)

  const before = listRunIds(root)
  assert.throws(
    () =>
      createRun(root, {
        workflowSlug: 'design',
        requestPath,
        design: true,
      }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'DESIGN_COMPOSITION_UNSUPPORTED',
  )
  assert.deepEqual(listRunIds(root), before)

  const result = spawnSync(
    process.execPath,
    [CLI, 'init', '--request', requestPath, '--with-design', '--json'],
    { cwd: root, encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as Record<string, unknown>

  assert.equal(output.design_composition, true)
  assert.equal(loadState(root, String(output.run_id)).design_composition, true)
})

test('a design-composed plan requires the design handoff map before submission', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'planning',
    requestPath: request(root),
    design: true,
  })

  submitCurrentStage(root, run.run_id)
  const prepared = prepareInvocation(root, run.run_id)
  const invocation = prepared.invocation

  assert.ok(invocation)
  const workflow = snapshot(root, run.run_id)
  const plan = stageBySlug(workflow, 'plan')
  const output = makeOutput(root, invocation, plan, 'success', prepared.state)
  const data = output.data as Record<string, unknown>

  delete data.design_plan

  const validation = validateOutputForSubmission(
    root,
    run.run_id,
    invocation,
    output,
  )

  assert.equal(validation.passed, false)
  assert.match(
    validation.checks.map((check) => check.message).join('\n'),
    /data.design_plan/u,
  )

  const requirements = JSON.parse(
    readFileSync(
      path.join(root, 'library/schemas/stage-output-requirements.json'),
      'utf8',
    ),
  ) as { stages: { plan: { fields: Array<{ path: string }> } } }
  const declared = new Set(
    requirements.stages.plan.fields.map((field) => field.path),
  )

  for (const field of [
    'data.design_plan',
    'data.design_plan.planning_stage',
    'data.design_plan.verification_stage',
    'data.design_plan.evidence_roles',
  ]) {
    assert.equal(declared.has(field), true)
  }
})

test('the single-chunk plan route preserves the design selection both ways', () => {
  for (const design of [false, true]) {
    const root = createFixture()
    const planRunId = ratifiedPlanRun(
      root,
      [{ id: 'alpha', cohort_index: 1 }],
      undefined,
      design,
    )
    const started = maybeStartDelivery(root, loadState(root, planRunId), {
      actor: 'operator',
      action: 'approve',
    })

    assert.ok(started?.status === 'started' && started.kind === 'delivery')
    assert.equal(
      loadState(root, started.run_id).design_composition,
      design ? true : undefined,
    )
  }
})

test('a cohort session carries design composition into chunks and release', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(
    root,
    [
      { id: 'alpha', cohort_index: 1 },
      { id: 'beta', cohort_index: 1 },
    ],
    undefined,
    true,
  )
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  assert.equal(session.design_composition, true)

  for (const chunk of started.chunks) {
    assert.equal(loadState(root, chunk.run_id).design_composition, true)
    commitInChunk(
      root,
      loadState(root, chunk.run_id).workspace_root,
      chunk.chunk,
    )
    markSucceeded(root, chunk.run_id)
  }

  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: design cohort fixture baseline'])

  const integrated = integrateCohort(root, session.cohort_id)

  assert.equal(integrated.autostart.kind, 'release')
  assert.equal(integrated.autostart.status, 'started')
  assert.equal(
    loadCohortState(root, session.cohort_id).design_composition,
    true,
  )

  if (integrated.autostart.kind === 'release') {
    assert.equal(
      loadState(root, integrated.autostart.run_id).design_composition,
      true,
    )
  }
})

test('composition validation rejects unreachable stages and duplicate checkpoints', () => {
  const root = createFixture()
  const orphanPath = path.join(
    root,
    'library/workflows/planning/stages/orphan.json',
  )
  const designPath = path.join(
    root,
    'library/workflows/planning/stages/design.json',
  )
  const orphan = JSON.parse(readFileSync(designPath, 'utf8')) as Record<
    string,
    unknown
  >

  orphan.slug = 'orphan'
  orphan.transitions = {
    success: 'orphan',
    failure: 'orphan',
    blocked: 'paused',
  }
  writeFileSync(orphanPath, `${JSON.stringify(orphan)}\n`)

  const unreachable = loadWorkflow(root, 'planning')
  assert.ok(unreachable.design_composition)
  unreachable.design_composition.stages = ['design', 'orphan']
  assert.throws(
    () => composeDesignWorkflow(root, unreachable),
    /unreachable stages: orphan/u,
  )

  const design = JSON.parse(readFileSync(designPath, 'utf8')) as Record<
    string,
    unknown
  >
  design.checkpoint = 'technical_plan'
  writeFileSync(designPath, `${JSON.stringify(design)}\n`)
  assert.throws(
    () => composeDesignWorkflow(root, loadWorkflow(root, 'planning')),
    /both declare checkpoint 'technical_plan'/u,
  )
})

test('repository validation enforces design governance on a composed stage', () => {
  const root = createFixture()
  prepareValidationFixture(root)

  assert.deepEqual(
    validateRepository(root).errors.filter((error) =>
      error.includes('design persona'),
    ),
    [],
  )

  // `delivery/verify` carries a design persona only in the composed graph, so
  // a diagnostic naming it proves validation reaches every composed graph.
  const lookupPath = path.join(
    root,
    'governance/registries/policy_lookup_table.json',
  )
  const lookup = readJson<{
    rows: Array<{ persona: string; policies: string[] }>
  }>(lookupPath)

  lookup.rows = lookup.rows.map((row) =>
    row.persona === 'design-reviewer'
      ? {
          ...row,
          policies: row.policies.filter((policy) => policy !== 'DESIGN-001'),
        }
      : row,
  )
  writeJsonFile(lookupPath, lookup)

  const broken = validateRepository(root)

  assert.equal(broken.ok, false)
  assert.match(
    broken.errors.join('\n'),
    /workflow stage 'delivery\/verify' design persona 'design-reviewer' MUST load DESIGN-001/u,
  )
})
