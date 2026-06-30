import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  isSemanticVersion,
  nextSemanticVersion,
  validateReleaseMetadata,
} from '../../src/lib/versioning.js'
import { createFixture } from '../helpers.js'

test('Semantic Versioning accepts complete versions and rejects abbreviated versions', () => {
  assert.equal(isSemanticVersion('2.0.0'), true)
  assert.equal(isSemanticVersion('2.1.0-rc.1+build.4'), true)
  assert.equal(isSemanticVersion('2.0'), false)
  assert.equal(isSemanticVersion('02.0.0'), false)
})

test('Semantic Versioning bump calculation returns exact next stable versions', () => {
  assert.equal(nextSemanticVersion('2.7.4', 'major'), '3.0.0')
  assert.equal(nextSemanticVersion('2.7.4', 'minor'), '2.8.0')
  assert.equal(nextSemanticVersion('2.7.4', 'patch'), '2.7.5')
  assert.equal(nextSemanticVersion('invalid', 'patch'), null)
})

test('release metadata validation requires synchronized version files', () => {
  const root = createFixture()
  const packagePath = path.join(root, 'package.json')
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    version: string
  }

  packageJson.version = '2.0.1'
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

  const result = validateReleaseMetadata(root)

  assert.match(
    result.errors.join('\n'),
    /package\.json\.version MUST match VERSION/u,
  )
})

test('release metadata validation requires the changelog latest release to match VERSION', () => {
  const root = createFixture()
  const version = readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const changelogPath = path.join(root, 'CHANGELOG.md')
  const changelog = readFileSync(changelogPath, 'utf8').replace(
    /^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}$/mu,
    '## [999.0.0] - 2099-01-01',
  )

  writeFileSync(changelogPath, changelog)

  const result = validateReleaseMetadata(root)

  assert.ok(
    result.errors.includes(
      `CHANGELOG.md latest release MUST match VERSION (${version})`,
    ),
  )
})

test('release metadata validation requires version-bearing docs to match VERSION', () => {
  const root = createFixture()
  const readmePath = path.join(root, 'README.md')
  const readme = readFileSync(readmePath, 'utf8').replace(
    /^# Pancreator v[^\s]+$/mu,
    '# Pancreator v999.0.0',
  )

  writeFileSync(readmePath, readme)

  const result = validateReleaseMetadata(root)

  assert.ok(
    result.errors.includes('README.md heading version MUST match VERSION'),
  )
})
