import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  CHECK_LOG_DIRECTORY,
  FAILING_TEST_DISPLAY_LIMIT,
  FAILURE_TAIL_LINES,
  checkOutputVerbose,
  outputTail,
  parseFailingTests,
  renderRepositoryCheckSummary,
  repositoryCheckFailingTests,
  writeRepositoryCheckLog,
} from '../../src/lib/check-output.js'
import type {
  RepositoryCheckCommandResult,
  RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'
import { createTestTempDirectory } from '../temp.js'

const WORKSPACE = '/work/space'

// The shape tests/reporters/failures-only.ts prints, including a suite and a
// parent test that failed only because a child did.
const FAILURES_ONLY = [
  '',
  'not ok - top fails (/work/space/dist/tests/unit/a.test.js:4)',
  '    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
  '        at TestContext.<anonymous> (file:///work/space/dist/tests/unit/a.test.js:4:34)',
  '',
  'not ok - inner (with parens) fails (/work/space/dist/tests/unit/a.test.js:5)',
  '    Error: boom',
  '',
  'not ok - suite (/work/space/dist/tests/unit/a.test.js:5)',
  '    Error [ERR_TEST_FAILURE]: 1 subtest failed',
  '',
  'not ok - /elsewhere/b.test.js (/elsewhere/b.test.js:1)',
  '    test failed',
  '# tests 7',
  '# fail 4',
].join('\n')

const TAP = [
  'TAP version 13',
  '# Subtest: suite',
  '    not ok 1 - inner fails',
  '      ---',
  "      location: '/work/space/tests/a.test.mjs:5:27'",
  "      error: 'boom'",
  '      ...',
  '    ok 2 - inner ok',
  'not ok 3 - suite',
  '  ---',
  "  location: '/work/space/tests/a.test.mjs:5:1'",
  "  error: '1 subtest failed'",
  '  ...',
  'not ok 4 - top fails',
  '  ---',
  "  location: '/work/space/tests/a.test.mjs:4:1'",
  '  ...',
].join('\n')

const SPEC = [
  '✖ top fails (0.456917ms)',
  '✖ failing tests:',
  '',
  'test at tests/a.test.mjs:4:1',
  '✖ top fails (0.456917ms)',
  '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
  '',
  'test at tests/a.test.mjs:6:39',
  '✖ child fails (2.90225ms)',
  '  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:',
].join('\n')

function entry(
  overrides: Partial<RepositoryCheckCommandResult>,
): RepositoryCheckCommandResult {
  return {
    kind: 'command',
    command: 'npm test',
    exit_code: 0,
    signal: null,
    stdout: '',
    stderr: '',
    passed: true,
    timed_out: false,
    duration_ms: 1_000,
    ...overrides,
  }
}

function profileResult(
  status: RepositoryCheckResult['status'],
  results: RepositoryCheckCommandResult[],
): RepositoryCheckResult {
  return {
    profile: 'fast',
    status,
    config_path: 'runtime/repository-checks.json',
    workspace_root: WORKSPACE,
    timeout_ms: 600_000,
    results,
    total_duration_ms: results.reduce(
      (total, item) => total + item.duration_ms,
      0,
    ),
    advisories: [],
  }
}

test('parseFailingTests reads the failures-only reporter and drops subtest rollups', () => {
  assert.deepEqual(parseFailingTests(FAILURES_ONLY, WORKSPACE), [
    { name: 'top fails', location: 'dist/tests/unit/a.test.js:4' },
    {
      name: 'inner (with parens) fails',
      location: 'dist/tests/unit/a.test.js:5',
    },
    { name: '/elsewhere/b.test.js', location: '/elsewhere/b.test.js:1' },
  ])
})

test('parseFailingTests reads TAP blocks and keeps each failure at its owner', () => {
  assert.deepEqual(parseFailingTests(TAP, WORKSPACE), [
    { name: 'inner fails', location: 'tests/a.test.mjs:5' },
    { name: 'top fails', location: 'tests/a.test.mjs:4' },
  ])
})

test('parseFailingTests reads the spec reporter failing-tests block once', () => {
  assert.deepEqual(parseFailingTests(SPEC, WORKSPACE), [
    { name: 'top fails', location: 'tests/a.test.mjs:4' },
    { name: 'child fails', location: 'tests/a.test.mjs:6' },
  ])
})

test('parseFailingTests finds nothing in output that names no test', () => {
  assert.deepEqual(
    parseFailingTests('src/a.ts(3,1): error TS2304: x\nnpm error code 1\n'),
    [],
  )
})

test('outputTail keeps the last lines without trailing blanks', () => {
  const output = Array.from({ length: 100 }, (_, index) => `line ${index}`)

  assert.deepEqual(outputTail(`${output.join('\n')}\n\n`, 3), [
    'line 97',
    'line 98',
    'line 99',
  ])
  assert.equal(outputTail(output.join('\n')).length, FAILURE_TAIL_LINES)
  assert.deepEqual(outputTail('\n\n'), [])
})

test('checkOutputVerbose honors --verbose and the PAN_VERBOSE spellings pan-run accepts', () => {
  assert.equal(checkOutputVerbose(['--verbose'], {}), true)
  assert.equal(checkOutputVerbose([], { PAN_VERBOSE: '1' }), true)
  assert.equal(checkOutputVerbose([], { PAN_VERBOSE: 'yes' }), true)
  assert.equal(checkOutputVerbose([], { PAN_VERBOSE: '0' }), false)
  assert.equal(checkOutputVerbose([], {}), false)
})

test('a passing profile renders one line with the command count, elapsed time, and log', () => {
  const summary = renderRepositoryCheckSummary(
    profileResult('passed', [
      entry({ kind: 'probe', command: 'node --version', duration_ms: 20 }),
      entry({ stdout: 'lots of output\n'.repeat(500), duration_ms: 42_280 }),
    ]),
    'runtime/logs/repository-check/x.log',
  )

  assert.equal(
    summary,
    '[repository-check:fast] passed: 1 command in 42.3s (log: runtime/logs/repository-check/x.log)',
  )
})

test('a failing profile renders the failing command, its tests, and the log', () => {
  const failing = entry({
    exit_code: 1,
    passed: false,
    stdout: FAILURES_ONLY,
    stderr: 'npm error Lifecycle script `test` failed\n',
  })
  const result = profileResult('failed', [
    entry({ command: 'npm run lint' }),
    failing,
  ])
  const summary = renderRepositoryCheckSummary(result, 'runtime/logs/x.log')

  assert.equal(
    summary,
    [
      '[repository-check:fast] FAILED: 1 of 2 commands failed in 2.0s',
      'failed command: npm test (exit 1)',
      '  failing tests (3):',
      '    top fails (dist/tests/unit/a.test.js:4)',
      '    inner (with parens) fails (dist/tests/unit/a.test.js:5)',
      '    /elsewhere/b.test.js (/elsewhere/b.test.js:1)',
      'log: runtime/logs/x.log',
    ].join('\n'),
  )
  assert.deepEqual(repositoryCheckFailingTests(result), [
    {
      kind: 'command',
      command: 'npm test',
      failing_tests: parseFailingTests(FAILURES_ONLY, WORKSPACE),
    },
  ])
})

test('a failure that names no test shows the output tail, and a long list is capped', () => {
  const lint = entry({
    command: 'npm run lint',
    exit_code: 2,
    passed: false,
    stdout: '[warn] src/a.ts\n',
    stderr: 'Code style issues found in the above file.\n',
  })
  const tail = renderRepositoryCheckSummary(
    profileResult('failed', [lint]),
    null,
  )

  assert.match(tail, /^failed command: npm run lint \(exit 2\)$/mu)
  assert.match(
    tail,
    /^ {2}last 2 output lines:\n {4}\[warn\] src\/a\.ts\n {4}Code style/mu,
  )
  assert.doesNotMatch(tail, /^log:/mu)

  const many = Array.from(
    { length: FAILING_TEST_DISPLAY_LIMIT + 5 },
    (_, index) => `not ok - case ${index} (/work/space/t.js:${index + 1})`,
  ).join('\n')
  const capped = renderRepositoryCheckSummary(
    profileResult('failed', [
      entry({ exit_code: 1, passed: false, stdout: many }),
    ]),
    'runtime/logs/x.log',
  )

  assert.match(capped, /failing tests \(35\):/u)
  assert.match(capped, /… 5 more in the log/u)
})

test('a probe failure and a timeout say how the entry ended', () => {
  const summary = renderRepositoryCheckSummary(
    profileResult('failed', [
      entry({
        kind: 'probe',
        command: 'node --version',
        exit_code: null,
        passed: false,
        timed_out: true,
        error: 'Command timed out after 1000ms.',
      }),
    ]),
    'runtime/logs/x.log',
  )

  assert.match(summary, /FAILED: a probe failed in /u)
  assert.match(summary, /^failed probe: node --version \(timed out\)$/mu)
  assert.match(summary, /Command timed out after 1000ms\./u)
})

test('writeRepositoryCheckLog keeps every stream of every entry under the log directory', () => {
  const root = createTestTempDirectory('check-output-log-')
  const relative = writeRepositoryCheckLog(
    root,
    profileResult('failed', [
      entry({ kind: 'probe', command: 'node --version', stdout: 'v22\n' }),
      entry({
        exit_code: 1,
        passed: false,
        stdout: 'out line\n',
        stderr: 'err line\n',
      }),
    ]),
    '2026-09-30T00:00:00.000Z',
    'pan repository-check fast',
  )

  assert.match(
    relative,
    new RegExp(
      `^${CHECK_LOG_DIRECTORY}/\\d+_[A-Z][a-z]{2}-\\d{2}-\\d{4}_fast-[0-9a-f]{8}\\.log$`,
      'u',
    ),
  )

  const log = readFileSync(path.join(root, relative), 'utf8')

  assert.match(
    log,
    /^\$ pan repository-check fast\nprofile=fast\nstatus=failed\n/u,
  )
  assert.match(log, /=== probe 1\/2: node --version ===/u)
  assert.match(
    log,
    /=== command 2\/2: npm test ===\nexit_code=1 [^\n]*\n--- stdout ---\nout line\n--- stderr ---\nerr line\n/u,
  )
})
