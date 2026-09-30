/** Spend ledger, snapshot, sync, and multi-instance report types. */

import type {
  AggregateSpendRecordsResult,
  CollectSpendRecordsOptions,
  SpendRecord,
} from '../token-spend/model.js'

export const DAY_MS = 24 * 60 * 60 * 1_000

export const MAX_LEDGER_DAYS = 365

export const SNAPSHOT_SCHEMA_VERSION = 1

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
    cost_basis: 'charged'
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
