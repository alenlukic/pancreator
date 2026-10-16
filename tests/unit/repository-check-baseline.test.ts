import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compareRepositoryCheckToBaseline,
  type RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'
import { isEnvironmentBlockedDelta } from '../../src/lib/validation/baselines.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'

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

test('volatile execution identities do not invent regressions while assertion bodies, counts, and failure status retain their signal', () => {
  const first = 'a'.repeat(40)
  const second = 'b'.repeat(40)
  const assertion =
    'not ok - same assertion\nAssertionError: expected 1, actual 2\n'
  const baseline = failedCheck(assertion + `  "current_head": "${first}",\n`)
  const repeated = failedCheck(assertion + `  "current_head": "${second}",\n`)
  const comparison = compareRepositoryCheckToBaseline(baseline, repeated)
  assert.equal(comparison.passed, true)
  assert.equal(comparison.delta.new.length, 0)
  assert.equal(repeated.status, 'failed')
  assert.equal(repeated.results[0]!.exit_code, 1)
  assert.equal(
    compareRepositoryCheckToBaseline(
      baseline,
      failedCheck(
        assertion.replace('actual 2', 'actual 3') +
          `  "current_head": "${second}",\n`,
      ),
    ).passed,
    false,
  )
  assert.equal(
    compareRepositoryCheckToBaseline(
      baseline,
      failedCheck(
        assertion +
          'not ok - a new failed assertion\n' +
          `  "current_head": "${second}",\n`,
      ),
    ).passed,
    false,
  )
  assert.equal(
    compareRepositoryCheckToBaseline(
      baseline,
      failedCheck(assertion + `  "current_head": "${second}",\n`, {
        exit_code: 2,
      }),
    ).passed,
    false,
  )
  assert.equal(
    compareRepositoryCheckToBaseline(
      failedCheck(`"actual_value": "${first}"`),
      failedCheck(`"actual_value": "${second}"`),
    ).passed,
    false,
  )
})

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

test('TAP assertion substance stays attached to its case and retains literal values', () => {
  const record = (body: string, name = 'checks value'): string =>
    `not ok 1 - ${name}\n  ---\n  error: 'mismatch'\n${body}\n  ...\n`
  const original = record(
    "  expected: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'\n  actual: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'",
  )
  const identity = (diagnostic: string, count = 1) => ({
    kind: 'command',
    command: 'npm run lint',
    diagnostic,
    count,
  })
  const normalized = (value: string): string =>
    value
      .replace('not ok 1', 'not ok <index>')
      .replace('  ---\n', '')
      .replace('  ...\n', '')
      .split('\n')
      .map((line) => (/^ {4}/u.test(line) ? line.slice(2) : line.trim()))
      .filter(Boolean)
      .join('\n')

  for (const changed of [
    original.replace(
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccccccccccccccccccc',
    ),
    original.replace('checks value', 'checks another case'),
  ]) {
    const comparison = compareRepositoryCheckToBaseline(
      failedCheck(original),
      failedCheck(changed),
    )
    assert.deepEqual(comparison.delta.new, [identity(normalized(changed))])
    assert.deepEqual(comparison.delta.fixed, [identity(normalized(original))])
  }
  for (const [before, after] of [
    ["  expected: '10ms'", "  expected: '20ms'"],
    [
      "  actual: '/workspace/file.ts:10:2'",
      "  actual: '/workspace/file.ts:20:3'",
    ],
    ["  actual: '2026-10-14T10:00:00Z'", "  actual: '2026-10-15T11:00:00Z'"],
    [
      '  expected:\n    "current_head": "' + 'a'.repeat(40) + '"',
      '  expected:\n    "current_head": "' + 'b'.repeat(40) + '"',
    ],
    ['  actual:\n    duration_ms: 10', '  actual:\n    duration_ms: 20'],
    [
      '  actual:\n    first:\n      second: value',
      '  actual:\n    first:\n    second: value',
    ],
  ]) {
    const baseline = record(before)
    const current = record(after)
    const comparison = compareRepositoryCheckToBaseline(
      failedCheck(baseline),
      failedCheck(current),
    )
    assert.deepEqual(comparison.delta.new, [identity(normalized(current))])
    assert.deepEqual(comparison.delta.fixed, [identity(normalized(baseline))])
  }
})

