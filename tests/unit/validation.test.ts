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

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function assertEachDiagnostic(
  errors: string[],
  expected: Array<[string, RegExp]>,
): void {
  const joined = errors.join('\n')

  for (const [label, pattern] of expected) {
    assert.match(joined, pattern, `${label}: diagnostic missing`)
  }
}

// Pass A: every compatible policy/config mutation on ONE fixture, ONE
// validateRepository run; each expected diagnostic is asserted individually so
// a regression stays attributable.
test('repository validation requires a policy to deliver each engineering handbook', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policiesDirectory = path.join(root, 'governance', 'policies')
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const configPath = path.join(root, 'config.json')

  // Each handbook MUST be delivered by at least one policy.
  for (const policyId of ['ENG-001', 'TS-001', 'DESIGN-001', 'PY-001']) {
    const policyPath = path.join(policiesDirectory, `${policyId}.json`)
    const policy = readJson<{ guidance_sources?: unknown[] }>(policyPath)

    delete policy.guidance_sources
    writeJsonFile(policyPath, policy)
  }

  // Static guidance references MUST be declared in guidance_sources.
  const actionPath = path.join(policiesDirectory, 'ACTION-001.json')
  const action = readJson<{ instructions: string[] }>(actionPath)

  action.instructions.push(
    'Agents MUST apply library/skills/spotfix.md before completion.',
  )
  writeJsonFile(actionPath, action)

  // Lookup rows: drop a referenced policy dependency (WAIVER-001 requires
  // OPERATOR-001).
  const lookup = readJson<{
    rows: Array<{
      persona: string
      workflow: string
      stage: string
      policies: string[]
      technology?: string
    }>
  }>(lookupPath)

  lookup.rows = lookup.rows.map((row) =>
    row.persona === '*' && row.workflow === '*' && row.stage === '*'
      ? {
          ...row,
          policies: row.policies.filter((policy) => policy !== 'OPERATOR-001'),
        }
      : row,
  )
  writeJsonFile(lookupPath, lookup)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assertEachDiagnostic(result.errors, [
    [
      'engineering handbook delivery',
      /governance\/handbooks\/eng\/engineering\.md MUST be delivered by at least one policy/u,
    ],
    [
      'TypeScript handbook delivery',
      /governance\/handbooks\/typescript\/style-guide\.md MUST be delivered by at least one policy/u,
    ],
    [
      'design handbook delivery',
      /governance\/handbooks\/design\/ux-guide\.md MUST be delivered by at least one policy/u,
    ],
    [
      'Python handbook delivery',
      /governance\/handbooks\/python\/style-guide\.md MUST be delivered by at least one policy/u,
    ],
    [
      'undeclared static guidance',
      /ACTION-001 references static guidance library\/skills\/spotfix\.md without declaring it in guidance_sources/u,
    ],
    [
      'policy dependency',
      /loads WAIVER-001 without referenced policy OPERATOR-001/u,
    ],
  ])

  // An unsupported technology selector fails the lookup table load itself and
  // a missing persona mapping aborts projection validation; both mask the
  // governance diagnostics above, so they run as a second pass on the same
  // fixture.
  lookup.rows.push({
    persona: 'coder',
    workflow: '*',
    stage: '*',
    technology: 'ruby',
    policies: ['ENG-001'],
  })
  writeJsonFile(lookupPath, lookup)

  // Every pipeline config MUST map every standalone Cursor agent.
  const config = readJson<{
    defaults: Record<string, string>
    configs: Record<string, { personas: Record<string, string> }>
  }>(configPath)

  delete config.configs.auto?.personas.planner
  delete config.defaults.planner
  writeJsonFile(configPath, config)

  const secondPass = validateRepository(root)

  assert.equal(secondPass.ok, false)
  assertEachDiagnostic(secondPass.errors, [
    [
      'unsupported technology selector',
      /technology MUST name a supported workspace technology when present/u,
    ],
    [
      'pipeline config persona mapping',
      /pipeline config 'auto' does not map persona 'planner'/u,
    ],
  ])
})

