import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  isSemanticVersion,
  validateReleaseMetadata,
} from '../../src/lib/versioning.js'
import { createFixture } from '../helpers.js'

test('Semantic Versioning accepts complete versions and rejects abbreviated versions', () => {
  assert.equal(isSemanticVersion('2.0.0'), true)
  assert.equal(isSemanticVersion('2.1.0-rc.1+build.4'), true)
  assert.equal(isSemanticVersion('2.0'), false)
  assert.equal(isSemanticVersion('02.0.0'), false)
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
  const changelogPath = path.join(root, 'CHANGELOG.md')
  const changelog = readFileSync(changelogPath, 'utf8').replace(
    '## [2.0.0] - 2026-06-28',
    '## [2.0.1] - 2026-06-28',
  )

  writeFileSync(changelogPath, changelog)

  const result = validateReleaseMetadata(root)

  assert.match(
    result.errors.join('\n'),
    /CHANGELOG\.md latest release MUST match VERSION \(2\.0\.0\)/u,
  )
})
