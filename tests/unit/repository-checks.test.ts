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

test('baseline delta treats a first-time failing command as new', () => {
  const current = failedCheck(
    '/workspace/src/a.ts:10:2 error Unexpected value no-example\n',
  )

  const comparison = compareRepositoryCheckToBaseline(passedCheck(), current)

  assert.equal(comparison.passed, false)
  assert.equal(comparison.delta.new.length > 0, true)
})

test('baseline delta treats a changed exit status as new', () => {
  const baseline = failedCheck('same diagnostic text\n')
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

test('baseline delta ignores an unchanged exit status', () => {
  const baseline = failedCheck('same diagnostic text\n')
  const current = failedCheck('same diagnostic text\n')

  const comparison = compareRepositoryCheckToBaseline(baseline, current)

  assert.equal(comparison.passed, true)
  assert.equal(comparison.delta.new.length, 0)
  assert.equal(comparison.delta.fixed.length, 0)
  assert.equal(comparison.delta.carried.length, 1)
})

test('baseline delta passes a fully repaired check', () => {
  const baseline = failedCheck(
    '/workspace/src/a.ts:10:2 error Unexpected value no-example\n',
  )

  const comparison = compareRepositoryCheckToBaseline(baseline, passedCheck())

  assert.equal(comparison.passed, true)
  assert.equal(comparison.delta.new.length, 0)
  assert.equal(
    comparison.delta.fixed.some((item) =>
      item.diagnostic.includes('no-example'),
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

  writeChecks(root, {
    fast: {
      timeout_ms: 1_000,
      probes: [],
      commands: ['node -e "setTimeout(() => process.exit(0), 2000)"'],
    },
  })

  const result = runRepositoryCheck(root, 'fast', { timeout_ms: 5_000 })

  assert.equal(result.status, 'passed')
  assert.equal(result.timeout_ms, 5_000)
  assert.equal(result.results[0]?.timed_out, false)
})

test('direct repository checks use the profile timeout default', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      timeout_ms: 1_000,
      probes: [],
      commands: ['node -e "setTimeout(() => process.exit(0), 2000)"'],
    },
  })

  const result = runRepositoryCheck(root, 'fast')

  assert.equal(result.status, 'failed')
  assert.equal(result.timeout_ms, 1_000)
  assert.equal(result.results[0]?.timed_out, true)
})