// Pass B: lookup-row removals on ONE fixture, ONE validateRepository run.
test('repository validation requires code-review stages to load engineering handbook policies', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = readJson<{ rows: Array<{ persona: string }> }>(lookupPath)

  lookup.rows = lookup.rows.filter(
    (row) => row.persona !== 'coder' && row.persona !== 'design-qa',
  )
  writeJsonFile(lookupPath, lookup)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assertEachDiagnostic(result.errors, [
    [
      'engineering handbook on code-review stages',
      /workflow stage 'delivery\/implement' persona 'coder' MUST load a policy for the engineering handbook/u,
    ],
    [
      'Python handbook on code-review and QA stages',
      /workflow stage 'delivery\/implement' persona 'coder' MUST load a policy for the Python handbook/u,
    ],
    [
      'TypeScript handbook on code-review and QA stages',
      /workflow stage 'delivery\/implement' persona 'coder' MUST load a policy for the TypeScript handbook/u,
    ],
    [
      'design handbook on design stages',
      /workflow stage 'design\/test' persona 'design-qa' MUST load a policy for the design handbook/u,
    ],
  ])
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

function fixtureInvocation(root: string, stageSlug: string): Invocation {
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

test('invocation validator passes for canonical rendered markdown', () => {
  const root = createFixture()
  const invocation = fixtureInvocation(root, 'implement')
  const markdown = renderInvocationMarkdown(invocation)
  const result = validateInvocationMarkdown(invocation, markdown)

  assert.equal(result.passed, true)

  // The policy heading MUST be present verbatim.
  const headingless = validateInvocationMarkdown(
    invocation,
    markdown.replace(POLICIES_HEADING, '## Policies'),
  )

  assert.equal(headingless.passed, false)
  assert.equal(
    headingless.checks.find((check) => check.id === 'policies.heading')?.passed,
    false,
  )

  // Every policy summary MUST be present.
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
  // Per-invocation validation artifacts follow the layout of their own run.
  assert.deepEqual(validationPaths(), [
    `${runRelative}/agent/validations/implement-1-fixture.invocation-validation.json`,
    `${runRelative}/agent/validations/implement-1-fixture.delegation-validation.json`,
    `${runRelative}/agent/validations/implement-1-fixture.attestation-validation.json`,
  ])

  // A layout-v1 run wrote these artifacts beside its invocation, so a resumed
  // run must keep reading and writing that location.
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

  // Line endings normalize.
  assert.equal(
    validateDelegationMarkdown(canonical, canonical.replaceAll('\n', '\r\n'))
      .passed,
    true,
  )

  // The final newline normalizes.
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

// The classification keys on the QA-owning personas: the delivery verify
// stage's verifier, plus qa-tester for standalone and evidence-worker QA.
// The fixture pins qa-tester to keep that persona's path under test.
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
      // A genuine product failure on carried infrastructure.
      label: 'product assertion failure on a QA persona',
      stage: qaStage,
      stderr:
        'FAILED tests/integration/customers/acme/test_box.py::test_poll - AssertionError: mismatch',
      blocked: false,
    },
    {
      // The delivery verify stage's verifier owns QA too.
      label: 'carried infrastructure failure on the delivery verifier',
      stage: verifyStage,
      stderr: importError,
      blocked: true,
    },
    {
      // A non-QA persona never classifies as environment-blocked.
      label: 'carried infrastructure failure on the coder',
      stage: implementStage,
      stderr: importError,
      blocked: false,
    },
    {
      // A genuinely new product regression whose node id names a timeout:
      // keyword matching classified this as environmental, inviting a waiver
      // that would ship the regression.
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
              final_line: guidanceFinalLine(invocation, entry),
            })),
          }
        : {}),
    },
  }
}

