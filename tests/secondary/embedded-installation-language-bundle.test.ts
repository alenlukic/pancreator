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

// The installer generates the split shape itself: LANG-001 without handbooks,
// LANGSTYLE-001 carrying them, and one librarian style row beside the code
// rows. Read that shape from the install rather than construct it, so the
// refresh assertions stay anchored to what the installer actually produced.
function readInstalledSplitBundle(
  pancreatorDir: string,
): Array<{ path: string }> {
  const paths = bundlePaths(pancreatorDir)
  const sources = readJson<GeneratedPolicy>(paths.style).guidance_sources ?? []

  assert.equal(
    readJson<GeneratedPolicy>(paths.language).guidance_sources,
    undefined,
    'the installed bundle is split',
  )
  assert.ok(sources.length > 0, 'the installed style policy carries handbooks')
  assert.deepEqual(
    generatedPersonas(paths.lookup),
    [...CODE_PERSONAS, 'librarian'].sort(),
  )

  return sources
}

// A bundle generated before the split lands in one policy, and
// preserveLanguageGovernance must still carry that shape through a refresh
// untouched. No install produces it any more, so the pre-split fixture is
// folded back from the installed split bundle instead of assumed.
function unsplitInstalledBundle(
  pancreatorDir: string,
): Array<{ path: string }> {
  const paths = bundlePaths(pancreatorDir)
  const sources = readJson<GeneratedPolicy>(paths.style).guidance_sources ?? []

  assert.ok(sources.length > 0, 'the installed style policy carries handbooks')

  writeJson(paths.language, {
    ...readJson<GeneratedPolicy>(paths.language),
    guidance_sources: sources,
  })
  rmSync(paths.style)

  const lookup = readJson<LookupTable>(paths.lookup)

  lookup.rows = lookup.rows.filter(
    (row) => row.generated_by !== GENERATED_BY || row.stage === '*',
  )
  writeJson(paths.lookup, lookup)

  return sources
}

test('embedded refresh preserves a split target language bundle', () => {
  const project = cloneInstalledProject()
  const pancreatorDir = path.join(project, '.pancreator')
  const paths = bundlePaths(pancreatorDir)

  try {
    const sources = readInstalledSplitBundle(pancreatorDir)
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
    const sources = unsplitInstalledBundle(pancreatorDir)
    const handbook = readFileSync(paths.handbook, 'utf8')

    assert.ok(
      readJson<GeneratedPolicy>(paths.language).guidance_sources?.length,
      'the fixture bundle is pre-split',
    )
    assert.equal(existsSync(paths.style), false)
    writeFileSync(paths.handbook, `${handbook}${TARGET_NOTE}`)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(
      readJson<GeneratedPolicy>(paths.language).guidance_sources,
      sources,
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
