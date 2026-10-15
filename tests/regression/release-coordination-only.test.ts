import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { landRelease } from '../../src/lib/release-landing.js'
import {
  advanceTip,
  git,
  landingFixture,
  makeCandidate,
  readLandingLog,
  setProfileCommand,
} from '../integration/release-landing-helpers.js'

test('a standalone release lands without workflow evidence, test execution, or artifact validation', () => {
  const root = landingFixture()
  const name = 'standalone-coordination'
  const workspace = makeCandidate(
    root,
    name,
    'Add the standalone capability.\n\n### Added\n\n- Ship the operator capability.',
  )

  for (const profile of [
    'static',
    'configuration',
    'full',
    'impacted-release',
  ]) {
    setProfileCommand(
      root,
      profile,
      "node -e \"require('node:fs').writeFileSync('unexpected-release-test','bad');process.exit(1)\"",
    )
  }

  const check = path.join(root, 'bin/check-landing')
  writeFileSync(
    check,
    '#!/bin/sh\nprintf bad > unexpected-release-validation\nexit 1\n',
  )
  chmodSync(check, 0o755)
  const result = landRelease(root, {
    worktree: name,
    bump: 'minor',
    verifyProfiles: ['full'],
    repairNote: 'Legacy caller option',
  })
  assert.equal(result.status, 'landed')
  assert.equal(result.verification_basis, 'not_applicable')
  assert.equal(
    existsSync(path.join(workspace, 'unexpected-release-test')),
    false,
  )
  assert.equal(
    existsSync(path.join(root, 'unexpected-release-validation')),
    false,
  )
  assert.equal(
    readLandingLog(root).some((event) =>
      ['verify', 'check', 'build'].includes(String(event.step)),
    ),
    false,
  )
  assert.equal(git(root, ['rev-parse', 'pan-dev']), result.tip_after)
  assert.equal(git(workspace, ['status', '--porcelain']), '')
  const index = JSON.parse(
    readFileSync(path.join(workspace, 'release/index.json'), 'utf8'),
  ) as { releases: { version: string; commit: string }[] }
  assert.equal(
    index.releases.find((entry) => entry.version === result.version)?.commit,
    result.release_commit,
  )
  assert.equal(
    git(workspace, [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      result.index_commit!,
    ]),
    'release/index.json',
  )
})

test('release reconciles a newer integration tip under the allocation and landing mutex without requesting verification', () => {
  const root = landingFixture()
  const name = 'coordination-new-tip'
  const workspace = makeCandidate(
    root,
    name,
    'Add a compatible capability.\n\n### Added\n\n- Preserve both branches.',
  )
  const tipVersion = advanceTip(root, { sourceChange: true })
  const tip = git(root, ['rev-parse', 'pan-dev'])
  const result = landRelease(root, { worktree: name, bump: 'minor' })
  assert.equal(result.status, 'landed')
  assert.notEqual(result.version, tipVersion)
  assert.ok(
    readFileSync(path.join(workspace, 'src/base.ts'), 'utf8').includes(
      'tipSide',
    ),
  )
  git(workspace, ['merge-base', '--is-ancestor', tip, 'HEAD'])
  assert.equal(
    readLandingLog(root).some(
      (entry) => entry.step === 'integrate' && entry.outcome === 'merged',
    ),
    true,
  )
  assert.equal(
    result.steps.some((entry) => entry.step === 'verify'),
    false,
  )
})

test('a genuine source merge conflict remains a coordination stop and does not allocate or fake validation', () => {
  const root = landingFixture()
  const name = 'coordination-conflict'
  makeCandidate(
    root,
    name,
    'Record the candidate.',
    "export const base = 'candidate conflict'\n",
  )
  advanceTip(root, { sourceChange: true })
  const tip = git(root, ['rev-parse', 'pan-dev'])
  const result = landRelease(root, { worktree: name, bump: 'minor' })
  assert.equal(result.status, 'conflict')
  assert.ok(result.source_conflicts?.includes('src/base.ts'))
  assert.equal(
    result.steps.some((entry) => entry.step === 'allocate'),
    false,
  )
  assert.equal(
    result.steps.some((entry) => entry.step === 'verify'),
    false,
  )
  assert.equal(git(root, ['rev-parse', 'pan-dev']), tip)
})
