import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture, sharedFixture } from '../fixture-template.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { validateRepository } from '../../src/lib/validation.js'
import {
  prepareValidationFixture,
  readJson,
  writeJsonFile,
} from './validation-helpers.js'
import { writePolicyExtension } from './policies-helpers.js'

test('build-docs owns primer validators on LIBRARIAN-001', () => {
  const root = sharedFixture()
  const catalog = loadPolicyCatalog(root)
  const librarian = catalog.get('LIBRARIAN-001')
  const primer = catalog.get('PRIMER-001')

  assert.ok(librarian)
  assert.ok(primer)
  assert.equal(primer.requirements?.length ?? 0, 0)

  const ids = resolveRequirements(root, {
    persona: 'librarian',
    workflow: 'standalone',
    stage: 'build-docs',
    invocation_kind: 'documentation',
  })
    .validation_requirements.filter((requirement) =>
      [
        'TARGET-REPO-PRIMER-VALIDATE-001',
        'TARGET-LANGUAGE-HANDBOOK-VALIDATE-001',
      ].includes(requirement.registry_id),
    )
    .map((requirement) => requirement.requirement_id)
    .sort()

  assert.deepEqual(ids, [
    'target-language-handbook-validate',
    'target-repo-primer-validate',
  ])
  assert.equal(
    resolveRequirements(root, {
      persona: 'librarian',
      workflow: 'standalone',
      stage: 'build-docs',
      invocation_kind: 'documentation',
    }).validation_requirements.some(
      (requirement) => requirement.policy_id === 'LIBRARIAN-001',
    ),
    true,
  )
})

