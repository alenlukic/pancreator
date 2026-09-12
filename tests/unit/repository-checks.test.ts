import assert from 'node:assert/strict'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  AGENT_REPOSITORY_CHECK_RUNS_FILE,
  agentRepositoryCheckAdvisories,
  compareRepositoryCheckToBaseline,
  loadRepositoryChecks,
  MAX_CAPTURE_BYTES,
  recordAgentRepositoryCheck,
  recordAgentRepositoryCheckForRuns,
  recordProfileGatePass,
  REPOSITORY_CHECK_FAST_REPEATED,
  repositoryChecksSourcePath,
  runRepositorySetup,
  runRepositoryCheck,
  runRepositoryCheckStreaming,
  SUMMARY_STREAM_HEAD_BYTES,
  SUMMARY_STREAM_TAIL_BYTES,
} from '../../src/lib/repository-checks.js'
import type { RepositoryCheckResult } from '../../src/lib/repository-checks.js'
import {
  gateCacheKey,
  gateCacheLookup,
  repositoryCheckGateCommand,
} from '../../src/lib/gate-cache.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadRepositoryCheckBaseline } from '../../src/lib/validation.js'
import type { RunState } from '../../src/lib/types.js'
import {
  createFixture,
  createRun,
  createTestTempDirectory,
  writeJson,
} from '../helpers.js'

/** The checkout under test, which `bin/run-tests` runs the suite from. */
const REPO_ROOT = process.cwd()

/**
 * A profile command that backgrounds a grandchild ticking `file` until it is
 * killed. The `& wait` shape puts the ticker outside the shell the runner
 * spawns, so only a process-group kill reaches it.
 */
function heartbeatCommand(file: string): string {
  return (
    `sh -c "node -e \\"setInterval(() => require('node:fs')` +
    `.appendFileSync('${file}', 'x'), 25); setTimeout(() => {}, 30000)\\"" & wait`
  )
}

/** Ticks the heartbeat grandchild has written so far. */
function heartbeatCount(file: string): number {
  return existsSync(file) ? readFileSync(file, 'utf8').length : 0
}

