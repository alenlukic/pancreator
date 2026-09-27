import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const QUIET_RUNNER = path.join(process.cwd(), 'bin', 'run-quiet')
const PROCESS_TIMEOUT_MS = 30_000
const PROCESS_MAX_BUFFER = 4 * 1024 * 1024

function runQuiet(
  source: string,
  options: {
    verbose?: boolean
    progress?: boolean
    progressIntervalSeconds?: string
    root?: string
  } = {},
): SpawnSyncReturns<string> & { root: string } {
  // An inherited operator diagnostic would change the output and fail these
  // cases.
  const env = { ...process.env }
  delete env.PAN_VERBOSE
  delete env.PAN_PROGRESS
  delete env.PAN_PROGRESS_INTERVAL_SECONDS
  // An interactive `npm test` exports its own tick sink, which would take the
  // ticks this file captures.
  delete env.PAN_PROGRESS_FD

  // Provide a temp root so pan-run can write its logs
  const root = options.root ?? createTestTempDirectory('run-quiet-')
  env.PANCREATOR_ROOT = root

  if (options.verbose) {
    env.PAN_VERBOSE = '1'
  }

  if (options.progress) {
    env.PAN_PROGRESS = '1'
    env.PAN_PROGRESS_INTERVAL_SECONDS = options.progressIntervalSeconds ?? '0.2'
  }

  const result = spawnSync(
    QUIET_RUNNER,
    ['--', process.execPath, '-e', source],
    {
      encoding: 'utf8',
      env,
      timeout: PROCESS_TIMEOUT_MS,
      maxBuffer: PROCESS_MAX_BUFFER,
    },
  )

  return Object.assign(result, { root })
}

test('quiet command suppresses successful stdout and stderr', () => {
  const result = runQuiet(
    "process.stdout.write('ordinary output\\n'); process.stderr.write('warning output\\n')",
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('quiet command preserves captured output when the command fails', () => {
  const result = runQuiet(
    "process.stdout.write('context\\n'); process.stderr.write('failure\\n'); process.exit(7)",
  )

  assert.equal(result.status, 7)
  assert.match(result.stdout, /context/u)
  assert.match(result.stderr, /failure/u)
})

test('quiet command streams successful output in verbose mode', () => {
  const result = runQuiet("process.stdout.write('visible\\n')", {
    verbose: true,
  })

  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'visible\n')
  assert.equal(result.stderr, '')
})

// AC-17: log, heartbeat file, and exit record exist in every mode
test('AC-17: run-quiet writes log, heartbeat file, and exit record in every mode', async (t) => {
  function hasShellLog(root: string): boolean {
    const dir = path.join(root, 'runtime', 'logs', 'shell')
    if (!existsSync(dir)) return false
    const entries = readdirSync(dir, { withFileTypes: true })
    return entries.some((e) => e.isDirectory())
  }

  function latestShellLogDir(root: string): string | null {
    const dir = path.join(root, 'runtime', 'logs', 'shell')
    if (!existsSync(dir)) return null
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    const last = entries.at(-1)
    return last !== undefined ? path.join(dir, last) : null
  }

  await t.test('success: nothing on stdout, writes log and record', () => {
    const result = runQuiet("process.stdout.write('hello\\n')")

    assert.equal(result.status, 0)
    assert.equal(result.stdout, '', 'stdout must be empty on success')
    assert.equal(
      result.stderr,
      '',
      'stderr must be empty on success with non-terminal',
    )
    assert.ok(hasShellLog(result.root), 'shell log must exist')

    const logDir = latestShellLogDir(result.root)
    assert.ok(logDir, 'shell log dir must exist')
    assert.ok(
      existsSync(path.join(logDir!, 'record.json')),
      'record.json must exist',
    )
    assert.ok(
      existsSync(path.join(logDir!, 'output.log')),
      'output.log must exist',
    )
    assert.ok(
      existsSync(path.join(logDir!, 'heartbeat.json')),
      'heartbeat.json must exist',
    )
  })

  await t.test(
    'failure: prints captured stdout then stderr, writes log',
    () => {
      const result = runQuiet(
        "process.stdout.write('context\\n'); process.stderr.write('failure\\n'); process.exit(7)",
      )

      assert.equal(result.status, 7)
      assert.match(
        result.stdout,
        /context/u,
        'stdout must contain captured stdout',
      )
      assert.match(
        result.stderr,
        /failure/u,
        'stderr must contain captured stderr',
      )
      assert.ok(
        hasShellLog(result.root),
        'shell log must exist even on failure',
      )
    },
  )

  await t.test('verbose: streams output', () => {
    const result = runQuiet("process.stdout.write('visible\\n')", {
      verbose: true,
    })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /visible/u, 'verbose mode must stream output')
  })
})
