/**
 * The instance id, the local spend ledger, and the record selection and merge
 * that keep one record per event.
 */

import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { fileExists, isRecord, readText, writeJsonAtomic } from '../io.js'
import type { SpendRecord } from '../token-spend/model.js'
import { DAY_MS, MAX_LEDGER_DAYS, type SpendLedger } from './model.js'
import { parseSpendRecords, parseToolCalls } from './snapshot.js'

const INSTANCE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function instanceFilePath(root: string): string {
  return path.join(root, 'runtime', 'spend', 'instance.json')
}

/** Absolute path of the local spend ledger, `runtime/spend/ledger.json`. */
export function ledgerFilePath(root: string): string {
  return path.join(root, 'runtime', 'spend', 'ledger.json')
}

/** Absolute path of the mutex file that serializes spend ledger writes. */
export function ledgerLockPath(root: string): string {
  return path.join(root, 'runtime', 'spend', 'ledger.lock')
}

/** Read or create the per-instance identity file. Returns instance_id and label. */
export function resolveInstanceId(root: string): {
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

/**
 * Reads the local spend ledger, keeping only well-formed records and tool-call
 * counts. A missing or corrupt ledger reads as an empty one for this
 * instance; nothing is written.
 */
export function readLedger(root: string, instanceId: string): SpendLedger {
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
        records: parseSpendRecords(parsed.records),
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

  if (a.command !== 'Unattributed') {
    score += 1
  }

  if (!a.persona_model.startsWith('Unattributed ·')) {
    score += 1
  }

  if (a.tools.length > 0) {
    score += 1
  }

  if (a.fast_mode !== 'unknown') {
    score += 1
  }

  if (a.governance !== 'unattributed') {
    score += 1
  }

  if (a.workflow_role !== 'unattributed') {
    score += 1
  }

  if (a.stage !== 'Unattributed') {
    score += 1
  }

  if (a.remediation !== 'unattributed') {
    score += 1
  }

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

export interface LedgerRecordMeta {
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
    records: Array.from(byKey.values(), (meta) => meta.record),
    tool_calls: mergedToolCalls,
    updated_at: syncedAt,
  }
}

/**
 * Earliest and latest record timestamps, or the full retention window when
 * the ledger is empty. One pass with constant extra space: spreading a
 * 365-day ledger into `Math.min` overflows the call stack.
 */
export function ledgerWindow(
  records: readonly Pick<SpendRecord, 'timestamp_ms'>[],
  now: Date,
): { start: string; end: string } {
  if (records.length === 0) {
    return {
      start: new Date(now.getTime() - MAX_LEDGER_DAYS * DAY_MS).toISOString(),
      end: now.toISOString(),
    }
  }

  let startMs = Infinity
  let endMs = -Infinity

  for (const { timestamp_ms } of records) {
    if (timestamp_ms < startMs) {
      startMs = timestamp_ms
    }

    if (timestamp_ms > endMs) {
      endMs = timestamp_ms
    }
  }

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  }
}