test('runner metadata is ignored outside assertions and raw recorded results stay compatible', () => {
  const output = (head: string, count: number): string =>
    `Selected ${count} of 50 lane tests for 2 changed file(s).\n` +
    `[tests impacted] running ${count} of 196 lane test file(s) for 6 changed file(s) (log: /report-${count}.log)\n` +
    `ok - passing case ${count}\n` +
    `  "current_head": "${head}",\n` +
    'not ok 1 - same failure\n  AssertionError: mismatch\n'
  const baseline = failedCheck(output('a'.repeat(40), 2))
  const current = failedCheck(output('b'.repeat(40), 4))
  current.total_duration_ms = 99
  current.config_path = '/generated/current/repository-checks.json'
  current.advisories = ['Generated report at /temporary/report.json']
  const roundTrip = JSON.parse(JSON.stringify(current)) as RepositoryCheckResult
  const comparison = compareRepositoryCheckToBaseline(baseline, roundTrip)
  assert.deepEqual(comparison.delta.new, [])
  assert.deepEqual(comparison.delta.fixed, [])
  assert.deepEqual(comparison.delta.counts, { new: 0, fixed: 0, carried: 2 })
  assert.deepEqual(roundTrip, current)
})

test('a final runner failure rendering is not a second unnumbered occurrence', () => {
  const record =
    'not ok - same case (/workspace/test.ts:1)\n    AssertionError: mismatch\n'
  const baseline = failedCheck(record)
  const comparison = compareRepositoryCheckToBaseline(
    baseline,
    failedCheck(
      record + '# failing tests:\n# test at /workspace/test.ts:1\n' + record,
    ),
  )
  assert.deepEqual(comparison.delta.new, [])
  assert.deepEqual(comparison.delta.fixed, [])
  assert.equal(comparison.delta.carried[0]?.count, 1)
  const duplicate = compareRepositoryCheckToBaseline(
    baseline,
    failedCheck(record + record),
  )
  assert.deepEqual(duplicate.delta.new, [
    { ...comparison.delta.carried[0]!, count: 1 },
  ])
  assert.deepEqual(duplicate.delta.fixed, [])
})

test('mixed pytest output retains additional tool errors even with a recognized pytest failure', () => {
  const before =
    'plugins: anyio-4.0.0\nFAILED test.py::old - AssertionError: old\n'
  const error = 'src/other.py:<line>: error: Missing return statement [return]'
  const comparison = compareRepositoryCheckToBaseline(
    failedCheck(before),
    failedCheck(
      before + 'src/other.py:4: error: Missing return statement [return]\n',
    ),
  )
  assert.deepEqual(comparison.delta.new, [
    {
      kind: 'command',
      command: 'npm run lint',
      diagnostic: error,
      count: 1,
    },
  ])
  assert.deepEqual(comparison.delta.fixed, [])
})

test('unsupported and truncated output remains visible and passing commands contribute no failures', () => {
  for (const output of [
    'unrecognized tool output',
    'fatal: new crash',
    '…[output elided]…',
  ]) {
    const comparison = compareRepositoryCheckToBaseline(
      failedCheck(''),
      failedCheck(output),
    )
    assert.deepEqual(comparison.delta.new, [
      {
        kind: 'command',
        command: 'npm run lint',
        diagnostic: output,
        count: 1,
      },
    ])
    assert.deepEqual(comparison.delta.fixed, [])
  }
  const incomplete = compareRepositoryCheckToBaseline(
    failedCheck(''),
    failedCheck("not ok 1 - truncated\n  ---\n  error: 'partial'\n"),
  )
  assert.deepEqual(incomplete.delta.new, [
    {
      kind: 'command',
      command: 'npm run lint',
      diagnostic:
        "not ok <index> - truncated\nerror: 'partial'\n<incomplete TAP assertion>",
      count: 1,
    },
  ])
  const passed = passedCheck()
  passed.results[0]!.stdout = 'not ok 99 - ordinary captured application text'
  const comparison = compareRepositoryCheckToBaseline(passedCheck(), passed)
  assert.deepEqual(comparison.delta.new, [])
  assert.deepEqual(comparison.delta.fixed, [])
})

