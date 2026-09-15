import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  validateHarnessInstructionCoverage,
  validateRepository,
} from '../../src/lib/validation.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'
import type { Policy, PolicyRequirement } from '../../src/lib/types.js'
import {
  assertEachDiagnostic,
  prepareValidationFixture,
  readJson,
  writeJsonFile,
} from './validation-helpers.js'

function coveragePolicy(
  id: string,
  instructions: string[],
  requirements: PolicyRequirement[] = [],
): Map<string, Policy> {
  return new Map([
    [
      id,
      {
        id,
        title: 'Harness instruction coverage',
        severity: 'hard',
        summary: 'Agents MUST preserve deterministic coverage mappings.',
        instructions: instructions.map((text) => ({
          text,
          audience: ['harness' as const],
        })),
        requirements,
      },
    ],
  ])
}

test('harness instruction coverage maps every rule to one declared test', () => {
  const root = createTestTempDirectory('harness-coverage-')
  const stageScaffold: PolicyRequirement = {
    id: 'stage-scaffold',
    registry_id: 'STAGE-SCAFFOLD-001',
    phase: 'before_operation',
    executor: 'agent',
    target: 'invocation.output.path',
    enforcement: 'advisory',
    failure_route: 'retry',
    evidence_class: 'validation-result',
  }
  const coverageErrors = (instruction: string): string[] =>
    validateHarnessInstructionCoverage(
      root,
      coveragePolicy('HARNESS-COVERAGE-001', [instruction], [stageScaffold]),
    )

  assert.match(
    coverageErrors('The harness MUST do the thing.').join('\n'),
    /HARNESS-COVERAGE-001 harness instruction 1 MUST reference a same-policy requirement id or a `tests\/<path>::<test name>` citation/u,
  )

  mkdirSync(path.join(root, 'tests', 'unit'), { recursive: true })
  assert.match(
    coverageErrors('The harness MUST cover `tests/unit/mapped.test.ts`.').join(
      '\n',
    ),
    /cites tests\/unit\/mapped\.test\.ts without naming the test that enforces it/u,
    'a bare path names no enforcing test',
  )
  assert.match(
    coverageErrors(
      'The harness MUST cover `tests/unit/missing.test.ts::a mapped case`.',
    ).join('\n'),
    /cites tests\/unit\/missing\.test\.ts, which is not a test file/u,
  )

  writeFileSync(
    path.join(root, 'tests', 'unit', 'mapped.test.ts'),
    "import { execFileSync } from 'node:child_process'\n\n" +
      "test('a mapped case', () => {})\n",
  )

  assert.match(
    coverageErrors(
      'The harness MUST cover `tests/unit/mapped.test.ts::an absent case`.',
    ).join('\n'),
    /cites test 'an absent case', which tests\/unit\/mapped\.test\.ts does not declare/u,
    'an existing file does not vouch for a test it never declares',
  )
  assert.match(
    coverageErrors(
      'The harness MUST cover `tests/unit/mapped.test.ts::node:child_process`.',
    ).join('\n'),
    /cites test 'node:child_process', which tests\/unit\/mapped\.test\.ts does not declare/u,
    'an import specifier is a quoted string, not a declared enforcer',
  )
  assert.deepEqual(
    coverageErrors(
      'The harness MUST cover `tests/unit/mapped.test.ts::a mapped case`.',
    ),
    [],
  )
  assert.equal(
    coverageErrors('The harness MUST run stage-scaffolding.').length,
    1,
    'a near-miss requirement token is not a mapping',
  )
  assert.deepEqual(coverageErrors('The harness MUST run stage-scaffold.'), [])

  writeFileSync(
    path.join(root, 'tests', 'unit', 'shared.test.ts'),
    "test('the shared case', () => {})\n",
  )

  assert.match(
    validateHarnessInstructionCoverage(
      root,
      coveragePolicy('HARNESS-SHARE-001', [
        'The harness MUST do the first thing (`tests/unit/shared.test.ts::the shared case`).',
        'The harness MUST do the second thing (`tests/unit/shared.test.ts::the shared case`).',
      ]),
    ).join('\n'),
    /HARNESS-SHARE-001 harness instruction 2 repeats the coverage citation tests\/unit\/shared\.test\.ts::the shared case, which instruction 1 already claims/u,
  )
})

test('repository validation rejects a policy no lookup row delivers', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = readJson<{
    rows: Array<{ persona: string; policies: string[] }>
  }>(lookupPath)

  // BIN-001 lost every lookup row once, and repository validation stayed green.
  assert.ok(
    lookup.rows.some((row) => row.policies.includes('BIN-001')),
    'the fixture starts with a BIN-001 row',
  )

  lookup.rows = lookup.rows
    .map((row) => ({
      ...row,
      policies: row.policies.filter((policy) => policy !== 'BIN-001'),
    }))
    .filter((row) => row.policies.length > 0)
  writeJsonFile(lookupPath, lookup)

  assertEachDiagnostic(validateRepository(root).errors, [
    [
      'orphan policy',
      /BIN-001 is in the policy catalog and no policy lookup row names it/u,
    ],
    [
      'undelivered audience',
      /BIN-001 carries audience 'agent' and no policy lookup row renders a card at audience agent or supervisor/u,
    ],
  ])
})

test('repository validation rejects an audience that reaches no card', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policyPath = path.join(root, 'governance', 'policies', 'ORCH-001.json')
  const policy = readJson<{ instructions: unknown[] }>(policyPath)
  const supervisorOnly = [...policy.instructions]

  // `operator` is a write-only tag: no code path renders a card at that
  // audience, so an instruction carrying it reaches nobody.
  policy.instructions = [
    ...supervisorOnly,
    {
      text: 'Agents MUST apply the operator-only fixture rule.',
      audience: ['operator'],
    },
  ]
  writeJsonFile(policyPath, policy)

  assert.match(
    validateRepository(root).errors.join('\n'),
    /ORCH-001 carries audience 'operator', which no card producer renders/u,
  )

  // A `supervisor` audience has a producer, but only a supervisor row delivers
  // it. ENG-001 resolves on worker rows alone.
  const engPath = path.join(root, 'governance', 'policies', 'ENG-001.json')
  const eng = readJson<{ instructions: unknown[] }>(engPath)

  policy.instructions = supervisorOnly
  writeJsonFile(policyPath, policy)
  eng.instructions = [
    ...eng.instructions,
    {
      text: 'Supervisors MUST apply the supervisor-only fixture rule.',
      audience: ['supervisor'],
    },
  ]
  writeJsonFile(engPath, eng)

  assert.match(
    validateRepository(root).errors.join('\n'),
    /ENG-001 carries audience 'supervisor' and no policy lookup row renders a card at audience supervisor/u,
  )
})

test('repository validation rejects a lookup row that renders no instruction', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policyPath = path.join(root, 'governance', 'policies', 'PAIR-001.json')
  const policy = readJson<{ instructions: Array<{ text: string }> }>(policyPath)

  // Every instruction tagged `harness` empties the card the row promises.
  policy.instructions = policy.instructions.map((instruction) => ({
    text:
      typeof instruction === 'string'
        ? instruction
        : (instruction as { text: string }).text,
    audience: ['harness'],
  })) as never

  writeJsonFile(policyPath, policy)

  assert.match(
    validateRepository(root).errors.join('\n'),
    /loads PAIR-001, whose instruction list is empty at card audience agent/u,
  )
})
