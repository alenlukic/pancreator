import assert from 'node:assert/strict'
import test from 'node:test'

import { renderInvocationMarkdown, renderStatus } from '../../src/lib/render.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import {
  buildValidationArtifact,
  invocationValidationPath,
} from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'
import type { Invocation } from '../../src/lib/types.js'

test('status summary includes the pause reason when present', () => {
  const status = renderStatus({
    schema_version: 1,
    run_id: 'run-1',
    workflow_slug: 'dev',
    workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
    workspace_root: '.',
    title: 'Run',
    status: 'paused',
    current_stage: 'implement',
    pending_action: { type: 'operator_decision' },
    current_invocation: null,
    request: {
      source_path: 'request.md',
      stored_path: 'runtime/request.md',
      sha256: 'abc',
    },
    revision: 4,
    transition_count: 2,
    consecutive_failures: 0,
    attempts: {},
    stage_history: [],
    created_at: '2026-06-22T00:00:00.000Z',
    updated_at: '2026-06-22T00:00:00.000Z',
    limits: {
      max_total_transitions: 18,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    pause_reason: 'Maximum consecutive failures exceeded.',
  })

  assert.match(status, /Status: paused/)
  assert.match(status, /Pause reason: Maximum consecutive failures exceeded\./)
})

function baseInvocation(
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
    },
    boundaries: ['Fixture boundary'],
    workspace_before: {
      kind: 'filesystem',
      fingerprint: 'fixture-fingerprint',
      entries: [],
    },
  }
}

test('invocation cards inline full policy text for every stage', () => {
  const root = createFixture()
  const stages = ['intake', 'plan', 'implement', 'review', 'test', 'ship']

  for (const stageSlug of stages) {
    const markdown = renderInvocationMarkdown(
      baseInvocation(root, 'dev', stageSlug),
    )
    const policies = resolvePolicies(root, {
      persona: stageBySlug(loadWorkflow(root, 'dev'), stageSlug).persona,
      workflow: 'dev',
      stage: stageSlug,
    })

    assert.match(markdown, /## 📜 Policies in force/)

    for (const policy of policies) {
      assert.match(
        markdown,
        new RegExp(`\\*\\*${policy.id} · ${policy.title}\\*\\*`),
      )
      assert.match(
        markdown,
        new RegExp(policy.summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      )

      for (const instruction of policy.instructions) {
        assert.match(
          markdown,
          new RegExp(instruction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        )
      }
    }
  }
})

test('status summary renders a dedicated validation section for pass state', () => {
  const invocationId = 'implement-1-abcd'
  const runId = 'run-1'
  const invocationValidation = buildValidationArtifact({
    run_id: runId,
    invocation_id: invocationId,
    kind: 'invocation',
    status: 'pass',
    checks: [{ id: 'policies.heading', passed: true, message: 'ok' }],
    artifact_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
  })

  const status = renderStatus(
    {
      schema_version: 1,
      run_id: runId,
      workflow_slug: 'dev',
      workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
      workspace_root: '.',
      title: 'Run',
      status: 'running',
      current_stage: 'implement',
      pending_action: {
        type: 'invoke_agent',
        persona: 'coder',
        path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
      },
      current_invocation: {
        id: invocationId,
        json_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.json`,
        markdown_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
        output_path: `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`,
      },
      request: {
        source_path: 'request.md',
        stored_path: 'runtime/request.md',
        sha256: 'abc',
      },
      revision: 1,
      transition_count: 1,
      consecutive_failures: 0,
      attempts: { implement: 1 },
      stage_history: [],
      created_at: '2026-06-22T00:00:00.000Z',
      updated_at: '2026-06-22T00:00:00.000Z',
      limits: {
        max_total_transitions: 18,
        max_stage_attempts: 3,
        max_consecutive_failures: 3,
      },
    },
    {
      invocation: invocationValidation,
      delegation: { state: 'missing' },
      invocation_validation_path: invocationValidationPath(runId, invocationId),
      delegation_validation_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation-validation.json`,
      delegation_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation.md`,
    },
  )

  assert.match(status, /## Validation/)
  assert.match(status, /Invocation validation: pass/)
  assert.match(status, /Delegation validation: missing/)
})

test('status summary surfaces validation failure reasons', () => {
  const invocationId = 'plan-1-abcd'
  const runId = 'run-1'
  const delegationValidation = buildValidationArtifact({
    run_id: runId,
    invocation_id: invocationId,
    kind: 'delegation',
    status: 'fail',
    checks: [
      {
        id: 'delegation.canonical_equality',
        passed: false,
        message: 'Delegation artifact MUST equal the canonical invocation card',
      },
    ],
    artifact_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation.md`,
  })

  const status = renderStatus(
    {
      schema_version: 1,
      run_id: runId,
      workflow_slug: 'dev',
      workflow_snapshot: { path: 'workflow.json', sha256: 'abc' },
      workspace_root: '.',
      title: 'Run',
      status: 'running',
      current_stage: 'plan',
      pending_action: {
        type: 'invoke_agent',
        persona: 'tech-lead',
        path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
      },
      current_invocation: {
        id: invocationId,
        json_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.json`,
        markdown_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`,
        output_path: `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`,
      },
      request: {
        source_path: 'request.md',
        stored_path: 'runtime/request.md',
        sha256: 'abc',
      },
      revision: 1,
      transition_count: 1,
      consecutive_failures: 0,
      attempts: { plan: 1 },
      stage_history: [],
      created_at: '2026-06-22T00:00:00.000Z',
      updated_at: '2026-06-22T00:00:00.000Z',
      limits: {
        max_total_transitions: 18,
        max_stage_attempts: 3,
        max_consecutive_failures: 3,
      },
    },
    {
      invocation: { state: 'missing' },
      delegation: delegationValidation,
      invocation_validation_path: invocationValidationPath(runId, invocationId),
      delegation_validation_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation-validation.json`,
      delegation_path: `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation.md`,
    },
  )

  assert.match(status, /Delegation validation: fail/)
  assert.match(status, /delegation\.canonical_equality/)
})

test('invocation cards distinguish required, conditional, and indexed context', () => {
  const root = createFixture()
  const invocation = baseInvocation(root, 'dev', 'review')
  invocation.inputs = {
    references: [
      {
        path: 'required.json',
        description: 'Effective implementation output',
        retrieval: 'required',
      },
      {
        path: 'conditional.json',
        description: 'Execution provenance',
        retrieval: 'conditional',
        condition: 'Read only to verify provenance.',
      },
      {
        path: 'manifest.json',
        description: 'Complete workflow context index',
        retrieval: 'index_only',
        condition: 'Read only to resolve a named inconsistency.',
      },
    ],
    missing_required: ["latest success output for stage 'plan'"],
  }

  const markdown = renderInvocationMarkdown(invocation)

  assert.match(markdown, /### Required inputs/u)
  assert.match(markdown, /`required\.json` — Effective implementation output/u)
  assert.match(markdown, /### Conditional references/u)
  assert.match(markdown, /Read when: Read only to verify provenance\./u)
  assert.match(markdown, /### Context index/u)
  assert.match(markdown, /### Missing required context/u)
  assert.match(markdown, /latest success output for stage 'plan'/u)
})