test('command, exit, signal and timeout changes retain exact status identities', () => {
  const diagnostic = 'AssertionError: mismatch'
  const baseline = failedCheck(diagnostic)
  for (const override of [
    { exit_code: 2 },
    { signal: 'SIGTERM' as const },
    { timed_out: true },
  ]) {
    const current = failedCheck(diagnostic, override)
    const entry = current.results[0]!
    const comparison = compareRepositoryCheckToBaseline(baseline, current)
    assert.deepEqual(comparison.delta.new, [
      {
        kind: 'command',
        command: 'npm run lint',
        diagnostic: `<status> exit_code=${entry.exit_code} signal=${entry.signal ?? 'null'} timed_out=${entry.timed_out}`,
        count: 1,
      },
    ])
    assert.deepEqual(comparison.delta.fixed, [
      {
        kind: 'command',
        command: 'npm run lint',
        diagnostic: '<status> exit_code=1 signal=null timed_out=false',
        count: 1,
      },
    ])
  }
  const comparison = compareRepositoryCheckToBaseline(
    baseline,
    failedCheck(diagnostic, { command: 'another checker' }),
  )
  assert.deepEqual(comparison.delta.new, [
    {
      kind: 'command',
      command: 'another checker',
      diagnostic: '<status> exit_code=1 signal=null timed_out=false',
      count: 1,
    },
    { kind: 'command', command: 'another checker', diagnostic, count: 1 },
  ])
  assert.deepEqual(comparison.delta.fixed, [
    {
      kind: 'command',
      command: 'npm run lint',
      diagnostic: '<status> exit_code=1 signal=null timed_out=false',
      count: 1,
    },
    { kind: 'command', command: 'npm run lint', diagnostic, count: 1 },
  ])
})

test('nested TAP occurrences retain their suite identity', () => {
  const suite = (name: string): string =>
    `# Subtest: ${name}\n    # Subtest: same child\n    not ok 1 - same child\n      ---\n      error: 'mismatch'\n      ...\n`
  const baseline = failedCheck(suite('first'))
  const comparison = compareRepositoryCheckToBaseline(
    baseline,
    failedCheck(suite('first') + suite('second')),
  )
  assert.deepEqual(comparison.delta.new, [
    {
      kind: 'command',
      command: 'npm run lint',
      diagnostic:
        "not ok <index> - same child (suite: second)\nerror: 'mismatch'",
      count: 1,
    },
  ])
  assert.deepEqual(comparison.delta.fixed, [])
})

test('TAP literal blocks preserve blank lines and trailing whitespace', () => {
  const before =
    "not ok 1 - multiline value\n  ---\n  expected: 'other'\n  actual: |-\n    first\n    second\n  ...\n"
  const diagnostic =
    "not ok <index> - multiline value\nexpected: 'other'\nactual: |-\n  first\n  second"

  for (const [from, to, normalized] of [
    ['first\n', 'first\n\n', 'first\n\n'],
    ['first\n', 'first \n', 'first \n'],
    ['first\n', 'first\n    \n', 'first\n  \n'],
  ]) {
    const comparison = compareRepositoryCheckToBaseline(
      failedCheck(before),
      failedCheck(before.replace(from, to)),
    )
    const identity = (value: string) => ({
      kind: 'command',
      command: 'npm run lint',
      diagnostic: value,
      count: 1,
    })

    assert.deepEqual(comparison.delta.fixed, [identity(diagnostic)])
    assert.deepEqual(comparison.delta.new, [
      identity(diagnostic.replace(from, normalized)),
    ])
  }
})

