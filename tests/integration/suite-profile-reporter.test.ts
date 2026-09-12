import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  loadSuiteProfile,
  TEST_PROFILE_ENV,
} from '../../src/lib/suite-profile.js'
import { createTestTempDirectory } from '../temp.js'

const REPORTER = path.resolve(
  process.cwd(),
  'dist/tests/reporters/failures-only.js',
)

function tinyLane(): { cwd: string; file: string } {
  const cwd = createTestTempDirectory('pancreator-suite-profile-')
  const laneDir = path.join(cwd, 'tests', 'unit')

  mkdirSync(laneDir, { recursive: true })

  const file = path.join(laneDir, 'tiny.test.js')

  writeFileSync(
    file,
    [
      "const test = require('node:test');",
      "test('alpha', () => {});",
      "test('beta', () => {});",
      '',
    ].join('\n'),
  )

  return { cwd, file }
}

/** The parent runs under node --test; the child must not inherit that context. */
function childEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _context, ...rest } = process.env

  return { ...rest, ...env }
}

function runReporter(
  cwd: string,
  file: string,
  env: Record<string, string>,
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      '--test',
      `--test-reporter=${REPORTER}`,
      '--test-reporter-destination=stdout',
      file,
    ],
    { cwd, encoding: 'utf8', env: childEnv(env) },
  )
}

test('the reporter writes a suite profile only when PAN_TEST_PROFILE is set', () => {
  const { cwd, file } = tinyLane()
  const target = path.join(cwd, 'out', 'profile.json')

  const unset = runReporter(cwd, file, { [TEST_PROFILE_ENV]: '' })

  assert.equal(unset.status, 0, unset.stderr)
  assert.match(unset.stdout, /^# pass 2$/mu)
  assert.equal(existsSync(target), false)
  assert.equal(existsSync(path.join(cwd, 'out')), false)

  const set = runReporter(cwd, file, { [TEST_PROFILE_ENV]: target })

  assert.equal(set.status, 0, set.stderr)
  // The printed output is unchanged apart from the measured duration.
  const withoutDuration = (text: string): string =>
    text.replace(/^# duration_ms .*$/mu, '')

  assert.equal(withoutDuration(set.stdout), withoutDuration(unset.stdout))

  const profile = loadSuiteProfile(cwd, 'out/profile.json')

  assert.ok(profile)
  assert.equal(profile.lane, 'unit')
  assert.equal(profile.test_count, 2)
  assert.equal(profile.pass_count, 2)
  assert.equal(profile.fail_count, 0)
  assert.ok(profile.wall_clock_ms > 0)
  assert.equal(profile.files.length, 1)
  assert.equal(profile.files[0].file, 'tests/unit/tiny.test.js')
  assert.equal(profile.files[0].test_count, 2)
  assert.deepEqual(profile.slowest_tests.map((entry) => entry.name).sort(), [
    'alpha',
    'beta',
  ])
  assert.deepEqual(profile.all_tests?.map((entry) => entry.name).sort(), [
    'alpha',
    'beta',
  ])
})