/** Last non-empty line of the selection, from the invocation's own policies. */
function guidanceFinalLine(
  invocation: Invocation,
  entry: { policy_id: string; source_path: string },
): string {
  const divider = /^\s*(?:[-_*]\s*){3,}$/u

  for (const policy of invocation.policies) {
    if (policy.id !== entry.policy_id) {
      continue
    }

    for (const guidance of policy.guidance ?? []) {
      if (guidance.source_path === entry.source_path) {
        const lines = guidance.content.split('\n')

        for (let index = lines.length - 1; index >= 0; index -= 1) {
          if (lines[index].trim().length > 0 && !divider.test(lines[index])) {
            return lines[index]
          }
        }
      }
    }
  }

  return ''
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
  const validate = (output: Record<string, unknown>) =>
    validateInvocationAttestation(invocation, output)
  const failedCheck = (
    result: ReturnType<typeof validateInvocationAttestation>,
    id: string,
  ) => result.checks.find((check) => check.id === id)?.passed === false
  const firstFailureMessage = (
    result: ReturnType<typeof validateInvocationAttestation>,
  ) => result.checks.find((check) => !check.passed)?.message ?? ''

  const complete = validate(attestedOutput(attestation))

  assert.equal(complete.passed, true)
  assert.equal(complete.status, 'read')

  // Status routes.
  const missing = validate(attestedOutput(undefined))

  assert.equal(missing.passed, false)
  assert.equal(missing.status, 'missing')

  const pending = validate(
    attestedOutput({ ...attestation, status: 'pending' }),
  )

  assert.equal(pending.passed, false)
  assert.equal(pending.status, 'pending')
  assert.ok(failedCheck(pending, 'attestation.status'))

  const malformed = validate(
    attestedOutput({ ...attestation, status: 'skimmed' }),
  )

  assert.equal(malformed.passed, false)
  assert.equal(malformed.status, 'malformed')
  assert.ok(failedCheck(malformed, 'attestation.status'))

  // Section declarations.
  const partial = validate(
    attestedOutput({
      ...attestation,
      sections: attestation.sections?.slice(0, -1),
    }),
  )

  assert.equal(partial.passed, false)
  assert.ok(failedCheck(partial, 'attestation.section_count'))

  const reordered = validate(
    attestedOutput({
      ...attestation,
      sections: [...(attestation.sections ?? [])].reverse(),
    }),
  )

  assert.equal(reordered.passed, false)

  const sections = [...(attestation.sections ?? [])]
  const first = sections[0]

  assert.ok(first)
  sections[0] = { id: first.id, sha256: 'stale-digest' }

  const staleSection = validate(attestedOutput({ ...attestation, sections }))

  assert.equal(staleSection.passed, false)
  assert.ok(failedCheck(staleSection, `attestation.section.${first.id}`))

  const staleContract = validate(
    attestedOutput({ ...attestation, contract_sha256: 'stale' }),
  )

  assert.equal(staleContract.passed, false)
  assert.ok(failedCheck(staleContract, 'attestation.contract_digest'))

  // Guidance routes.
  assert.ok(
    attestation.guidance?.length,
    'the fixture contract references guidance',
  )

  const withFirstGuidance = (
    patch: Partial<NonNullable<ReadAttestation['guidance']>[number]>,
  ) =>
    attestation.guidance?.map((entry, index) =>
      index === 0 ? { ...entry, ...patch } : entry,
    )

  const pendingGuidance = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({ status: 'pending' }),
    }),
  )

  assert.equal(pendingGuidance.passed, false)
  assert.match(
    firstFailureMessage(pendingGuidance),
    /still the scaffold value pending/u,
  )

  const skippedBare = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({ status: 'skipped' }),
    }),
  )

  assert.equal(skippedBare.passed, false)
  assert.match(
    firstFailureMessage(skippedBare),
    /MUST carry the concrete reason/u,
  )

  const skippedReasoned = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({
        status: 'skipped',
        reason: 'The task changes no file the trigger governs.',
      }),
    }),
  )

  assert.equal(skippedReasoned.passed, true)

  // Unreadable guidance means the worker acted without policy it is held to,
  // so the attestation fails rather than recording the loss as an aside.
  const referenceFailed = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({
        status: 'reference_failed',
        error: 'ENOENT: guidance source missing',
      }),
    }),
  )

  assert.equal(referenceFailed.passed, false)
  assert.match(
    firstFailureMessage(referenceFailed),
    /ENOENT: guidance source missing/u,
  )

  // A self-declared "I read the contract" cannot cover external selections
  // the worker never opened, so omitting the entries fails the attestation.
  const { guidance: _guidance, ...withoutGuidance } = attestation
  const absent = validate(attestedOutput(withoutGuidance))

  assert.equal(absent.passed, false)
  assert.ok(failedCheck(absent, 'attestation.guidance_count'))

  // A read entry without its final-line quote is a path list, not evidence.
  const missingQuote = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({ final_line: undefined }),
    }),
  )

  assert.equal(missingQuote.passed, false)
  assert.match(
    firstFailureMessage(missingQuote),
    /MUST quote the selection's last content line/u,
  )

  // A wrong quote fails: the line validates against the selected bytes.
  const mismatch = validate(
    attestedOutput({
      ...attestation,
      guidance: withFirstGuidance({
        final_line: 'not the selection closing line',
      }),
    }),
  )

  assert.equal(mismatch.passed, false)
  assert.match(firstFailureMessage(mismatch), /final_line does not match/u)

  // Contract reference failures.
  const referenceFailure = {
    invocation_id: attestation.invocation_id,
    model: invocation.stage.model,
    contract_path: attestation.contract_path,
    status: 'reference_failed',
    error: 'ENOENT: contract path could not be opened',
  }
  const blocked = validate(attestedOutput(referenceFailure, 'blocked'))

  assert.equal(blocked.passed, true)
  assert.equal(blocked.status, 'reference_failed')
  assert.ok(
    blocked.checks.some((check) => check.message.includes('ENOENT')),
    'the failed reference MUST stay visible in the checks',
  )

  const reportedAsSuccess = validate(attestedOutput(referenceFailure))

  assert.equal(reportedAsSuccess.passed, false)
  assert.ok(
    failedCheck(reportedAsSuccess, 'attestation.reference_failure_blocks'),
  )

  const { error: _error, ...withoutReason } = referenceFailure
  const unreasoned = validate(attestedOutput(withoutReason, 'blocked'))

  assert.equal(unreasoned.passed, false)

  // An invocation prepared before guidance attestation existed carries no
  // guidance index, and its worker owes no entries.
  const legacy = structuredClone(invocation)

  assert.ok(legacy.contract_manifest)
  delete legacy.contract_manifest.guidance
  assert.equal(
    validateInvocationAttestation(legacy, attestedOutput(withoutGuidance))
      .passed,
    true,
  )

  // An invocation without a contract manifest owes no attestation at all.
  assert.equal(
    validateInvocationAttestation(
      fixtureInvocation(root, 'implement'),
      attestedOutput(undefined),
    ).passed,
    true,
  )
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

