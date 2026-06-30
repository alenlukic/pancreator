import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  loadRepositoryChecks,
  repositoryChecksSourcePath,
  runRepositoryCheck,
  runRepositoryCheckStreaming,
} from '../../src/lib/repository-checks.js'
import { createFixture } from '../helpers.js'

function makeInstallation(): { root: string; workspace: string } {
  const parent = mkdtempSync(path.join(tmpdir(), 'pancreator-checks-'))
  const root = path.join(parent, '.pancreator')
  const workspace = path.join(parent, 'workspace')

  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  mkdirSync(workspace, { recursive: true })
  writeFileSync(
    path.join(root, 'project.json'),
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
  assert.equal(result.results[2]?.stdout, workspace)
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

test('repository checks honor the tighter profile timeout', () => {
  const { root } = makeInstallation()

  writeChecks(root, {
    fast: {
      timeout_ms: 1_000,
      probes: [],
      commands: ['node -e "setTimeout(() => process.exit(0), 2000)"'],
    },
  })

  const result = runRepositoryCheck(root, 'fast', { timeout_ms: 5_000 })

  assert.equal(result.status, 'failed')
  assert.equal(result.timeout_ms, 1_000)
  assert.equal(result.results[0]?.timed_out, true)
})
