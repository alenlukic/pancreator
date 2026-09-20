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
  adoptedBaselineWorkspaceDivergence,
  AGENT_REPOSITORY_CHECK_RUNS_FILE,
  HARNESS_LAUNCH_TOKEN_ENV,
  harnessLaunchDigest,
  agentRepositoryCheckAdvisories,
  assertRepositoryCheckProfileAllowed,
  compareRepositoryCheckToBaseline,
  loadRepositoryChecks,
  MAX_CAPTURE_BYTES,
  recordAgentRepositoryCheck,
  recordAgentRepositoryCheckForRuns,
  recordProfileGatePass,
  REPOSITORY_CHECK_FAST_REPEATED,
  repositoryChecksSourcePath,
  resolveRepositoryCheckInitiator,
  reusableProfileExecution,
  runRepositorySetup,
  runRepositoryCheck,
  runRepositoryCheckStreaming,
  SUMMARY_STREAM_HEAD_BYTES,
  SUMMARY_STREAM_TAIL_BYTES,
  unrecordedProfileClaimAdvisories,
} from '../../src/lib/repository-checks.js'
import type {
  RepositoryCheckResult,
  ReusableProfileExecution,
} from '../../src/lib/repository-checks.js'
import {
  gateCacheKey,
  gateCacheLookup,
  repositoryCheckGateCommand,
} from '../../src/lib/gate-cache.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import {
  prefetchRecordPath,
  resolveRunLayout,
} from '../../src/lib/run-layout.js'
import { loadRepositoryCheckBaseline } from '../../src/lib/validation.js'
import type {
  RepositoryCheckBaselinePointer,
  RunState,
} from '../../src/lib/types.js'
import {
  createFixture,
  createTestTempDirectory,
  writeJson,
} from '../helpers.js'
import { createRun } from '../run-helpers.js'

/** The checkout under test, which `bin/run-tests` runs the suite from. */
const REPO_ROOT = process.cwd()

/**
 * A profile command that backgrounds a grandchild ticking `file` until it is
 * killed. The `& wait` shape puts the ticker outside the shell the runner
 * spawns, so only a process-group kill reaches it.
 *
 * The ticker is a shell loop rather than a Node process: these tests time the
 * kill out after a few hundred milliseconds, and a Node interpreter under
 * suite load can take longer than that to reach its first tick, which left
 * the caller asserting against a heartbeat that had never started. The loop
 * writes its first tick within milliseconds and stops itself after 30 s, so a
 * kill that fails to land still cannot outlive the suite.
 */
