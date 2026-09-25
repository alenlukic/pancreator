/**
 * Integration tests for `pan spend sync` and `pan spend report` (AC-2 through AC-7, AC-11, AC-12).
 *
 * All tests use a loopback HTTP server to stand in for the Vercel service and
 * the Blob Signed URLs — no real network request is made.
 */
import assert from 'node:assert/strict'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'

import { createFixture } from '../fixture-template.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

const TEST_TOKEN = 'test-spend-token'

// --------------------------------------------------------------------------
// Loopback server helpers
// --------------------------------------------------------------------------

interface ServerContext {
  origin: string
  requestLog: Array<{
    method: string
    path: string
    headers: Record<string, string>
  }>
  close: () => Promise<void>
}

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<ServerContext> {
  const requestLog: ServerContext['requestLog'] = []

  const server = createServer((req, res) => {
    requestLog.push({
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      headers: req.headers as Record<string, string>,
    })

    handler(req, res)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  const origin = `http://127.0.0.1:${addr.port}`

  return {
    origin,
    requestLog,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)

  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
  })
  res.end(payload)
}

function runCli(
  root: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CURSOR_ADMIN_API_KEY: '',
      CURSOR_SESSION_TOKEN: '',
      ...env,
    },
  })

  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  }
}

// --------------------------------------------------------------------------
// AC-2: refuses a missing host or token before any request
// --------------------------------------------------------------------------

test('refuses a missing host or token before any request', async () => {
  const ctx = await startServer((_req, res) => {
    respondJson(res, 200, {})
  })

  const root = createFixture()

  try {
    // No host configured → SPEND_SYNC_HOST_MISSING before any network call.
    const syncResult = runCli(root, ['spend', 'sync', '--json'], {
      PAN_SPEND_SYNC_TOKEN: TEST_TOKEN,
    })

    assert.notEqual(syncResult.status, 0)
    assert.match(syncResult.stderr, /SPEND_SYNC_HOST_MISSING/)
    assert.equal(ctx.requestLog.length, 0)

    // Same for report.
    const reportResult = runCli(root, ['spend', 'report', '--json'], {
      PAN_SPEND_SYNC_TOKEN: TEST_TOKEN,
    })

    assert.notEqual(reportResult.status, 0)
    assert.match(reportResult.stderr, /SPEND_SYNC_HOST_MISSING/)
    assert.equal(ctx.requestLog.length, 0)
  } finally {
    await ctx.close()
  }
})

// --------------------------------------------------------------------------
// AC-11: argument refusal
// --------------------------------------------------------------------------

test('rejects an unknown spend subcommand with INVALID_ARGUMENT', () => {
  const root = createFixture()
  const result = runCli(root, ['spend', 'frobnicate', '--json'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /INVALID_ARGUMENT/)
  assert.doesNotMatch(result.stderr, /SPEND_SYNC_HOST_MISSING/)
})

test('rejects --days 0 for spend sync with INVALID_ARGUMENT before host lookup', () => {
  const root = createFixture()
  const result = runCli(root, ['spend', 'sync', '--days', '0', '--json'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /INVALID_ARGUMENT/)
  assert.doesNotMatch(result.stderr, /SPEND_SYNC_HOST_MISSING/)
})

// --------------------------------------------------------------------------
// AC-12: cleanup retains the spend ledger
// --------------------------------------------------------------------------

test('retains the spend ledger under pan cleanup', () => {
  const root = createFixture()
  const plan = runCli(root, ['cleanup', '--json'])

  assert.equal(plan.status, 0)

  // The plan should not propose to delete runtime/spend.
  assert.doesNotMatch(plan.stdout, /"runtime\/spend"/)
})
