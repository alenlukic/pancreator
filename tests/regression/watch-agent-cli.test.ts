/**
 * `pan watch --agent` routes by the positional run id (AC-006): with a run id
 * it names the worker's agent for a run-scoped watch, and without one it is
 * the standalone agent watch.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

// Both cases refuse before the watch writes anything, so they run against
// this checkout's own root.
function pan(args: string[]): {
  status: number | null
  body: { error?: string }
} {
  const env = { ...process.env }
  delete env.PANCREATOR_ROOT

  const result = spawnSync(process.execPath, [CLI, ...args, '--json'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 20_000,
  })

  return {
    status: result.status,
    body: JSON.parse(result.stderr) as { error?: string },
  }
}

test('AC-006: pan watch <run-id> --agent <name> takes the run-scoped route', () => {
  const result = pan(['watch', 'no-such-run', '--agent', 'pan-coder'])

  assert.equal(result.status, 1)
  assert.equal(result.body.error, 'RUN_NOT_FOUND')
})

test('AC-006: pan watch --agent <id> without a run id is the standalone form', () => {
  const result = pan(['watch', '--agent', 'bg-1', '--invocation', 'x'])

  assert.equal(result.status, 1)
  assert.equal(result.body.error, 'INVALID_ARGUMENT')
})
