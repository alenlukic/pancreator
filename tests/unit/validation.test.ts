import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  POLICIES_HEADING,
  validateDelegationMarkdown,
  validateInvocationMarkdown,
  validateRepository,
} from '../../src/lib/validation.js'
import { renderInvocationMarkdown } from '../../src/lib/render.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'
import type { Invocation } from '../../src/lib/types.js'

function prepareValidationFixture(root: string): void {
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  writeFileSync(path.join(root, 'prettier.config.js'), 'export default {}\n')
  writeFileSync(path.join(root, 'tsconfig.json'), '{}\n')
  writeFileSync(path.join(root, 'src', 'cli.ts'), 'export {}\n')
}

test('repository validation requires a policy to unroll each engineering handbook', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policyPath = path.join(root, 'governance', 'policies', 'ENG-001.json')
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    guidance_sources?: unknown[]
  }

  delete policy.guidance_sources

  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /governance\/handbooks\/eng\/engineering\.md MUST be unrolled by at least one policy/u,
  )
})

test('repository validation requires code-review and QA stages to load engineering handbook policies', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = JSON.parse(readFileSync(lookupPath, 'utf8')) as {
    rows: Array<{ persona: string }>
  }

  lookup.rows = lookup.rows.filter((row) => row.persona !== 'qa-tester')

  writeFileSync(lookupPath, `${JSON.stringify(lookup, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /workflow stage 'dev\/test' persona 'qa-tester' MUST load a policy for the engineering handbook/u,
  )
})

test('repository validation requires a policy to unroll the TypeScript handbook', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policyPath = path.join(root, 'governance', 'policies', 'TS-001.json')
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    guidance_sources?: unknown[]
  }

  delete policy.guidance_sources

  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /governance\/handbooks\/typescript\/style-guide\.md MUST be unrolled by at least one policy/u,
  )
})

test('repository validation rejects static guidance references that are not unrolled', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policyPath = path.join(
    root,
    'governance',
    'policies',
    'ACTION-001.json',
  )
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    instructions: string[]
  }

  policy.instructions.push(
    'Agents MUST apply library/skills/spotfix.md before completion.',
  )
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /ACTION-001 references static guidance library\/skills\/spotfix\.md without unrolling it through guidance_sources/u,
  )
})

test('repository validation requires code-review and QA stages to load TypeScript handbook policies', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = JSON.parse(readFileSync(lookupPath, 'utf8')) as {
    rows: Array<{ persona: string; policies: string[] }>
  }

  lookup.rows = lookup.rows.map((row) =>
    row.persona === 'qa-tester'
      ? {
          ...row,
          policies: row.policies.filter((policy) => policy !== 'TS-001'),
        }
      : row,
  )

  writeFileSync(lookupPath, `${JSON.stringify(lookup, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /workflow stage 'dev\/test' persona 'qa-tester' MUST load a policy for the TypeScript handbook/u,
  )
})

test('embedded repository validation does not impose the TypeScript handbook on target stages', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const configPath = path.join(root, 'project.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const result = validateRepository(root)

  assert.doesNotMatch(
    result.errors.join('\n'),
    /MUST load a policy for the TypeScript handbook/u,
  )
})

test('repository validation requires lookup rows to load referenced policy dependencies', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = JSON.parse(readFileSync(lookupPath, 'utf8')) as {
    rows: Array<{
      persona: string
      workflow: string
      stage: string
      policies: string[]
    }>
  }

  lookup.rows = lookup.rows.map((row) =>
    row.persona === '*' && row.workflow === '*' && row.stage === '*'
      ? {
          ...row,
          policies: row.policies.filter((policy) => policy !== 'OPERATOR-001'),
        }
      : row,
  )

  writeFileSync(lookupPath, `${JSON.stringify(lookup, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /loads WAIVER-001 without referenced policy OPERATOR-001/u,
  )
})

test('repository validation requires standalone Cursor agents in every pipeline config', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const configPath = path.join(root, 'project.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    configs: Record<string, { personas: Record<string, string> }>
  }

  delete config.configs.complex?.personas.investigator
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /pipeline config 'complex' does not map persona 'investigator'/u,
  )
})

function fixtureInvocation(root: string, stageSlug: string): Invocation {
  const workflow = loadWorkflow(root, 'dev')
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

test('invocation validator fails when the policy heading is absent', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const markdown = renderInvocationMarkdown(invocation).replace(
    POLICIES_HEADING,
    '## Policies',
  )
  const result = validateInvocationMarkdown(invocation, markdown)

  assert.equal(result.passed, false)
  assert.equal(
    result.checks.find((check) => check.id === 'policies.heading')?.passed,
    false,
  )
})

test('invocation validator fails when policy text is missing', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const policy = invocation.policies[0]
  const markdown = renderInvocationMarkdown(invocation).replace(
    policy.summary,
    '',
  )
  const result = validateInvocationMarkdown(invocation, markdown)

  assert.equal(result.passed, false)
  assert.equal(
    result.checks.find((check) => check.id === `policy.${policy.id}.summary`)
      ?.passed,
    false,
  )
})

test('invocation validator passes for canonical rendered markdown', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const result = validateInvocationMarkdown(
    invocation,
    renderInvocationMarkdown(invocation),
  )

  assert.equal(result.passed, true)
})

test('delegation validator fails for rewritten prompts', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const canonical = renderInvocationMarkdown(invocation)
  const result = validateDelegationMarkdown(
    canonical,
    'See runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.md',
  )

  assert.equal(result.passed, false)
})

test('delegation validator passes for canonical copied markdown', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const canonical = renderInvocationMarkdown(invocation)
  const result = validateDelegationMarkdown(canonical, canonical)

  assert.equal(result.passed, true)
})

test('delegation validator normalizes line endings', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const canonical = renderInvocationMarkdown(invocation)
  const result = validateDelegationMarkdown(
    canonical,
    canonical.replaceAll('\n', '\r\n'),
  )

  assert.equal(result.passed, true)
})
