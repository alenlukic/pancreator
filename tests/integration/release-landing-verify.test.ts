import assert from 'node:assert/strict'
import test from 'node:test'

import { landRelease } from '../../src/lib/release-landing.js'
import {
  git,
  landingFixture,
  makeCandidate,
  readLandingLog,
  setProfileCommand,
} from './release-landing-helpers.js'

test('deprecated profile and repair flags cannot execute tests during release', () => {
  for (const extra of [
    { verifyProfiles: ['full'] },
    { verifyProfiles: ['impacted-release'] },
    { repairNote: 'repair a failed test' },
  ]) {
    const root = landingFixture()
    const workspace = makeCandidate(
      root,
      'no-release-tests',
      '### Fixed\n\n- Move all test execution to verify.',
    )
    for (const profile of ['full', 'impacted-release']) {
      setProfileCommand(root, profile, 'exit 17')
    }
    const result = landRelease(root, {
      worktree: 'no-release-tests',
      bump: 'patch',
      ...extra,
    })
    assert.equal(result.status, 'landed')
    assert.equal(result.tip_after, git(workspace, ['rev-parse', 'HEAD']))
    assert.deepEqual(result.verified_profiles, [])
    assert.equal(result.verification_basis, 'not_applicable')
    const events = readLandingLog(root)
    assert.ok(
      events.some(
        (entry) => entry.event === 'deprecated_verification_options_ignored',
      ),
    )
    assert.equal(
      events.some((entry) => entry.step === 'verify' || entry.step === 'build'),
      false,
    )
  }
})
