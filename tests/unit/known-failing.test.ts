import assert from 'node:assert/strict'
import test from 'node:test'

import {
  creditKnownFailures,
  parseKnownFailingTests,
} from '../../src/lib/known-failing.js'
import type {
  RepositoryCheckCommandResult,
  RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'

function failingCommand(
  command: string,
  stdout: string,
): RepositoryCheckCommandResult {
  return {
    kind: 'command',
    command,
    exit_code: 1,
    signal: null,
    stdout,
    stderr: '',
    passed: false,
    timed_out: false,
    duration_ms: 10,
  }
}

function result(
  ...results: RepositoryCheckCommandResult[]
): RepositoryCheckResult {
  return {
    profile: 'fast',
    status: 'failed',
    config_path: 'runtime/repository-checks.json',
    workspace_root: '/workspace',
    timeout_ms: 120_000,
    results,
    total_duration_ms: 10,
    advisories: [],
  }
}

test('a declaration names one case and a reason', () => {
  const declarations = parseKnownFailingTests(
    [
      '# Request',
      '',
      '## Known-failing tests',
      '',
      '- `tests/unit/inbox.test.ts > listInbox ignores nested directories` — upstream fixture drift.',
      '',
      '## Next',
      '',
      '- `tests/unit/other.test.ts > not in the section` — outside the section.',
    ].join('\n'),
  )

  assert.deepEqual(declarations, [
    {
      file: 'tests/unit/inbox.test.ts',
      case: 'listInbox ignores nested directories',
      reason: 'upstream fixture drift.',
    },
  ])
})

// AC-021: a file-wide declaration would credit the very regression the gate
// exists to catch, so it parses to nothing rather than to a loose match.
test('a declaration that names only a file path credits nothing', () => {
  const declarations = parseKnownFailingTests(
    [
      '## Known-failing tests',
      '',
      '- `tests/unit/inbox.test.ts` — the whole file is flaky.',
      '- `tests/unit/inbox.test.ts > names a case but no reason`',
    ].join('\n'),
  )

  assert.deepEqual(declarations, [])
})

test('a declared failure is credited and an undeclared one is not', () => {
  const declarations = parseKnownFailingTests(
    [
      '## Known-failing tests',
      '',
      '- `tests/unit/a.test.ts > declared case` — tracked upstream.',
    ].join('\n'),
  )
  const declaredOnly = creditKnownFailures(
    result(
      failingCommand(
        'npm test',
        [
          'FAIL tests/unit/a.test.ts > declared case',
          'AssertionError: expected 1 to equal 2',
          '    at Object.<anonymous> (/workspace/tests/unit/a.test.ts:12:3)',
        ].join('\n'),
      ),
    ),
    declarations,
  )

  assert.equal(declaredOnly.credited.length, 1)
  // AC-021: the assertion text and stack frame describe the same failure the
  // headline already named, so neither counts as its own diagnostic.
  assert.deepEqual(declaredOnly.undeclared, [])

  const withUndeclared = creditKnownFailures(
    result(
      failingCommand(
        'npm test',
        [
          'FAIL tests/unit/a.test.ts > declared case',
          'FAIL tests/unit/b.test.ts > undeclared case',
        ].join('\n'),
      ),
    ),
    declarations,
  )

  assert.equal(withUndeclared.credited.length, 1)
  assert.equal(withUndeclared.undeclared.length, 1)
  assert.match(withUndeclared.undeclared[0], /undeclared case/u)
})

// AC-021. The gate accepts a profile when nothing is undeclared, so a failing
// command that contributed no diagnostic at all was laundered into a baseline
// pass by one credited case elsewhere in the same profile. A killed build step
// or a tool that exits non-zero in silence is exactly that shape.
test('a failing command that prints nothing is undeclared beside a credited case', () => {
  const declarations = parseKnownFailingTests(
    [
      '## Known-failing tests',
      '',
      '- `tests/unit/a.test.ts > declared case` — tracked upstream.',
    ].join('\n'),
  )
  const credit = creditKnownFailures(
    result(
      failingCommand('npm test', 'FAIL tests/unit/a.test.ts > declared case'),
      failingCommand('npm run build', ''),
    ),
    declarations,
  )

  assert.equal(credit.credited.length, 1)
  assert.equal(credit.undeclared.length, 1)
  assert.match(credit.undeclared[0], /npm run build/u)
})

// AC-021. A runner that never finished reporting named no case a declaration
// could cover, and `GATE_CACHE_ACCEPTANCE_RULE` already refuses to credit a
// timeout. The transcript it managed to print before the kill does not change
// that, so a declared headline inside it earns nothing.
test('a timed-out command is never credited, whatever its transcript holds', () => {
  const timedOut = failingCommand(
    'npm test',
    'FAIL tests/unit/a.test.ts > declared case',
  )

  timedOut.timed_out = true

  const credit = creditKnownFailures(
    result(timedOut),
    parseKnownFailingTests(
      [
        '## Known-failing tests',
        '',
        '- `tests/unit/a.test.ts > declared case` — tracked upstream.',
      ].join('\n'),
    ),
  )

  assert.deepEqual(credit.credited, [])
  assert.equal(credit.undeclared.length, 1)
  assert.match(credit.undeclared[0], /timed out/u)
})

// AC-021. A failed probe means the environment was not ready, which is the one
// condition a gate must never report as a known-failing baseline.
test('a failed probe is never credited, whatever its transcript holds', () => {
  const probe = failingCommand(
    'node --version',
    'FAIL tests/unit/a.test.ts > declared case',
  )

  probe.kind = 'probe'
  probe.exit_code = 127

  const credit = creditKnownFailures(
    result(probe),
    parseKnownFailingTests(
      [
        '## Known-failing tests',
        '',
        '- `tests/unit/a.test.ts > declared case` — tracked upstream.',
      ].join('\n'),
    ),
  )

  assert.deepEqual(credit.credited, [])
  assert.equal(credit.undeclared.length, 1)
  assert.match(credit.undeclared[0], /probe `node --version`/u)
})

// A linter reports no test case, so there is nothing a declaration could have
// named and every diagnostic it prints is judged.
test('a failing command that reports no test case is never credited', () => {
  const credit = creditKnownFailures(
    result(
      failingCommand(
        'npm run lint',
        'src/lib/inbox.ts:12:3 error Unexpected any',
      ),
    ),
    parseKnownFailingTests(
      [
        '## Known-failing tests',
        '',
        '- `src/lib/inbox.ts > anything` — tracked upstream.',
      ].join('\n'),
    ),
  )

  assert.deepEqual(credit.credited, [])
  assert.equal(credit.undeclared.length, 1)
})

/**
 * Verbatim stdout of this repository's own `failures-only` reporter, captured
 * by running two deliberately failing cases through
 * `node --test --test-reporter=./dist/tests/reporters/failures-only.js`. A
 * hand-written TAP shape would have hidden two real properties of it: the
 * headline carries the compiled `dist/**.js` path rather than the `.ts` path
 * an operator declares, and the assertion text and stack frames arrive as
 * their own lines beneath it.
 */
const REPORTER_TRANSCRIPT = `
not ok - legacy parser accepts an empty body (/workspace/dist/tests/unit/legacy.test.js:3)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

    undefined !== 1

        at TestContext.<anonymous> (file:///workspace/dist/tests/unit/legacy.test.js:4:12)
        at Test.runInAsyncScope (node:async_hooks:214:14)
        at Test.run (node:internal/test_runner/test:1047:25)
        at Test.start (node:internal/test_runner/test:944:17)
        at startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)

not ok - fresh parser rejects a trailing comma (/workspace/dist/tests/unit/fresh.test.js:6)
    AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:

      assert.ok(false)

        at TestContext.<anonymous> (file:///workspace/dist/tests/unit/fresh.test.js:7:12)
        at Test.runInAsyncScope (node:async_hooks:214:14)
# tests 2
# pass 0
# fail 2
`

test('the matcher credits the shape this repository’s own reporter prints', () => {
  const declarations = parseKnownFailingTests(
    [
      '## Known-failing tests',
      '',
      '- `tests/unit/legacy.test.ts > legacy parser accepts an empty body` — ' +
        'the legacy parser is scheduled for removal.',
    ].join('\n'),
  )

  assert.equal(declarations.length, 1)

  const credit = creditKnownFailures(
    result(failingCommand('npm test', REPORTER_TRANSCRIPT)),
    declarations,
  )

  // The declaration names the source path; the reporter names the compiled
  // one. Crediting is the whole point of the declaration, so the two spellings
  // must meet.
  assert.equal(credit.credited.length, 1)
  assert.match(credit.credited[0], /legacy parser accepts an empty body/u)

  // The undeclared case is the second headline and nothing else: not the
  // assertion text, not one of the six stack frames.
  assert.equal(credit.undeclared.length, 1)
  assert.match(credit.undeclared[0], /fresh parser rejects a trailing comma/u)
})

test('a fully declared reporter transcript leaves nothing undeclared', () => {
  const credit = creditKnownFailures(
    result(failingCommand('npm test', REPORTER_TRANSCRIPT)),
    parseKnownFailingTests(
      [
        '## Known-failing tests',
        '',
        '- `tests/unit/legacy.test.ts > legacy parser accepts an empty body` — ' +
          'scheduled for removal.',
        '- `tests/unit/fresh.test.ts > fresh parser rejects a trailing comma` — ' +
          'blocked on an upstream fix.',
      ].join('\n'),
    ),
  )

  assert.equal(credit.credited.length, 2)
  assert.deepEqual(credit.undeclared, [])
})
