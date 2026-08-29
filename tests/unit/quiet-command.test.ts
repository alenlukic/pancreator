import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const QUIET_RUNNER = path.join(process.cwd(), 'bin', 'run-quiet')
const PROCESS_TIMEOUT_MS = 30_000
const PROCESS_MAX_BUFFER = 1024 * 1024

function runQuiet(
  source: string,
  options: {
    verbose?: boolean
    progress?: boolean
    progressIntervalSeconds?: string
  } = {},
): SpawnSyncReturns<string> {
  // PAN_VERBOSE and PAN_PROGRESS are documented operator diagnostics, so an
  // inherited value would otherwise change output and fail the pinned cases.
  const env = { ...process.env }
  delete env.PAN_VERBOSE
  delete env.PAN_PROGRESS
  delete env.PAN_PROGRESS_INTERVAL_SECONDS

  if (options.verbose) {
    env.PAN_VERBOSE = '1'
  }

  if (options.progress) {
    env.PAN_PROGRESS = '1'
    env.PAN_PROGRESS_INTERVAL_SECONDS = options.progressIntervalSeconds ?? '0.2'
  }

  return spawnSync(QUIET_RUNNER, ['--', process.execPath, '-e', source], {
    encoding: 'utf8',
    env,
    timeout: PROCESS_TIMEOUT_MS,
    maxBuffer: PROCESS_MAX_BUFFER,
  })
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

test('progress ticks mark intervals in which the command produced output', () => {
  // Captured output has no terminal, so ticks require the opt-in; the
  // suppression tests above pin that the default emits nothing.
  const result = runQuiet(
    "const timer = setInterval(() => process.stdout.write('line\\n'), 100); setTimeout(() => clearInterval(timer), 700)",
    { progress: true },
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /^\.+\n$/u)
})

test('a silent command earns no ticks, exposing a hang as a stopped stream', () => {
  const result = runQuiet('setTimeout(() => {}, 700)', { progress: true })

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('progress ticks stay quiet for a command faster than one interval', () => {
  // An interval wider than the command's lifetime removes the race between a
  // first tick and a fast exit. It is kept short because the ticker's
  // orphaned `sleep` holds the stderr pipe open, so the wrapper's exit is not
  // observed until the interval elapses.
  const result = runQuiet("process.stdout.write('quick\\n')", {
    progress: true,
    progressIntervalSeconds: '0.5',
  })

  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})