for (const [label, replacement, normalized] of [
  ['blank line', 'first\n\n', 'first\n\n'],
  ['whitespace-only line', 'first\n    \n', 'first\n  \n'],
  ['trailing space', 'first \n', 'first \n'],
]) {
  test(`TAP error scalars retain a changed ${label}`, () => {
    const before =
      'not ok 1 - explicit assertion failure\n  ---\n  error: |-\n    first\n    second\n  ...\n'
    const diagnostic =
      'not ok <index> - explicit assertion failure\nerror: |-\n  first\n  second'
    const identity = (value: string) => ({
      kind: 'command',
      command: 'npm run lint',
      diagnostic: value,
      count: 1,
    })
    const comparison = compareRepositoryCheckToBaseline(
      failedCheck(before),
      failedCheck(before.replace('first\n', replacement)),
    )

    assert.deepEqual(comparison.delta.new, [
      identity(diagnostic.replace('first\n', normalized)),
    ])
    assert.deepEqual(comparison.delta.fixed, [identity(diagnostic)])
  })
}

for (const field of ['error', 'expected', 'actual']) {
  test(`TAP ${field} scalars retain embedded terminators and subsequent content`, () => {
    const before = `not ok 1 - literal terminator\n  ---\n  ${field}: |-\n    first\n    ...\n    second\n  ...\n`
    const diagnostic = `not ok <index> - literal terminator\n${field}: |-\n  first\n  ...\n  second`
    const identity = (value: string) => ({
      kind: 'command',
      command: 'npm run lint',
      diagnostic: value,
      count: 1,
    })
    const baseline = failedCheck(before)
    const unchanged = compareRepositoryCheckToBaseline(
      baseline,
      failedCheck(before),
    )

    assert.deepEqual(unchanged.delta.new, [])
    assert.deepEqual(unchanged.delta.fixed, [])

    for (const [from, to] of [
      ['...\n', '... \n'],
      ['second', 'changed second'],
    ]) {
      const comparison = compareRepositoryCheckToBaseline(
        baseline,
        failedCheck(before.replace(from, to)),
      )

      assert.equal(comparison.passed, false)
      assert.deepEqual(comparison.delta.new, [
        identity(diagnostic.replace(from, to)),
      ])
      assert.deepEqual(comparison.delta.fixed, [identity(diagnostic)])
    }

    assert.deepEqual(unchanged.delta.carried, [identity(diagnostic)])

    const incomplete = compareRepositoryCheckToBaseline(
      baseline,
      failedCheck(before.slice(0, -'\n  ...\n'.length)),
    )

    assert.equal(incomplete.passed, false)
    assert.deepEqual(incomplete.delta.new, [
      identity(`${diagnostic}\n<incomplete TAP assertion>`),
    ])
    assert.deepEqual(incomplete.delta.fixed, [identity(diagnostic)])
  })
}

test('TAP location retains the source filename while ignoring line and column', () => {
  const transcript = (file: string, line: number, column: number): string =>
    `TAP version 13\n# Subtest: same case\nnot ok 1 - same case\n  ---\n  location: '/workspace/tests/unit/${file}.test.ts:${line}:${column}'\n  error: 'mismatch'\n  ...\n1..1\n`
  const baseline = failedCheck(transcript('a', 10, 2))
  const moved = compareRepositoryCheckToBaseline(
    baseline,
    failedCheck(transcript('a', 20, 3)),
  )
  const identity = (file: string) => ({
    kind: 'command',
    command: 'npm run lint',
    diagnostic: `not ok <index> - same case\nlocation: '<workspace>/tests/unit/${file}.test.ts:<line>:<column>'\nerror: 'mismatch'`,
    count: 1,
  })

  assert.deepEqual(moved.delta.new, [])
  assert.deepEqual(moved.delta.fixed, [])
  assert.deepEqual(moved.delta.carried, [identity('a')])

  const renamed = compareRepositoryCheckToBaseline(
    baseline,
    failedCheck(transcript('b', 10, 2)),
  )

  assert.deepEqual(renamed.delta.new, [identity('b')])
  assert.deepEqual(renamed.delta.fixed, [identity('a')])
})