function heartbeatCommand(file: string): string {
  return (
    `sh -c 'n=0; while [ $n -lt 1500 ]; do printf x >> "${file}"; ` +
    `n=$((n+1)); sleep 0.02; done' & wait`
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

// A cohort shares one baseline across chunk runs that each own a different
// worktree, so a host failure of the capturing tree used to read as a
// regression the adopting chunk had introduced, and the chunk spent its next
// stage hunting a change that never happened.
test('a baseline from another workspace diagnoses a new failure instead of attributing it', () => {
  const newFailure = '/workspace/src/b.ts:3:1 error New failure no-new\n'
  // Only an adopted baseline spans two trees, and only the pointer knows it
  // was adopted, so the caller resolves the divergence and hands it in.
  const pointer: RepositoryCheckBaselinePointer = {
    profile: 'static',
    status: 'passed',
    artifact_path: 'runtime/logs/cohorts/c/baselines/pre-implementation.json',
    workspace_fingerprint: 'f',
    recorded_at: '2026-09-13T00:00:00.000Z',
    shared_from_cohort: 'cohort-fixture',
    capture_workspace_path: 'worktrees/operator/chunk-a',
  }
  const divergence = adoptedBaselineWorkspaceDivergence(
    pointer,
    'worktrees/operator/chunk-b',
  )

  assert.deepEqual(divergence, {
    baseline_workspace: 'worktrees/operator/chunk-a',
    current_workspace: 'worktrees/operator/chunk-b',
  })
  // The same chunk path, a baseline this run captured itself, and a pointer
  // written before the capture path existed each report no divergence, so
  // every run outside a shared adoption is graded exactly as it was.
  assert.equal(
    adoptedBaselineWorkspaceDivergence(pointer, 'worktrees/operator/chunk-a'),
    null,
  )
  assert.equal(
    adoptedBaselineWorkspaceDivergence(
      { ...pointer, shared_from_cohort: undefined },
      'worktrees/operator/chunk-b',
    ),
    null,
  )
  assert.equal(
    adoptedBaselineWorkspaceDivergence(
      { ...pointer, capture_workspace_path: undefined },
      'worktrees/operator/chunk-b',
    ),
    null,
  )
  assert.equal(adoptedBaselineWorkspaceDivergence(undefined, '.'), null)

  // The gate reads the baseline through the loader, so the loader is where
  // the pointer's capture path has to reach the comparison.
  const root = createTestTempDirectory('adopted-baseline-')
  const artifactPath =
    'runtime/logs/cohorts/c/baselines/pre-implementation-static.json'

  mkdirSync(path.dirname(path.join(root, artifactPath)), { recursive: true })
  writeFileSync(
    path.join(root, artifactPath),
    `${JSON.stringify({
      schema_version: 1,
      run_id: 'chunk-a-run',
      stage: 'implement',
      profile: 'static',
      workspace_fingerprint: 'f',
      recorded_at: pointer.recorded_at,
      capture_workspace_path: 'worktrees/operator/chunk-a',
      result: passedCheck(),
    })}\n`,
  )

  const adoptingRun = {
    workspace_root: 'worktrees/operator/chunk-b',
    repository_check_baselines: {
      static: { ...pointer, artifact_path: artifactPath },
    },
  } as unknown as RunState

  assert.deepEqual(
    loadRepositoryCheckBaseline(root, adoptingRun, 'static')
      .workspace_divergence,
    divergence,
  )

  const divergent = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck(newFailure),
    divergence,
  )

  assert.deepEqual(divergent.delta.baseline_workspace_divergence, divergence)
  // The explanation names the two trees and sends the reader to the one that
  // can settle the question, instead of attributing the failure to a change
  // this run may not have made.
  assert.doesNotMatch(divergent.explanation, /introduced a new failure/u)
  assert.match(divergent.explanation, /may belong to the capturing workspace/u)
  assert.match(
    divergent.explanation,
    /captured in 'worktrees\/operator\/chunk-a'/u,
  )
  assert.match(
    divergent.explanation,
    /executed in 'worktrees\/operator\/chunk-b'/u,
  )
  // The diagnostic is still unexplained, so the gate still fails; only the
  // attribution changes.
  assert.equal(divergent.passed, false)
  assert.equal(
    divergent.delta.new.some((item) => item.diagnostic.includes('no-new')),
    true,
  )

  // One workspace on both sides attributes the failure as it always did.
  const sameWorkspace = compareRepositoryCheckToBaseline(
    passedCheck(),
    failedCheck(newFailure),
  )

  assert.equal(sameWorkspace.delta.baseline_workspace_divergence, undefined)
  assert.match(sameWorkspace.explanation, /introduced a new failure/u)

  // Divergence alone decides nothing: a run that adds no diagnostic still
  // passes, and the marker only records where the two sides ran.
  const clean = compareRepositoryCheckToBaseline(
    passedCheck(),
    passedCheck(),
    divergence,
  )

  assert.equal(clean.passed, true)
  assert.deepEqual(clean.delta.baseline_workspace_divergence, divergence)
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
  const heartbeat = path.join(root, 'streaming-timeout-heartbeat.txt')

  writeChecks(root, {
    fast: {
      probes: [],
      commands: [heartbeatCommand(heartbeat)],
    },
  })

  // The profile floor is 1 s; the stage-requested bound has no floor, and the
  // contract is the kill, not the wait.
  const result = await runRepositoryCheckStreaming(root, 'fast', {
    timeout_ms: 250,
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.results[0]?.timed_out, true)

  const ticks = heartbeatCount(heartbeat)

  assert.ok(ticks > 0, 'the heartbeat grandchild never started')
  await delay(500)
  assert.equal(heartbeatCount(heartbeat), ticks)
})

test('a concurrent profile runs its commands together and records each one', async () => {
  // The heaviest profile's commands are independent, so running them one
  // after another charges the operator the sum of their durations. Each must
  // still keep its own exit code and captured output, in declared order.
  const { root } = makeInstallation()
  const delayMs = 900
  const stdout: string[] = []

  // TP-10: each command brackets its own delay in a shared log. An elapsed
  // ceiling would measure the scheduling of a suite that runs its own tests
  // concurrently; the recorded order measures these three commands.
  const bracketLog = path.join(root, 'brackets.txt')
  const bracketed = (body: string) =>
    `node -e "const fs=require('fs');const log='${bracketLog}';` +
    `fs.appendFileSync(log,'start\\n');` +
    `setTimeout(() => { ${body}; fs.appendFileSync(log,'end\\n') }, ${delayMs})"`

  writeChecks(root, {
    full: {
      timeout_ms: 20_000,
      concurrent: true,
      probes: [],
      commands: [
        bracketed("process.stdout.write('alpha\\n')"),
        bracketed("process.stderr.write('beta\\n'); process.exitCode = 2"),
        bracketed("process.stdout.write('gamma\\n')"),
      ],
    },
  })

  const result = await runRepositoryCheckStreaming(root, 'full', {
    on_stdout: (chunk) => stdout.push(chunk),
  })
  const brackets = readFileSync(bracketLog, 'utf8').split('\n').filter(Boolean)

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

  // Every command started before the first one finished.
  assert.deepEqual(
    brackets.slice(0, 3),
    ['start', 'start', 'start'],
    brackets.join(','),
  )
  assert.equal(brackets.length, 6)
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

test('an isolation command must select both the failing file and case', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      probes: [],
      commands: ['npm test'],
      isolation_command: 'npm test -- {file}',
    },
  })

  assert.throws(
    () => loadRepositoryChecks(root),
    /isolation_command MUST be .* \{file\} and either \{test_pattern\} or \{test\}/u,
  )

  for (const isolationCommand of [
    'npm test -- {file} --case {test}',
    'npm test -- {file} --name-pattern {test_pattern}',
  ]) {
    writeChecks(root, {
      fast: {
        probes: [],
        commands: ['npm test'],
        isolation_command: isolationCommand,
      },
    })

    assert.equal(
      loadRepositoryChecks(root).profiles.fast?.isolation_command,
      isolationCommand,
    )
  }
})

