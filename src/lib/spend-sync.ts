/**
 * Multi-instance Cursor spend sync and report.
 *
 * `syncSpend` collects this instance's attributed spend records, merges them
 * into a local ledger at `runtime/spend/ledger.json`, and uploads the ledger
 * as a gzip snapshot to the configured Vercel service.
 *
 * `reportMultiInstanceSpend` downloads every instance's latest snapshot from
 * the service, deduplicates events by key, and aggregates the combined set
 * using the same computation as the local spend report.
 *
 * No raw Cursor identifier (conversation id, cloud agent id, automation id,
 * email, or credential) leaves this machine. All cross-instance correlation
 * uses SHA-256 hex keys.
 */
import { randomUUID } from 'node:crypto'
import { createGunzip, createGzip } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { credentialRoots } from './cursor-usage.js'
import { PanError, errorMessage, invariant } from './errors.js'
import {
  fileExists,
  isRecord,
  readText,
  withOperationMutex,
  writeJsonAtomic,
} from './io.js'
import {
  isLoopbackHostname,
  readProjectConfig,
  resolveSpendSyncOrigin,
} from './project-config.js'
import {
  aggregateSpendRecords,
  collectSpendRecords,
  type AggregateSpendRecordsResult,
  type CollectSpendRecordsOptions,
  type SpendRecord,
} from './token-spend.js'

const DAY_MS = 24 * 60 * 60 * 1_000
const MAX_LEDGER_DAYS = 365
const DEFAULT_REPORT_DAYS = 14
const SNAPSHOT_SCHEMA_VERSION = 1
const SYNC_TIMEOUT_MS = 60_000
const INSTANCE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const HEX_KEY_RE = /^[0-9a-f]{64}$/u
const METRIC_FIELDS = [
  'events',
  'request_units',
  'input_tokens',
  'output_tokens',
  'cache_write_tokens',
  'cache_read_tokens',
  'total_tokens',
  'cost_cents',
] as const
const ATTRIBUTION_STRING_FIELDS = [
  'command',
  'persona_model',
  'fast_mode',
  'governance',
  'workflow_role',
  'stage',
  'remediation',
] as const

export interface SpendLedger {
  schema_version: 1
  instance_id: string
  records: SpendRecord[]
  /** Per hashed conversation_key tool call counts. */
  tool_calls: Record<string, Record<string, number>>
  updated_at: string
}

export interface SpendSnapshot {
  schema_version: 1
  instance_id: string
  label: string
  harness_version: string
  synced_at: string
  attribution_sources: {
    workspaces_scanned: number
    embedded_installations_scanned: number
  }
  records: SpendRecord[]
  tool_calls: Record<string, Record<string, number>>
}

export interface SyncSpendResult {
  status: 'synced'
  instance_id: string
  label: string
  host: string
  records_fetched: number
  ledger_records: number
  ledger_window: { start: string; end: string }
  uploaded_bytes: number
}

export interface InstanceSummary {
  instance_id: string
  label: string
  synced_at: string
  harness_version: string
  records_in_window: number
  records_selected: number
  totals: AggregateSpendRecordsResult['totals']
}

export interface MultiInstanceSpendReport {
  scope: 'multi-instance'
  period: {
    days: number
    start: string
    end: string
    timezone: 'UTC'
    source: 'Pancreator spend sync'
    cost_basis: 'charged' | 'model-cost' | 'mixed'
  }
  attribution_sources: {
    instances: number
    workspaces_scanned: number
    embedded_installations_scanned: number
  }
  instances: InstanceSummary[]
  totals: AggregateSpendRecordsResult['totals']
  token_categories: AggregateSpendRecordsResult['token_categories']
  daily: AggregateSpendRecordsResult['daily']
  slices: AggregateSpendRecordsResult['slices']
  coverage: AggregateSpendRecordsResult['coverage']
  warnings: string[]
}

