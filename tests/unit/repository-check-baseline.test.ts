import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareRepositoryCheckToBaseline,
  type RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'

function failedCheck(
  stderr: string,
  overrides: Partial<RepositoryCheckResult['results'][number]> = {},
): RepositoryCheckResult {
  return {
    profile: 'static',
    status: 'failed',
    config_path: '/harness/runtime/repository-checks.json',
    workspace_root: '/workspace',
    timeout_ms: 60_000,
    results: [
      {
        kind: 'command',
        command: 'npm run lint',
        exit_code: 1,
        signal: null,
        stdout: '',
        stderr,
        passed: false,
        timed_out: false,
        duration_ms: 1,
        ...overrides,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  }
}

function passedCheck(): RepositoryCheckResult {
  return {
    profile: 'static',
    status: 'passed',
    config_path: '/harness/runtime/repository-checks.json',
    workspace_root: '/workspace',
    timeout_ms: 60_000,
    results: [
      {
        kind: 'command',
        command: 'npm run lint',
        exit_code: 0,
        signal: null,
        stdout: '',
        stderr: '',
        passed: true,
        timed_out: false,
        duration_ms: 1,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  }
}

test('baseline comparison tolerates line movement and improving failure counts', () => {
  const baseline = failedCheck(
    '/workspace/src/a.ts:10:2 error Unexpected value no-example\n✖ 2 problems (2 errors, 0 warnings)\n',
  )
  const current = failedCheck(
    '/workspace/src/a.ts:40:9 error Unexpected value no-example\n✖ 1 problem (1 error, 0 warnings)\n',
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, true)
  assert.equal(comparison.delta.new.length, 0)
  assert.equal(comparison.delta.carried.length, 1)
})

test('baseline comparison rejects a new diagnostic from the same command', () => {
  const baseline = failedCheck(
    '/workspace/src/a.ts:10:2 error Unexpected value no-example\n',
  )
  const current = failedCheck(
    '/workspace/src/a.ts:40:9 error Unexpected value no-example\n' +
      '/workspace/src/b.ts:3:1 error New failure no-new\n',
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, false)
  assert.equal(comparison.delta.new.length, 1)
  assert.match(comparison.delta.new[0]?.diagnostic ?? '', /no-new/u)
  assert.equal(comparison.delta.new[0]?.command, 'npm run lint')
  assert.match(comparison.explanation, /1 new, 0 fixed, 1 carried/u)
})

test('baseline delta credits a repaired inherited failure as fixed', () => {
  const baseline = failedCheck(
    '/workspace/src/a.ts:10:2 error Unexpected value no-example\n' +
      '/workspace/src/b.ts:3:1 error Inherited failure no-old\n',
  )
  const current = failedCheck(
    '/workspace/src/a.ts:10:2 error Unexpected value no-example\n',
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, true)
  assert.equal(comparison.delta.fixed.length, 1)
  assert.match(comparison.delta.fixed[0]?.diagnostic ?? '', /no-old/u)
  assert.equal(comparison.delta.carried.length, 1)
  assert.match(comparison.explanation, /0 new, 1 fixed, 1 carried/u)

  const repaired = compareRepositoryCheckToBaseline(baseline, passedCheck())

  assert.equal(repaired.passed, true)
  assert.equal(repaired.delta.new.length, 0)
  assert.equal(
    repaired.delta.fixed.some((item) => item.diagnostic.includes('no-example')),
    true,
  )
})

test('baseline delta counts a duplicated diagnostic as new', () => {
  const baseline = failedCheck(
    '/workspace/src/a.ts:10:2 error Unexpected value no-example\n',
  )
  const current = failedCheck(
    '/workspace/src/a.ts:10:2 error Unexpected value no-example\n' +
      '/workspace/src/c.ts:11:4 error Unexpected value no-example\n',
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, false)
  assert.equal(comparison.delta.new.length, 1)
  assert.equal(comparison.delta.new[0]?.count, 1)
})

test('baseline delta retains failures that mention PASSED', () => {
  const comparison = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck('AssertionError: expected PASSED but got FAILED\n'),
  )

  assert.ok(
    comparison.delta.new.some((item) =>
      item.diagnostic.includes('expected PASSED but got FAILED'),
    ),
  )
})

test('baseline delta caps embedded diagnostics but preserves full counts', () => {
  const diagnostics = Array.from(
    { length: 101 },
    (_, index) => `/workspace/src/${index}.ts:1:1 error failure-${index}`,
  ).join('\n')
  const comparison = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck(`${diagnostics}\n`),
  )

  assert.equal(comparison.delta.new.length, 100)
  assert.equal(comparison.delta.counts?.new, 102)
  assert.equal(comparison.delta.full?.new.length, 102)
})

test('baseline delta treats a first-time failing command as new', () => {
  const comparison = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck('/workspace/src/a.ts:10:2 error Unexpected value no-example\n'),
  )

  assert.equal(comparison.passed, false)
  assert.equal(comparison.delta.new.length > 0, true)

  const explained = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck('AssertionError: expected true\n'),
  )

  assert.match(explained.explanation, /AssertionError: expected true/u)
  assert.doesNotMatch(explained.explanation, /<status>/u)
})

test('baseline delta treats a changed exit status as new', () => {
  const baseline = failedCheck('same diagnostic text\n')

  const unchanged = compareRepositoryCheckToBaseline(
    baseline,
    failedCheck('same diagnostic text\n'),
  )

  assert.equal(unchanged.passed, true)
  assert.equal(unchanged.delta.new.length, 0)
  assert.equal(unchanged.delta.fixed.length, 0)
  assert.equal(unchanged.delta.carried.length, 1)

  const current = failedCheck('same diagnostic text\n', {
    timed_out: true,
    exit_code: null,
  })
  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, false)
  assert.equal(
    comparison.delta.new.some((item) =>
      item.diagnostic.includes('timed_out=true'),
    ),
    true,
  )
})

test('a new pytest failure with spaces in bracketed parameters is detected', () => {
  const header =
    'test session starts\nplatform darwin -- Python 3.12.12, pytest-9.0.3\n'
  const baseline = failedCheck(
    `${header}FAILED tests/unit/test_old.py::test_old[ a b ] - AssertionError: old\n`,
  )
  const current = failedCheck(
    `${header}FAILED tests/unit/test_new.py::test_new[ c d ] - AssertionError: new\n`,
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, false)
  assert.equal(comparison.delta.new.length, 1)
  assert.match(comparison.delta.new[0]?.diagnostic ?? '', /test_new/u)
})

test('a pytest-looking transcript still surfaces failures outside the pytest shapes', () => {
  // A command that runs pytest plus another tool: the pytest half passes, the
  // other tool regresses. The failure allowlist matches nothing, so extraction
  // must fall back to generic lines instead of discarding the evidence.
  const header = 'plugins: anyio-4.0.0\n'
  const baseline = failedCheck(
    `${header}src/example.py:10: error: Incompatible types [assignment]\n`,
  )
  const current = failedCheck(
    `${header}src/example.py:10: error: Incompatible types [assignment]\n` +
      'src/other.py:4: error: Missing return statement [return]\n',
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, false)
  assert.equal(comparison.delta.new.length, 1)
  assert.match(
    comparison.delta.new[0]?.diagnostic ?? '',
    /Missing return statement/u,
  )
})