// Rehomed from the governance branch at integration: these cases prove
// rules that branch adds and have no other home in the consolidated suite.

test('guidance final-line evidence skips a trailing Markdown divider', () => {
  const root = createFixture()
  const { invocation, attestation } = attestedFixture(root)

  assert.ok(attestation.guidance?.length)

  // The RF-006 trap: a selection that ends with a `---` divider. The old
  // contract demanded the literal last non-empty line, so the required quote
  // was three dashes that prove nothing and invite a failed attempt.
  const target = attestation.guidance[0]
  const policy = invocation.policies.find(
    (item) => item.id === target.policy_id,
  )
  const guidance = policy?.guidance?.find(
    (item) => item.source_path === target.source_path,
  )

  assert.ok(guidance)

  const contentLine = guidanceFinalLine(invocation, target)

  assert.ok(contentLine.trim().length > 0)
  guidance.content = `${guidance.content}\n\n---\n`

  // Quoting the last real content line passes.
  const evidence = attestation.guidance.map((entry, index) =>
    index === 0 ? { ...entry, final_line: contentLine } : entry,
  )
  const accepted = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, guidance: evidence }),
  )

  assert.equal(accepted.passed, true)

  // Quoting the divider itself is not read evidence and fails.
  const dividerQuote = attestation.guidance.map((entry, index) =>
    index === 0 ? { ...entry, final_line: '---' } : entry,
  )
  const rejected = validateInvocationAttestation(
    invocation,
    attestedOutput({ ...attestation, guidance: dividerQuote }),
  )

  assert.equal(rejected.passed, false)
  assert.match(
    rejected.checks.find((check) => !check.passed)?.message ?? '',
    /final_line does not match/u,
  )
})