export interface SyncSpendOptions extends CollectSpendRecordsOptions {
  fetchImpl?: typeof fetch
}

export interface ReportMultiInstanceSpendOptions {
  days?: number
  now?: Date
  fetchImpl?: typeof fetch
}

function instanceFilePath(root: string): string {
  return path.join(root, 'runtime', 'spend', 'instance.json')
}

function ledgerFilePath(root: string): string {
  return path.join(root, 'runtime', 'spend', 'ledger.json')
}

function ledgerLockPath(root: string): string {
  return path.join(root, 'runtime', 'spend', 'ledger.lock')
}

/** Read or create the per-instance identity file. Returns instance_id and label. */
function resolveInstanceId(root: string): {
  instance_id: string
  label: string
} {
  const filePath = instanceFilePath(root)

  if (fileExists(filePath)) {
    try {
      const raw = readText(filePath)
      const parsed: unknown = JSON.parse(raw)

      if (
        isRecord(parsed) &&
        typeof parsed.instance_id === 'string' &&
        INSTANCE_ID_RE.test(parsed.instance_id)
      ) {
        return {
          instance_id: parsed.instance_id,
          label: os.hostname().slice(0, 64),
        }
      }
    } catch {
      // Fall through to create new identity.
    }
  }

  const instance_id = randomUUID()

  writeJsonAtomic(filePath, {
    instance_id,
    created_at: new Date().toISOString(),
  })

  return { instance_id, label: os.hostname().slice(0, 64) }
}

function readLedger(root: string, instanceId: string): SpendLedger {
  const filePath = ledgerFilePath(root)

  if (!fileExists(filePath)) {
    return {
      schema_version: 1,
      instance_id: instanceId,
      records: [],
      tool_calls: {},
      updated_at: new Date(0).toISOString(),
    }
  }

  try {
    const raw = readText(filePath)
    const parsed: unknown = JSON.parse(raw)

    if (
      isRecord(parsed) &&
      parsed.schema_version === 1 &&
      Array.isArray(parsed.records)
    ) {
      return {
        schema_version: 1,
        instance_id:
          typeof parsed.instance_id === 'string'
            ? parsed.instance_id
            : instanceId,
        records: parsed.records.filter(isSpendRecord),
        tool_calls: parseToolCalls(parsed.tool_calls),
        updated_at:
          typeof parsed.updated_at === 'string'
            ? parsed.updated_at
            : new Date(0).toISOString(),
      }
    }
  } catch {
    // Corrupt ledger; start fresh.
  }

  return {
    schema_version: 1,
    instance_id: instanceId,
    records: [],
    tool_calls: {},
    updated_at: new Date(0).toISOString(),
  }
}

/**
 * Attribution score: count how many attribution fields are known.
 * Higher score = better attributed.
 */
function attributionScore(record: SpendRecord): number {
  const a = record.attribution
  let score = 0

  if (a.command !== 'Unattributed') score += 1
  if (!a.persona_model.startsWith('Unattributed ·')) score += 1
  if (a.tools.length > 0) score += 1
  if (a.fast_mode !== 'unknown') score += 1
  if (a.governance !== 'unattributed') score += 1
  if (a.workflow_role !== 'unattributed') score += 1
  if (a.stage !== 'Unattributed') score += 1
  if (a.remediation !== 'unattributed') score += 1

  return score
}

/**
 * Select the better of two records with the same event key.
 *
 * Selection rule:
 * 1. Higher attribution score wins.
 * 2. Tie: newer synced_at → incoming wins.
 * 3. Further tie: lexicographically smaller instance_id.
 */
export function selectSpendRecord(
  incoming: SpendRecord,
  existing: SpendRecord,
  incomingInstanceId: string,
  existingInstanceId: string,
  incomingSyncedAt: string,
  existingSyncedAt: string,
): SpendRecord {
  const inScore = attributionScore(incoming)
  const exScore = attributionScore(existing)

  if (inScore !== exScore) {
    return inScore > exScore ? incoming : existing
  }

  if (incomingSyncedAt !== existingSyncedAt) {
    return incomingSyncedAt > existingSyncedAt ? incoming : existing
  }

  return incomingInstanceId <= existingInstanceId ? incoming : existing
}

