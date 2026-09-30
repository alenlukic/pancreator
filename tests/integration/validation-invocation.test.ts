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
  validateInvocationMarkdown,
} from '../../src/lib/validation.js'
import {
  compareRepositoryCheckToBaseline,
  type RepositoryCheckCommandResult,
  type RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'
import { renderInvocationMarkdown } from '../../src/lib/render.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../fixture-template.js'
import { fixtureInvocation } from './validation-invocation-helpers.js'

test('invocation validator passes for canonical rendered markdown', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const markdown = renderInvocationMarkdown(invocation)
  const result = validateInvocationMarkdown(invocation, markdown)

  assert.equal(result.passed, true)

  const headingless = validateInvocationMarkdown(
    invocation,
    markdown.replace(POLICIES_HEADING, '## Policies'),
  )

  assert.equal(headingless.passed, false)
  assert.equal(
    headingless.checks.find((check) => check.id === 'policies.heading')?.passed,
    false,
  )

  const policy = invocation.policies[0]
  const summaryless = validateInvocationMarkdown(
    invocation,
    markdown.replace(policy.summary, ''),
  )

  assert.equal(summaryless.passed, false)
  assert.equal(
    summaryless.checks.find(
      (check) => check.id === `policy.${policy.id}.summary`,
    )?.passed,
    false,
  )
})

test('invocation validation preserves legacy plain-string instruction checks', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const legacy = structuredClone(invocation)

  for (const policy of legacy.policies) {
    // Persisted invocations from older releases used this plain-string shape.
    policy.instructions = policy.instructions.map(
      (instruction) => instruction.text,
    ) as unknown as typeof policy.instructions
  }

  const markdown = renderInvocationMarkdown(legacy)
  const result = validateInvocationMarkdown(legacy, markdown)
  const firstPolicy = legacy.policies[0]

  assert.ok(firstPolicy)
  assert.equal(result.passed, true)
  assert.ok(
    result.checks.some(
      (check) =>
        check.id === `policy.${firstPolicy.id}.instruction.1` && check.passed,
    ),
  )
})

test('delegation source falls back to the layout of the run it belongs to', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const runRelative = `runtime/logs/workflows/${invocation.run_id}`
  const validationPaths = () => [
    invocationValidationPath(invocation.run_id, invocation.invocation_id, root),
    delegationValidationPath(invocation.run_id, invocation.invocation_id, root),
    attestationValidationPath(
      invocation.run_id,
      invocation.invocation_id,
      root,
    ),
  ]

  const legacyRunDirectory = path.join(root, runRelative)

  mkdirSync(legacyRunDirectory, { recursive: true })

  const currentLayout = expectedDelegationSource(root, invocation)

  assert.deepEqual(currentLayout, {
    path: 'runtime/logs/workflows/run-fixture/agent/invocations/implement-1-fixture.md',
    mode: 'verbatim',
  })
  assert.deepEqual(validationPaths(), [
    `${runRelative}/agent/validations/implement-1-fixture.invocation-validation.json`,
    `${runRelative}/agent/validations/implement-1-fixture.delegation-validation.json`,
    `${runRelative}/agent/validations/implement-1-fixture.attestation-validation.json`,
  ])

  // A layout-v1 run keeps these artifacts beside its invocation, so a resumed
  // run must read and write that location.
  writeFileSync(path.join(legacyRunDirectory, 'state.json'), '{}\n')

  const legacyLayout = expectedDelegationSource(root, invocation)

  assert.deepEqual(legacyLayout, {
    path: 'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.md',
    mode: 'verbatim',
  })
  assert.deepEqual(validationPaths(), [
    `${runRelative}/invocations/implement-1-fixture.invocation-validation.json`,
    `${runRelative}/invocations/implement-1-fixture.delegation-validation.json`,
    `${runRelative}/invocations/implement-1-fixture.attestation-validation.json`,
  ])
})

test('delegation validator normalizes trailing whitespace', () => {
  // validateDelegationMarkdown is pure, so a literal stands in for a card.
  const canonical = [
    '# 🧭 Implement · attempt 1',
    '',
    '## 📜 Policies in force',
    '',
    '- **ENG-001 · Engineering handbook**',
    '  Agents MUST keep changes coherent.',
    '',
    '## 🚧 Boundaries',
    '',
    '- Fixture boundary',
    '',
  ].join('\n')

  assert.equal(validateDelegationMarkdown(canonical, canonical).passed, true)

  const withTrailingWhitespace = canonical
    .split('\n')
    .map((line) => `${line}  `)
    .join('\n')

  assert.equal(
    validateDelegationMarkdown(canonical, withTrailingWhitespace).passed,
    true,
  )

  assert.equal(
    validateDelegationMarkdown(canonical, canonical.replaceAll('\n', '\r\n'))
      .passed,
    true,
  )

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

// The fixture pins qa-tester to keep that QA persona's path under test.
function qaPersonaStage(root: string) {
  return {
    ...stageBySlug(loadWorkflow(root, 'delivery'), 'verify'),
    persona: 'qa-tester',
  }
}

test('preserved full-suite evidence classifies as environment-blocked', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')

  const qaStage = qaPersonaStage(root)
  const verifyStage = stageBySlug(workflow, 'verify')
  const implementStage = stageBySlug(workflow, 'implement')

  const baseline = preservedFullSuiteBaseline()
  const importError = 'E   ImportError: cannot import name orm_models'
  const rows: Array<{
    label: string
    stage: typeof qaStage
    stderr: string
    blocked: boolean
  }> = [
    {
      label: 'carried infrastructure failure on a QA persona',
      stage: qaStage,
      stderr: importError,
      blocked: true,
    },
    {
      label: 'product assertion failure on a QA persona',
      stage: qaStage,
      stderr:
        'FAILED tests/integration/customers/acme/test_box.py::test_poll - AssertionError: mismatch',
      blocked: false,
    },
    {
      label: 'carried infrastructure failure on the delivery verifier',
      stage: verifyStage,
      stderr: importError,
      blocked: true,
    },
    {
      label: 'carried infrastructure failure on the coder',
      stage: implementStage,
      stderr: importError,
      blocked: false,
    },
    {
      // The node id names a timeout, but the failure is a new product
      // regression, so it is not environment-blocked.
      label: 'new failing test that mentions a timeout',
      stage: qaStage,
      stderr:
        'FAILED tests/integration/test_request_timeout.py::test_timeout_honored - AssertionError: request not aborted',
      blocked: false,
    },
  ]

  for (const row of rows) {
    const current = rerunWithExtraStderr(baseline, row.stderr)
    const comparison = compareRepositoryCheckToBaseline(baseline, current)

    assert.equal(comparison.passed, false, row.label)
    assert.equal(comparison.delta.new.length, 1, row.label)
    assert.equal(
      isEnvironmentBlockedDelta(row.stage, baseline, comparison),
      row.blocked,
      row.label,
    )
  }
})
