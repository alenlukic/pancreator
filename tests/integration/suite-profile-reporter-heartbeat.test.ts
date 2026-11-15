import assert from 'node:assert/strict'
import type { SpawnSyncReturns } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  TEST_HEARTBEAT_PREFIX,
  TEST_HEARTBEAT_SECONDS_ENV,
} from '../../src/lib/suite-profile-env.js'
import { createTestTempDirectory } from '../temp.js'

const REPORTER = path.join(
  process.cwd(),
  'dist/tests/reporters/failures-only.js',
)

/** The parent runs under node --test; the child must not inherit that context. */
function childEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _context, ...rest } = process.env

  return { ...rest, ...env }
}

function runSlowSuite(
  testFile: string,
  env: Record<string, string>,
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      '--test',
      `--test-reporter=${REPORTER}`,
      '--test-reporter-destination=stdout',
      testFile,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: childEnv(env),
      timeout: 30_000,
    },
  )
}

test('AC-10: failures-only reporter prints heartbeat lines on long runs', () => {
  const root = createTestTempDirectory('reporter-heartbeat-')
  const testFile = path.join(root, 'slow.test.js')
  writeFileSync(
    testFile,
    [
      "import test from 'node:test'",
      "test('waits', async () => { await new Promise((r) => setTimeout(r, 2500)) })",
      '',
    ].join('\n'),
    'utf8',
  )

  const result = runSlowSuite(testFile, {
    PAN_TEST_HEARTBEAT_SECONDS: '1',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`${TEST_HEARTBEAT_PREFIX}\\d+s:`))
})

test('a run shorter than the default heartbeat interval exits at once and prints only the summary', () => {
  const root = createTestTempDirectory('reporter-heartbeat-short-')
  const testFile = path.join(root, 'quick.test.js')
  writeFileSync(
    testFile,
    ["import test from 'node:test'", "test('t', () => {})", ''].join('\n'),
    'utf8',
  )
  const { [TEST_HEARTBEAT_SECONDS_ENV]: _interval, ...env } = childEnv({})

  // Hang guard far below the 30 s default interval: an armed heartbeat timer
  // holds the reporter's process open until the next interval boundary.
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      `--test-reporter=${REPORTER}`,
      '--test-reporter-destination=stdout',
      testFile,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env,
      timeout: 10_000,
    },
  )

  assert.equal(result.error, undefined, 'the run exited before the hang guard')
  assert.equal(result.status, 0, result.stderr)

  const lines = result.stdout.split('\n').filter(Boolean)

  assert.ok(lines.length > 0)
  assert.ok(
    lines.every((line) =>
      /^# (tests|pass|fail|cancelled|skipped|todo|duration_ms) /u.test(line),
    ),
    `only summary lines print: ${result.stdout}`,
  )
})

test('a file with a retained handle is named in stalled heartbeats and fails at the file timeout', () => {
  const root = createTestTempDirectory('reporter-stalled-file-')
  const stalled = path.join(root, 'a-stalled.test.js')
  const later = path.join(root, 'b-later.test.js')

  writeFileSync(
    stalled,
    [
      "import test from 'node:test'",
      "test('leaks an active handle', () => { setInterval(() => {}, 1000) })",
      '',
    ].join('\n'),
  )
  writeFileSync(
    later,
    [
      "import test from 'node:test'",
      "test('later succeeds', () => {})",
      '',
    ].join('\n'),
  )

  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=2',
      '--test-timeout=3500',
      '--experimental-test-coverage',
      `--test-reporter=${REPORTER}`,
      '--test-reporter-destination=stdout',
      stalled,
      later,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: childEnv({ PAN_TEST_HEARTBEAT_SECONDS: '0.5' }),
      timeout: 30_000,
    },
  )

  assert.equal(result.error, undefined, 'the file timeout ends the run')
  assert.equal(result.status, 1, result.stderr)
  assert.match(
    result.stdout,
    /# heartbeat \d+s: awaiting file report: .*a-stalled\.test\.js \(dispatched \d+s ago\)/u,
  )
  assert.match(result.stdout, /not ok - .*a-stalled\.test\.js/u)
  assert.match(result.stdout, /test timed out after 3500ms/u)
  assert.match(result.stdout, /^# pass 2$/mu)
})