/**
 * The self-development runtime configuration is untracked per-installation
 * state that nothing regenerates. A selector added to the tracked template
 * therefore reached no live gate, and the whole classifier sat inert in the
 * one installation that declares one. Adoption is keyed on identical
 * commands, so an operator-rewritten profile keeps its own configuration.
 */
test('a self-development profile adopts the template isolation command', () => {
  const { root } = makeInstallation()
  const templateCommand = './run-one -- --pattern {test_pattern} --file {file}'

  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify({ schema_version: 1, installation_mode: 'self_development' }, null, 2)}\n`,
  )
  mkdirSync(path.join(root, 'library/templates'), { recursive: true })
  writeFileSync(
    path.join(
      root,
      'library/templates/repository-checks.self-development.json',
    ),
    `${JSON.stringify({
      schema_version: 1,
      profiles: {
        fast: {
          probes: [],
          commands: ['npm test'],
          isolation_command: templateCommand,
        },
      },
    })}\n`,
  )

  writeChecks(root, { fast: { probes: [], commands: ['npm test'] } })

  assert.equal(
    loadRepositoryChecks(root).profiles.fast?.isolation_command,
    templateCommand,
  )

  // An operator who replaced the command replaced the runner too, so the
  // template's selector no longer describes anything this profile runs.
  writeChecks(root, { fast: { probes: [], commands: ['npm run verify'] } })

  assert.equal(
    loadRepositoryChecks(root).profiles.fast?.isolation_command,
    undefined,
  )
})

/**
 * An eval grader reads the profile commands of a synthetic run directory that
 * holds a repository-check file and nothing else. Loading those profiles must
 * not start requiring a harness configuration the directory never had.
 */
test('a directory with no harness configuration still loads its profiles', () => {
  const bare = createTestTempDirectory('bare-checks-')

  mkdirSync(path.join(bare, 'runtime'), { recursive: true })
  writeFileSync(
    path.join(bare, 'runtime', 'repository-checks.json'),
    `${JSON.stringify({
      schema_version: 1,
      profiles: { fast: { probes: [], commands: ['npm test'] } },
    })}\n`,
  )

  assert.deepEqual(loadRepositoryChecks(bare).profiles.fast?.commands, [
    'npm test',
  ])
})

test('a target installation adopts no isolation command', () => {
  const { root } = makeInstallation()

  mkdirSync(path.join(root, 'library/templates'), { recursive: true })
  writeFileSync(
    path.join(
      root,
      'library/templates/repository-checks.self-development.json',
    ),
    `${JSON.stringify({
      schema_version: 1,
      profiles: {
        fast: {
          probes: [],
          commands: ['npm test'],
          isolation_command: 'node --test --name {test_pattern} {file}',
        },
      },
    })}\n`,
  )
  writeChecks(root, { fast: { probes: [], commands: ['npm test'] } })

  assert.equal(
    loadRepositoryChecks(root).profiles.fast?.isolation_command,
    undefined,
  )
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

test('a synchronous timeout ends the whole process tree, not only the shell', async () => {
  // The gate path runs commands synchronously. With piped output the call
  // returned only when the orphaned grandchildren closed the pipes: 916 s
  // against a 600 s bound in the field. Output now goes to files and the
  // child's process group is killed, so the bound is the bound.
  const { root } = makeInstallation()
  const heartbeat = path.join(root, 'synchronous-timeout-heartbeat.txt')

  writeChecks(root, {
    fast: {
      probes: [],
      commands: [`echo early; ${heartbeatCommand(heartbeat)}`],
    },
  })

  const startedAt = Date.now()
  // Give the loaded test runner time to start the shell and heartbeat before
  // exercising the timeout path. The timeout remains the behavior under test.
  const result = runRepositoryCheck(root, 'fast', { timeout_ms: 2000 })
  const elapsed = Date.now() - startedAt

  assert.equal(result.status, 'failed')
  assert.equal(result.results[0]?.timed_out, true)
  assert.match(result.results[0]?.stdout ?? '', /early/u)
  // The heartbeat below proves the tree died; this bound proves the other
  // half of the field defect, that the call came back near its deadline
  // instead of waiting on a pipe an orphan still held. It is a generous hang
  // guard, not the kill proof, exactly as its streaming sibling keeps it.
  assert.ok(
    elapsed < 10_000,
    `the gate returned after ${elapsed}ms; the orphaned tree kept it waiting`,
  )

  const ticks = heartbeatCount(heartbeat)

  assert.ok(ticks > 0, 'the heartbeat grandchild never started')
  await delay(500)
  assert.equal(heartbeatCount(heartbeat), ticks)
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
  // Test fixtures live under <checkout>/runtime/tmp/tests.noindex/. When the checkout
  // is a cohort worktree, every fixture path contains a `worktrees` segment.
  // The path alone must not send the fixture to the installation's file.
  const { root } = makeInstallation()

  writeChecks(root, { fast: { probes: [], commands: ['echo ok'] } })

  const worktree = path.join(root, 'worktrees', 'operator', 'wt')
  const fixture = path.join(
    worktree,
    'runtime',
    'tmp',
    'tests.noindex',
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

test('verify agents cannot run the full profile owned by the ship gate', () => {
  assert.throws(
    () => assertRepositoryCheckProfileAllowed('full', 'verify', 'agent'),
    (error: unknown) => {
      assert.match(String(error), /VERIFY-001/u)
      assert.match(String(error), /ship release gate/u)
      return true
    },
  )

  assert.doesNotThrow(() =>
    assertRepositoryCheckProfileAllowed('fast', 'verify', 'agent'),
  )
  assert.doesNotThrow(() =>
    assertRepositoryCheckProfileAllowed('full', 'ship', 'harness'),
  )
})

// R-02 of run 63290: `--harness-initiated` was the whole permission, and a
// documented flag is something the caller sets for itself. The declaration
// now needs the launch token the harness recorded a digest of, and the token
// leaves the environment so the profile's own children cannot inherit it.
test('harness authority comes from the recorded launch token, not the flag', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const token = 'a'.repeat(64)
  const record = prefetchRecordPath(root, run.run_id, 'full')

  mkdirSync(path.dirname(record.absolute), { recursive: true })
  writeFileSync(
    record.absolute,
    `${JSON.stringify({
      schema_version: 1,
      run_id: run.run_id,
      profile: 'full',
      launch_digest: harnessLaunchDigest(token),
    })}
`,
  )

  const previous = process.env[HARNESS_LAUNCH_TOKEN_ENV]

  try {
    process.env[HARNESS_LAUNCH_TOKEN_ENV] = token

    assert.equal(
      resolveRepositoryCheckInitiator(root, run.run_id, true),
      'harness',
    )
    // Reading it removes it, so a profile command this process starts does
    // not inherit the authority of the launch that started this process.
    assert.equal(process.env[HARNESS_LAUNCH_TOKEN_ENV], undefined)

    // RV-02 of run 63290: a same-user process can read a running child's
    // environment, so the launch is spent on first use. The record keeps its
    // other fields, because the supervisor reconciles the child from them.
    const spent = JSON.parse(readFileSync(record.absolute, 'utf8')) as Record<
      string,
      unknown
    >

    assert.equal(spent.launch_digest, undefined)
    assert.equal(spent.run_id, run.run_id)
    assert.ok(typeof spent.launch_consumed_at === 'string')

    process.env[HARNESS_LAUNCH_TOKEN_ENV] = token
    assert.throws(
      () => resolveRepositoryCheckInitiator(root, run.run_id, true),
      /harness launch token/u,
    )

    assert.equal(
      resolveRepositoryCheckInitiator(root, run.run_id, false),
      'agent',
    )

    process.env[HARNESS_LAUNCH_TOKEN_ENV] = 'b'.repeat(64)
    assert.throws(
      () => resolveRepositoryCheckInitiator(root, run.run_id, true),
      /harness launch token/u,
    )
  } finally {
    if (previous === undefined) {
      delete process.env[HARNESS_LAUNCH_TOKEN_ENV]
    } else {
      process.env[HARNESS_LAUNCH_TOKEN_ENV] = previous
    }
  }
})

// R-03 of run 63290: the lookup was scoped to the submitting invocation, so a
// verifier that obeyed its brief and cited the implement gate's pass was told
// its true claim had no evidence, and was pointed at a command its own
// contract forbade. Any passing execution of this run at this fingerprint is
// the evidence the claim needs.
test('a profile pass claim is answered by any current-run evidence', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const output = {
    summary: 'The fast profile passed at the current workspace.',
  }
  const ledger = resolveRunLayout(root, run.run_id).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  mkdirSync(path.dirname(ledger.absolute), { recursive: true })
  writeFileSync(
    ledger.absolute,
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: 'implement-1',
      workspace_fingerprint: fingerprint,
      status: 'passed',
    })}
`,
  )

  assert.deepEqual(
    unrecordedProfileClaimAdvisories(root, run.run_id, fingerprint, output),
    [],
  )

  // A row at another fingerprint is evidence for another workspace, so the
  // advisory still fires.
  assert.equal(
    unrecordedProfileClaimAdvisories(root, run.run_id, 'other', output).length,
    1,
  )
})