interface LedgerRecordMeta {
  record: SpendRecord
  instance_id: string
  synced_at: string
}

/**
 * Merge freshly collected records into the ledger under the selection rule,
 * drop records older than 365 days, and keep only referenced tool maps.
 */
export function mergeLedger(
  ledger: SpendLedger,
  incomingRecords: SpendRecord[],
  incomingToolCalls: Map<string, Map<string, number>>,
  instanceId: string,
  syncedAt: string,
  now: Date,
): SpendLedger {
  const cutoffMs = now.getTime() - MAX_LEDGER_DAYS * DAY_MS
  const byKey = new Map<string, LedgerRecordMeta>()

  for (const record of ledger.records) {
    if (record.timestamp_ms >= cutoffMs) {
      byKey.set(record.key, {
        record,
        instance_id: ledger.instance_id,
        synced_at: ledger.updated_at,
      })
    }
  }

  for (const incoming of incomingRecords) {
    if (incoming.timestamp_ms < cutoffMs) {
      continue
    }

    const existing = byKey.get(incoming.key)

    if (existing === undefined) {
      byKey.set(incoming.key, {
        record: incoming,
        instance_id: instanceId,
        synced_at: syncedAt,
      })
    } else {
      const selected = selectSpendRecord(
        incoming,
        existing.record,
        instanceId,
        existing.instance_id,
        syncedAt,
        existing.synced_at,
      )

      byKey.set(incoming.key, {
        record: selected,
        instance_id: selected === incoming ? instanceId : existing.instance_id,
        synced_at: selected === incoming ? syncedAt : existing.synced_at,
      })
    }
  }

  // Merge tool_calls: incoming (newer) wins per conversation_key.
  const mergedToolCalls: Record<string, Record<string, number>> = {
    ...ledger.tool_calls,
  }

  for (const [convKey, toolMap] of incomingToolCalls) {
    mergedToolCalls[convKey] = Object.fromEntries(toolMap)
  }

  // Remove tool_call entries whose conversation_key is no longer referenced.
  const remainingConvKeys = new Set<string>()

  for (const meta of byKey.values()) {
    if (meta.record.conversation_key !== null) {
      remainingConvKeys.add(meta.record.conversation_key)
    }
  }

  for (const key of Object.keys(mergedToolCalls)) {
    if (!remainingConvKeys.has(key)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete mergedToolCalls[key]
    }
  }

  return {
    schema_version: 1,
    instance_id: instanceId,
    records: [...byKey.values()].map((meta) => meta.record),
    tool_calls: mergedToolCalls,
    updated_at: syncedAt,
  }
}

function gzipJson(value: unknown): Promise<Buffer> {
  const json = JSON.stringify(value)
  const input = Buffer.from(json, 'utf8')
  const chunks: Buffer[] = []

  return new Promise<Buffer>((resolve, reject) => {
    const gz = createGzip()

    gz.on('data', (chunk: Buffer) => chunks.push(chunk))
    gz.on('end', () => resolve(Buffer.concat(chunks)))
    gz.on('error', reject)
    gz.end(input)
  })
}

function gunzipBuffer(compressed: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = []

  return new Promise<Buffer>((resolve, reject) => {
    const gz = createGunzip()

    gz.on('data', (chunk: Buffer) => chunks.push(chunk))
    gz.on('end', () => resolve(Buffer.concat(chunks)))
    gz.on('error', reject)
    gz.end(compressed)
  })
}

/**
 * Resolve `PAN_SPEND_SYNC_TOKEN` from the process environment or `.env` files.
 * Uses the same root search as Cursor usage credentials.
 */
