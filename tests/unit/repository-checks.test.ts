import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  compareRepositoryCheckToBaseline,
  loadRepositoryChecks,
  repositoryChecksSourcePath,
  runRepositorySetup,
  runRepositoryCheck,
  runRepositoryCheckStreaming,
} from '../../src/lib/repository-checks.js'
import type { RepositoryCheckResult } from '../../src/lib/repository-checks.js'
import { createFixture } from '../helpers.js'

function makeInstallation(): { root: string; workspace: string } {
  const parent = mkdtempSync(path.join(tmpdir(), 'pancreator-checks-'))
  const root = path.join(parent, '.pancreator')
  const workspace = path.join(parent, 'workspace')

  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  mkdirSync(workspace, { recursive: true })
  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        installation_mode: 'embedded',
        workspace_root: '../workspace',
        state_root: 'runtime',
      },
      null,
      2,
    )}\n`,
  )

  return { root, workspace }
}

function writeChecks(root: string, profiles: Record<string, unknown>): void {
  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({ schema_version: 1, profiles }, null, 2)}\n`,
  )
}

test('repository checks report missing profiles without guessing commands', () => {
  const { root } = makeInstallation()

  const result = runRepositoryCheck(root, 'full')

  assert.equal(result.status, 'not_configured')
  assert.deepEqual(result.results, [])

  // A configuration that declares no setup commands reports the same.
  writeChecks(root, {})

  const setup = runRepositorySetup(root)

  assert.equal(setup.status, 'not_configured')
  assert.deepEqual(setup.results, [])
})

test('self-development uses a tracked fallback without requiring runtime state', () => {
  const root = createFixture()
  const runtimeConfig = path.join(root, 'runtime', 'repository-checks.json')

  // Fixtures may copy ignored local runtime state from the source checkout.
  // Removing it verifies behavior from a clean Git clone.
  rmSync(runtimeConfig, { force: true })

  const config = loadRepositoryChecks(root)

  assert.deepEqual(config.profiles.static?.commands, ['npm run lint'])
  assert.match(
    repositoryChecksSourcePath(root),
    /library\/templates\/repository-checks\.self-development\.json$/u,
  )
})

test('repository checks run probes and commands in the configured workspace', () => {
  const { root, workspace } = makeInstallation()

  writeChecks(root, {
    fast: {
      description: 'fixture checks',
      probes: ['node -p "process.execPath"', 'node --version'],
      commands: ['node -e "process.stdout.write(process.cwd())"'],
    },
  })

  const result = runRepositoryCheck(root, 'fast')

  assert.equal(result.status, 'passed')
  assert.deepEqual(
    result.results.map((item) => item.kind),
    ['probe', 'probe', 'command'],
  )
  assert.equal(
    realpathSync(result.results[2]?.stdout ?? ''),
    realpathSync(workspace),
  )
  assert.match(result.results[0]?.stdout ?? '', /node/u)
  assert.match(result.results[1]?.stdout ?? '', /^v\d+/u)
})

test('a failed command does not stop the remaining command partitions', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    static: {
      probes: [],
      commands: [
        'node -e "console.error(\'backend partition failure\'); process.exit(1)"',
        'node -e "process.stdout.write(\'frontend partition ran\')"',
      ],
    },
  })

  const result = runRepositoryCheck(root, 'static')

  // Commands are independently meaningful partitions: an early backend
  // failure must not leave the frontend partition uncaptured, or a baseline
  // would represent surfaces it never observed.
  assert.equal(result.status, 'failed')
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0]?.passed, false)
  assert.equal(result.results[1]?.passed, true)
  assert.match(result.results[1]?.stdout ?? '', /frontend partition ran/u)
})

test('repository checks stop after a failed probe', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    static: {
      probes: ['node -e "process.exit(7)"'],
      commands: ['node -e "process.exit(0)"'],
    },
  })

  const result = runRepositoryCheck(root, 'static')

  assert.equal(result.status, 'failed')
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0]?.exit_code, 7)
})

test('repository checks run environment probes before ordinary probes', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    static: {
      environment_probes: ['node -e "process.exit(9)"'],
      probes: ['node -e "process.exit(0)"'],
      commands: ['node -e "process.exit(0)"'],
    },
  })

  const result = runRepositoryCheck(root, 'static')

  assert.equal(result.status, 'failed')
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0]?.kind, 'probe')
  assert.equal(result.results[0]?.exit_code, 9)
})

