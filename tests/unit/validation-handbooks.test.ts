import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateRepository } from '../../src/lib/validation.js'
import { createFixture } from '../fixture-template.js'
import {
  assertEachDiagnostic,
  prepareValidationFixture,
  readJson,
  writeJsonFile,
} from './validation-helpers.js'

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

  for (const policyId of [
    'ENG-001',
    'TS-001',
    'TSTYLE-001',
    'DESIGN-001',
    'PYSTYLE-001',
  ]) {
    const policyPath = path.join(policiesDirectory, `${policyId}.json`)
    const policy = readJson<{ guidance_sources?: unknown[] }>(policyPath)

    delete policy.guidance_sources
    writeJsonFile(policyPath, policy)
  }

  const actionPath = path.join(policiesDirectory, 'ACTION-001.json')
  const action = readJson<{ instructions: string[] }>(actionPath)

  action.instructions.push(
    'Agents MUST apply library/skills/spotfix.md before completion.',
  )
  writeJsonFile(actionPath, action)

  // WAIVER-001 references OPERATOR-001, so this removal breaks the dependency.
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

  // The next two mutations mask the diagnostics above, so they run as a
  // second pass on the same fixture.
  lookup.rows.push({
    persona: 'coder',
    workflow: '*',
    stage: '*',
    technology: 'ruby',
    policies: ['ENG-001'],
  })
  writeJsonFile(lookupPath, lookup)

  const config = readJson<{
    defaults: Record<string, string>
    configs: Record<string, Record<string, unknown>>
  }>(configPath)

  delete config.configs.auto?.planner

  if (
    typeof config.configs.auto?.personas === 'object' &&
    config.configs.auto.personas !== null
  ) {
    delete (config.configs.auto.personas as Record<string, unknown>).planner
  }
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
      'TypeScript handbook on code-review and QA stages',
      /workflow stage 'delivery\/implement' persona 'coder' MUST load a policy for the TypeScript handbook/u,
    ],
    [
      'design handbook on design stages',
      /workflow stage 'design\/test' persona 'design-qa' MUST load a policy for the design handbook/u,
    ],
  ])

  // The style handbooks belong to the batch pass, so a delivery stage that
  // resolves no style policy is correct rather than a diagnostic.
  assert.doesNotMatch(
    result.errors.join('\n'),
    /MUST load a policy for the (?:TypeScript|Python) style handbook/u,
  )
})

test('repository validation requires the style mode to load both style handbooks', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = readJson<{ rows: Array<{ stage: string }> }>(lookupPath)

  lookup.rows = lookup.rows.filter((row) => row.stage !== 'style')
  writeJsonFile(lookupPath, lookup)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assertEachDiagnostic(result.errors, [
    [
      'TypeScript style handbook on the style mode',
      /standalone mode 'style' MUST load a policy for the TypeScript style handbook/u,
    ],
    [
      'Python style handbook on the style mode',
      /standalone mode 'style' MUST load a policy for the Python style handbook/u,
    ],
  ])
})

test('embedded repository validation excludes self-development authoring audits', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  mkdirSync(path.join(root, 'tests', 'unit'), { recursive: true })
  writeFileSync(path.join(root, 'tests', 'unit', 'placeholder.test.ts'), '')

  writeJsonFile(
    path.join(root, 'governance', 'policies', 'HARNESS-COVERAGE-001.json'),
    {
      id: 'HARNESS-COVERAGE-001',
      title: 'Harness instruction coverage',
      severity: 'hard',
      summary: 'Agents MUST preserve embedded installation cleanliness.',
      instructions: [
        { text: 'The harness MUST do the thing.', audience: ['harness'] },
      ],
    },
  )

  const result = validateRepository(root)

  assert.doesNotMatch(
    result.errors.join('\n'),
    /MUST load a policy for the TypeScript handbook/u,
  )
  assert.doesNotMatch(result.errors.join('\n'), /stale disposition evidence/u)
  assert.doesNotMatch(result.warnings.join('\n'), /unowned advisory directive/u)
  assert.doesNotMatch(
    result.errors.join('\n'),
    /HARNESS-COVERAGE-001 harness instruction 1 MUST reference/u,
  )
})

// The coverage check reads the policy catalog it is handed and the cited files
// under `root`, so the cases below hand it a one-policy catalog over a scratch
// tests/ tree. Driving the same rules through validateRepository cost a fixture
