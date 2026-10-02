/** Spend snapshot and spend record parsing, and the derived Cursor fee. */

import { isRecord } from '../io.js'
import type { SpendRecord } from '../token-spend/model.js'
import { SNAPSHOT_SCHEMA_VERSION, type SpendSnapshot } from './model.js'

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

// Records synced by an older harness lack these fields.
const OPTIONAL_METRIC_FIELDS = [
  'cursor_fee_cents',
  'included_cost_cents',
  'included_fee_cents',
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
    OPTIONAL_METRIC_FIELDS.every(
      (field) => metrics[field] === undefined || isFiniteNumber(metrics[field]),
    ) &&
    isRecord(attribution) &&
    ATTRIBUTION_STRING_FIELDS.every(
      (field) => typeof attribution[field] === 'string',
    ) &&
    Array.isArray(attribution.tools) &&
    attribution.tools.every((tool) => typeof tool === 'string')
  )
}

// Cursor charges $0.25 per million tokens on every model it does not own.
// Every fee-bearing usage event reproduces this rate, and none precedes the
// start instant.
const CURSOR_FEE_CENTS_PER_TOKEN = 25 / 1_000_000

const CURSOR_FEE_START_MS = Date.parse('2026-08-27T17:10:00.000Z')

const CURSOR_OWNED_MODEL_RE = /^(?:cursor-|composer|grok|default$)/iu

/** Cursor's token fee for one event, from its model, time, and token total. */
export function derivedCursorFeeCents(
  model: string,
  timestampMs: number,
  totalTokens: number,
): number {
  return timestampMs < CURSOR_FEE_START_MS || CURSOR_OWNED_MODEL_RE.test(model)
    ? 0
    : totalTokens * CURSOR_FEE_CENTS_PER_TOKEN
}

function withRecordedFee(record: SpendRecord): SpendRecord {
  return isFiniteNumber(record.metrics.cursor_fee_cents)
    ? record
    : {
        ...record,
        metrics: {
          ...record.metrics,
          cursor_fee_cents: derivedCursorFeeCents(
            record.model,
            record.timestamp_ms,
            record.metrics.total_tokens,
          ),
        },
        fee_derived: true,
      }
}

// The billing kind is not stored on a record, so an older record's split
// cannot be derived; its whole cost stays on-demand.
function withRecordedBilling(record: SpendRecord): SpendRecord {
  return isFiniteNumber(record.metrics.included_cost_cents) &&
    isFiniteNumber(record.metrics.included_fee_cents)
    ? record
    : {
        ...record,
        metrics: {
          ...record.metrics,
          included_cost_cents: 0,
          included_fee_cents: 0,
        },
        billing_unrecorded: true,
      }
}

/**
 * Parse stored records, deriving the fee of records synced before fees were
 * and counting records synced before billing kinds were as on-demand.
 */
export function parseSpendRecords(values: unknown[]): SpendRecord[] {
  return values
    .filter(isSpendRecord)
    .map((record) => withRecordedBilling(withRecordedFee(record)))
}

/**
 * Per-conversation tool-call counts from an untrusted value, keeping only
 * 64-hex conversation keys and finite numeric counts. Returns an empty map
 * for a non-object.
 */
export function parseToolCalls(value: unknown): SpendSnapshot['tool_calls'] {
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

  const records = parseSpendRecords(value.records)
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
