import { resolvePolicies } from '../../src/lib/policies.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type { Invocation } from '../../src/lib/types.js'

export function baseInvocation(
  root: string,
  workflowSlug: string,
  stageSlug: string,
): Invocation {
  const workflow = loadWorkflow(root, workflowSlug)
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

export function delegatedInvocation(root: string): Invocation {
  const invocation = baseInvocation(root, 'delivery', 'implement')
  const prefix = 'runtime/logs/workflows/run-fixture/invocations/implement-1'

  invocation.output.scaffold_command =
    `./bin/pan output scaffold run-fixture --invocation ${prefix}.json ` +
    `--output ${invocation.output.path}`
  invocation.delegation = {
    persona: invocation.stage.persona,
    cursor_agent_path: '.cursor/agents/pan-coder.md',
    canonical_markdown_path: `${prefix}.md`,
    invocation_validation_path: `${prefix}.invocation-validation.json`,
    delegation_artifact_path: `${prefix}.delegation.md`,
    supervisor_procedure_path: `${prefix}.supervisor.md`,
    submit_command: `./bin/pan submit run-fixture ${invocation.output.path}`,
    mode: 'referenced',
    delivery_prompt_path: `${prefix}.delivery.md`,
    supervisor_card: {
      path: 'runtime/logs/workflows/run-fixture/agent/supervisor-card.md',
      sha256: 'a'.repeat(64),
      attest_command:
        './bin/pan governance attest-supervisor run-fixture --sha256 ' +
        'a'.repeat(64),
    },
    policies: resolvePolicies(root, {
      persona: 'orchestrator',
      workflow: 'delivery',
      stage: 'implement',
    }).filter((policy) => policy.id === 'INVOCATION-001'),
  }

  return invocation
}