function resolveSpendToken(root: string): string {
  const envToken = process.env.PAN_SPEND_SYNC_TOKEN

  if (typeof envToken === 'string' && envToken.length > 0) {
    return envToken
  }

  for (const candidateRoot of credentialRoots(root)) {
    const envPath = path.join(candidateRoot, '.env')

    if (!fileExists(envPath)) {
      continue
    }

    try {
      const parsed = parseEnv(readText(envPath))
      const token = parsed.PAN_SPEND_SYNC_TOKEN

      if (typeof token === 'string' && token.length > 0) {
        return token
      }
    } catch {
      continue
    }
  }

  invariant(
    false,
    'PAN_SPEND_SYNC_TOKEN is not set in the environment or any .env file.',
    { code: 'SPEND_SYNC_TOKEN_MISSING' },
  )
}

/** Validate a URL: must be https, or http for loopback only (C-9). */
function assertSecureUrl(url: string, context: string): void {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    invariant(false, `${context} is not a valid URL: ${url}`, {
      code: 'SPEND_SYNC_INVALID_RESPONSE',
    })
  }

  invariant(
    parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)),
    `${context} must use https (or http for a loopback host), got: ${url}`,
    { code: 'SPEND_SYNC_INVALID_RESPONSE' },
  )
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  })
}

async function expectJson(
  response: Response,
  context: string,
): Promise<unknown> {
  if (response.status === 401 || response.status === 403) {
    invariant(false, `${context}: unauthorized (${response.status}).`, {
      code: 'SPEND_SYNC_UNAUTHORIZED',
    })
  }

  if (!response.ok) {
    invariant(
      false,
      `${context}: request failed with status ${response.status}.`,
      {
        code: 'SPEND_SYNC_REQUEST_FAILED',
      },
    )
  }

  try {
    return (await response.json()) as unknown
  } catch {
    invariant(false, `${context}: response is not valid JSON.`, {
      code: 'SPEND_SYNC_INVALID_RESPONSE',
    })
  }
}

function readVersion(root: string): string {
  const versionPath = path.join(root, 'VERSION')

  return fileExists(versionPath) ? readText(versionPath).trim() : 'unknown'
}

function emptySpendCoverage() {
  return {
    known_events: 0,
    total_events: 0,
    known_tokens: 0,
    total_tokens: 0,
    known_token_percent: null,
  }
}

/**
 * Sync this instance's spend data to the configured Vercel service.
 *
 * Fails with `SPEND_SYNC_HOST_MISSING` when no host is configured, and with
 * `SPEND_SYNC_TOKEN_MISSING` when the token is absent — before any network
 * request.
 */
