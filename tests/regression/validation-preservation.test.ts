import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateDelegationMarkdown,
  validateInvocationMarkdown,
} from '../../src/lib/validation.js'
import { renderInvocationMarkdown } from '../../src/lib/render.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'
import type { Invocation } from '../../src/lib/types.js'

test('invocation and delegation exact-match validation is preserved', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const stage = stageBySlug(workflow, 'implement')
  const policies = resolvePolicies(root, {
    persona: stage.persona,
    workflow: workflow.slug,
    stage: stage.slug,
  })
  const requirements = resolveRequirements(root, {
    persona: stage.persona,
    workflow: workflow.slug,
    stage: stage.slug,
    invocation: { output_path: 'runtime/logs/workflows/x/outputs/y.json' },
  })
  const invocation = {
    $operator: {
      headline: 'Test',
      summary: 'Test summary',
      next_action: 'Submit',
    },
    schema_version: 1,
    invocation_id: 'implement-1-test',
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
    policies,
    requirements,
    rubric: stage.criteria,
    output: {
      path: 'runtime/logs/workflows/x/outputs/y.json',
      template: 'library/templates/stage-output.example.json',
      schema: 'library/schemas/stage-output.schema.json',
      required_data: stage.required_data ?? {},
    },
    boundaries: [],
    workspace_before: { kind: 'git', fingerprint: 'abc', entries: [] },
  } satisfies Invocation

  const markdown = renderInvocationMarkdown(invocation)
  const invocationValidation = validateInvocationMarkdown(invocation, markdown)
  const delegationValidation = validateDelegationMarkdown(markdown, markdown)

  assert.equal(invocationValidation.passed, true)
  assert.equal(delegationValidation.passed, true)
})