// The same finding's second half: prose matching read every string in the
// document, so a finding that reported an unrecorded pass was itself read as
// a claim. Only what the worker asserts in its own voice is a claim.
test('a profile pass claim is read from the summary and criteria only', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint

  assert.deepEqual(
    unrecordedProfileClaimAdvisories(root, run.run_id, fingerprint, {
      summary: 'Verification is complete.',
      risks: ['The output under review says the fast profile passed.'],
      data: {
        verify: {
          findings: [
            {
              evidence: [
                'The implement output claims the fast profile passed.',
              ],
            },
          ],
        },
      },
    }),
    [],
  )

  assert.equal(
    unrecordedProfileClaimAdvisories(root, run.run_id, fingerprint, {
      summary: 'Verification is complete.',
      criteria: [{ explanation: 'The fast profile passed at this workspace.' }],
    }).length,
    1,
  )
})

test('a profile pass claim without current ledger evidence names the sanctioned command', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const invocationId = 'implement-1'
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  const output = {
    summary: 'The fast profile passed at the current workspace.',
  }
  const missing = unrecordedProfileClaimAdvisories(
    root,
    run.run_id,
    fingerprint,
    output,
  )

  assert.equal(missing.length, 1)
  assert.equal(missing[0].id, 'repository_check_claim_unrecorded')
  assert.match(
    missing[0].message,
    new RegExp(`repository-check fast --run ${run.run_id}`, 'u'),
  )

  const ledger = resolveRunLayout(root, run.run_id).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  )

  mkdirSync(path.dirname(ledger.absolute), { recursive: true })
  writeFileSync(
    ledger.absolute,
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: invocationId,
      workspace_fingerprint: fingerprint,
      status: 'passed',
    })}
