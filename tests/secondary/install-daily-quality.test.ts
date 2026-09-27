/**
 * Secondary-lane tests for the daily quality installer exemption and the
 * self_development_only schedule strip.
 */
import assert from 'node:assert/strict'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createReleaseFixture,
  git,
  makeSkeletonProject,
  readJson,
  runInstaller,
  type InstallMarker,
} from './install-helpers.js'

/** Commit one source change on the release fixture, marked or not. */
function commitSourceChange(source: string, id: string | null): string {
  writeFileSync(
    path.join(source, 'src', 'daily-sample.ts'),
    'export const dailySample = true\n',
  )
  git(source, ['add', 'src/daily-sample.ts'])
  git(source, [
    'commit',
    '-qm',
    id === null
      ? 'feat: unreleased change'
      : `style: daily conform and style pass 2026-09-26\n\nPancreator-Daily-Quality: ${id}`,
  ])

  return git(source, ['rev-parse', 'HEAD'])
}

test('embedded install strips self_development_only jobs from staged config.json', () => {
  const project = makeSkeletonProject()
  const result = runInstaller(project)

  assert.equal(result.status, 0, `installer failed: ${result.stderr}`)

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

test('install accepts drift of only marked daily commits and records daily_quality_head', () => {
  const source = createReleaseFixture()
  const project = makeSkeletonProject()

  try {
    const indexed = git(source, ['rev-parse', 'HEAD^'])
    const head = commitSourceChange(source, 'occ-install')
    const result = runInstaller(project, ['--pancreator-root', source])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Accepted 1 daily quality commit\(s\)/u)

    const marker = readJson<InstallMarker & { daily_quality_head?: string }>(
      path.join(project, '.pancreator', 'install.json'),
    )

    assert.equal(marker.daily_quality_head, head)
    assert.equal(marker.source_commit, indexed)
    assert.equal(marker.source_indexed, true)
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
})

test('install refuses drift that holds an unmarked installable commit', () => {
  const source = createReleaseFixture()
  const project = makeSkeletonProject()

  try {
    commitSourceChange(source, null)

    const result = runInstaller(project, ['--pancreator-root', source])

    assert.equal(result.status, 1)
    assert.match(result.stderr, /differ from indexed release/u)
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'install.json')),
      false,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
})