export async function syncSpend(
  root: string,
  options: SyncSpendOptions = {},
): Promise<SyncSpendResult> {
  const config = readProjectConfig(root)

  // Resolve origin and token before any network request (AC-2).
  const origin = resolveSpendSyncOrigin(config)
  const token = resolveSpendToken(root)

  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? new Date()
  const syncedAt = now.toISOString()

  // Resolve instance identity.
  const { instance_id, label } = resolveInstanceId(root)

  // Collect spend records for the window.
  const collected = await collectSpendRecords(root, { ...options, now })

  // Merge and write the ledger under the mutex.
  const ledgerPath = ledgerFilePath(root)
  const lockPath = ledgerLockPath(root)

  const mergedLedger = withOperationMutex(lockPath, () => {
    const existing = readLedger(root, instance_id)
    const toolCallsMap = new Map<string, Map<string, number>>()

    for (const [convKey, toolMap] of collected.tool_calls) {
      toolCallsMap.set(convKey, toolMap)
    }

    const merged = mergeLedger(
      existing,
      collected.records,
      toolCallsMap,
      instance_id,
      syncedAt,
      now,
    )

    writeJsonAtomic(ledgerPath, merged)

    return merged
  })

  // Build and compress the snapshot (whole ledger, not just the window).
  const snapshot: SpendSnapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    instance_id,
    label,
    harness_version: readVersion(root),
    synced_at: syncedAt,
    attribution_sources: collected.attribution_sources,
    records: mergedLedger.records,
    tool_calls: mergedLedger.tool_calls,
  }

  const compressed = await gzipJson(snapshot)

  // POST /api/snapshots/upload to get a signed PUT URL.
  let uploadResponse: unknown

  try {
    const response = await timedFetch(
      fetchImpl,
      `${origin}/api/snapshots/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instance_id }),
      },
    )

    uploadResponse = await expectJson(response, 'POST /api/snapshots/upload')
  } catch (err) {
    if (err instanceof PanError) throw err

    invariant(
      false,
      `POST /api/snapshots/upload failed: ${errorMessage(err)}`,
      {
        code: 'SPEND_SYNC_REQUEST_FAILED',
      },
    )
  }

  invariant(
    isRecord(uploadResponse) &&
      typeof uploadResponse.upload_url === 'string' &&
      typeof uploadResponse.pathname === 'string',
    'POST /api/snapshots/upload returned an unexpected response shape.',
    { code: 'SPEND_SYNC_INVALID_RESPONSE' },
  )

  const uploadUrl = uploadResponse.upload_url as string

  assertSecureUrl(uploadUrl, 'upload_url')

  // PUT the compressed snapshot to the signed URL.
  try {
    const putResponse = await timedFetch(fetchImpl, uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(compressed.length),
      },
      body: compressed,
    })

    if (!putResponse.ok) {
      invariant(
        false,
        `PUT snapshot failed with status ${putResponse.status}.`,
        {
          code: 'SPEND_SYNC_REQUEST_FAILED',
        },
      )
    }
  } catch (err) {
    if (err instanceof PanError) throw err

    invariant(false, `PUT snapshot failed: ${errorMessage(err)}`, {
      code: 'SPEND_SYNC_REQUEST_FAILED',
    })
  }

  const ledgerRecords = mergedLedger.records.length
  const cutoffMs = now.getTime() - MAX_LEDGER_DAYS * DAY_MS
  const ledgerWindow =
    ledgerRecords > 0
      ? {
          start: new Date(
            Math.min(...mergedLedger.records.map((r) => r.timestamp_ms)),
          ).toISOString(),
          end: new Date(
            Math.max(...mergedLedger.records.map((r) => r.timestamp_ms)),
          ).toISOString(),
        }
      : { start: new Date(cutoffMs).toISOString(), end: now.toISOString() }

  return {
    status: 'synced',
    instance_id,
    label,
    host: origin,
    records_fetched: collected.records.length,
    ledger_records: ledgerRecords,
    ledger_window: ledgerWindow,
    uploaded_bytes: compressed.length,
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSpendRecord(value: unknown): value is SpendRecord {
  if (
    !isRecord(value) ||
    typeof value.key !== 'string' ||
    !HEX_KEY_RE.test(value.key) ||
    (value.source !== 'team' && value.source !== 'personal') ||
    !isFiniteNumber(value.timestamp_ms) ||
    typeof value.model !== 'string' ||
    !(
      value.conversation_key === null ||
      (typeof value.conversation_key === 'string' &&
        HEX_KEY_RE.test(value.conversation_key))
    )
  ) {
    return false
  }

  const { metrics, attribution } = value

  return (
    isRecord(metrics) &&
    METRIC_FIELDS.every((field) => isFiniteNumber(metrics[field])) &&
    isRecord(attribution) &&
    ATTRIBUTION_STRING_FIELDS.every(
      (field) => typeof attribution[field] === 'string',
    ) &&
    Array.isArray(attribution.tools) &&
    attribution.tools.every((tool) => typeof tool === 'string')
  )
}

function parseToolCalls(value: unknown): SpendSnapshot['tool_calls'] {
  const toolCalls: SpendSnapshot['tool_calls'] = {}

  if (!isRecord(value)) {
    return toolCalls
  }

  for (const [conversationKey, tools] of Object.entries(value)) {
    if (!HEX_KEY_RE.test(conversationKey) || !isRecord(tools)) {
      continue
    }

    toolCalls[conversationKey] = Object.fromEntries(
      Object.entries(tools).filter(([, count]) => isFiniteNumber(count)),
    ) as Record<string, number>
  }

  return toolCalls
}

export interface ParsedSpendSnapshot {
  snapshot: SpendSnapshot
  /** Records dropped because they do not match the record shape. */
  skipped_records: number
}

/**
 * Validate a decoded snapshot. Returns null when the envelope is invalid;
 * malformed records are dropped and counted rather than failing the snapshot.
 */
export function parseSpendSnapshot(value: unknown): ParsedSpendSnapshot | null {
  if (
    !isRecord(value) ||
    value.schema_version !== SNAPSHOT_SCHEMA_VERSION ||
    typeof value.instance_id !== 'string' ||
    typeof value.synced_at !== 'string' ||
    !Array.isArray(value.records)
  ) {
    return null
  }

  const records = value.records.filter(isSpendRecord)
  const sources = isRecord(value.attribution_sources)
    ? value.attribution_sources
    : {}

  return {
    snapshot: {
      schema_version: SNAPSHOT_SCHEMA_VERSION,
      instance_id: value.instance_id,
      label: typeof value.label === 'string' ? value.label : value.instance_id,
      harness_version:
        typeof value.harness_version === 'string'
          ? value.harness_version
          : 'unknown',
      synced_at: value.synced_at,
      attribution_sources: {
        workspaces_scanned: isFiniteNumber(sources.workspaces_scanned)
          ? sources.workspaces_scanned
          : 0,
        embedded_installations_scanned: isFiniteNumber(
          sources.embedded_installations_scanned,
        )
          ? sources.embedded_installations_scanned
          : 0,
      },
      records,
      tool_calls: parseToolCalls(value.tool_calls),
    },
    skipped_records: value.records.length - records.length,
  }
}

function emptyMultiInstanceReport(
  period: MultiInstanceSpendReport['period'],
  warnings: string[],
): MultiInstanceSpendReport {
  return {
    scope: 'multi-instance',
    period,
    attribution_sources: {
      instances: 0,
      workspaces_scanned: 0,
      embedded_installations_scanned: 0,
    },
    instances: [],
    totals: {
      events: 0,
      request_units: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
      cost_cents: 0,
    },
    token_categories: {
      input: 0,
      output: 0,
      cache_write: 0,
      cache_read: 0,
      cached: 0,
    },
    daily: [],
    slices: {
      commands: [],
      persona_models: [],
      tools: [],
      fast_mode: [],
      governance: [],
      workflow_role: [],
      stages: [],
      remediation: [],
    },
    coverage: {
      command: emptySpendCoverage(),
      persona: emptySpendCoverage(),
      tools: emptySpendCoverage(),
      fast_mode: emptySpendCoverage(),
      governance: emptySpendCoverage(),
      workflow_role: emptySpendCoverage(),
      stage: emptySpendCoverage(),
      remediation: emptySpendCoverage(),
    },
    warnings: [
      ...warnings,
      'No snapshots are available. Run `pan spend sync` on each instance first.',
    ],
  }
}

/** Tool maps for the selected records, taken from the instance that supplied each record. */
function selectedToolCalls(
  selected: LedgerRecordMeta[],
  snapshotsById: Map<string, SpendSnapshot>,
): Map<string, Map<string, number>> {
  const toolCalls = new Map<string, Map<string, number>>()

  for (const { record, instance_id } of selected) {
    const conversationKey = record.conversation_key

    if (conversationKey === null || toolCalls.has(conversationKey)) {
      continue
    }

    const tools = snapshotsById.get(instance_id)?.tool_calls[conversationKey]

    if (tools !== undefined) {
      toolCalls.set(conversationKey, new Map(Object.entries(tools)))
    }
  }

  return toolCalls
}

export interface CombineSpendSnapshotsOptions {
  days: number
  now: Date
  /** Warnings gathered while fetching; they lead the report warnings. */
  warnings?: string[]
}

/**
 * Combine validated instance snapshots into one report. Each event key counts
 * once under the selection rule, and each instance's totals cover only the
 * records it supplied to the selection, so instance totals sum to the report
 * totals.
 */
export function combineSpendSnapshots(
  snapshots: SpendSnapshot[],
  options: CombineSpendSnapshotsOptions,
): MultiInstanceSpendReport {
  const endDateMs = options.now.getTime()
  const startDateMs = endDateMs - options.days * DAY_MS
  const warnings = [...(options.warnings ?? [])]
  const basePeriod = {
    days: options.days,
    start: new Date(startDateMs).toISOString(),
    end: options.now.toISOString(),
    timezone: 'UTC' as const,
    source: 'Pancreator spend sync' as const,
  }

  if (snapshots.length === 0) {
    return emptyMultiInstanceReport(
      { ...basePeriod, cost_basis: 'charged' },
      warnings,
    )
  }

  const byKey = new Map<string, LedgerRecordMeta>()
  const inWindowPerInstance = new Map<string, number>()
  const snapshotsById = new Map<string, SpendSnapshot>()

  for (const snapshot of snapshots) {
    snapshotsById.set(snapshot.instance_id, snapshot)

    let inWindow = 0

    for (const record of snapshot.records) {
      if (
        record.timestamp_ms < startDateMs ||
        record.timestamp_ms > endDateMs
      ) {
        continue
      }

      inWindow += 1

      const existing = byKey.get(record.key)
      const selected =
        existing === undefined
          ? record
          : selectSpendRecord(
              record,
              existing.record,
              snapshot.instance_id,
              existing.instance_id,
              snapshot.synced_at,
              existing.synced_at,
            )

      if (existing === undefined || selected === record) {
        byKey.set(record.key, {
          record,
          instance_id: snapshot.instance_id,
          synced_at: snapshot.synced_at,
        })
      }
    }

    inWindowPerInstance.set(snapshot.instance_id, inWindow)
  }

  const selected = [...byKey.values()]
  const selectedByInstance = new Map<string, LedgerRecordMeta[]>()

  for (const meta of selected) {
    const group = selectedByInstance.get(meta.instance_id) ?? []

    group.push(meta)
    selectedByInstance.set(meta.instance_id, group)
  }

  const instances: InstanceSummary[] = [...snapshotsById.values()].map(
    (snapshot) => {
      const supplied = selectedByInstance.get(snapshot.instance_id) ?? []

      return {
        instance_id: snapshot.instance_id,
        label: snapshot.label,
        synced_at: snapshot.synced_at,
        harness_version: snapshot.harness_version,
        records_in_window: inWindowPerInstance.get(snapshot.instance_id) ?? 0,
        records_selected: supplied.length,
        totals: aggregateSpendRecords(
          supplied.map((meta) => meta.record),
          selectedToolCalls(supplied, snapshotsById),
        ).totals,
      }
    },
  )

  const aggregated = aggregateSpendRecords(
    selected.map((meta) => meta.record),
    selectedToolCalls(selected, snapshotsById),
  )
  const sources = new Set(selected.map((meta) => meta.record.source))
  const cost_basis: MultiInstanceSpendReport['period']['cost_basis'] =
    sources.size === 2
      ? 'mixed'
      : sources.has('personal')
        ? 'model-cost'
        : 'charged'

  if (sources.has('personal')) {
    warnings.push(
      'Personal event tokens are inferred allocations of account-wide aggregates; they are not authoritative billed charges.',
    )
  }

  warnings.push(
    'Duplicate events across instances were counted once, using the better attributed record.',
    ...aggregated.warnings,
  )

  return {
    scope: 'multi-instance',
    period: { ...basePeriod, cost_basis },
    attribution_sources: {
      instances: snapshotsById.size,
      workspaces_scanned: [...snapshotsById.values()].reduce(
        (total, snapshot) =>
          total + snapshot.attribution_sources.workspaces_scanned,
        0,
      ),
      embedded_installations_scanned: [...snapshotsById.values()].reduce(
        (total, snapshot) =>
          total + snapshot.attribution_sources.embedded_installations_scanned,
        0,
      ),
    },
    instances,
    totals: aggregated.totals,
    token_categories: aggregated.token_categories,
    daily: aggregated.daily,
    slices: aggregated.slices,
    coverage: aggregated.coverage,
    warnings,
  }
}

/**
 * Download every instance's latest snapshot and aggregate into a combined report.
 *
 * Fails with `SPEND_SYNC_HOST_MISSING` or `SPEND_SYNC_TOKEN_MISSING` before any
 * network request when those preconditions are missing.
 */
export async function reportMultiInstanceSpend(
  root: string,
  options: ReportMultiInstanceSpendOptions = {},
): Promise<MultiInstanceSpendReport> {
  const days = options.days ?? DEFAULT_REPORT_DAYS

  invariant(
    Number.isInteger(days) && days >= 1 && days <= MAX_LEDGER_DAYS,
    `--days MUST be an integer from 1 to ${MAX_LEDGER_DAYS}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  const config = readProjectConfig(root)

  // Resolve origin and token before any network request (AC-2).
  const origin = resolveSpendSyncOrigin(config)
  const token = resolveSpendToken(root)

  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? new Date()

  let listData: unknown

  try {
    const response = await timedFetch(fetchImpl, `${origin}/api/snapshots`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    listData = await expectJson(response, 'GET /api/snapshots')
  } catch (err) {
    if (err instanceof PanError) throw err

    invariant(false, `GET /api/snapshots failed: ${errorMessage(err)}`, {
      code: 'SPEND_SYNC_REQUEST_FAILED',
    })
  }

  invariant(
    isRecord(listData) && Array.isArray(listData.snapshots),
    'GET /api/snapshots returned an unexpected response shape.',
    { code: 'SPEND_SYNC_INVALID_RESPONSE' },
  )

  const warnings: string[] = []
  const snapshots: SpendSnapshot[] = []

  for (const entry of listData.snapshots as unknown[]) {
    if (
      !isRecord(entry) ||
      typeof entry.instance_id !== 'string' ||
      typeof entry.download_url !== 'string'
    ) {
      warnings.push('Skipped a snapshot entry with an invalid shape.')
      continue
    }

    const instanceId = entry.instance_id
    const downloadUrl = entry.download_url

    try {
      assertSecureUrl(downloadUrl, `download_url for instance ${instanceId}`)
    } catch {
      warnings.push(
        `Skipped instance ${instanceId}: download_url is not a secure URL.`,
      )
      continue
    }

    try {
      const response = await timedFetch(fetchImpl, downloadUrl, {})

      if (!response.ok) {
        warnings.push(
          `Skipped instance ${instanceId}: download failed with status ${response.status}.`,
        )
        continue
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const decompressed = await gunzipBuffer(buffer)
      const parsed = parseSpendSnapshot(
        JSON.parse(decompressed.toString('utf8')) as unknown,
      )

      if (parsed === null) {
        warnings.push(
          `Skipped instance ${instanceId}: snapshot has an invalid schema.`,
        )
        continue
      }

      if (parsed.skipped_records > 0) {
        warnings.push(
          `Skipped ${parsed.skipped_records} malformed record(s) in the snapshot of instance ${instanceId}.`,
        )
      }

      snapshots.push(parsed.snapshot)
    } catch (err) {
      warnings.push(`Skipped instance ${instanceId}: ${errorMessage(err)}`)
    }
  }

  return combineSpendSnapshots(snapshots, { days, now, warnings })
}