`,
  )

  assert.deepEqual(
    unrecordedProfileClaimAdvisories(root, run.run_id, fingerprint, output),
    [],
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
  assert.match(evidence, /^invoked_by=agent$/mu)
})

// The verify stage permits each of its evidence workers one profile run, and
// two of them land at one workspace fingerprint often. Both passes used to
// derive the same log name, so the second execution overwrote the first one's
// bytes and the ledger carried two entries pointing at one body.
test('two permitted executions at one fingerprint keep their own evidence logs', () => {
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

  const passes = ['review', 'qa'].map((role) => {
    const result = commandLineResult(root)
    const recorded = recordProfileGatePass(root, 'fast', result, options)

    assert.ok(recorded, `${role} stored its pass`)
    recordAgentRepositoryCheckForRuns(
      root,
      [run.run_id],
      result,
      options.started_at,
      'agent',
      recorded.evidence_path,
    )

    return recorded
  })

  assert.equal(
    new Set(passes.map((pass) => pass.evidence_path)).size,
    2,
    'each execution owns a distinct log path',
  )

  // Both bodies survive, and each ledger entry resolves to its own.
  const ledger = readFileSync(
    resolveRunLayout(root, run.run_id).evidence(
      AGENT_REPOSITORY_CHECK_RUNS_FILE,
    ).absolute,
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { evidence_log: string | null })

  assert.deepEqual(
    ledger.map((entry) => entry.evidence_log),
    passes.map((pass) => pass.evidence_path),
  )

  for (const entry of ledger) {
    assert.match(
      readFileSync(path.join(root, entry.evidence_log ?? ''), 'utf8'),
      /^\$ pan repository-check fast$/mu,
    )
  }
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

/** The ledger a run holds of the profile executions recorded against it. */
function ledgerEntries(root: string, runId: string): Record<string, unknown>[] {
  const ledger = resolveRunLayout(root, runId).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  ).absolute

  return existsSync(ledger)
    ? readFileSync(ledger, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []
}

// HR3-006: the ledger already held the pass, and the next request for the
// same profile executed the suite again anyway. Nothing about the workspace
// had moved, so the second execution bought the run nothing.
test('a recorded pass answers a repeated request for the same profile', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  const layout = resolveRunLayout(root, run.run_id)
  const ledger = layout.evidence(AGENT_REPOSITORY_CHECK_RUNS_FILE)
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint
  // The pass an agent's own command-line run stores, and the ledger entry
  // that points a later reader at its bytes.
  const pass = recordProfileGatePass(root, 'fast', commandLineResult(root), {
    run_ids: [run.run_id],
    fingerprint_before: fingerprint,
    started_at: '2026-09-13T09:00:00.000Z',
  })

  assert.ok(pass)
  mkdirSync(path.dirname(ledger.absolute), { recursive: true })
  writeFileSync(
    ledger.absolute,
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: 'implement-1',
      workspace_fingerprint: fingerprint,
      status: 'passed',
      duration_ms: 90_000,
      started_at: '2026-09-13T09:00:00.000Z',
      invoked_by: 'agent',
      evidence_log: pass.evidence_path,
    })}\n`,
  )

  // The reuse names the execution it stands in for, so the worker cites that
  // run rather than describing an execution it did not perform.
  assert.deepEqual(
    reusableProfileExecution(
      root,
      run.run_id,
      'implement-1',
      'fast',
      fingerprint,
    ),
    {
      profile: 'fast',
      invocation_id: 'implement-1',
      worker_role: null,
      workspace_fingerprint: fingerprint,
      started_at: '2026-09-13T09:00:00.000Z',
      invoked_by: 'agent',
      evidence_log: pass.evidence_path,
      ledger_path: ledger.relative,
    },
  )

  // Reuse reads the ledger and writes nothing, so no second entry claims a
  // fresh execution.
  assert.equal(ledgerEntries(root, run.run_id).length, 1)
})

