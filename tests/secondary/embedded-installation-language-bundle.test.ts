import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  cloneInstalledProject,
  readJson,
  runInstaller,
} from './install-helpers.js'

const GENERATED_BY = 'pancreator-target-language-handbooks'
const CODE_PERSONAS = ['coder', 'qa-tester', 'reviewer', 'spotfixer']
const TARGET_NOTE = '\nThis target prefers explicit return types.\n'

interface GeneratedPolicy {
  id: string
  generated_by: string
  guidance_sources?: Array<{ path: string }>
  [key: string]: unknown
}

interface LookupTable {
  schema_version: number
  rows: Array<Record<string, unknown>>
}

function bundlePaths(pancreatorDir: string) {
  const policies = path.join(pancreatorDir, 'governance', 'policies')

  return {
    language: path.join(policies, 'LANG-001.json'),
    style: path.join(policies, 'LANGSTYLE-001.json'),
    lookup: path.join(
      pancreatorDir,
      'governance',
      'registries',
      'policy_lookup_table.json',
    ),
    handbook: path.join(
      pancreatorDir,
      'governance',
      'handbooks',
      'target',
      'typescript',
      'style-guide.md',
    ),
  }
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function generatedPersonas(lookupPath: string): string[] {
  return readJson<LookupTable>(lookupPath)
    .rows.filter((row) => row.generated_by === GENERATED_BY)
    .map((row) => String(row.persona))
    .sort()
}

// Rewrite the installed pre-split bundle into the shape /pan-build-docs now
// generates: LANG-001 without handbooks, LANGSTYLE-001 carrying them, and one
// librarian style row beside the code rows.
function splitInstalledBundle(pancreatorDir: string): Array<{ path: string }> {
  const paths = bundlePaths(pancreatorDir)
  const language = readJson<GeneratedPolicy>(paths.language)
  const sources = language.guidance_sources ?? []

  assert.ok(sources.length > 0, 'the installed bundle carries handbooks')

  writeJson(paths.style, {
    ...language,
    id: 'LANGSTYLE-001',
    title: 'Target language style guidance',
  })
  delete language.guidance_sources
  writeJson(paths.language, language)

  const lookup = readJson<LookupTable>(paths.lookup)

  lookup.rows.push({
    persona: 'librarian',
    workflow: 'standalone',
    stage: 'style',
    policies: ['LANGSTYLE-001'],
    generated_by: GENERATED_BY,
  })
  writeJson(paths.lookup, lookup)

  return sources
}

test('embedded refresh preserves a split target language bundle', () => {
  const project = cloneInstalledProject()
  const pancreatorDir = path.join(project, '.pancreator')
  const paths = bundlePaths(pancreatorDir)

  try {
    const sources = splitInstalledBundle(pancreatorDir)
    const handbook = readFileSync(paths.handbook, 'utf8')

    writeFileSync(paths.handbook, `${handbook}${TARGET_NOTE}`)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      readJson<GeneratedPolicy>(paths.language).guidance_sources,
      undefined,
      'LANG-001 MUST keep declaring no guidance source',
    )
    assert.deepEqual(
      readJson<GeneratedPolicy>(paths.style).guidance_sources,
      sources,
      'LANGSTYLE-001 MUST survive with the handbook sources',
    )
    assert.equal(
      readFileSync(paths.handbook, 'utf8'),
      `${handbook}${TARGET_NOTE}`,
      'the target-derived handbook MUST survive the refresh',
    )
    assert.deepEqual(
      generatedPersonas(paths.lookup),
      [...CODE_PERSONAS, 'librarian'].sort(),
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded refresh preserves a pre-split target language bundle', () => {
  const project = cloneInstalledProject()
  const pancreatorDir = path.join(project, '.pancreator')
  const paths = bundlePaths(pancreatorDir)

  try {
    const language = readJson<GeneratedPolicy>(paths.language)
    const handbook = readFileSync(paths.handbook, 'utf8')

    assert.ok(
      language.guidance_sources?.length,
      'the installed bundle is pre-split',
    )
    assert.equal(existsSync(paths.style), false)
    writeFileSync(paths.handbook, `${handbook}${TARGET_NOTE}`)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(
      readJson<GeneratedPolicy>(paths.language).guidance_sources,
      language.guidance_sources,
    )
    assert.equal(existsSync(paths.style), false)
    assert.equal(
      readFileSync(paths.handbook, 'utf8'),
      `${handbook}${TARGET_NOTE}`,
      'the target-derived handbook MUST survive the refresh',
    )
    assert.deepEqual(generatedPersonas(paths.lookup), CODE_PERSONAS)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
