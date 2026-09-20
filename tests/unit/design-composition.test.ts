import assert from 'node:assert/strict'
import test from 'node:test'

import {
  composeDesignWorkflow,
  workflowSupportsDesignComposition,
} from '../../src/lib/design-composition.js'
import { PanError } from '../../src/lib/errors.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { sharedFixture } from '../helpers.js'

test('planning composition is additive, pure, and carries design into the plan', () => {
  const root = sharedFixture()
  const base = loadWorkflow(root, 'planning')
  const before = structuredClone(base)
  const composed = composeDesignWorkflow(root, base)

  assert.equal(workflowSupportsDesignComposition(base), true)
  assert.deepEqual(base, before)
  assert.equal(base.start_stage, 'plan')
  assert.deepEqual(
    base.stages.map((stage) => stage.slug),
    ['plan'],
  )
  assert.equal(composed.start_stage, 'design')
  assert.deepEqual(
    composed.stages.map((stage) => stage.slug),
    ['design', 'plan'],
  )
  assert.equal(composed.limits.max_total_transitions, 8)

  const design = stageBySlug(composed, 'design')
  const plan = stageBySlug(composed, 'plan')
  const standalone = stageBySlug(loadWorkflow(root, 'design'), 'design')

  assert.equal(design.persona, 'designer')
  assert.equal(design.workspace_policy, 'runtime_only')
  assert.equal(design.gate, 'next_stage')
  assert.equal(design.transitions.success, 'plan')
  assert.deepEqual(design.required_data, standalone.required_data)
  assert.deepEqual(plan.context.required_stage_outputs, [
    { stage: 'design', selection: 'latest_success' },
  ])
  assert.equal(plan.required_data?.design_plan, 'object')
  assert.equal(plan.required_data?.['design_plan.planning_stage'], 'string')
  assert.equal(plan.required_data?.['design_plan.verification_stage'], 'string')
  assert.equal(plan.required_data?.['design_plan.evidence_roles'], 'array')
  assert.deepEqual(
    composed.stages
      .filter((stage) => stage.checkpoint === 'technical_plan')
      .map((stage) => stage.slug),
    ['plan'],
  )
})

test('delivery composition appends design evidence without changing verify routing', () => {
  const root = sharedFixture()

  for (const slug of ['delivery', 'delivery-chunk']) {
    const base = loadWorkflow(root, slug)
    const baseVerify = stageBySlug(base, 'verify')
    const composed = composeDesignWorkflow(root, base)
    const verify = stageBySlug(composed, 'verify')

    assert.deepEqual(
      composed.stages.map((stage) => stage.slug),
      base.stages.map((stage) => stage.slug),
    )

    assert.deepEqual(
      baseVerify.evidence_workers?.map((worker) => worker.role),
      ['review', 'qa'],
    )
    assert.deepEqual(
      verify.evidence_workers?.map((worker) => worker.role),
      ['review', 'qa', 'design-review', 'design-qa'],
    )
    assert.deepEqual(
      verify.evidence_workers?.slice(-2).map((worker) => worker.persona),
      ['design-reviewer', 'design-qa'],
    )
    assert.equal(verify.gate, 'stage_verdict')
    assert.equal(verify.checkpoint, 'independent_review')
    assert.equal(verify.transitions.failure, 'remediate')
  }
})

test('composition rejects unknown files, stages, and duplicate roles', () => {
  const root = sharedFixture()
  const planning = loadWorkflow(root, 'planning')

  assert.ok(planning.design_composition)
  planning.design_composition.stages = ['missing']
  assert.throws(
    () => composeDesignWorkflow(root, planning),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_WORKFLOW',
  )

  const unknownOverride = loadWorkflow(root, 'planning')
  assert.ok(unknownOverride.design_composition)
  unknownOverride.design_composition.stage_overrides = { nowhere: {} }
  assert.throws(
    () => composeDesignWorkflow(root, unknownOverride),
    /overrides unknown stage 'nowhere'/u,
  )

  const duplicateRole = loadWorkflow(root, 'delivery')
  assert.ok(duplicateRole.design_composition?.stage_overrides?.verify)
  duplicateRole.design_composition.stage_overrides.verify.evidence_workers = [
    { persona: 'design-reviewer', role: 'review', scope: 'Duplicate role.' },
  ]
  assert.throws(
    () => composeDesignWorkflow(root, duplicateRole),
    /duplicate evidence-worker role 'review'/u,
  )
})

test('every composed design persona resolves design and browser governance', () => {
  const root = sharedFixture()
  const contexts = [
    ['designer', 'planning', 'design'],
    ['design-reviewer', 'delivery', 'verify'],
    ['design-qa', 'delivery', 'verify'],
    ['design-reviewer', 'delivery-chunk', 'verify'],
    ['design-qa', 'delivery-chunk', 'verify'],
  ] as const

  for (const [persona, workflow, stage] of contexts) {
    const policies = new Set(
      resolvePolicies(root, { persona, workflow, stage }).map(
        (policy) => policy.id,
      ),
    )

    assert.equal(policies.has('DESIGN-001'), true)
    assert.equal(policies.has('BROWSER-001'), true)
  }
})

test('the standalone design workflow retains its graph contract', () => {
  const workflow = loadWorkflow(sharedFixture(), 'design')

  assert.equal(workflow.start_stage, 'intake')
  assert.deepEqual(
    workflow.stages.map((stage) => ({
      slug: stage.slug,
      persona: stage.persona,
      gate: stage.gate,
      checkpoint: stage.checkpoint,
      transitions: stage.transitions,
    })),
    [
      {
        slug: 'intake',
        persona: 'orchestrator',
        gate: 'operator',
        checkpoint: undefined,
        transitions: {
          success: 'design',
          failure: 'intake',
          blocked: 'paused',
        },
      },
      {
        slug: 'design',
        persona: 'designer',
        gate: 'next_stage',
        checkpoint: undefined,
        transitions: {
          success: 'review',
          failure: 'design',
          blocked: 'paused',
        },
      },
      {
        slug: 'review',
        persona: 'design-reviewer',
        gate: 'stage_verdict',
        checkpoint: 'independent_review',
        transitions: { success: 'test', failure: 'design', blocked: 'paused' },
      },
      {
        slug: 'test',
        persona: 'design-qa',
        gate: 'stage_verdict',
        checkpoint: undefined,
        transitions: {
          success: 'handoff',
          failure: 'design',
          blocked: 'paused',
        },
      },
      {
        slug: 'handoff',
        persona: 'designer',
        gate: 'operator',
        checkpoint: undefined,
        transitions: {
          success: 'succeeded',
          failure: 'design',
          blocked: 'paused',
        },
      },
    ],
  )
  assert.equal(
    stageBySlug(workflow, 'design').prompt_path,
    'library/workflows/design/prompts/design.md',
  )
})
