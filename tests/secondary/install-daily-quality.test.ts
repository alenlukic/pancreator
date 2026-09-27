/**
 * Secondary-lane tests for the daily quality installer exemption and the
 * self_development_only schedule strip.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  makeSkeletonProject,
  readJson,
  runInstaller,
} from './install-helpers.js'

const REPO_ROOT = process.cwd()
const SURFACES_PATH = 'governance/registries/daily_quality_surfaces.json'

/**
 * Regression: the surfaces file must cover every editable conform surface and
 * every extension code-style scans. This test reads both source files and the
 * surfaces registry and asserts coverage.
 */
test('surfaces file covers every editable conform surface and style extension', () => {
  const surfacesPath = path.join(REPO_ROOT, SURFACES_PATH)
  const conformPath = path.join(REPO_ROOT, 'src', 'lib', 'conform.ts')
  const codestylePath = path.join(REPO_ROOT, 'src', 'lib', 'code-style.ts')

  assert.ok(
    existsSync(surfacesPath),
    `surfaces file not found: ${surfacesPath}`,
  )
  assert.ok(existsSync(conformPath), `conform.ts not found`)
  assert.ok(existsSync(codestylePath), `code-style.ts not found`)

  const surfaces = JSON.parse(readFileSync(surfacesPath, 'utf8')) as {
    conform_paths: string[]
    style_extensions: string[]
  }

  // Known conform surfaces from src/lib/conform.ts.
  const expectedConformSurfaces = [
    'AGENTS.md',
    'governance/criteria/',
    'governance/policies/',
    'library/cursor/commands/',
    'library/cursor/rules/',
    'library/personas/',
    'library/skills/',
    'docs/issues/',
  ]

  for (const surface of expectedConformSurfaces) {
    const covered = surfaces.conform_paths.some(
      (pattern) =>
        pattern.startsWith(surface.replace(/\/$/, '')) ||
        pattern === surface ||
        surface.startsWith(pattern.replace(/\/\*.*$/, '/')),
    )

    assert.ok(
      covered,
      `conform surface '${surface}' not covered by surfaces file`,
    )
  }

  // Known style extensions from src/lib/technologies.ts.
  const expectedStyleExtensions = [
    '.ts',
    '.tsx',
    '.py',
    '.pyi',
    '.js',
    '.mjs',
    '.cjs',
  ]

  for (const ext of expectedStyleExtensions) {
    assert.ok(
      surfaces.style_extensions.includes(ext),
      `style extension '${ext}' not in surfaces file`,
    )
  }
})

test('embedded install strips self_development_only jobs from staged config.json', () => {
  const project = makeSkeletonProject()
  const result = runInstaller(project)

  assert.equal(result.status, 0, `installer failed: ${result.stderr}`)

  // Verify the staged config.json does not have self_development_only jobs.
  const harnessCfg = path.join(project, '.pancreator', 'config.json')

  assert.ok(existsSync(harnessCfg), `config.json not found: ${harnessCfg}`)

  const config = readJson<{ schedule?: { enabled: boolean; jobs: unknown[] } }>(
    harnessCfg,
  )

  const jobs = config.schedule?.jobs ?? []
  const selfDevJobs = jobs.filter(
    (j): j is { self_development_only: boolean } =>
      typeof j === 'object' &&
      j !== null &&
      (j as Record<string, unknown>).self_development_only === true,
  )

  assert.equal(
    selfDevJobs.length,
    0,
    'embedded install must not include self_development_only jobs',
  )
})
