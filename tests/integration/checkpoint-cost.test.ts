import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { TEST_PROFILE_ENV } from '../../src/lib/suite-profile-env.js'
import { readFixtureCost } from '../reporters/failures-only.js'
import { flushFixtureSidecar } from '../reporters/fixture-profile.js'
import { createTestTempDirectory } from '../temp.js'
import { checkpoint, prepareCheckpointRun } from './delivery-helpers.js'

test('a checkpoint run prepares without npm and reports its prepare cost', () => {
  const previousProfile = process.env[TEST_PROFILE_ENV]
  const previousPath = process.env.PATH
  // The target lives in the run's scratch directory, which the runner
  // removes. Named under the checkout it would accumulate one file per run.
  const profileTarget = path.join(
    createTestTempDirectory('checkpoint-cost-'),
    'profile.json',
  )

  process.env[TEST_PROFILE_ENV] = profileTarget

  const created = checkpoint('delivery@created')
  const bin = path.join(created.root, 'fake-npm-bin')
  const npmMarker = path.join(created.root, 'npm-spawned')

  mkdirSync(bin, { recursive: true })
  const npm = path.join(bin, 'npm')

  try {
    writeFileSync(npm, `#!/bin/sh\n: > ${JSON.stringify(npmMarker)}\nexit 0\n`)
    chmodSync(npm, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`

    const prepared = prepareCheckpointRun(created.root, created.runId)

    assert.ok(prepared.invocation)
    assert.equal(existsSync(npmMarker), false, 'npm spawn count is zero')

    flushFixtureSidecar(profileTarget)

    const cost = readFixtureCost(profileTarget)

    assert.ok(cost)
    assert.ok(cost.prepare_ms > 0)
    assert.ok(cost.clone_ms > 0)
  } finally {
    process.env.PATH = previousPath

    if (previousProfile === undefined) {
      delete process.env[TEST_PROFILE_ENV]
    } else {
      process.env[TEST_PROFILE_ENV] = previousProfile
    }
  }
})
