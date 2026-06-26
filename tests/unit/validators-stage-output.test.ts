import assert from 'node:assert/strict'
import test from 'node:test'

import { validateStageOutput } from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'
import type { Invocation, StageOutput } from '../../src/lib/types.js'

function fixtureInvocation(
  root: string,
  stageSlug: string,
  invocationId: string,
): { invocation: Invocation; stage: ReturnType<typeof stageBySlug> } {
  const workflow = loadWorkflow(root, 'dev')
  const stage = stageBySlug(workflow, stageSlug)

  return {
    stage,
    invocation: {
      $operator: {
        headline: 'Test',
        summary: 'Test',
        next_action: 'Submit',
      },
      schema_version: 1,
      invocation_id: invocationId,
      run_id: 'run-test',
      attempt: 1,
      created_at: new Date().toISOString(),
      workspace_root: '.',
      workflow: {
        slug: workflow.slug,
        snapshot_path: 'x',
        snapshot_sha256: 'y',
      },
      stage: {
        slug: stage.slug,
        title: stage.title,
        persona: stage.persona,
        model: 'test',
        model_config: 'test',
        workspace_policy: stage.workspace_policy,
        gate: stage.gate,
      },
      prompt: 'Do work',
      inputs: { references: [] },
      policies: [],
      rubric: stage.criteria,
      output: {
        path: 'runtime/logs/workflows/run-test/outputs/out.json',
        template: 'library/templates/stage-output.example.json',
        schema: 'library/schemas/stage-output.schema.json',
        required_data: stage.required_data ?? {},
      },
      boundaries: [],
      workspace_before: { kind: 'git', fingerprint: 'abc', entries: [] },
    },
  }
}

function baseOutput(
  invocation: Invocation,
  stage: ReturnType<typeof stageBySlug>,
): StageOutput {
  return {
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result: 'success',
    summary: 'Fixture output',
    artifacts: [],
    criteria: stage.criteria.map((criterion) => ({
      id: criterion.id,
      result: 'pass',
      evidence: ['runtime/logs/workflows/run-test/artifacts/evidence.md'],
      explanation: 'Fixture evidence',
    })),
    risks: [],
    unknowns: [],
    data: {},
  }
}

test('strict stage output rejects pass claims without evidence', () => {
  const root = createFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'implement',
    'implement-1-test',
  )
  const output = baseOutput(invocation, stage)
  const passCriterion = output.criteria.find((item) => item.result === 'pass')

  assert.ok(passCriterion)
  passCriterion.evidence = []

  const validation = validateStageOutput(root, stage, invocation, output)

  assert.match(
    validation.errors.join('\n'),
    /pass claim MUST include evidence/u,
  )
})

test('strict stage output rejects success with failed self-evaluation', () => {
  const root = createFixture()
  const { invocation, stage } = fixtureInvocation(
    root,
    'review',
    'review-1-test',
  )
  const output = baseOutput(invocation, stage)

  output.criteria[0].result = 'fail'

  const validation = validateStageOutput(root, stage, invocation, output)

  assert.match(validation.errors.join('\n'), /contradicts failed criterion/u)
})
