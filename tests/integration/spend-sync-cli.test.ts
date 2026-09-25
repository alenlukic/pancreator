/**
 * Integration tests for `pan spend sync` and `pan spend report` (AC-2 through AC-7, AC-11, AC-12).
 *
 * All tests use a loopback HTTP server to stand in for Cursor, the Vercel
 * service, and the Blob Signed URLs — no real network request is made.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'

import { syncSpend } from '../../src/lib/spend-sync.js'
import type { SpendRecord } from '../../src/lib/token-spend.js'
import { createFixture } from '../fixture-template.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

const TEST_TOKEN = 'test-spend-token'
const CURSOR_KEY = 'cursor-admin-key-secret'
const EMAIL = 'private-person@example.com'

const CONVERSATION_ID = 'conversation-raw-id-123'
const CLOUD_AGENT_ID = 'bc-cloud-agent-raw-456'
const AUTOMATION_ID = 'automation-raw-789'
const TRANSCRIPT_TEXT = 'transcript text that must stay local'

const DAY_MS = 24 * 60 * 60 * 1000
const HEX_KEY = /^[0-9a-f]{64}$/u

// In-process syncs resolve the bearer token from the environment.
process.env.PAN_SPEND_SYNC_TOKEN = TEST_TOKEN

// --------------------------------------------------------------------------
// Loopback server helpers
// --------------------------------------------------------------------------

interface LoggedRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: Buffer
}

interface ServerContext {
  origin: string
  requestLog: LoggedRequest[]
  close: () => Promise<void>
}

async function startServer(
  handler: (
    request: LoggedRequest,
    res: ServerResponse,
    origin: string,
  ) => void,
): Promise<ServerContext> {
  const requestLog: LoggedRequest[] = []
  let origin = ''

  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const logged = {
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks),
      }

      requestLog.push(logged)
      handler(logged, res, origin)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }

  origin = `http://127.0.0.1:${addr.port}`

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
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
  })
  res.end(JSON.stringify(body))
}

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

/** Run the CLI without blocking, so the in-process loopback server can answer it. */
function runCli(
  root: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<CliResult> {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: root,
    timeout: 60_000,
    env: {
      ...process.env,
      CURSOR_ADMIN_API_KEY: '',
      CURSOR_SESSION_TOKEN: '',
      ...env,
    },
  })
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function setVercelHost(root: string, host: string): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, spend: { vercel_host: host } }, null, 2)}\n`,
  )
}

function projectSlug(absolute: string): string {
  return path.resolve(absolute).split(path.sep).filter(Boolean).join('-')
}

function writeTranscript(root: string): string {
  const projectsRoot = path.join(root, 'cursor-projects')
  const transcriptPath = path.join(
    projectsRoot,
    projectSlug(root),
    'agent-transcripts',
    `${CONVERSATION_ID}.jsonl`,
  )

  mkdirSync(path.dirname(transcriptPath), { recursive: true })
  writeFileSync(
    transcriptPath,
    [
      {
        role: 'user',
        message: { content: [{ type: 'text', text: TRANSCRIPT_TEXT }] },
      },
      {
        role: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'ReadFile', input: {} }],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  )

  return projectsRoot
}

function usageEvent(timestampMs: number, ids: Record<string, string>): unknown {
  return {
    timestamp: String(timestampMs),
    userEmail: EMAIL,
    model: 'gpt-5.6-sol',
    kind: 'Usage-based',
    maxMode: false,
    requestsCosts: 1,
    isTokenBasedCall: true,
    isChargeable: true,
    isHeadless: false,
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalCents: 2,
    },
    chargedCents: 2,
    ...ids,
  }
}

interface SyncServerOptions {
  events: () => unknown[]
  uploadStatus?: number
  uploadUrl?: (origin: string) => string
}

/** Serve Cursor usage, the upload endpoint, and the presigned PUT target. */
function syncHandler(options: SyncServerOptions) {
  return (request: LoggedRequest, res: ServerResponse, origin: string) => {
    if (request.path === '/cursor/usage') {
      respondJson(res, 200, {
        pagination: { hasNextPage: false },
        usageEvents: options.events(),
      })
    } else if (request.path === '/api/snapshots/upload') {
      if (options.uploadStatus !== undefined) {
        respondJson(res, options.uploadStatus, { error: 'unauthorized' })
        return
      }

      respondJson(res, 200, {
        upload_url: (options.uploadUrl ?? ((o) => `${o}/blob/put`))(origin),
        pathname: 'spend/instances/x.json.gz',
      })
    } else if (request.path === '/blob/put') {
      res.writeHead(200)
      res.end()
    } else {
      respondJson(res, 404, { error: 'not found' })
    }
  }
}

function syncOptions(root: string, ctx: ServerContext, now: Date) {
  return {
    days: 14,
    now,
    apiKey: CURSOR_KEY,
    endpoint: `${ctx.origin}/cursor/usage`,
    cursorProjectsRoot: writeTranscript(root),
  }
}

async function assertSpendError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, code)

    return true
  })
}

function readLedger(root: string): { records: SpendRecord[] } {
  return JSON.parse(
    readFileSync(path.join(root, 'runtime/spend/ledger.json'), 'utf8'),
  ) as { records: SpendRecord[] }
}

function hexKey(label: string): string {
  return createHash('sha256').update(label).digest('hex')
}

function snapshotRecord(
  label: string,
  timestampMs: number,
  command = 'Unattributed',
): SpendRecord {
  return {
    key: hexKey(label),
    source: 'team',
    timestamp_ms: timestampMs,
    model: 'gpt-5.6-sol',
    metrics: {
      events: 1,
      request_units: 1,
      input_tokens: 100,
      output_tokens: 20,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 120,
      cost_cents: 2,
    },
    attribution: {
      command,
      persona_model: 'Unattributed · gpt-5.6-sol',
      tools: [],
      fast_mode: 'unknown',
      governance: 'unattributed',
      workflow_role: 'unattributed',
      stage: 'Unattributed',
      remediation: 'unattributed',
    },
    conversation_key: null,
  }
}

function gzipSnapshot(
  instanceId: string,
  records: SpendRecord[],
  schemaVersion = 1,
): Buffer {
  return gzipSync(
    JSON.stringify({
      schema_version: schemaVersion,
      instance_id: instanceId,
      label: `host-${instanceId.slice(-1)}`,
      harness_version: '7.26.0',
      synced_at: new Date().toISOString(),
      attribution_sources: {
        workspaces_scanned: 1,
        embedded_installations_scanned: 0,
      },
      records,
      tool_calls: {},
    }),
  )
}

/** Serve a snapshot list and each gzip snapshot body. */
function reportHandler(snapshots: Map<string, Buffer>) {
  return (request: LoggedRequest, res: ServerResponse, origin: string) => {
    if (request.path === '/api/snapshots') {
      respondJson(res, 200, {
        snapshots: [...snapshots.keys()].map((instance_id) => ({
          instance_id,
          uploaded_at: new Date().toISOString(),
          size: snapshots.get(instance_id)?.length ?? 0,
          download_url: `${origin}/blob/get/${instance_id}`,
        })),
      })
      return
    }

    const body = snapshots.get(request.path.replace('/blob/get/', ''))

    if (body === undefined) {
      respondJson(res, 404, { error: 'not found' })
      return
    }

    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    res.end(body)
  }
}

// --------------------------------------------------------------------------
// AC-2: refuses a missing host or token before any request
// --------------------------------------------------------------------------

test('refuses a missing host or token before any request', async () => {
  const ctx = await startServer((_request, res) => {
    respondJson(res, 200, {})
  })

  const root = createFixture()

  try {
    for (const subcommand of ['sync', 'report']) {
      const result = await runCli(root, ['spend', subcommand, '--json'], {
        PAN_SPEND_SYNC_TOKEN: TEST_TOKEN,
      })

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /SPEND_SYNC_HOST_MISSING/)
    }

    setVercelHost(root, ctx.origin)

    for (const subcommand of ['sync', 'report']) {
      const result = await runCli(root, ['spend', subcommand, '--json'], {
        PAN_SPEND_SYNC_TOKEN: '',
      })

      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /SPEND_SYNC_TOKEN_MISSING/)
    }

    assert.equal(ctx.requestLog.length, 0)
  } finally {
    await ctx.close()
  }
})

// --------------------------------------------------------------------------
// AC-3, AC-4, AC-5: sync
// --------------------------------------------------------------------------

test('two pan spend sync runs accumulate one ledger and keep one instance id', async () => {
  const firstNow = new Date('2026-09-20T12:00:00.000Z')
  const secondNow = new Date('2026-09-21T12:00:00.000Z')
  const at = (hours: number) => firstNow.getTime() - hours * 60 * 60 * 1000
  let events = [usageEvent(at(2), {}), usageEvent(at(1), {})]

  const ctx = await startServer(syncHandler({ events: () => events }))
  const root = createFixture()

  try {
    setVercelHost(root, ctx.origin)
    mkdirSync(path.join(root, 'runtime/spend'), { recursive: true })
    writeFileSync(
      path.join(root, 'runtime/spend/ledger.json'),
      `${JSON.stringify({
        schema_version: 1,
        instance_id: 'seed',
        records: [snapshotRecord('stale', firstNow.getTime() - 366 * DAY_MS)],
        tool_calls: {},
        updated_at: '2025-01-01T00:00:00.000Z',
      })}\n`,
    )

    const first = await syncSpend(root, syncOptions(root, ctx, firstNow))

    events = [usageEvent(at(1), {}), usageEvent(at(0.5), {})]

    const second = await syncSpend(root, syncOptions(root, ctx, secondNow))

    const ledger = readLedger(root)
    const keys = ledger.records.map((record) => record.key)
    const instance = JSON.parse(
      readFileSync(path.join(root, 'runtime/spend/instance.json'), 'utf8'),
    ) as { instance_id: string }
    const puts = ctx.requestLog.filter((request) => request.method === 'PUT')

    assert.equal(keys.length, 3)
    assert.equal(new Set(keys).size, 3)
    assert.ok(!keys.includes(hexKey('stale')))
    assert.equal(first.instance_id, instance.instance_id)
    assert.equal(second.instance_id, instance.instance_id)
    assert.deepEqual(
      { ...second, uploaded_bytes: 0 },
      {
        status: 'synced',
        instance_id: instance.instance_id,
        label: second.label,
        host: ctx.origin,
        records_fetched: 2,
        ledger_records: 3,
        ledger_window: {
          start: new Date(at(2)).toISOString(),
          end: new Date(at(0.5)).toISOString(),
        },
        uploaded_bytes: 0,
      },
    )
    assert.ok(second.label.length > 0 && second.label.length <= 64)
    assert.equal(second.uploaded_bytes, puts[1]?.body.length)
  } finally {
    await ctx.close()
  }
})

test('the uploaded snapshot has hashed keys and no raw identifiers', async () => {
  const now = new Date('2026-09-20T12:00:00.000Z')
  const events = [
    usageEvent(now.getTime() - 60_000, { conversationId: CONVERSATION_ID }),
    usageEvent(now.getTime() - 50_000, { cloudAgentId: CLOUD_AGENT_ID }),
    usageEvent(now.getTime() - 40_000, { automationId: AUTOMATION_ID }),
  ]
  const ctx = await startServer(syncHandler({ events: () => events }))
  const root = createFixture()

  try {
    setVercelHost(root, ctx.origin)
    await syncSpend(root, syncOptions(root, ctx, now))

    const put = ctx.requestLog.find((request) => request.method === 'PUT')
    const decoded = gunzipSync(put?.body ?? Buffer.alloc(0)).toString('utf8')
    const snapshot = JSON.parse(decoded) as {
      schema_version: number
      records: SpendRecord[]
      tool_calls: Record<string, unknown>
    }

    assert.equal(snapshot.schema_version, 1)
    assert.equal(snapshot.records.length, 3)

    for (const record of snapshot.records) {
      assert.match(record.key, HEX_KEY)
      assert.ok(
        record.conversation_key === null ||
          HEX_KEY.test(record.conversation_key),
      )
    }

    assert.equal(Object.keys(snapshot.tool_calls).length, 1)

    for (const key of Object.keys(snapshot.tool_calls)) {
      assert.match(key, HEX_KEY)
    }

    for (const forbidden of [
      CONVERSATION_ID,
      CLOUD_AGENT_ID,
      AUTOMATION_ID,
      EMAIL,
      TEST_TOKEN,
      CURSOR_KEY,
      TRANSCRIPT_TEXT,
    ]) {
      assert.ok(!decoded.includes(forbidden), `snapshot leaks ${forbidden}`)
    }
  } finally {
    await ctx.close()
  }
})

test('sync POSTs for a presigned URL with the Bearer token and PUTs the gzip snapshot to it', async () => {
  const now = new Date('2026-09-20T12:00:00.000Z')
  const ctx = await startServer(
    syncHandler({ events: () => [usageEvent(now.getTime() - 60_000, {})] }),
  )
  const root = createFixture()

  try {
    setVercelHost(root, ctx.origin)
    await syncSpend(root, syncOptions(root, ctx, now))

    const service = ctx.requestLog.filter(
      (request) => request.path !== '/cursor/usage',
    )

    assert.deepEqual(
      service.map((request) => [request.method, request.path]),
      [
        ['POST', '/api/snapshots/upload'],
        ['PUT', '/blob/put'],
      ],
    )
    assert.equal(service[0]?.headers.authorization, `Bearer ${TEST_TOKEN}`)
    assert.ok(JSON.parse(service[0]?.body.toString('utf8') ?? '{}').instance_id)
    assert.deepEqual([...(service[1]?.body.subarray(0, 2) ?? [])], [0x1f, 0x8b])
  } finally {
    await ctx.close()
  }
})

test('sync refuses an insecure upload URL with SPEND_SYNC_INVALID_RESPONSE and keeps the ledger valid', async () => {
  const now = new Date('2026-09-20T12:00:00.000Z')
  const ctx = await startServer(
    syncHandler({
      events: () => [usageEvent(now.getTime() - 60_000, {})],
      uploadUrl: () => 'http://blob.example.com/put',
    }),
  )
  const root = createFixture()

  try {
    setVercelHost(root, ctx.origin)
    await assertSpendError(
      syncSpend(root, syncOptions(root, ctx, now)),
      'SPEND_SYNC_INVALID_RESPONSE',
    )

    assert.ok(!ctx.requestLog.some((request) => request.method === 'PUT'))
    assert.equal(readLedger(root).records.length, 1)
  } finally {
    await ctx.close()
  }
})

test('sync maps a 401 to SPEND_SYNC_UNAUTHORIZED and keeps the ledger valid', async () => {
  const now = new Date('2026-09-20T12:00:00.000Z')
  const ctx = await startServer(
    syncHandler({
      events: () => [usageEvent(now.getTime() - 60_000, {})],
      uploadStatus: 401,
    }),
  )
  const root = createFixture()

  try {
    setVercelHost(root, ctx.origin)
    await assertSpendError(
      syncSpend(root, syncOptions(root, ctx, now)),
      'SPEND_SYNC_UNAUTHORIZED',
    )

    assert.equal(readLedger(root).records.length, 1)
  } finally {
    await ctx.close()
  }
})

// --------------------------------------------------------------------------
// AC-6, AC-7: report
// --------------------------------------------------------------------------

test('report aggregates every instance snapshot, skips an invalid snapshot, and applies the days window', async () => {
  const instanceA = '00000000-0000-4000-8000-00000000000a'
  const instanceB = '00000000-0000-4000-8000-00000000000b'
  const instanceC = '00000000-0000-4000-8000-00000000000c'
  const recent = Date.now() - DAY_MS

  const ctx = await startServer(
    reportHandler(
      new Map([
        [
          instanceA,
          gzipSnapshot(instanceA, [
            snapshotRecord('shared', recent, '/pan-start'),
            snapshotRecord('outside-window', Date.now() - 30 * DAY_MS),
          ]),
        ],
        [
          instanceB,
          gzipSnapshot(instanceB, [
            snapshotRecord('shared', recent),
            snapshotRecord('only-b', recent),
          ]),
        ],
        [instanceC, gzipSnapshot(instanceC, [], 9)],
      ]),
    ),
  )
  const root = createFixture()

  try {
    setVercelHost(root, ctx.origin)

    const result = await runCli(
      root,
      ['spend', 'report', '--days', '14', '--json'],
      {
        PAN_SPEND_SYNC_TOKEN: TEST_TOKEN,
      },
    )

    assert.equal(result.status, 0, result.stderr)

    const { report } = JSON.parse(result.stdout) as {
      report: {
        scope: string
        period: { days: number; cost_basis: string }
        totals: { events: number; total_tokens: number }
        instances: Array<{
          instance_id: string
          records_in_window: number
          records_selected: number
          totals: { events: number; total_tokens: number }
        }>
        slices: { commands: Array<{ key: string }> }
        warnings: string[]
      }
    }

    assert.equal(
      ctx.requestLog[0]?.headers.authorization,
      `Bearer ${TEST_TOKEN}`,
    )
    assert.equal(report.scope, 'multi-instance')
    assert.equal(report.period.days, 14)
    assert.equal(report.period.cost_basis, 'charged')
    assert.equal(report.totals.events, 2)
    assert.deepEqual(
      report.instances.map((instance) => [
        instance.instance_id,
        instance.records_in_window,
        instance.records_selected,
      ]),
      [
        [instanceA, 1, 1],
        [instanceB, 2, 1],
      ],
    )
    assert.equal(
      report.instances.reduce((total, item) => total + item.totals.events, 0),
      report.totals.events,
    )
    assert.equal(
      report.instances.reduce(
        (total, item) => total + item.totals.total_tokens,
        0,
      ),
      report.totals.total_tokens,
    )
    assert.ok(report.slices.commands.some((row) => row.key === '/pan-start'))
    assert.ok(
      report.warnings.some(
        (warning) => warning.includes(instanceC) && warning.includes('invalid'),
      ),
    )
  } finally {
    await ctx.close()
  }
})

test('report with no snapshots returns zero totals and a warning', async () => {
  const ctx = await startServer(reportHandler(new Map()))
  const root = createFixture()

  try {
    setVercelHost(root, ctx.origin)

    const result = await runCli(root, ['spend', 'report', '--json'], {
      PAN_SPEND_SYNC_TOKEN: TEST_TOKEN,
    })

    assert.equal(result.status, 0, result.stderr)

    const { report } = JSON.parse(result.stdout) as {
      report: {
        instances: unknown[]
        totals: { events: number; cost_cents: number }
        warnings: string[]
      }
    }

    assert.deepEqual(report.instances, [])
    assert.equal(report.totals.events, 0)
    assert.equal(report.totals.cost_cents, 0)
    assert.ok(report.warnings.some((warning) => /No snapshots/u.test(warning)))
  } finally {
    await ctx.close()
  }
})

// --------------------------------------------------------------------------
// AC-11: argument refusal
// --------------------------------------------------------------------------

test('rejects an unknown spend subcommand with INVALID_ARGUMENT', async () => {
  const root = createFixture()
  const result = await runCli(root, ['spend', 'frobnicate', '--json'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /INVALID_ARGUMENT/)
  assert.doesNotMatch(result.stderr, /SPEND_SYNC_HOST_MISSING/)
})

test('rejects --days 0 for spend sync with INVALID_ARGUMENT before host lookup', async () => {
  const root = createFixture()
  const result = await runCli(root, ['spend', 'sync', '--days', '0', '--json'])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /INVALID_ARGUMENT/)
  assert.doesNotMatch(result.stderr, /SPEND_SYNC_HOST_MISSING/)
})

// --------------------------------------------------------------------------
// AC-12: cleanup retains the spend ledger
// --------------------------------------------------------------------------

test('retains the spend ledger when pan cleanup --apply runs', async () => {
  const root = createFixture()
  const spendDir = path.join(root, 'runtime/spend')
  const ledger = `${JSON.stringify({ schema_version: 1, records: [] })}\n`
  const instance = `${JSON.stringify({ instance_id: 'kept' })}\n`

  mkdirSync(spendDir, { recursive: true })
  writeFileSync(path.join(spendDir, 'ledger.json'), ledger)
  writeFileSync(path.join(spendDir, 'instance.json'), instance)

  const plan = await runCli(root, [
    'cleanup',
    '--class',
    'spend-ledger',
    '--json',
  ])

  assert.equal(plan.status, 0, plan.stderr)
  assert.deepEqual(
    (JSON.parse(plan.stdout) as { actions: unknown[] }).actions,
    [],
  )

  const applied = await runCli(root, ['cleanup', '--apply', '--json'])

  assert.equal(applied.status, 0, applied.stderr)
  assert.ok(existsSync(path.join(spendDir, 'ledger.json')))
  assert.equal(readFileSync(path.join(spendDir, 'ledger.json'), 'utf8'), ledger)
  assert.equal(
    readFileSync(path.join(spendDir, 'instance.json'), 'utf8'),
    instance,
  )
})
