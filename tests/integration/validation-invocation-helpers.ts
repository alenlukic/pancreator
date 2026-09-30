import { resolvePolicies } from '../../src/lib/policies.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type { Invocation } from '../../src/lib/types.js'

export function fixtureInvocation(root: string, stageSlug: string): Invocation {
  const workflow = loadWorkflow(root, 'delivery')
  const stage = stageBySlug(workflow, stageSlug)
  const policies = resolvePolicies(root, {
    persona: stage.persona,
    workflow: workflow.slug,
    stage: stage.slug,
  })

  return {
    $operator: {
      headline: `${stage.title} is ready`,
      summary: 'Fixture summary',
      next_action: 'Invoke worker',
    },
    schema_version: 1,
    invocation_id: `${stageSlug}-1-fixture`,
    run_id: 'run-fixture',
    attempt: 1,
    created_at: '2026-06-24T00:00:00.000Z',
    workspace_root: '.',
    workflow: {
      slug: workflow.slug,
      snapshot_path: 'workflow.snapshot.json',
      snapshot_sha256: 'abc',
    },
    stage: {
      slug: stage.slug,
      title: stage.title,
      persona: stage.persona,
      model: 'fixture-model',
      model_config: 'default',
      workspace_policy: stage.workspace_policy,
      gate: stage.gate,
    },
    prompt: 'Fixture prompt',
    inputs: { references: [] },
    policies,
    rubric: stage.criteria,
    output: {
      path: `runtime/logs/workflows/run-fixture/outputs/${stageSlug}.json`,
      template: 'library/templates/stage-output.example.json',
      schema: 'library/schemas/stage-output.schema.json',
      required_data: stage.required_data ?? {},
      operator_brief: {
        source_path: `runtime/logs/workflows/run-fixture/artifacts/json/${stageSlug}.brief.json`,
        rendered_path: `runtime/logs/workflows/run-fixture/artifacts/html/${stageSlug}.html`,
        schema: 'library/schemas/operator-brief.schema.json',
        renderer: 'pan briefs render',
        profile:
          stageSlug === 'plan'
            ? 'plan'
            : stageSlug === 'ship'
              ? 'release'
              : 'implementation',
        required_headings: [],
      },
    },
    boundaries: ['Fixture boundary'],
    workspace_before: {
      kind: 'filesystem',
      fingerprint: 'fixture-fingerprint',
      entries: [],
    },
  }
}
