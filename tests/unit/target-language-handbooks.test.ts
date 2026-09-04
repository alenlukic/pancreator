import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateTargetLanguageHandbooks } from '../../src/lib/validators/target-language-handbooks.js'
import { createTestTempDirectory } from '../temp.js'

const GENERATED_BY = 'pancreator-target-language-handbooks'

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function createLanguageFixture(): string {
  const root = createTestTempDirectory('pancreator-language-handbook-')

  writeJson(path.join(root, 'config.json'), {
    schema_version: 1,
    workspace_root: 'target',
    installation_mode: 'embedded',
  })
  writeJson(
    path.join(root, 'governance', 'registries', 'policy_lookup_table.json'),
    {
      schema_version: 1,
      rows: [],
    },
  )
  mkdirSync(path.join(root, 'target'), { recursive: true })

  return root
}

function writeLanguageBundle(
  root: string,
  language = 'typescript',
  policies = ['LANG-001'],
): void {
  const handbookRoot = path.join(
    root,
    'governance',
    'handbooks',
    'target',
    language,
  )
  mkdirSync(handbookRoot, { recursive: true })
  writeFileSync(
    path.join(handbookRoot, 'style-guide.md'),
    `<!-- pancreator-target-language-handbook: ${language} -->\n\n# ${language}\n`,
  )
  writeJson(path.join(root, 'governance', 'policies', 'LANG-001.json'), {
    id: 'LANG-001',
    title: 'Target language guidance',
    severity: 'hard',
    summary: 'Agents MUST apply target-derived language guidance.',
    instructions: ['Agents MUST apply this guidance when it is resolved.'],
    generated_by: GENERATED_BY,
    guidance_sources: [
      {
        path: `governance/handbooks/target/${language}/style-guide.md`,
      },
    ],
  })

  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup_table.json',
  )
  const lookup = JSON.parse(readFileSync(lookupPath, 'utf8')) as {
    rows: Array<Record<string, unknown>>
  }

  for (const persona of ['coder', 'qa-tester', 'reviewer', 'spotfixer']) {
    lookup.rows.push({
      persona,
      workflow: '*',
      stage: '*',
      policies,
      generated_by: GENERATED_BY,
    })
  }

  writeJson(lookupPath, lookup)
}

function fixtureInput(root: string) {
  return {
    root,
    targetPath: 'docs/target-repo-primer.md',
    requirement: {
      policy_id: 'PRIMER-001',
      requirement_id: 'target-language-handbook-validate',
      registry_id: 'TARGET-LANGUAGE-HANDBOOK-VALIDATE-001',
      arguments: {},
    },
  }
}

test('validates exact embedded target language handbook coverage', () => {
  const root = createLanguageFixture()

  try {
    writeFileSync(path.join(root, 'target', 'tsconfig.json'), '{}\n')
    writeLanguageBundle(root)

    const result = validateTargetLanguageHandbooks(fixtureInput(root))

    assert.equal(result.status, 'passed')
    assert.deepEqual(result.issues, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accepts required supplemental policies in generated Python rows', () => {
  const root = createLanguageFixture()

  try {
    writeFileSync(path.join(root, 'target', 'pyproject.toml'), '[project]\n')
    writeLanguageBundle(root, 'python', ['LANG-001', 'PY-001'])

    const result = validateTargetLanguageHandbooks(fixtureInput(root))

    assert.equal(result.status, 'passed')
    assert.deepEqual(result.issues, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a generated Python row that omits PY-001', () => {
  const root = createLanguageFixture()

  try {
    writeFileSync(path.join(root, 'target', 'pyproject.toml'), '[project]\n')
    writeLanguageBundle(root, 'python')

    const result = validateTargetLanguageHandbooks(fixtureInput(root))

    assert.equal(result.status, 'failed')
    assert.ok(
      result.issues.some((item) => item.code === 'language.lookup_rows'),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects stale marked target language handbooks', () => {
  const root = createLanguageFixture()

  try {
    writeFileSync(path.join(root, 'target', 'tsconfig.json'), '{}\n')
    writeLanguageBundle(root)
    const staleRoot = path.join(
      root,
      'governance',
      'handbooks',
      'target',
      'python',
    )
    mkdirSync(staleRoot, { recursive: true })
    writeFileSync(
      path.join(staleRoot, 'style-guide.md'),
      '<!-- pancreator-target-language-handbook: python -->\n',
    )

    const result = validateTargetLanguageHandbooks(fixtureInput(root))

    assert.equal(result.status, 'failed')
    assert.ok(
      result.issues.some((item) => item.code === 'language.handbook_coverage'),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
