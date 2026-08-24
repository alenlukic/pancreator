import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  attestationValidationPath,
  delegationValidationPath,
  expectedDelegationSource,
  invocationValidationPath,
  isEnvironmentBlockedDelta,
  POLICIES_HEADING,
  validateDelegationMarkdown,
  attestationModelMatches,
  validateInvocationAttestation,
  validateInvocationMarkdown,
  validateRepository,
} from '../../src/lib/validation.js'
import {
  compareRepositoryCheckToBaseline,
  type RepositoryCheckCommandResult,
  type RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'
import {
  buildInvocationContractManifest,
  renderInvocationMarkdown,
} from '../../src/lib/render.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'
import type { Invocation, InvocationAttestation } from '../../src/lib/types.js'

function prepareValidationFixture(root: string): void {
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  writeFileSync(path.join(root, 'prettier.config.js'), 'export default {}\n')
  writeFileSync(path.join(root, 'tsconfig.json'), '{}\n')
  writeFileSync(path.join(root, 'src', 'cli.ts'), 'export {}\n')
}

test('repository validation rejects a target policy without its binding layer', () => {
  const root = createFixture()

  prepareValidationFixture(root)
  writeFileSync(
    path.join(root, 'governance', 'policies', 'TARGET-001.json'),
    `${JSON.stringify(
      {
        id: 'TARGET-001',
        extension_id: 'target',
        title: 'Target policy',
        severity: 'hard',
        summary: 'Agents MUST apply the target policy.',
        instructions: ['Agents MUST preserve target behavior.'],
      },
      null,
      2,
    )}\n`,
  )

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /TARGET-001 declares extension target, but its binding layer is missing/u,
  )
})

test('repository validation requires a policy to deliver each engineering handbook', () => {
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
    /governance\/handbooks\/eng\/engineering\.md MUST be delivered by at least one policy/u,
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

test('repository validation requires a policy to deliver the TypeScript handbook', () => {
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
    /governance\/handbooks\/typescript\/style-guide\.md MUST be delivered by at least one policy/u,
  )
})

test('repository validation requires a policy to deliver the design handbook', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policyPath = path.join(
    root,
    'governance',
    'policies',
    'DESIGN-001.json',
  )
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    guidance_sources?: unknown[]
  }

  delete policy.guidance_sources

  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /governance\/handbooks\/design\/ux-guide\.md MUST be delivered by at least one policy/u,
  )
})

