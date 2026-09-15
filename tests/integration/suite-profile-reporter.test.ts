import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { TEST_FILE_DURATIONS_ENV } from '../../src/lib/suite-profile-env.js'
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

function laneFile(cwd: string, name: string, cases: string[]): string {
  const laneDir = path.join(cwd, 'tests', 'unit')

  mkdirSync(laneDir, { recursive: true })

  const file = path.join(laneDir, name)

  writeFileSync(
    file,
    [
      "const test = require('node:test');",
      ...cases.map((caseName) => `test('${caseName}', () => {});`),
      '',
    ].join('\n'),
  )

  return file
}

function tinyLane(): { cwd: string; file: string } {
  const cwd = createTestTempDirectory('pancreator-suite-profile-')

  return { cwd, file: laneFile(cwd, 'tiny.test.js', ['alpha', 'beta']) }
}

/** The record `bin/run-tests` hands the reporter, per checkout. */
function durationRecordPath(cwd: string): string {
  return path.join(
    cwd,
    'runtime',
    'tmp',
    'tests.noindex',
    'file-durations.json',
  )
}

interface DurationRecord {
  schema_version: number
  recorded_at: string
  lane: string
  test_count: number
  wall_clock_ms: number
  files: Array<{ file: string; duration_ms: number; recorded_at?: string }>
}

function readDurationRecord(target: string): DurationRecord {
  return JSON.parse(readFileSync(target, 'utf8')) as DurationRecord
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

test('the reporter always writes durations and profiles only on request', () => {
  const { cwd, file } = tinyLane()
  const target = path.join(cwd, 'out', 'profile.json')
  const durations = durationRecordPath(cwd)

  const unset = runReporter(cwd, file, {
    [TEST_PROFILE_ENV]: '',
    [TEST_FILE_DURATIONS_ENV]: durations,
  })

  assert.equal(unset.status, 0, unset.stderr)
  assert.match(unset.stdout, /^# pass 2$/mu)
  assert.equal(existsSync(target), false)
  assert.equal(existsSync(path.join(cwd, 'out')), false)

  const durationRecord = readDurationRecord(durations)

  assert.equal(durationRecord.schema_version, 1)
  assert.match(durationRecord.recorded_at, /^\d{4}-\d{2}-\d{2}T/u)
  assert.equal(durationRecord.lane, 'unit')
  assert.equal(durationRecord.test_count, 2)
  assert.ok(durationRecord.wall_clock_ms > 0)
  assert.deepEqual(
    durationRecord.files.map((entry) => entry.file),
    ['tests/unit/tiny.test.js'],
  )

  const set = runReporter(cwd, file, {
    [TEST_PROFILE_ENV]: target,
    [TEST_FILE_DURATIONS_ENV]: durations,
  })

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

// `pan tests impacted` runs this reporter over a subset of the lane. Writing
// that subset as the whole record left every file it skipped unmeasured, and
// the scheduler leads with unmeasured files, so the known long pole went last.
test('a reporter run over part of a lane keeps what other runs measured', () => {
  const cwd = createTestTempDirectory('pancreator-duration-merge-')
  const durations = durationRecordPath(cwd)
  const slow = laneFile(cwd, 'slow.test.js', ['alpha', 'beta'])
  const fast = laneFile(cwd, 'fast.test.js', ['gamma'])

  for (const file of [slow, fast]) {
    const complete = runReporter(cwd, file, {
      [TEST_PROFILE_ENV]: '',
      [TEST_FILE_DURATIONS_ENV]: durations,
    })

    assert.equal(complete.status, 0, complete.stderr)
  }

  const subset = runReporter(cwd, fast, {
    [TEST_PROFILE_ENV]: '',
    [TEST_FILE_DURATIONS_ENV]: durations,
  })

  assert.equal(subset.status, 0, subset.stderr)

  const merged = readDurationRecord(durations)

  assert.deepEqual(merged.files.map((entry) => entry.file).sort(), [
    'tests/unit/fast.test.js',
    'tests/unit/slow.test.js',
  ])
  assert.equal(merged.test_count, 1)

  for (const entry of merged.files) {
    assert.match(entry.recorded_at ?? '', /^\d{4}-\d{2}-\d{2}T/u)
  }
})

// Only a run the runner scheduled owns the record. A bare `node --test` from
// the repository root used to replace it with a document naming one file.
test('a reporter run the runner did not schedule writes no duration record', () => {
  const { cwd, file } = tinyLane()
  const result = runReporter(cwd, file, {
    [TEST_PROFILE_ENV]: '',
    [TEST_FILE_DURATIONS_ENV]: '',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^# pass 2$/mu)
  assert.equal(existsSync(durationRecordPath(cwd)), false)
  assert.equal(existsSync(path.join(cwd, 'runtime')), false)

  // A relative target is not ownership either: it would resolve against
  // whatever directory the process happened to start in.
  const relative = runReporter(cwd, file, {
    [TEST_PROFILE_ENV]: '',
    [TEST_FILE_DURATIONS_ENV]: 'runtime/tmp/tests.noindex/file-durations.json',
  })

  assert.equal(relative.status, 0, relative.stderr)
  assert.equal(existsSync(path.join(cwd, 'runtime')), false)
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
        // This child is not a scheduled suite run, so it owns no scheduler
        // record and must not contribute a fixture path to the real one.
        [TEST_FILE_DURATIONS_ENV]: '',
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