test('repository check configuration rejects malformed command arrays', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    full: {
      probes: [],
      commands: [''],
    },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /MUST be a non-empty command string/u,
  )
})

test('repository check configuration rejects identical fast and full commands', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      probes: ['node --version'],
      commands: ['node -e "process.exit(0)"'],
    },
    full: {
      probes: ['node --version'],
      commands: ['node   -e   "process.exit(0)"'],
    },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /profiles\.fast MUST NOT duplicate profiles\.full/u,
  )
})

test('repository check supersets cannot shorten subset timeouts', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      timeout_ms: 10_000,
      probes: [],
      commands: ['node -e "process.exit(0)"'],
    },
    full: {
      timeout_ms: 5_000,
      probes: [],
      commands: [
        'node -e "process.exit(0)"',
        'node -e "process.stdout.write(\'full\')"',
      ],
    },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /profiles\.full\.timeout_ms MUST be at least .*profiles\.fast\.timeout_ms/u,
  )
})

function failedCheck(
  stderr: string,
  workspaceRoot = '/workspace',
  overrides: Partial<RepositoryCheckResult['results'][number]> = {},
): RepositoryCheckResult {
  return {
    profile: 'static',
    status: 'failed',
    config_path: '/harness/runtime/repository-checks.json',
    workspace_root: workspaceRoot,
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

  // A fully repaired check passes with every inherited failure fixed.
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

test('baseline delta ignores xdist scheduling and passing test output', () => {
  const baseline = failedCheck(
    '[gw0] [ 50%] PASSED tests/example_test.py::test_ok\n' +
      '/workspace/src/a.ts:10:2 error Unexpected value no-example\n',
  )
  const current = failedCheck(
    '[gw3] [ 75%] PASSED tests/example_test.py::test_ok\n' +
      '/workspace/src/a.ts:40:9 error Unexpected value no-example\n',
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, true)
  assert.equal(comparison.delta.new.length, 0)
})

test('repeated fast profiles ignore reordered xdist pass output', () => {
  // The same passing xdist transcript, with the "::test PASSED" lines
  // scheduled onto different workers in a different order.
  const transcript = (tests: string[]): string =>
    [
      'plugins: xdist-3.8.0',
      ...tests.map(
        (name, index) =>
          `[gw${index}] [ ${index * 50}%] tests/example.py::${name} PASSED`,
      ),
      '================ 2 passed in 0.01s ================',
      '',
    ].join('\n')
  const passingRun = (stdout: string): RepositoryCheckResult => {
    const check = passedCheck()

    check.profile = 'fast'
    check.results[0] = {
      ...check.results[0],
      command: 'node check.mjs',
      stdout,
    }

    return check
  }
  const baseline = passingRun(transcript(['test_a', 'test_b']))
  const current = passingRun(transcript(['test_b', 'test_a']))
  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, true)
  assert.deepEqual(comparison.delta, {
    new: [],
    fixed: [],
    carried: [],
    counts: { new: 0, fixed: 0, carried: 0 },
  })
  assert.ok(Buffer.byteLength(JSON.stringify(current), 'utf8') < 1024 * 1024)
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

test('gate explanations do not quote passing-output churn', () => {
  const comparison = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck('tests/example_test.py::test_ok PASSED\n'),
  )

  assert.match(comparison.explanation, /no genuine failure identity/u)
  assert.doesNotMatch(comparison.explanation, /PASSED/u)
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
  const current = failedCheck(
    '/workspace/src/a.ts:10:2 error Unexpected value no-example\n',
  )

  const comparison = compareRepositoryCheckToBaseline(passedCheck(), current)

  assert.equal(comparison.passed, false)
  assert.equal(comparison.delta.new.length > 0, true)

  // The explanation quotes the printed failure rather than the exit status.
  const explained = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck('AssertionError: expected true\n'),
  )

  assert.match(explained.explanation, /AssertionError: expected true/u)
  assert.doesNotMatch(explained.explanation, /<status>/u)
})

test('baseline delta treats a changed exit status as new', () => {
  const baseline = failedCheck('same diagnostic text\n')

  // An identical current run carries the failure without anything new.
  const unchanged = compareRepositoryCheckToBaseline(
    baseline,
    failedCheck('same diagnostic text\n'),
  )

  assert.equal(unchanged.passed, true)
  assert.equal(unchanged.delta.new.length, 0)
  assert.equal(unchanged.delta.fixed.length, 0)
  assert.equal(unchanged.delta.carried.length, 1)

  const current = failedCheck('same diagnostic text\n', '/workspace', {
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

test('streaming repository checks emit subprocess output before returning the result', async () => {
  const { root } = makeInstallation()
  const stdout: string[] = []
  const starts: string[] = []

  writeChecks(root, {
    fast: {
      timeout_ms: 5_000,
      probes: [],
      commands: [
        "node -e \"process.stdout.write('first\\n'); setTimeout(() => process.stdout.write('second\\n'), 25)\"",
      ],
    },
  })

  const result = await runRepositoryCheckStreaming(root, 'fast', {
    on_start: (kind, command) => starts.push(`${kind}:${command}`),
    on_stdout: (chunk) => stdout.push(chunk),
  })

  assert.equal(result.status, 'passed')
  assert.equal(result.timeout_ms, 5_000)
  assert.equal(starts.length, 1)
  assert.equal(starts[0]?.startsWith('command:'), true)
  assert.match(stdout.join(''), /first\nsecond/u)
})

test('stage-requested timeout overrides the profile default', () => {
  const { root } = makeInstallation()

  // The configuration floor for timeout_ms is 1000 ms, so the command sleeps
  // just past that floor.
  writeChecks(root, {
    fast: {
      timeout_ms: 1_000,
      probes: [],
      commands: ['node -e "setTimeout(() => process.exit(0), 1300)"'],
    },
  })

  const result = runRepositoryCheck(root, 'fast', { timeout_ms: 5_000 })

  assert.equal(result.status, 'passed')
  assert.equal(result.timeout_ms, 5_000)
  assert.equal(result.results[0]?.timed_out, false)

  // Without the override, the profile default applies and the command times
  // out.
  const direct = runRepositoryCheck(root, 'fast')

  assert.equal(direct.status, 'failed')
  assert.equal(direct.timeout_ms, 1_000)
  assert.equal(direct.results[0]?.timed_out, true)
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
      `src/other.py:4: error: Missing return statement [return]\n`,
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, false)
  assert.equal(comparison.delta.new.length, 1)
  assert.match(
    comparison.delta.new[0]?.diagnostic ?? '',
    /Missing return statement/u,
  )
})

test('a current-path harness-managed worktree resolves the owning installation runtime config', () => {
  const { root } = makeInstallation()

  writeChecks(root, { fast: { probes: [], commands: ['echo ok'] } })

  const worktree = path.join(root, 'worktrees', 'operator', 'wt')
  const runtimeWorktree = path.join(
    root,
    'runtime',
    'worktrees',
    'operator',
    'wt',
  )

  mkdirSync(worktree, { recursive: true })
  mkdirSync(runtimeWorktree, { recursive: true })

  assert.equal(
    repositoryChecksSourcePath(worktree),
    path.join(root, 'runtime', 'repository-checks.json'),
  )
  // The runtime configuration is untracked, so the worktree never carries it;
  // resolution must reach the owning installation rather than fall back to a
  // weaker template suite.
  assert.equal(
    repositoryChecksSourcePath(runtimeWorktree),
    path.join(root, 'runtime', 'repository-checks.json'),
  )
})

test('workspace setup commands load, run in order, and stop at the first failure', () => {
  const { root } = makeInstallation()

  writeFileSync(
    path.join(root, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({
      schema_version: 1,
      setup: ['echo one', 'node -e "process.exit(1)"', 'echo never'],
      profiles: {},
    })}\n`,
  )

  const config = loadRepositoryChecks(root)

  assert.deepEqual(config.setup, [
    'echo one',
    'node -e "process.exit(1)"',
    'echo never',
  ])

  const result = runRepositorySetup(root)

  assert.equal(result.status, 'failed')
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0].passed, true)
  assert.equal(result.results[1].passed, false)
})