test('repository validation requires design stages to load design handbook policies', () => {
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

  lookup.rows = lookup.rows.filter((row) => row.persona !== 'design-qa')

  writeFileSync(lookupPath, `${JSON.stringify(lookup, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /workflow stage 'design\/test' persona 'design-qa' MUST load a policy for the design handbook/u,
  )
})

test('repository validation requires a policy to deliver the Python handbook', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policyPath = path.join(root, 'governance', 'policies', 'PY-001.json')
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    guidance_sources?: unknown[]
  }

  delete policy.guidance_sources

  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /governance\/handbooks\/python\/style-guide\.md MUST be delivered by at least one policy/u,
  )
})

test('repository validation requires code-review and QA stages to load Python handbook policies', () => {
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
          policies: row.policies.filter((policy) => policy !== 'PY-001'),
        }
      : row,
  )

  writeFileSync(lookupPath, `${JSON.stringify(lookup, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /workflow stage 'dev\/test' persona 'qa-tester' MUST load a policy for the Python handbook/u,
  )
})

test('repository validation rejects static guidance references that are not declared', () => {
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
    /ACTION-001 references static guidance library\/skills\/spotfix\.md without declaring it in guidance_sources/u,
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
  const configPath = path.join(root, 'config.json')
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

test('repository validation rejects unsupported policy technology selectors', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = JSON.parse(readFileSync(lookupPath, 'utf8')) as {
    rows: Array<Record<string, unknown>>
  }

  lookup.rows.push({
    persona: 'coder',
    workflow: '*',
    stage: '*',
    technology: 'ruby',
    policies: ['ENG-001'],
  })
  writeFileSync(lookupPath, `${JSON.stringify(lookup, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /technology MUST name a supported workspace technology when present/u,
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
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
    configs: Record<string, { personas: Record<string, string> }>
  }

  delete config.configs.complex?.personas['tech-lead']
  delete config.defaults['tech-lead']
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /pipeline config 'complex' does not map persona 'tech-lead'/u,
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
      operator_brief: {
        source_path: `runtime/logs/workflows/run-fixture/artifacts/json/${stageSlug}.brief.json`,
        rendered_path: `runtime/logs/workflows/run-fixture/artifacts/html/${stageSlug}.html`,
        schema: 'library/schemas/operator-brief.schema.json',
        renderer: 'pan briefs render',
        profile:
          stageSlug === 'intake'
            ? 'intake'
            : stageSlug === 'plan'
              ? 'plan'
              : stageSlug === 'review'
                ? 'review'
                : stageSlug === 'test'
                  ? 'qa'
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

test('delegation source falls back to the layout of the run it belongs to', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const currentLayout = expectedDelegationSource(root, invocation)

  assert.deepEqual(currentLayout, {
    path: 'runtime/logs/workflows/run-fixture/agent/invocations/implement-1-fixture.md',
    mode: 'verbatim',
  })

  const legacyRunDirectory = path.join(
    root,
    'runtime/logs/workflows',
    invocation.run_id,
  )

  mkdirSync(legacyRunDirectory, { recursive: true })
  writeFileSync(path.join(legacyRunDirectory, 'state.json'), '{}\n')

  const legacyLayout = expectedDelegationSource(root, invocation)

  assert.deepEqual(legacyLayout, {
    path: 'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.md',
    mode: 'verbatim',
  })
})

// A layout-v1 run wrote these artifacts beside its invocation, so a resumed run
// must keep reading and writing that location.
test('per-invocation validation artifacts follow the layout of their own run', () => {
  const root = createFixture()
  const runId = 'run-layout-validation'
  const invocationId = 'implement-1-fixture'
  const runRelative = `runtime/logs/workflows/${runId}`

  mkdirSync(path.join(root, runRelative), { recursive: true })

  assert.deepEqual(
    [
      invocationValidationPath(runId, invocationId, root),
      delegationValidationPath(runId, invocationId, root),
      attestationValidationPath(runId, invocationId, root),
    ],
    [
      `${runRelative}/agent/validations/${invocationId}.invocation-validation.json`,
      `${runRelative}/agent/validations/${invocationId}.delegation-validation.json`,
      `${runRelative}/agent/validations/${invocationId}.attestation-validation.json`,
    ],
  )

  writeFileSync(path.join(root, runRelative, 'state.json'), '{}\n')

  assert.deepEqual(
    [
      invocationValidationPath(runId, invocationId, root),
      delegationValidationPath(runId, invocationId, root),
      attestationValidationPath(runId, invocationId, root),
    ],
    [
      `${runRelative}/invocations/${invocationId}.invocation-validation.json`,
      `${runRelative}/invocations/${invocationId}.delegation-validation.json`,
      `${runRelative}/invocations/${invocationId}.attestation-validation.json`,
    ],
  )
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

test('delegation validator normalizes trailing whitespace', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const canonical = renderInvocationMarkdown(invocation)
  const withTrailingWhitespace = canonical
    .split('\n')
    .map((line) => `${line}  `)
    .join('\n')

  assert.equal(
    validateDelegationMarkdown(canonical, withTrailingWhitespace).passed,
    true,
  )
})

test('delegation validator normalizes the final newline', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const canonical = renderInvocationMarkdown(invocation)

  assert.equal(
    validateDelegationMarkdown(canonical, canonical.trimEnd()).passed,
    true,
  )
})

// Preserved waiver-1 full-suite evidence from audited run
// 63327_Aug-13-0394_5de7203f: the be-test-int command timed out at baseline
// with ETIMEDOUT, which is the carried infrastructure the environment-blocked
// classification must recognize.
function preservedFullSuiteBaseline(): RepositoryCheckResult {
  const fixture = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        'tests/fixtures/harness-repair/full-suite-evidence.json',
      ),
      'utf8',
    ),
  ) as {
    profile: string
    status: 'failed'
    timeout_ms: number
    result: RepositoryCheckCommandResult
  }

  return {
    profile: fixture.profile,
    status: fixture.status,
    config_path: 'runtime/repository-checks.json',
    workspace_root: '/workspace',
    timeout_ms: fixture.timeout_ms,
    results: [fixture.result],
    total_duration_ms: fixture.result.duration_ms,
    advisories: [],
  }
}

function rerunWithExtraStderr(
  baseline: RepositoryCheckResult,
  extraStderr: string,
): RepositoryCheckResult {
  const command = baseline.results[0]

  assert.ok(command)

  return {
    ...baseline,
    results: [{ ...command, stderr: `${command.stderr}${extraStderr}\n` }],
  }
}

test('preserved full-suite evidence classifies as environment-blocked', () => {
  const root = createFixture()
  const qaStage = stageBySlug(loadWorkflow(root, 'dev'), 'test')
  const baseline = preservedFullSuiteBaseline()
  const current = rerunWithExtraStderr(
    baseline,
    'E   ImportError: cannot import name orm_models',
  )
  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, false)
  assert.equal(comparison.delta.new.length, 1)
  assert.equal(isEnvironmentBlockedDelta(qaStage, baseline, comparison), true)
})

test('a genuine product failure on carried infrastructure is not environment-blocked', () => {
  const root = createFixture()
  const qaStage = stageBySlug(loadWorkflow(root, 'dev'), 'test')
  const baseline = preservedFullSuiteBaseline()
  const current = rerunWithExtraStderr(
    baseline,
    'FAILED tests/integration/customers/acme/test_box.py::test_poll - AssertionError: mismatch',
  )
  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, false)
  assert.equal(isEnvironmentBlockedDelta(qaStage, baseline, comparison), false)
})

test('a non-QA stage never classifies as environment-blocked', () => {
  const root = createFixture()
  const reviewStage = stageBySlug(loadWorkflow(root, 'dev'), 'review')
  const baseline = preservedFullSuiteBaseline()
  const current = rerunWithExtraStderr(
    baseline,
    'E   ImportError: cannot import name orm_models',
  )
  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(
    isEnvironmentBlockedDelta(reviewStage, baseline, comparison),
    false,
  )
})

type ReadAttestation = Extract<
  InvocationAttestation,
  { contract_sha256: string }
>

function attestedFixture(root: string): {
  invocation: Invocation
  attestation: ReadAttestation
} {
  const invocation = fixtureInvocation(root, 'implement')
  const contractPath = `runtime/logs/workflows/run-fixture/invocations/${invocation.invocation_id}.md`

  invocation.contract_manifest = buildInvocationContractManifest(
    contractPath,
    renderInvocationMarkdown(invocation),
    invocation.policies,
  )

  const manifest = invocation.contract_manifest

  return {
    invocation,
    attestation: {
      invocation_id: invocation.invocation_id,
      model: invocation.stage.model,
      contract_path: manifest.contract_path,
      contract_sha256: manifest.contract_sha256,
      status: 'read',
      sections: manifest.sections.map((section) => ({
        id: section.id,
        sha256: section.sha256,
      })),
      ...(manifest.guidance?.length
        ? {
            guidance: manifest.guidance.map((entry) => ({
              policy_id: entry.policy_id,
              source_path: entry.source_path,
              content_sha256: entry.content_sha256,
              status: 'read' as const,
            })),
          }
        : {}),
    },
  }
}

/** A submitted output carrying whatever the worker declared, valid or not. */
function attestedOutput(
  attestation: unknown,
  result: 'success' | 'blocked' = 'success',
): Record<string, unknown> {
  return {
    schema_version: 1,
    result,
    ...(attestation ? { invocation_attestation: attestation } : {}),
  }
}

test('attestation validator passes a complete in-order declaration', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput(attestation),
  )

  assert.equal(result.passed, true)
  assert.equal(result.status, 'read')
})

test('attestation validator rejects a missing declaration', () => {
  const root = createFixture()
  const { invocation } = attestedFixture(root)
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput(undefined),
  )

  assert.equal(result.passed, false)
  assert.equal(result.status, 'missing')
})

test('attestation validator rejects the prefilled pending status', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, status: 'pending' }),
  )

  assert.equal(result.passed, false)
  assert.equal(result.status, 'pending')
  assert.match(
    result.checks.find((check) => check.id === 'attestation.status')?.message ??
      '',
    /still the scaffold value pending/u,
  )
})

test('attestation validator reports an unrecognized status as malformed', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, status: 'skimmed' }),
  )

  assert.equal(result.passed, false)
  assert.equal(result.status, 'malformed')
  assert.equal(
    result.checks.find((check) => check.id === 'attestation.status')?.passed,
    false,
  )
})

test('attestation validator rejects a partial declaration', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput({
      ...attestation,
      sections: attestation.sections?.slice(0, -1),
    }),
  )

  assert.equal(result.passed, false)
  assert.equal(
    result.checks.find((check) => check.id === 'attestation.section_count')
      ?.passed,
    false,
  )
})

test('attestation validator rejects reordered sections', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const reordered = [...(attestation.sections ?? [])].reverse()
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, sections: reordered }),
  )

  assert.equal(result.passed, false)
})

test('attestation validator rejects a stale section digest', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const sections = [...(attestation.sections ?? [])]
  const first = sections[0]

  assert.ok(first)
  sections[0] = { id: first.id, sha256: 'stale-digest' }

  const result = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, sections }),
  )

  assert.equal(result.passed, false)
  assert.equal(
    result.checks.find(
      (check) => check.id === `attestation.section.${first.id}`,
    )?.passed,
    false,
  )
})

test('attestation validator rejects a stale contract digest', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, contract_sha256: 'stale' }),
  )

  assert.equal(result.passed, false)
  assert.equal(
    result.checks.find((check) => check.id === 'attestation.contract_digest')
      ?.passed,
    false,
  )
})

test('attestation validator passes read guidance and rejects the pending scaffold value', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)

  assert.ok(
    attestation.guidance?.length,
    'the fixture contract references guidance',
  )

  const passing = validateInvocationAttestation(
    invocation,
    attestedOutput(attestation),
  )

  assert.equal(passing.passed, true)

  const pending = attestation.guidance.map((entry, index) =>
    index === 0 ? { ...entry, status: 'pending' as const } : entry,
  )
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, guidance: pending }),
  )

  assert.equal(result.passed, false)
  assert.match(
    result.checks.find((check) => !check.passed)?.message ?? '',
    /still the scaffold value pending/u,
  )
})

test('attestation validator requires a reason for skipped guidance', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)

  assert.ok(attestation.guidance?.length)

  const bare = attestation.guidance.map((entry, index) =>
    index === 0 ? { ...entry, status: 'skipped' as const } : entry,
  )
  const rejected = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, guidance: bare }),
  )

  assert.equal(rejected.passed, false)
  assert.match(
    rejected.checks.find((check) => !check.passed)?.message ?? '',
    /MUST carry the concrete reason/u,
  )

  const reasoned = attestation.guidance.map((entry, index) =>
    index === 0
      ? {
          ...entry,
          status: 'skipped' as const,
          reason: 'The task changes no file the trigger governs.',
        }
      : entry,
  )
  const accepted = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, guidance: reasoned }),
  )

  assert.equal(accepted.passed, true)
})

test('attestation validator fails a guidance reference failure', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)

  assert.ok(attestation.guidance?.length)

  const failed = attestation.guidance.map((entry, index) =>
    index === 0
      ? {
          ...entry,
          status: 'reference_failed' as const,
          error: 'ENOENT: guidance source missing',
        }
      : entry,
  )
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, guidance: failed }),
  )

  // Unreadable guidance means the worker acted without policy it is held to,
  // so the attestation fails rather than recording the loss as an aside.
  assert.equal(result.passed, false)
  assert.match(
    result.checks.find((check) => !check.passed)?.message ?? '',
    /ENOENT: guidance source missing/u,
  )
})

test('attestation validator accepts an absent guidance echo and still checks a volunteered one', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)

  assert.ok(attestation.guidance?.length)

  // Absent is the slim contract: no per-guidance transcription owed.
  const { guidance: _guidance, ...withoutGuidance } = attestation
  const absent = validateInvocationAttestation(
    invocation,
    attestedOutput(withoutGuidance),
  )

  assert.equal(absent.passed, true)

  // A volunteered echo (legacy scaffolds) is still validated exactly.
  const truncated = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, guidance: [] }),
  )

  assert.equal(truncated.passed, false)
  assert.equal(
    truncated.checks.find((check) => check.id === 'attestation.guidance_count')
      ?.passed,
    false,
  )
})

test('a manifest without a guidance index requires no guidance entries', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const manifest = invocation.contract_manifest

  assert.ok(manifest)
  // An invocation prepared before guidance attestation existed carries no
  // guidance index, and its worker owes no entries.
  delete manifest.guidance

  const { guidance: _guidance, ...withoutGuidance } = attestation
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput(withoutGuidance),
  )

  assert.equal(result.passed, true)
})

test('attestation validator accepts a blocked reference failure', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput(
      {
        invocation_id: attestation.invocation_id,
        model: invocation.stage.model,
        contract_path: attestation.contract_path,
        status: 'reference_failed',
        error: 'ENOENT: contract path could not be opened',
      },
      'blocked',
    ),
  )

  assert.equal(result.passed, true)
  assert.equal(result.status, 'reference_failed')
  assert.ok(
    result.checks.some((check) => check.message.includes('ENOENT')),
    'the failed reference MUST stay visible in the checks',
  )
})

test('attestation validator rejects a reference failure reported as success', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput({
      invocation_id: attestation.invocation_id,
      model: invocation.stage.model,
      contract_path: attestation.contract_path,
      status: 'reference_failed',
      error: 'ENOENT: contract path could not be opened',
    }),
  )

  assert.equal(result.passed, false)
  assert.equal(
    result.checks.find(
      (check) => check.id === 'attestation.reference_failure_blocks',
    )?.passed,
    false,
  )
})

test('attestation validator rejects a reference failure without a reason', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput(
      {
        invocation_id: attestation.invocation_id,
        model: invocation.stage.model,
        contract_path: attestation.contract_path,
        status: 'reference_failed',
      },
      'blocked',
    ),
  )

  assert.equal(result.passed, false)
})

test('attestation validator skips an invocation without a contract manifest', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const result = validateInvocationAttestation(
    invocation,
    attestedOutput(undefined),
  )

  assert.equal(result.passed, true)
})

test('a new failing test that mentions a timeout is not environment-blocked', () => {
  const root = createFixture()
  const qaStage = stageBySlug(loadWorkflow(root, 'dev'), 'test')
  const baseline = preservedFullSuiteBaseline()
  // A genuinely new product regression whose node id names a timeout: keyword
  // matching classified this as environmental, inviting a waiver that would
  // ship the regression.
  const current = rerunWithExtraStderr(
    baseline,
    'FAILED tests/integration/test_request_timeout.py::test_timeout_honored - AssertionError: request not aborted',
  )
  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, false)
  assert.equal(isEnvironmentBlockedDelta(qaStage, baseline, comparison), false)
})

test('attestation model matching accepts executor-selected models under auto', () => {
  assert.equal(attestationModelMatches('claude-opus-5[1m]', 'auto'), true)
  assert.equal(attestationModelMatches('  ', 'auto'), false)
  assert.equal(attestationModelMatches(undefined, 'auto'), false)
  assert.equal(
    attestationModelMatches(
      'gpt-5.4[context=272k,effort=high,fast=false]',
      'gpt-5.4[context=272k,effort=high,fast=false]',
    ),
    true,
  )
  assert.equal(attestationModelMatches('another-model', 'gpt-5.4'), false)
})
