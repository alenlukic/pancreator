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
  // The generated bundle splits the same way the durable policies do:
  // LANG-001 keeps the toolchain instructions and references no handbook, and
  // LANGSTYLE-001 carries every style handbook for the batch pass alone.
  writeJson(path.join(root, 'governance', 'policies', 'LANG-001.json'), {
    id: 'LANG-001',
    title: 'Target language guidance',
    severity: 'hard',
    summary: 'Agents MUST apply target-derived language guidance.',
    instructions: ['Agents MUST apply this guidance when it is resolved.'],
    generated_by: GENERATED_BY,
  })
  writeJson(path.join(root, 'governance', 'policies', 'LANGSTYLE-001.json'), {
    id: 'LANGSTYLE-001',
    title: 'Target language style guidance',
    severity: 'hard',
    summary: 'Agents MUST apply target-derived language style guidance.',
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

  // The real generator rewrites its rows, so a rewritten bundle replaces the
  // previous one rather than stacking a second set of generated rows.
  lookup.rows = lookup.rows.filter((row) => row.generated_by !== GENERATED_BY)

  for (const persona of ['coder', 'qa-tester', 'reviewer', 'spotfixer']) {
    lookup.rows.push({
      persona,
      workflow: '*',
      stage: '*',
      policies,
      generated_by: GENERATED_BY,
    })
  }

  lookup.rows.push({
    persona: 'librarian',
    workflow: 'standalone',
    stage: 'style',
    policies: ['LANGSTYLE-001'],
    generated_by: GENERATED_BY,
  })

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

    // The same row passes once PY-001 joins it, so the policy is required
    // rather than merely unexpected.
    writeLanguageBundle(root, 'python', ['LANG-001', 'PY-001'])

    const accepted = validateTargetLanguageHandbooks(fixtureInput(root))

    assert.equal(accepted.status, 'passed')
    assert.deepEqual(accepted.issues, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a bundle that keeps the handbooks on LANG-001', () => {
  const root = createLanguageFixture()

  try {
    writeFileSync(path.join(root, 'target', 'tsconfig.json'), '{}\n')
    writeLanguageBundle(root)

    const policiesDirectory = path.join(root, 'governance', 'policies')
    const style = JSON.parse(
      readFileSync(path.join(policiesDirectory, 'LANGSTYLE-001.json'), 'utf8'),
    ) as { guidance_sources: unknown }
    const language = JSON.parse(
      readFileSync(path.join(policiesDirectory, 'LANG-001.json'), 'utf8'),
    ) as Record<string, unknown>

    language.guidance_sources = style.guidance_sources
    writeJson(path.join(policiesDirectory, 'LANG-001.json'), language)
    rmSync(path.join(policiesDirectory, 'LANGSTYLE-001.json'))

    const result = validateTargetLanguageHandbooks(fixtureInput(root))

    assert.equal(result.status, 'failed')
    assert.deepEqual(result.issues.map((item) => item.code).sort(), [
      'language.policy_missing',
      'language.policy_sources',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a bundle whose style policy reaches a delivery persona', () => {
  const root = createLanguageFixture()

  try {
    writeFileSync(path.join(root, 'target', 'tsconfig.json'), '{}\n')
    writeLanguageBundle(root)

    const lookupPath = path.join(
      root,
      'governance',
      'registries',
      'policy_lookup_table.json',
    )
    const lookup = JSON.parse(readFileSync(lookupPath, 'utf8')) as {
      rows: Array<Record<string, unknown>>
    }

    lookup.rows = lookup.rows.map((row) =>
      row.stage === 'style'
        ? { ...row, persona: 'coder', workflow: '*', stage: '*' }
        : row,
    )
    writeJson(lookupPath, lookup)

    const result = validateTargetLanguageHandbooks(fixtureInput(root))

    assert.equal(result.status, 'failed')
    assert.ok(
      result.issues.some((item) => item.code === 'language.style_lookup_row'),
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