test('self-development skips generated language rows that target installs keep', () => {
  const selfDev = resolvePolicies(sharedFixture(), {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.equal(selfDev.includes('LANG-001'), false)

  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  config.workspace_root = 'target'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  mkdirSync(path.join(root, 'target'), { recursive: true })
  writeFileSync(path.join(root, 'target', 'package.json'), '{}\n')
  writeFileSync(path.join(root, 'target', 'tsconfig.json'), '{}\n')

  const embedded = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'delivery',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(embedded.includes('LANG-001'))
})

test('mixed policies tag supervisor, harness, and operator audiences', () => {
  const catalog = loadPolicyCatalog(sharedFixture())
  const audiences = (policyId: string): string[][] =>
    (catalog.get(policyId)?.instructions ?? []).map(
      (instruction) => instruction.audience,
    )
  const audienceFor = (policyId: string, excerpt: string): string[] => {
    const instruction = (catalog.get(policyId)?.instructions ?? []).find(
      (item) => item.text.includes(excerpt),
    )

    assert.ok(
      instruction,
      `${policyId} MUST contain the named instruction ${excerpt}`,
    )

    return instruction.audience
  }

  // The durable-instruction-text rules govern how agents author policies,
  // personas, skills, and commands, so they render on an agent card. No code
  // path renders a card at audience `operator`.
  assert.deepEqual(audienceFor('STE-001', 'durable-instruction-text'), [
    'agent',
  ])
  // The chat rules moved to COMMS-001 at audience `agent`, so one universal
  // row delivers them to a worker card, a standalone card, and a supervisor
  // card alike.
  assert.equal(
    audiences('STE-001').some((audience) => audience.includes('supervisor')),
    false,
    'STE-001 gave up its supervisor-audience chat rules',
  )
  assert.deepEqual(
    audienceFor('COMMS-001', 'Operator chat reports MUST state the outcome'),
    ['agent'],
  )
  // The prose cap and the terminal-state report contract reach every
  // operator-facing agent through the same universal row.
  assert.deepEqual(audienceFor('COMMS-001', 'MUST hold at most 250 words'), [
    'agent',
  ])
  assert.deepEqual(
    audienceFor('COMMS-001', 'When a task reaches a terminal state'),
    ['agent'],
  )
  assert.deepEqual(
    audiences('COMMS-001').filter(
      (audience) => audience.length !== 1 || audience[0] !== 'agent',
    ),
    [],
    'every COMMS-001 instruction carries audience agent',
  )
  // The chat shapes stay judgment-only, so no validator and no handbook
  // selection may bind to COMMS-001.
  assert.equal(catalog.get('COMMS-001')?.requirements, undefined)
  assert.equal(catalog.get('COMMS-001')?.guidance, undefined)
  assert.deepEqual(audienceFor('OPERATOR-001', '--redline --occasion'), [
    'supervisor',
  ])
  assert.deepEqual(audienceFor('OPERATOR-001', 'A non-empty `--note`'), [
    'supervisor',
  ])
  assert.deepEqual(audienceFor('CONTRACT-001', 'registry-validate'), [
    'harness',
  ])
  assert.deepEqual(audienceFor('CONTRACT-001', 'projection_manifest.json'), [
    'harness',
  ])
  assert.deepEqual(audienceFor('CONTRACT-001', 'directive-audit'), ['harness'])
  assert.deepEqual(audienceFor('CONTRACT-001', '.git/info/exclude'), [
    'harness',
  ])
  assert.deepEqual(
    audienceFor('BRIEF-001', 'MUST render requested HTML during submission'),
    ['harness'],
  )
  assert.deepEqual(audienceFor('BRIEF-001', 'retained brief system'), [
    'harness',
  ])
  assert.deepEqual(
    audienceFor('BRIEF-001', 'MUST delete transient source JSON'),
    ['harness'],
  )
  assert.deepEqual(
    audienceFor('BRIEF-001', 'MUST NOT loop the workflow to implementation'),
    ['harness'],
  )
  assert.deepEqual(
    audienceFor('VALID-001', 'treat an agent-run result as early feedback'),
    ['harness'],
  )
  assert.deepEqual(
    audienceFor('VALID-001', 'MUST NOT inline the full validator catalog'),
    ['harness'],
  )
  assert.deepEqual(
    audienceFor('VALID-001', 'MUST NOT invent a separate validator set'),
    ['harness'],
  )
  // A policy whose every instruction is harness-tagged renders an empty block
  // on the one card that loads it. Both of these keep a rendered instruction.
  assert.ok(
    audiences('OUTPUT-001').some((audience) => audience.includes('harness')),
  )
  assert.ok(
    audiences('OUTPUT-001').some((audience) => audience.includes('agent')),
  )
  assert.ok(
    audiences('RUNTIME-001').some((audience) => audience.includes('harness')),
  )
  assert.ok(
    audiences('RUNTIME-001').some((audience) => audience.includes('agent')),
  )
  assert.ok(
    catalog
      .get('LIBRARIAN-001')
      ?.instructions.some((instruction) =>
        instruction.text.includes(
          'The librarian MUST copy repository-check commands',
        ),
      ),
  )
  assert.equal(
    catalog
      .get('REPO-001')
      ?.instructions.some((instruction) =>
        instruction.text.includes(
          'The librarian MUST copy repository-check commands',
        ),
      ),
    false,
  )
})

test('a technology-scoped provider row does not cover an unscoped consumer', () => {
  // The technology clause of the coverage predicate once accepted any provider
  // when the consumer declared no technology, which silenced every dependency
  // gap a language-scoped row left behind.
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = readJson<{
    rows: Array<{
      persona: string
      workflow: string
      stage: string
      technology?: string
      policies: string[]
    }>
  }>(lookupPath)

  // WAIVER-001 references OPERATOR-001, and the universal row is the only
  // provider of OPERATOR-001, so scoping that provider isolates the clause.
  lookup.rows = lookup.rows.map((row) =>
    row.persona === '*' && row.workflow === '*' && row.stage === '*'
      ? {
          ...row,
          policies: row.policies.filter((policy) => policy !== 'OPERATOR-001'),
        }
      : row,
  )

  const scopedProvider = {
    persona: '*',
    workflow: '*',
    stage: '*',
    technology: 'typescript',
    policies: ['OPERATOR-001'],
  }

  lookup.rows.push(scopedProvider)
  writeJsonFile(lookupPath, lookup)

  assert.match(
    validateRepository(root).errors.join('\n'),
    /loads WAIVER-001 without referenced policy OPERATOR-001/u,
    'a technology-scoped provider must leave the unscoped consumer uncovered',
  )

  delete (scopedProvider as { technology?: string }).technology
  writeJsonFile(lookupPath, lookup)

  assert.doesNotMatch(
    validateRepository(root).errors.join('\n'),
    /loads WAIVER-001 without referenced policy OPERATOR-001/u,
    'the same provider without a technology scope must cover the consumer',
  )
})

test('test coverage citations are not read as policy references', () => {
  // DELEGATE-001's harness instructions cite the AC-named watch-repair tests.
  // A token like `AC-001` inside a `tests/<path>::<name>` citation is a test
  // name, not a policy reference, and must not fail the dependency check.
  const root = createFixture()

  prepareValidationFixture(root)

  const errors = validateRepository(root).errors.join('\n')

  assert.doesNotMatch(errors, /references missing policy AC-/u)
})

test('long-horizon policy rows swap one mode policy without changing the rest', () => {
  const root = sharedFixture()
  const ids = (contracts: Array<'long_horizon'>): string[] =>
    resolvePolicies(root, {
      persona: 'coder',
      workflow: 'delivery',
      stage: 'implement',
      contracts,
      operator_artifacts: 'suppressed',
    }).map((policy) => policy.id)
  const regular = ids([])
  const horizon = ids(['long_horizon'])

  assert.ok(regular.includes('SINGLERUN-001'))
  assert.equal(regular.includes('HORIZON-001'), false)
  assert.ok(horizon.includes('HORIZON-001'))
  assert.equal(horizon.includes('SINGLERUN-001'), false)
  assert.deepEqual(
    regular.filter((id) => id !== 'SINGLERUN-001'),
    horizon.filter((id) => id !== 'HORIZON-001'),
  )
})

test('long-horizon lookup values validate and distinguish otherwise equal rows', () => {
  const root = createFixture()

  writePolicyExtension(root, 'mode-pair.json', [
    {
      persona: 'planner',
      workflow: 'delivery',
      stage: 'plan',
      long_horizon: false,
      policies: ['PLAN-002'],
    },
    {
      persona: 'planner',
      workflow: 'delivery',
      stage: 'plan',
      long_horizon: true,
      policies: ['PLAN-002'],
    },
  ])

  assert.doesNotThrow(() =>
    resolvePolicies(root, {
      persona: 'planner',
      workflow: 'delivery',
      stage: 'plan',
    }),
  )

  const invalid = createFixture()

  writePolicyExtension(invalid, 'invalid-mode.json', [
    {
      persona: 'planner',
      workflow: 'delivery',
      stage: 'plan',
      long_horizon: 'yes',
      policies: ['PLAN-002'],
    },
  ])
  assert.throws(
    () =>
      resolvePolicies(invalid, {
        persona: 'planner',
        workflow: 'delivery',
        stage: 'plan',
      }),
    /long_horizon MUST be a boolean/u,
  )
})

test('a long-horizon provider cannot cover a regular consumer', () => {
  const root = createFixture()

  prepareValidationFixture(root)
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = readJson<{
    rows: Array<{
      persona: string
      workflow: string
      stage: string
      long_horizon?: boolean
      policies: string[]
    }>
  }>(lookupPath)

  lookup.rows = lookup.rows.map((row) => {
    if (row.persona === '*' && row.workflow === '*' && row.stage === '*') {
      return {
        ...row,
        policies: row.policies.filter((policy) => policy !== 'OPERATOR-001'),
      }
    }

    if (row.policies.includes('WAIVER-001')) {
      return { ...row, long_horizon: false }
    }

    return row
  })
  const provider = {
    persona: '*',
    workflow: '*',
    stage: '*',
    long_horizon: true,
    policies: ['OPERATOR-001'],
  }

  lookup.rows.push(provider)
  writeJsonFile(lookupPath, lookup)

  assert.match(
    validateRepository(root).errors.join('\n'),
    /loads WAIVER-001 without referenced policy OPERATOR-001/u,
  )

  delete (provider as { long_horizon?: boolean }).long_horizon
  writeJsonFile(lookupPath, lookup)

  assert.doesNotMatch(
    validateRepository(root).errors.join('\n'),
    /loads WAIVER-001 without referenced policy OPERATOR-001/u,
  )
})

test('mode governance explains every rule and carries the two canonical tables', () => {
  const catalog = loadPolicyCatalog(sharedFixture())
  const horizon = catalog.get('HORIZON-001')
  const regular = catalog.get('SINGLERUN-001')

  assert.ok(horizon)
  assert.ok(regular)
  assert.ok(
    horizon.instructions.every((instruction) =>
      /\bbecause\b/iu.test(instruction.text),
    ),
    'every long-horizon instruction states its reason',
  )
  assert.ok(
    horizon.instructions.some((instruction) =>
      /current models/iu.test(instruction.text),
    ),
    'model-limitation instructions identify the current limitation',
  )
  assert.ok(
    horizon.instructions.some((instruction) =>
      instruction.audience.includes('agent'),
    ),
  )

  const handbook = horizon.guidance?.[0]?.content ?? ''
  const tableHeader =
    '| Identifier | Source | Kind | What it decides | Mark | Reason |'

  assert.equal(
    handbook
      .split('\n')
      .filter((line) => line.replaceAll(/\s+/gu, ' ').trim() === tableHeader)
      .length,
    2,
  )
  assert.match(handbook, /\| LH-01\s+\|/u)
  assert.match(handbook, /\| LH-R4\s+\|/u)

  const policyText = (
    horizonPolicy: typeof horizon,
    regularPolicy: typeof regular,
  ): string =>
    [
      horizonPolicy.title,
      horizonPolicy.summary,
      ...horizonPolicy.instructions.map((instruction) => instruction.text),
      regularPolicy.title,
      regularPolicy.summary,
      ...regularPolicy.instructions.map((instruction) => instruction.text),
      handbook,
    ].join('\n')

  const policyIdPattern = /\b[A-Z][A-Z0-9]*-\d{3}\b/u

  assert.doesNotMatch(policyText(horizon, regular), policyIdPattern)
  assert.match(
    policyText({ ...horizon, title: 'HORIZON-999 mode' }, regular),
    policyIdPattern,
  )
})

// RV-05 of run 63290: this case reads files and matches sentences, which is
// the right instrument for a criterion that asks whether a sentence reaches a
// card or a prompt. The name claimed `validateRepository`, which it never
// called. Renamed to what it does; the governance-validation binding AC-006
// and AC-008 ask for is the separate case below.

// AC-006 and AC-008 are worded as governance validation binding the rule to
// its mechanism, and a grep is weaker than that. The directive audit inside
// `validateRepository` is the binding: it reports a MUST directive that names
// no owning policy, so removing the policy citation from the sentence has to
// make the audit notice.
test('governance validation binds the output-last rule to its owning policy', () => {
  const root = createFixture()
  const guidePath = path.join(root, 'library/skills/write-stage-output.md')
  const guide = readFileSync(guidePath, 'utf8')
  const owned = (report: { warnings: string[] }): string[] =>
    report.warnings.filter(
      (warning) =>
        warning.includes('unowned') &&
        warning.includes('write-stage-output.md'),
    )

  assert.match(guide, /`CONTRACT-001`: a worker MUST write its stage output/u)
  assert.deepEqual(owned(validateRepository(root)), [])

  writeFileSync(
    guidePath,
    guide.replace(
      '`CONTRACT-001`: a worker MUST write its stage output',
      'A worker MUST write its stage output',
    ),
  )

  const unowned = owned(validateRepository(root))

  assert.equal(unowned.length, 1, JSON.stringify(unowned))

  // The mechanism DELEGATE-001 names for AC-008 is a live error code rather
  // than prose, so the policy cannot drift from the failure it promises.
  assert.match(
    readFileSync(path.join(process.cwd(), 'src/lib/engine/submit.ts'), 'utf8'),
    /code: 'MODEL_EVIDENCE_MISMATCH'/u,
  )
})

test('repository validation rejects a verify field omitted from enforced_fields', () => {
  const root = createFixture()
  const contractPath = path.join(
    root,
    'library/schemas/stage-output-requirements.json',
  )

  const contract = readJson(contractPath) as Record<string, unknown>
  const stages = contract.stages as Record<string, Record<string, unknown>>
  const validators = stages.verify.validators as Array<Record<string, unknown>>
  const verify = validators.find(
    (entry) => entry.registry_id === 'VERIFY-VALIDATE-001',
  )

  assert.ok(verify)
  verify.enforced_fields = (verify.enforced_fields as string[]).filter(
    (field) => field !== 'data.verify.findings[].evidence[]',
  )
  writeJsonFile(contractPath, contract)

  const validation = validateRepository(root)

  assert.ok(
    validation.errors.some(
      (error) =>
        error.includes('stage output field contract') &&
        error.includes('data.verify.findings[].evidence[]'),
    ),
    validation.errors.join('\n'),
  )
})
