/**
 * `bin/pan-run` records the exit once the command's output drains, or once
 * PAN_RUN_DRAIN_SECONDS pass while a background process the command left
 * behind still holds that output. An unbounded drain left `ended_at` null
 * with the heartbeat already stopped, which read as a stalled command.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { isRecord } from '../../src/lib/io.js'
import { createTestTempDirectory } from '../temp.js'

const PAN_RUN = path.join(process.cwd(), 'bin', 'pan-run')
const PROCESS_TIMEOUT_MS = 30_000

function runEnv(root: string, extra: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env }

  delete env.PAN_VERBOSE
  delete env.PAN_PROGRESS_FD
  delete env.PAN_RUN_HEARTBEAT_SECONDS
  delete env.PAN_RUN_DRAIN_SECONDS

  return { ...env, ...extra, PANCREATOR_ROOT: root }
}

function recordDirectory(root: string): string {
  const shell = path.join(root, 'runtime', 'logs', 'shell')
  const name = readdirSync(shell, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1)

  assert.ok(name, 'pan-run wrote a record directory')

  return path.join(shell, name)
}

function readRecord(directory: string): Record<string, unknown> | null {
  try {
    const record: unknown = JSON.parse(
      readFileSync(path.join(directory, 'record.json'), 'utf8'),
    )

    return isRecord(record) ? record : null
  } catch {
    return null
  }
}

async function waitFor(check: () => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs

  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor deadline passed')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

test('a command whose output closes with it records a drained exit', () => {
  const root = createTestTempDirectory('pan-run-drained-')
  const result = spawnSync(PAN_RUN, ['--', 'true'], {
    encoding: 'utf8',
    env: runEnv(root),
    timeout: PROCESS_TIMEOUT_MS,
  })

  assert.equal(result.status, 0)
  assert.equal(readRecord(recordDirectory(root))?.output_drained, true)
})

test('the exit is recorded while a background process still holds the output', async (t) => {
  const root = createTestTempDirectory('pan-run-held-output-')
  const gate = path.join(root, 'gate')

  t.after(() => writeFileSync(gate, ''))

  const child = spawn(
    PAN_RUN,
    ['-c', `while [ ! -f '${gate}' ]; do sleep 0.1; done & echo held-output`],
    {
      env: runEnv(root, { PAN_RUN_DRAIN_SECONDS: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stderr = ''

  child.stdout.resume()
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk))

  const closed = once(child, 'close') as Promise<[number | null, string]>
  // Hang guard only; the test proves its contract from the record.
  const guard = setTimeout(() => child.kill('SIGKILL'), PROCESS_TIMEOUT_MS)

  closed.finally(() => clearTimeout(guard)).catch(() => undefined)

  // The gate stays closed, so only a bounded drain can write the exit.
  await waitFor(() => {
    try {
      return typeof readRecord(recordDirectory(root))?.ended_at === 'string'
    } catch {
      return false
    }
  })

  const directory = recordDirectory(root)
  const record = readRecord(directory)

  assert.equal(record?.exit_code, 0)
  assert.equal(record?.output_drained, false)
  await waitFor(() => /exited 0; its output is still open/u.test(stderr))

  writeFileSync(gate, '')

  const [code] = await closed

  assert.equal(code, 0)
  assert.match(
    readFileSync(path.join(directory, 'output.log'), 'utf8'),
    /held-output/u,
  )
})
