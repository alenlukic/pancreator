import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const INSTALL_SUPPORT = path.join(process.cwd(), 'bin', 'install-support')
const GENERATED_BY = 'pancreator-target-language-handbooks'
const HANDBOOK = 'governance/handbooks/target/typescript/style-guide.md'
const CODE_PERSONAS = ['coder', 'qa-tester', 'reviewer', 'spotfixer']

interface LookupTable {
  schema_version: number
  rows: Array<Record<string, unknown>>
}

interface BundleShape {
  split: boolean
  languageSources?: boolean
  codePersonas?: string[]
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function generatedPolicy(id: string, withSources: boolean) {
  return {
    id,
    title: 'Target language guidance',
    severity: 'hard',
    summary: 'Agents MUST apply target-derived language guidance.',
    instructions: ['Agents MUST apply this guidance when it is resolved.'],
    generated_by: GENERATED_BY,
    ...(withSources ? { guidance_sources: [{ path: HANDBOOK }] } : {}),
  }
}

function styleRow(): Record<string, unknown> {
  return {
    persona: 'librarian',
    workflow: 'standalone',
    stage: 'style',
    policies: ['LANGSTYLE-001'],
    generated_by: GENERATED_BY,
  }
}

function writeExistingBundle(root: string, shape: BundleShape): void {
  writeFileSync(
    path.join(root, HANDBOOK),
    '<!-- pancreator-target-language-handbook: typescript -->\n\n# TypeScript\n',
  )
  writeJson(
    path.join(root, 'governance', 'policies', 'LANG-001.json'),
    generatedPolicy('LANG-001', shape.languageSources ?? !shape.split),
  )

  if (shape.split) {
    writeJson(
      path.join(root, 'governance', 'policies', 'LANGSTYLE-001.json'),
      generatedPolicy('LANGSTYLE-001', true),
    )
  }

  const rows: Array<Record<string, unknown>> = [
    { persona: '*', workflow: '*', stage: '*', policies: ['GLOBAL-001'] },
    ...(shape.codePersonas ?? CODE_PERSONAS).map((persona) => ({
      persona,
      workflow: '*',
      stage: '*',
      policies: ['LANG-001'],
      generated_by: GENERATED_BY,
    })),
  ]

  if (shape.split) {
    rows.push(styleRow())
  }

  writeJson(
    path.join(root, 'governance', 'registries', 'policy_lookup_table.json'),
    { schema_version: 1, rows },
  )
}

// The staged payload carries the source checkout's own split bundle, so the
// preservation step must replace it rather than merge with it.
function writeStagedPayload(root: string): void {
  writeJson(
    path.join(root, 'governance', 'policies', 'LANGSTYLE-001.json'),
    generatedPolicy('LANGSTYLE-001', true),
  )
  writeJson(
    path.join(root, 'governance', 'registries', 'policy_lookup_table.json'),
    {
      schema_version: 1,
      rows: [
        { persona: '*', workflow: '*', stage: '*', policies: ['GLOBAL-001'] },
        styleRow(),
      ],
    },
  )
}

function preserve(existingRoot: string, stagingRoot: string): void {
  const result = spawnSync(
    process.execPath,
    [
      INSTALL_SUPPORT,
      'preserve-language-governance',
      '--existing-root',
      existingRoot,
      '--staging-root',
      stagingRoot,
    ],
    { encoding: 'utf8' },
  )

  assert.equal(result.status, 0, result.stderr)
}

function generatedPersonas(stagingRoot: string): string[] {
  const lookup = readJson<LookupTable>(
    path.join(
      stagingRoot,
      'governance',
      'registries',
      'policy_lookup_table.json',
    ),
  )

  return lookup.rows
    .filter((row) => row.generated_by === GENERATED_BY)
    .map((row) => String(row.persona))
}

function withRoots(
  shape: BundleShape,
  check: (existingRoot: string, stagingRoot: string) => void,
): void {
  const root = createTestTempDirectory('pancreator-language-bundle-')
  const existingRoot = path.join(root, 'existing')
  const stagingRoot = path.join(root, 'staging')

  try {
    mkdirSync(path.dirname(path.join(existingRoot, HANDBOOK)), {
      recursive: true,
    })
    writeExistingBundle(existingRoot, shape)
    writeStagedPayload(stagingRoot)
    preserve(existingRoot, stagingRoot)
    check(existingRoot, stagingRoot)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a split language bundle survives the staged refresh intact', () => {
  withRoots({ split: true }, (existingRoot, stagingRoot) => {
    const policies = path.join(stagingRoot, 'governance', 'policies')

    assert.equal(
      readFileSync(path.join(stagingRoot, HANDBOOK), 'utf8'),
      readFileSync(path.join(existingRoot, HANDBOOK), 'utf8'),
    )
    assert.equal(
      readJson<{ guidance_sources?: unknown }>(
        path.join(policies, 'LANG-001.json'),
      ).guidance_sources,
      undefined,
    )
    assert.deepEqual(
      readJson<{ guidance_sources: unknown }>(
        path.join(policies, 'LANGSTYLE-001.json'),
      ).guidance_sources,
      [{ path: HANDBOOK }],
    )
    assert.deepEqual(generatedPersonas(stagingRoot), [
      ...CODE_PERSONAS,
      'librarian',
    ])
  })
})

test('a pre-split language bundle survives and drops the staged style policy', () => {
  withRoots({ split: false }, (_existingRoot, stagingRoot) => {
    const policies = path.join(stagingRoot, 'governance', 'policies')

    assert.equal(existsSync(path.join(stagingRoot, HANDBOOK)), true)
    assert.deepEqual(
      readJson<{ guidance_sources: unknown }>(
        path.join(policies, 'LANG-001.json'),
      ).guidance_sources,
      [{ path: HANDBOOK }],
    )
    assert.equal(existsSync(path.join(policies, 'LANGSTYLE-001.json')), false)
    assert.deepEqual(generatedPersonas(stagingRoot), CODE_PERSONAS)
  })
})

test('a split bundle whose LANG-001 still carries the handbooks is rebuilt', () => {
  withRoots(
    { split: true, languageSources: true },
    (_existingRoot, stagingRoot) => {
      assert.equal(existsSync(path.join(stagingRoot, HANDBOOK)), false)
      assert.equal(
        existsSync(
          path.join(stagingRoot, 'governance', 'policies', 'LANG-001.json'),
        ),
        false,
      )
      assert.deepEqual(generatedPersonas(stagingRoot), ['librarian'])
    },
  )
})

test('a bundle with code rows outside the generator persona set is rebuilt', () => {
  withRoots(
    { split: true, codePersonas: [...CODE_PERSONAS, 'verifier'] },
    (_existingRoot, stagingRoot) => {
      assert.equal(existsSync(path.join(stagingRoot, HANDBOOK)), false)
      assert.deepEqual(generatedPersonas(stagingRoot), ['librarian'])
    },
  )
})
