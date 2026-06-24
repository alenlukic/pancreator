import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateRepository } from '../../src/lib/validation.js'
import { createFixture } from '../helpers.js'

function prepareValidationFixture(root: string): void {
  mkdirSync(path.join(root, 'tests'), { recursive: true })
  writeFileSync(path.join(root, 'prettier.config.js'), 'export default {}\n')
  writeFileSync(path.join(root, 'tsconfig.json'), '{}\n')
  writeFileSync(path.join(root, 'src', 'cli.ts'), 'export {}\n')
}

test('repository validation requires a policy to reference each engineering handbook', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policyPath = path.join(root, 'governance', 'policies', 'ENG-001.json')
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    summary: string
    instructions: string[]
  }

  policy.summary = policy.summary.replace(
    'governance/handbooks/eng/engineering.md',
    'the engineering handbook',
  )
  policy.instructions = policy.instructions.map((instruction) =>
    instruction.replace(
      'governance/handbooks/eng/engineering.md',
      'the engineering handbook',
    ),
  )

  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /governance\/handbooks\/eng\/engineering\.md MUST be referenced by at least one policy/u,
  )
})

test('repository validation requires code-review and QA stages to load engineering handbook policies', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(root, 'governance', 'policy_lookup_table.json')
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

test('repository validation requires a policy to reference the TypeScript handbook', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const policyPath = path.join(root, 'governance', 'policies', 'TS-001.json')
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    summary: string
    instructions: string[]
  }

  policy.summary = policy.summary.replace(
    'governance/handbooks/typescript/style-guide.md',
    'the TypeScript style guide',
  )
  policy.instructions = policy.instructions.map((instruction) =>
    instruction.replace(
      'governance/handbooks/typescript/style-guide.md',
      'the TypeScript style guide',
    ),
  )

  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)

  const result = validateRepository(root)

  assert.equal(result.ok, false)
  assert.match(
    result.errors.join('\n'),
    /governance\/handbooks\/typescript\/style-guide\.md MUST be referenced by at least one policy/u,
  )
})

test('repository validation requires code-review and QA stages to load TypeScript handbook policies', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const lookupPath = path.join(root, 'governance', 'policy_lookup_table.json')
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

test('repository validation requires standalone Cursor agents in every pipeline config', () => {
  const root = createFixture()
  prepareValidationFixture(root)
  const configPath = path.join(root, 'pipeline.config.json')
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