function makeInstallation(): { root: string; workspace: string } {
  const parent = createTestTempDirectory('checks-')
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

test('an elided baseline loads its full result before comparison', () => {
  const root = createTestTempDirectory('elided-check-')
  const artifactDirectory = 'runtime/logs/workflows/run-1/agent/artifacts/json'
  const summaryPath = `${artifactDirectory}/baseline-static.json`
  const fullPath = `${artifactDirectory}/baseline-static.full.json`
  const count = Math.ceil(
    (SUMMARY_STREAM_HEAD_BYTES + SUMMARY_STREAM_TAIL_BYTES) / 24,
  )
  const diagnostics = Array.from(
    { length: count },
    (_, index) => `stable diagnostic ${index}`,
  )
  const check = (stderr: string): RepositoryCheckResult => ({
    profile: 'static',
    status: 'failed',
    config_path: 'runtime/repository-checks.json',
    workspace_root: '.',
    timeout_ms: 60_000,
    results: [
      {
        kind: 'command',
        command: 'node -e "..."',
        exit_code: 1,
        signal: null,
        stdout: '',
        stderr,
        passed: false,
        timed_out: false,
        duration_ms: 1,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  })
  const artifact = (result: RepositoryCheckResult, full?: string) => ({
    schema_version: 1,
    run_id: 'run-1',
    stage: 'implement',
    profile: 'static',
    workspace_fingerprint: 'fixture',
    recorded_at: '2026-08-24T00:00:00.000Z',
    result,
    ...(full ? { full_result_path: full } : {}),
  })

  mkdirSync(path.join(root, artifactDirectory), { recursive: true })
  writeFileSync(
    path.join(root, summaryPath),
    `${JSON.stringify(
      artifact(
        check('…[bytes elided; see the full result artifact]…\n'),
        fullPath,
      ),
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    path.join(root, fullPath),
    `${JSON.stringify(artifact(check(`${diagnostics.join('\n')}\n`)), null, 2)}\n`,
  )

  const state = {
    repository_check_baselines: {
      static: {
        profile: 'static',
        status: 'failed',
        artifact_path: summaryPath,
        workspace_fingerprint: 'fixture',
        recorded_at: '2026-08-24T00:00:00.000Z',
      },
    },
  } as unknown as RunState
  const baseline = loadRepositoryCheckBaseline(root, state, 'static')

  assert.ok(baseline.result)
  assert.equal(baseline.artifact_path, fullPath)

  const compared = compareRepositoryCheckToBaseline(
    baseline.result,
    check(`stable diagnostic ${Math.floor(count / 2)}\n`),
  )

  assert.equal(compared.passed, true)
  assert.equal(compared.delta.new.length, 0)
  assert.equal(compared.delta.carried.length, 1)
})

test('repository checks report missing profiles without guessing commands', () => {
  const { root } = makeInstallation()

  const result = runRepositoryCheck(root, 'full')

  assert.equal(result.status, 'not_configured')
  assert.deepEqual(result.results, [])

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

  // One loop walks the environment probes, then the ordinary probes, then the
  // commands, and returns on the first failure.
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

test('a streaming timeout ends the whole process tree, not only the shell', async () => {
  // `npm test` fans out into run-built, run-tests, and node. Killing the
  // shell alone left that tree running and holding the pipes, so the gate
  // returned only when the suite finished on its own, 130 s late in the field.
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      probes: [],
      // A grandchild that inherits stdout and would live far past the bound.
      commands: ['sh -c "sleep 30; echo late" & wait'],
    },
  })

  const startedAt = Date.now()
  // The profile floor is 1 s; the stage-requested bound has no floor, and the
  // contract is the kill, not the wait.
  const result = await runRepositoryCheckStreaming(root, 'fast', {
    timeout_ms: 250,
  })
  const elapsed = Date.now() - startedAt

  assert.equal(result.status, 'failed')
  assert.equal(result.results[0]?.timed_out, true)
  assert.ok(
    elapsed < 10_000,
    `the gate returned after ${elapsed}ms; the orphaned tree kept it waiting`,
  )
})

test('a concurrent profile runs its commands together and records each one', async () => {
  // The heaviest profile's commands are independent, so running them one
  // after another charges the operator the sum of their durations. Each must
  // still keep its own exit code and captured output, in declared order.
  const { root } = makeInstallation()
  const delayMs = 900
  const stdout: string[] = []

  writeChecks(root, {
    full: {
      timeout_ms: 20_000,
      concurrent: true,
      probes: [],
      commands: [
        `node -e "setTimeout(() => process.stdout.write('alpha\\n'), ${delayMs})"`,
        `node -e "setTimeout(() => { process.stderr.write('beta\\n'); process.exit(2) }, ${delayMs})"`,
        `node -e "setTimeout(() => process.stdout.write('gamma\\n'), ${delayMs})"`,
      ],
    },
  })

  const startedAt = Date.now()
  const result = await runRepositoryCheckStreaming(root, 'full', {
    on_stdout: (chunk) => stdout.push(chunk),
  })
  const elapsed = Date.now() - startedAt

  // One command failed, so the profile failed, but every command ran.
  assert.equal(result.status, 'failed')
  assert.deepEqual(
    result.results.map((item) => item.passed),
    [true, false, true],
  )
  assert.match(result.results[0]?.stdout ?? '', /alpha/u)
  assert.equal(result.results[1]?.exit_code, 2)
  assert.match(result.results[1]?.stderr ?? '', /beta/u)
  assert.match(result.results[2]?.stdout ?? '', /gamma/u)
  assert.match(stdout.join(''), /alpha/u)
  assert.ok(
    elapsed < delayMs * 2,
    `the three commands took ${elapsed}ms; they ran one after another`,
  )
})

test('a concurrent profile ends every unfinished command at the shared deadline', async () => {
  // A shared deadline is the whole budget, not a budget per command. Without
  // the group kill the runner returns while orphans keep running.
  const { root } = makeInstallation()
  // Each slow command backgrounds a grandchild that ticks a heartbeat file.
  // A returning runner is not proof the tree died: only a heartbeat that
  // stops ticking distinguishes a killed process group from an orphan the
  // runner merely stopped waiting for.
  const firstBeat = path.join(root, 'runtime', 'beat-1.txt')
  const secondBeat = path.join(root, 'runtime', 'beat-2.txt')
  const heartbeats = [firstBeat, secondBeat]

  writeChecks(root, {
    full: {
      concurrent: true,
      probes: [],
      commands: [
        'echo quick',
        heartbeatCommand(firstBeat),
        heartbeatCommand(secondBeat),
      ],
    },
  })

  const startedAt = Date.now()
  const result = await runRepositoryCheckStreaming(root, 'full', {
    timeout_ms: 400,
  })
  const elapsed = Date.now() - startedAt

  assert.equal(result.status, 'failed')
  assert.equal(result.results[0]?.passed, true)
  assert.equal(result.results[1]?.timed_out, true)
  assert.equal(result.results[2]?.timed_out, true)
  assert.ok(
    elapsed < 10_000,
    `the profile returned after ${elapsed}ms; an orphan kept it waiting`,
  )

  const ticks = heartbeats.map(heartbeatCount)

  await delay(500)

  for (const [index, file] of heartbeats.entries()) {
    const before = ticks[index] ?? 0

    assert.ok(
      before > 0,
      `command ${index + 1} never started, so its heartbeat proves nothing`,
    )
    assert.equal(
      heartbeatCount(file),
      before,
      `a descendant of command ${index + 1} outlived the shared deadline`,
    )
  }
})

test('the concurrent field must be a boolean and the gate runner ignores it', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    full: { probes: [], commands: ['echo ok'], concurrent: 'yes' },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /profiles\.full\.concurrent MUST be a boolean when present/u,
  )

  // The gate path is synchronous and stays serial, so a configuration written
  // for the asynchronous runner cannot change what a gate verifies.
  writeChecks(root, {
    full: {
      timeout_ms: 20_000,
      concurrent: true,
      probes: [],
      commands: [
        'node -e "setTimeout(() => process.exit(0), 600)"',
        'node -e "setTimeout(() => process.exit(0), 600)"',
      ],
    },
  })

  const startedAt = Date.now()
  const result = runRepositoryCheck(root, 'full')

  assert.equal(result.status, 'passed')
  assert.ok(
    Date.now() - startedAt >= 1_200,
    'the synchronous runner honoured the concurrent field',
  )
})

test('a synchronous timeout ends the whole process tree, not only the shell', () => {
  // The gate path runs commands synchronously. With piped output the call
  // returned only when the orphaned grandchildren closed the pipes: 916 s
  // against a 600 s bound in the field. Output now goes to files and the
  // child's process group is killed, so the bound is the bound.
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      probes: [],
      commands: ['echo early; sh -c "sleep 30; echo late" & wait'],
    },
  })

  const startedAt = Date.now()
  const result = runRepositoryCheck(root, 'fast', { timeout_ms: 250 })
  const elapsed = Date.now() - startedAt

  assert.equal(result.status, 'failed')
  assert.equal(result.results[0]?.timed_out, true)
  assert.match(result.results[0]?.stdout ?? '', /early/u)
  assert.ok(
    elapsed < 10_000,
    `the gate returned after ${elapsed}ms; the orphaned tree kept it waiting`,
  )
})

test('a synchronous capture past the byte cap is truncated at the cap with the marker', () => {
  const { root } = makeInstallation()
  const marker = '\n[output truncated by Pancreator]\n'
  const excess = MAX_CAPTURE_BYTES + 1024 * 1024

  writeChecks(root, {
    fast: {
      probes: [],
      commands: [`node -e "process.stdout.write(Buffer.alloc(${excess}, 97))"`],
    },
  })

  const result = runRepositoryCheck(root, 'fast')
  const stdout = result.results[0]?.stdout ?? ''

  assert.equal(result.status, 'passed')
  assert.ok(stdout.endsWith(marker))
  assert.equal(
    Buffer.byteLength(stdout),
    MAX_CAPTURE_BYTES + Buffer.byteLength(marker),
  )
  assert.equal(result.results[0]?.stderr, '')
})

test('stage-requested timeout replaces the profile default', () => {
  const { root } = makeInstallation()

  // The floor for timeout_ms is 1000 ms, so the command sleeps just past it.
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

  const direct = runRepositoryCheck(root, 'fast')

  assert.equal(direct.status, 'failed')
  assert.equal(direct.timeout_ms, 1_000)
  assert.equal(direct.results[0]?.timed_out, true)
})

test('stage-requested timeout bounds the entire synchronous profile', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      timeout_ms: 5_000,
      probes: ['node -e "setTimeout(() => process.exit(0), 1200)"'],
      commands: ['node -e "setTimeout(() => process.exit(0), 1200)"'],
    },
  })

  const result = runRepositoryCheck(root, 'fast', { timeout_ms: 2_000 })

  assert.equal(result.status, 'failed')
  assert.equal(result.timeout_ms, 2_000)
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0]?.passed, true)
  assert.equal(result.results[1]?.timed_out, true)
  assert.ok(result.total_duration_ms < 2_750)
})

test('stage-requested timeout bounds the entire streaming profile', async () => {
  const { root } = makeInstallation()
  const starts: string[] = []

  writeChecks(root, {
    fast: {
      timeout_ms: 5_000,
      probes: ['node -e "setTimeout(() => process.exit(0), 1200)"'],
      commands: ['node -e "setTimeout(() => process.exit(0), 1200)"'],
    },
  })

  const result = await runRepositoryCheckStreaming(root, 'fast', {
    timeout_ms: 2_000,
    on_start: (kind, command) => starts.push(`${kind}:${command}`),
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.timeout_ms, 2_000)
  assert.equal(result.results.length, 2)
  assert.equal(result.results[0]?.passed, true)
  assert.equal(result.results[1]?.timed_out, true)
  assert.equal(starts.length, 2)
  assert.ok(result.total_duration_ms < 2_750)
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
  // A linked worktree carries a `.git` file that names its gitdir.
  writeFileSync(
    path.join(worktree, '.git'),
    'gitdir: ../../../.git/worktrees/wt\n',
  )
  writeFileSync(
    path.join(runtimeWorktree, '.git'),
    'gitdir: ../../../../.git/worktrees/wt\n',
  )

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

test('a directory under a worktree that is not itself a worktree keeps its own resolution', () => {
  // Test fixtures live under <checkout>/runtime/tmp/tests/. When the checkout
  // is a cohort worktree, every fixture path contains a `worktrees` segment.
  // The path alone must not send the fixture to the installation's file.
  const { root } = makeInstallation()

  writeChecks(root, { fast: { probes: [], commands: ['echo ok'] } })

  const worktree = path.join(root, 'worktrees', 'operator', 'wt')
  const fixture = path.join(
    worktree,
    'runtime',
    'tmp',
    'tests',
    'run-1',
    'checks-1',
  )

  mkdirSync(fixture, { recursive: true })
  writeFileSync(
    path.join(worktree, '.git'),
    'gitdir: ../../../.git/worktrees/wt\n',
  )
  writeFileSync(
    path.join(fixture, 'config.json'),
    `${JSON.stringify({ schema_version: 1, workspace_root: '.', state_root: 'runtime', installation_mode: 'self_development' })}\n`,
  )

  assert.equal(
    repositoryChecksSourcePath(fixture),
    path.join(
      fixture,
      'library',
      'templates',
      'repository-checks.self-development.json',
    ),
  )
})

test('the shipped self-development profiles declare no concurrent commands', () => {
  // The template is the fallback source above, so a fresh clone or a CI
  // checkout with no runtime/repository-checks.json adopts whatever it says
  // without an operator deciding anything. `concurrent` is safe only for
  // commands that share no mutable state, and the full profile's do:
  // `./bin/install --smoke` copies the live dist/ tree without taking the
  // bin/run-built lock that `npm run check` holds while bin/build swaps that
  // same tree. Turning the flag on for an installation stays an operator
  // action against the untracked runtime file.
  const template = JSON.parse(
    readFileSync(
      path.join(
        REPO_ROOT,
        'library',
        'templates',
        'repository-checks.self-development.json',
      ),
      'utf8',
    ),
  ) as {
    profiles: Record<string, { commands: string[]; concurrent?: unknown }>
  }

  for (const [name, profile] of Object.entries(template.profiles)) {
    assert.equal(
      profile.concurrent,
      undefined,
      `profiles.${name} declares concurrent commands. Prove the commands ` +
        `share no mutable state before shipping that default, or leave the ` +
        `flag to the operator's own runtime/repository-checks.json.`,
    )
  }
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

test('an agent-run profile is recorded against the live run bound to its worktree', () => {
  const { root, workspace } = makeInstallation()
  const writeRun = (
    runId: string,
    status: string,
    worktree?: string,
    invocationId?: string,
  ) => {
    const directory = path.join(root, 'runtime/logs/workflows', runId, 'agent')

    mkdirSync(directory, { recursive: true })
    writeFileSync(
      path.join(directory, 'state.json'),
      `${JSON.stringify({
        schema_version: 2,
        run_id: runId,
        workflow_slug: 'delivery',
        title: runId,
        status,
        current_stage: 'implement',
        pending_action: { type: 'prepare_invocation' },
        current_invocation: invocationId
          ? {
              id: invocationId,
              json_path: `agent/invocations/${invocationId}.json`,
              markdown_path: `agent/invocations/${invocationId}.md`,
              output_path: `agent/outputs/${invocationId}.json`,
            }
          : null,
        stage_history: [],
        attempts: {},
        revision: 1,
        workspace_root: '../workspace',
        ...(worktree
          ? {
              managed_worktree: {
                name: worktree,
                path: `worktrees/operator/${worktree}`,
                branch: worktree,
              },
            }
          : {}),
      })}\n`,
    )
  }

  writeRun('live-bound', 'running', 'cohort-greeting', 'implement-1')
  writeRun('paused-bound', 'paused', 'cohort-greeting')
  writeRun('finished-bound', 'succeeded', 'cohort-greeting')
  writeRun('live-other', 'running', 'cohort-farewell')
  writeRun('live-unbound', 'running')

  const result: RepositoryCheckResult = {
    profile: 'fast',
    status: 'passed',
    config_path: 'runtime/repository-checks.json',
    workspace_root: workspace,
    timeout_ms: 1000,
    results: [],
    total_duration_ms: 1234,
    advisories: [],
  }
  const recorded = recordAgentRepositoryCheck(
    root,
    'cohort-greeting',
    result,
    '2026-09-05T02:00:00.000Z',
  )

  // Only the live runs bound to the worktree receive the record: a finished
  // run has nothing left to audit, and other runs never saw this execution.
  assert.deepEqual(recorded.sort(), [
    `runtime/logs/workflows/live-bound/agent/evidence/${AGENT_REPOSITORY_CHECK_RUNS_FILE}`,
    `runtime/logs/workflows/paused-bound/agent/evidence/${AGENT_REPOSITORY_CHECK_RUNS_FILE}`,
  ])

  const lines = readFileSync(path.join(root, recorded[0]), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

  // The record names the run's current invocation, so the per-invocation
  // "fast at most once" rule is countable; a run between invocations records
  // null.
  assert.equal(lines.length, 1)
  assert.deepEqual(lines[0], {
    profile: 'fast',
    invocation_id: 'implement-1',
    workspace_fingerprint: lines[0].workspace_fingerprint,
    status: 'passed',
    duration_ms: 1234,
    started_at: '2026-09-05T02:00:00.000Z',
    invoked_by: 'agent',
  })
  assert.match(String(lines[0].workspace_fingerprint), /^[0-9a-f]{64}$/u)
  assert.equal(
    (
      JSON.parse(
        readFileSync(path.join(root, recorded[1]), 'utf8').trim(),
      ) as Record<string, unknown>
    ).invocation_id,
    null,
  )

  // One fast run for the invocation is within policy: no advisory.
  assert.deepEqual(
    agentRepositoryCheckAdvisories(root, 'live-bound', 'implement-1'),
    [],
  )

  // A second execution appends, so the "fast at most once" rule is countable.
  recordAgentRepositoryCheck(
    root,
    'cohort-greeting',
    { ...result, status: 'failed' },
    '2026-09-05T02:10:00.000Z',
  )

  assert.equal(
    readFileSync(path.join(root, recorded[0]), 'utf8').trim().split('\n')
      .length,
    2,
  )

  // Two fast runs for one invocation of a single-worker stage are reported by
  // name, as an advisory rather than a gate failure; another invocation's
  // count is its own. This run carries no workflow snapshot, so the stage
  // keeps the one-agent allowance.
  const advisories = agentRepositoryCheckAdvisories(
    root,
    'live-bound',
    'implement-1',
  )

  assert.equal(advisories.length, 1)
  assert.equal(advisories[0].id, REPOSITORY_CHECK_FAST_REPEATED)
  assert.equal(advisories[0].id, 'repository_check_fast_repeated')
  assert.match(advisories[0].message, /fast profile 2 times/u)
  assert.match(advisories[0].message, /implement-1/u)
  assert.match(
    advisories[0].message,
    /allows one run per agent, 1 for this stage \(one stage worker\)/u,
  )
  assert.deepEqual(
    agentRepositoryCheckAdvisories(root, 'live-bound', 'implement-2'),
    [],
  )
  // A run with no record file has nothing to report.
  assert.deepEqual(
    agentRepositoryCheckAdvisories(root, 'live-other', 'implement-1'),
    [],
  )

  // No bound live run means nothing is written anywhere.
  assert.deepEqual(
    recordAgentRepositoryCheck(root, 'unknown-worktree', result, 'now'),
    [],
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/logs/workflows/live-other/agent/evidence',
        AGENT_REPOSITORY_CHECK_RUNS_FILE,
      ),
    ),
    false,
  )

  // `--run` names the run directly, so a run without a worktree binding (a
  // release run in the base checkout) still receives its evidence.
  assert.deepEqual(
    recordAgentRepositoryCheckForRuns(root, ['live-unbound'], result, 'now'),
    [
      `runtime/logs/workflows/live-unbound/agent/evidence/${AGENT_REPOSITORY_CHECK_RUNS_FILE}`,
    ],
  )
})

test('the fast-profile allowance follows the evidence workers of the invocation stage', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const layout = resolveRunLayout(root, run.run_id)
  const evidence = layout.evidence(AGENT_REPOSITORY_CHECK_RUNS_FILE).absolute
  const record = (invocationId: string): string =>
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: invocationId,
      workspace_fingerprint: 'f'.repeat(64),
      status: 'passed',
      duration_ms: 1,
      started_at: '2026-09-05T02:00:00.000Z',
      invoked_by: 'agent',
    })}\n`

  // The invocation record names the stage; the run's own workflow snapshot
  // says how many agents that stage dispatches.
  writeJson(layout.invocation('verify-1', '.json').absolute, {
    stage: { slug: 'verify' },
  })
  writeJson(layout.invocation('implement-1', '.json').absolute, {
    stage: { slug: 'implement' },
  })
  mkdirSync(path.dirname(evidence), { recursive: true })
  writeFileSync(
    evidence,
    [
      record('verify-1'),
      record('verify-1'),
      record('implement-1'),
      record('implement-1'),
    ].join(''),
  )

  // Verify dispatches two evidence workers, each permitted one fast run, so
  // two records are compliant.
  assert.deepEqual(
    agentRepositoryCheckAdvisories(root, run.run_id, 'verify-1'),
    [],
  )

  // Implement declares no evidence worker, so its second record is one too
  // many.
  const implement = agentRepositoryCheckAdvisories(
    root,
    run.run_id,
    'implement-1',
  )

  assert.equal(implement.length, 1)
  assert.equal(implement[0].id, REPOSITORY_CHECK_FAST_REPEATED)
  assert.match(implement[0].message, /fast profile 2 times/u)
  assert.match(
    implement[0].message,
    /allows one run per agent, 1 for this stage \(one stage worker\)/u,
  )

  // A third verify record exceeds the two-worker allowance, and the message
  // states both the allowance and the count.
  appendFileSync(evidence, record('verify-1'))

  const verify = agentRepositoryCheckAdvisories(root, run.run_id, 'verify-1')

  assert.equal(verify.length, 1)
  assert.match(verify[0].message, /fast profile 3 times/u)
  assert.match(
    verify[0].message,
    /allows one run per agent, 2 for this stage \(2 evidence worker\(s\)\)/u,
  )
})

/** A passing profile result an agent's command-line run would produce. */
function commandLineResult(
  workspaceRoot: string,
  overrides: Partial<RepositoryCheckResult> = {},
): RepositoryCheckResult {
  return {
    profile: 'fast',
    status: 'passed',
    config_path: 'runtime/repository-checks.json',
    workspace_root: workspaceRoot,
    timeout_ms: 60_000,
    results: [
      {
        kind: 'command',
        command: 'npm test',
        exit_code: 0,
        signal: null,
        stdout: 'suite ok\n',
        stderr: '',
        passed: true,
        timed_out: false,
        duration_ms: 90_000,
      },
    ],
    total_duration_ms: 90_000,
    advisories: [],
    ...overrides,
  }
}

test('an agent clean profile pass is recorded where the gate looks for it', () => {
  // The agent already paid for this suite at this fingerprint. Recording the
  // pass as a gate result is what stops the submission gate from paying for
  // the identical run minutes later.
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const result = commandLineResult(root)
  const recorded = recordProfileGatePass(root, 'fast', result, {
    run_ids: [run.run_id],
    fingerprint_before: fingerprint,
    started_at: '2026-09-12T09:00:00.000Z',
  })

  assert.ok(recorded)

  // The gate resolves the same command text for the same profile, so a
  // lookup at this fingerprint finds the entry.
  const entry = gateCacheLookup(
    root,
    gateCacheKey(root, fingerprint, repositoryCheckGateCommand('fast')),
  )

  assert.ok(entry)
  assert.equal(entry.evidence_path, recorded.evidence_path)
  // The gate compares this against the run's baseline, so the whole result
  // has to survive, not a summary of it.
  assert.deepEqual(entry.repository_result, result)

  // The gate copies the evidence bytes forward, so the log must exist.
  const evidence = readFileSync(path.join(root, entry.evidence_path), 'utf8')

  assert.match(evidence, /^\$ pan repository-check fast$/mu)
  assert.match(evidence, /exit_code=0/u)
  assert.match(evidence, /invoked_by=command-line/u)
})

test('an agent profile run that proves nothing is not recorded as a pass', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const options = {
    run_ids: [run.run_id],
    fingerprint_before: fingerprint,
    started_at: '2026-09-12T09:00:00.000Z',
  }
  const timedOut = commandLineResult(root)

  timedOut.results = [{ ...timedOut.results[0], timed_out: true }]

  // A failure must re-run to show its repair; a timeout proves nothing at
  // all; a run naming no run has nowhere inside a run to put its evidence.
  assert.equal(
    recordProfileGatePass(
      root,
      'fast',
      commandLineResult(root, { status: 'failed' }),
      options,
    ),
    null,
  )
  assert.equal(recordProfileGatePass(root, 'fast', timedOut, options), null)
  assert.equal(
    recordProfileGatePass(root, 'fast', commandLineResult(root), {
      ...options,
      run_ids: [],
    }),
    null,
  )

  // The workspace moved under the run, so the result describes a tree that
  // no longer exists.
  writeFileSync(path.join(root, 'recorder-buster.txt'), 'changed\n')

  assert.equal(
    recordProfileGatePass(root, 'fast', commandLineResult(root), options),
    null,
  )

  // A workspace outside Git has no fingerprint to key a pass on. Every such
  // workspace fingerprints as the same constant, so one shared cache key
  // would serve results across unrelated trees. The caller in src/cli.ts
  // passes a non-nullable fingerprint, so the guard that has to hold is the
  // snapshot check rather than the null bracket: this case brackets the run
  // exactly as production does and still stores nothing.
  const bare = createTestTempDirectory('unversioned-')
  const bareSnapshot = gitWorkspaceSnapshot(bare)

  assert.notEqual(bareSnapshot.kind, 'git')
  assert.equal(
    recordProfileGatePass(
      root,
      'fast',
      commandLineResult(bare, { workspace_root: bare }),
      { ...options, fingerprint_before: bareSnapshot.fingerprint },
    ),
    null,
  )
  // A caller that brackets nothing at all is refused before that check.
  assert.equal(
    recordProfileGatePass(
      root,
      'fast',
      commandLineResult(bare, { workspace_root: bare }),
      { ...options, fingerprint_before: null },
    ),
    null,
  )
})