test('TAP product assertions cannot establish infrastructure identity', () => {
  const stage = stageBySlug(loadWorkflow(process.cwd(), 'delivery'), 'verify')
  const baseline = failedCheck(
    'ERROR collecting tests/legacy.py - ImportError: missing\n',
  )
  const comparisonWith = (diagnostic: string) =>
    compareRepositoryCheckToBaseline(
      baseline,
      failedCheck(baseline.results[0]!.stderr + diagnostic + '\n'),
    )

  for (const phrase of [
    'ERROR collecting',
    'ImportError: missing',
    'ModuleNotFoundError: missing',
    'ETIMEDOUT',
    'timed out',
    'worker crashed',
  ]) {
    for (const headline of [
      'not ok - newly failing product test (/workspace/tests/unit/product.test.ts:10)',
      'not ok 1 - newly failing product test',
    ]) {
      const comparison = comparisonWith(
        `${headline}\n    AssertionError: expected ${phrase} in the output`,
      )

      assert.equal(comparison.delta.new.length, 1)
      assert.equal(
        isEnvironmentBlockedDelta(stage, baseline, comparison),
        false,
        `${headline}: ${phrase}`,
      )
    }
  }

  for (const diagnostic of [
    'ERROR collecting tests/new.py - ImportError: missing',
    'E ImportError: missing',
    'ETIMEDOUT',
    'worker crashed',
  ]) {
    assert.equal(
      isEnvironmentBlockedDelta(stage, baseline, comparisonWith(diagnostic)),
      true,
      diagnostic,
    )
  }
})

test('independent TAP documents, suite instances and streams retain occurrences', () => {
  const record =
    "not ok 1 - repeated failure\n  ---\n  error: 'mismatch'\n  ...\n"
  const document = `TAP version 13\n${record}1..1\n`
  const suite = `# Subtest: repeated suite\n${record
    .split('\n')
    .filter(Boolean)
    .map((line) => `    ${line}\n`)
    .join('')}`
  const cases: Array<[RepositoryCheckResult, RepositoryCheckResult]> = [
    [failedCheck(document), failedCheck(document + document)],
    [failedCheck(suite), failedCheck(suite + suite)],
    [failedCheck(record), failedCheck(record, { stdout: record })],
  ]

  for (const [baseline, current] of cases) {
    const comparison = compareRepositoryCheckToBaseline(baseline, current)

    assert.deepEqual(comparison.delta.new, [
      { ...comparison.delta.carried[0]!, count: 1 },
    ])
    assert.deepEqual(comparison.delta.fixed, [])
    assert.equal(comparison.delta.carried[0]?.count, 1)
  }
})

test('pytest retains unknown nonmetadata output alongside recognized failures', () => {
  const before =
    'plugins: anyio-4.0.0\nFAILED test.py::old - AssertionError: old\n'

  for (const diagnostic of [
    'panic: index out of range [1] with length 1',
    'unrecognized tool output',
    'platform: unsupported foreign target',
    'timeout: foreign operation failed',
    'class UnexpectedFailure(Exception):',
  ]) {
    const comparison = compareRepositoryCheckToBaseline(
      failedCheck(before),
      failedCheck(before + diagnostic + '\n'),
    )

    assert.deepEqual(comparison.delta.new, [
      { kind: 'command', command: 'npm run lint', diagnostic, count: 1 },
    ])
    assert.deepEqual(comparison.delta.fixed, [])
  }
})

test('actual impacted wrapper metadata does not change failure identities', () => {
  const record = 'not ok - stable failure\n    AssertionError: mismatch\n'
  const output = (seconds: number, count: number): string =>
    `[tests impacted] running ${count} of 196 lane test file(s) for 6 changed file(s) (log: runtime/logs/checks/tests-impacted-${seconds}.log)\n` +
    `[tests impacted] # heartbeat ${seconds}s: ${count} passed, 1 failed, ${count} files done\n` +
    record +
    `[tests impacted] FAILED: ${count} of 196 lane test file(s) (exit 1) in ${seconds}s\n` +
    '# failing tests:\n' +
    record +
    `log: runtime/logs/checks/tests-impacted-${seconds}.log\n`
  const comparison = compareRepositoryCheckToBaseline(
    failedCheck(output(30, 4)),
    failedCheck(output(60, 9)),
  )

  assert.deepEqual(comparison.delta.new, [])
  assert.deepEqual(comparison.delta.fixed, [])
  assert.deepEqual(comparison.delta.carried, [
    {
      kind: 'command',
      command: 'npm run lint',
      diagnostic: 'not ok - stable failure\nAssertionError: mismatch',
      count: 1,
    },
  ])
})
