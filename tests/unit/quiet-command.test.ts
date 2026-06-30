import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const QUIET_RUNNER = path.join(process.cwd(), 'bin', 'run-quiet')
const PROCESS_TIMEOUT_MS = 30_000
const PROCESS_MAX_BUFFER = 1024 * 1024

function runQuiet(
  source: string,
  options: { verbose?: boolean } = {},
): SpawnSyncReturns<string> {
  return spawnSync(QUIET_RUNNER, ['--', process.execPath, '-e', source], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.verbose ? { PAN_VERBOSE: '1' } : {}),
    },
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