test('a reusable pass needs the same invocation, fingerprint, profile, and clean result', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  const ledger = resolveRunLayout(root, run.run_id).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  ).absolute
  const fingerprint = gitWorkspaceSnapshot(root).fingerprint

  const entry = (overrides: Record<string, unknown> = {}): string =>
    `${JSON.stringify({
      profile: 'fast',
      invocation_id: 'implement-1',
      workspace_fingerprint: fingerprint,
      status: 'passed',
      duration_ms: 1,
      started_at: '2026-09-13T09:00:00.000Z',
      invoked_by: 'agent',
      ...overrides,
    })}\n`
  const reuse = (
    invocationId: string | null,
    profileName: string,
    observed: string,
    workerRole: string | null = null,
  ): ReusableProfileExecution | null =>
    reusableProfileExecution(
      root,
      run.run_id,
      invocationId,
      profileName,
      observed,
      workerRole,
    )

  // A run that has recorded nothing has nothing to reuse.
  assert.equal(reuse('implement-1', 'fast', fingerprint), null)

  mkdirSync(path.dirname(ledger), { recursive: true })
  writeFileSync(ledger, entry())

  assert.ok(reuse('implement-1', 'fast', fingerprint))

  // A different tree, another invocation's allowance, and another profile
  // each describe work this record does not cover.
  assert.equal(reuse('implement-1', 'fast', 'a'.repeat(64)), null)
  assert.equal(reuse('verify-1', 'fast', fingerprint), null)
  assert.equal(reuse('implement-1', 'static', fingerprint), null)

  // The two evidence workers of one verify stage share an invocation id, so
  // the role is the only thing that keeps their entries apart. The stage
  // worker's own entry answers no worker, and neither worker answers the
  // other.
  writeFileSync(ledger, entry({ invocation_id: 'verify-1' }))
  assert.equal(reuse('verify-1', 'fast', fingerprint, 'review'), null)

  writeFileSync(
    ledger,
    entry({ invocation_id: 'verify-1', worker_role: 'review' }),
  )
  assert.equal(reuse('verify-1', 'fast', fingerprint, 'qa'), null)
  assert.equal(reuse('verify-1', 'fast', fingerprint), null)
  assert.equal(
    reuse('verify-1', 'fast', fingerprint, 'review')?.worker_role,
    'review',
  )

  // A failure has to re-run to show its repair.
  writeFileSync(ledger, entry({ status: 'failed' }))
  assert.equal(reuse('implement-1', 'fast', fingerprint), null)

  // The newest matching entry wins, so a reader follows the bytes that
  // execution actually left behind.
  writeFileSync(
    ledger,
    [
      entry({ evidence_log: 'agent/evidence/first.log' }),
      entry({ evidence_log: 'agent/evidence/second.log' }),
    ].join(''),
  )
  assert.equal(
    reuse('implement-1', 'fast', fingerprint)?.evidence_log,
    'agent/evidence/second.log',
  )
})

// Deduplication makes an ordinary repeat invisible, so the forced repeat has
// to leave a mark: otherwise a worker that chose to spend the suite again
// looks identical to one that never asked.
test('a forced repeat is recorded as a deliberate rerun', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  recordAgentRepositoryCheckForRuns(
    root,
    [run.run_id],
    commandLineResult(root),
    '2026-09-13T09:00:00.000Z',
  )
  recordAgentRepositoryCheckForRuns(
    root,
    [run.run_id],
    commandLineResult(root),
    '2026-09-13T09:30:00.000Z',
    'agent',
    null,
    true,
  )

  const entries = ledgerEntries(root, run.run_id)

  assert.equal(entries.length, 2)
  assert.equal(entries[0].forced_repeat, undefined)
  assert.equal(entries[1].forced_repeat, true)
})
