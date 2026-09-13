import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  loadSuiteProfile,
  TEST_PROFILE_ENV,
} from '../../src/lib/suite-profile.js'
import { TEST_SCRATCH_ENV } from '../../src/lib/suite-profile-env.js'
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

// The gate that profiles the suite points the target at a run's evidence
// directory, which a watch and an evidence audit read while the suite runs.
test('a profiled run leaves nothing transient in a run evidence directory', async () => {
  const cwd = createTestTempDirectory('pancreator-suite-profile-evidence-')
  const laneDir = path.join(cwd, 'tests', 'unit')
  const evidence = path.join(
    cwd,
    'runtime',
    'logs',
    'workflows',
    '63296_Sep-13-0000_profiled',
    'agent',
    'evidence',
  )
  const scratch = path.join(cwd, 'scratch')

  mkdirSync(laneDir, { recursive: true })
  mkdirSync(evidence, { recursive: true })
  mkdirSync(scratch, { recursive: true })

  const file = path.join(laneDir, 'slow.test.js')

  // The run has to outlast the observer, or an empty directory proves only
  // that the suite finished first.
  writeFileSync(
    file,
    [
      "const test = require('node:test');",
      'const { Atomics } = globalThis;',
      'const signal = new Int32Array(new SharedArrayBuffer(4));',
      "test('slow', () => { Atomics.wait(signal, 0, 0, 1500); });",
      '',
    ].join('\n'),
  )

  const target = path.join(evidence, 'suite-profile.json')
  const child = spawn(
    process.execPath,
    [
      '--test',
      `--test-reporter=${REPORTER}`,
      '--test-reporter-destination=stdout',
      file,
    ],
    {
      cwd,
      env: childEnv({
        [TEST_PROFILE_ENV]: target,
        [TEST_SCRATCH_ENV]: scratch,
      }),
      stdio: 'ignore',
    },
  )
  const finished = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code))
  })
  const observations: string[][] = []

  // The merged profile lands before the child exits, so the in-flight window
  // ends at that write rather than at exit.
  while (
    child.exitCode === null &&
    child.signalCode === null &&
    !existsSync(target)
  ) {
    observations.push(readdirSync(evidence))
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  assert.equal(await finished, 0)
  assert.ok(
    observations.length > 5,
    `only ${observations.length} in-flight observations were taken`,
  )

  for (const listing of observations) {
    assert.deepEqual(listing, [], 'a transient file reached the run evidence')
  }

  // Only the merged profile is durable, and it lands where the gate asked.
  assert.deepEqual(readdirSync(evidence), ['suite-profile.json'])
  assert.equal(loadSuiteProfile(cwd, path.relative(cwd, target))?.lane, 'unit')
})
