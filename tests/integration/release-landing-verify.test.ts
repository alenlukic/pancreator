import assert from 'node:assert/strict'
import test from 'node:test'

import { landRelease } from '../../src/lib/release-landing.js'
import {
  git,
  landingFixture,
  makeCandidate,
  readLandingLog,
} from './release-landing-helpers.js'

test('test profile flags and ship repair flags cannot execute tests during release', () => {
  const root = landingFixture()
  const workspace = makeCandidate(
    root,
    'no-release-tests',
    '### Fixed\n\n- Move all test execution to verify.',
  )
  const head = git(workspace, ['rev-parse', 'HEAD'])
  for (const extra of [
    { verifyProfiles: ['full'] },
    { verifyProfiles: ['impacted-release'] },
    { repairNote: 'repair a failed test' },
  ]) {
    assert.throws(
      () =>
        landRelease(root, {
          worktree: 'no-release-tests',
          bump: 'patch',
          ...extra,
        }),
      { code: 'LANDING_VERIFY_STAGE_REQUIRED' },
    )
    assert.equal(git(workspace, ['rev-parse', 'HEAD']), head)
  }
  assert.equal(
    readLandingLog(root).some(
      (entry) =>
        entry.step === 'allocate' ||
        entry.step === 'finalize' ||
        entry.step === 'build',
    ),
    false,
  )
})
