/** Token spend report, record, and attribution types, and the event keys. */

import { createHash } from 'node:crypto'

import type {
  CursorUsageEvent,
  CursorUsageEventsResult,
} from '../cursor-usage.js'

export interface SpendMetrics {
  events: number
  request_units: number
  input_tokens: number
  output_tokens: number
  cache_write_tokens: number
  cache_read_tokens: number
  total_tokens: number
  cost_cents: number
  /** Cursor's token fee, already included in `cost_cents`. */
  cursor_fee_cents: number
}

export interface SpendSliceRow {
  key: string
  metrics: SpendMetrics
}

export interface ToolSpendSliceRow extends SpendSliceRow {
  call_count: number
}

export interface SpendCoverage {
  known_events: number
  total_events: number
  known_tokens: number
  total_tokens: number
  known_token_percent: number | null
}

export interface DailySpendPoint extends SpendMetrics {
  date: string
}

export interface TokenSpendReport {
  schema_version: 2
  generated_at: string
  period: {
    days: number
    start: string
    end: string
    timezone: 'UTC'
    source: CursorUsageEventsResult['source']
    cost_basis: 'charged'
    pages_fetched: number
  }
  attribution_sources: {
    workspaces_scanned: number
    embedded_installations_scanned: number
  }
  totals: SpendMetrics
  token_categories: {
    input: number
    output: number
    cache_write: number
    cache_read: number
    cached: number
  }
  daily: DailySpendPoint[]
  slices: {
    commands: SpendSliceRow[]
    persona_models: SpendSliceRow[]
    tools: ToolSpendSliceRow[]
    fast_mode: SpendSliceRow[]
    governance: SpendSliceRow[]
    workflow_role: SpendSliceRow[]
    stages: SpendSliceRow[]
    remediation: SpendSliceRow[]
  }
  coverage: {
    command: SpendCoverage
    persona: SpendCoverage
    tools: SpendCoverage
    fast_mode: SpendCoverage
    governance: SpendCoverage
    workflow_role: SpendCoverage
    stage: SpendCoverage
    remediation: SpendCoverage
  }
  warnings: string[]
}

export interface GenerateTokenSpendReportOptions {
  days?: number
  apiKey?: string
  sessionToken?: string
  now?: Date
  fetchImpl?: typeof fetch
  endpoint?: string
  transcriptsRoot?: string | null
  cursorProjectsRoot?: string
}

/**
 * A privacy-safe attributed spend record keyed by a hashed event identity.
 * No raw Cursor identifier leaves the machine in this form.
 */
export interface SpendRecord {
  /** SHA-256 hex of [source, timestamp_ms, model, kind, max_mode, conv_id, agent_id, auto_id]. */
  key: string
  /** Usage source: 'team' for Admin API events, 'personal' for dashboard events. */
  source: 'team' | 'personal'
  timestamp_ms: number
  model: string
  metrics: SpendMetrics
  attribution: EventAttribution
  /** SHA-256 hex of matched transcript id, or null when no transcript matched. */
  conversation_key: string | null
  /** True when the fee was derived because the record predates fee syncing. */
  fee_derived?: true
}

export interface CollectSpendRecordsOptions {
  days?: number
  apiKey?: string
  sessionToken?: string
  now?: Date
  fetchImpl?: typeof fetch
  endpoint?: string
  transcriptsRoot?: string | null
  cursorProjectsRoot?: string
}

export interface CollectSpendRecordsResult {
  records: SpendRecord[]
  /** Per-conversation_key tool counts for matched transcripts. */
  tool_calls: Map<string, Map<string, number>>
  usage: {
    source: CursorUsageEventsResult['source']
    pages_fetched: number
  }
  attribution_sources: {
    workspaces_scanned: number
    embedded_installations_scanned: number
  }
  /** One entry per registered installation skipped for attribution, naming its id and reason. */
  warnings: string[]
}

export interface AggregateSpendRecordsResult {
  totals: SpendMetrics
  token_categories: TokenSpendReport['token_categories']
  daily: DailySpendPoint[]
  slices: TokenSpendReport['slices']
  coverage: TokenSpendReport['coverage']
  warnings: string[]
}

/** Compute the privacy-safe deduplication key for a Cursor usage event. */
export function spendEventKey(
  event: CursorUsageEvent,
  source: 'team' | 'personal',
): string {
  const input = JSON.stringify([
    source,
    event.timestamp_ms,
    event.model,
    event.kind,
    event.max_mode,
    event.conversation_id ?? '',
    event.cloud_agent_id ?? '',
    event.automation_id ?? '',
  ])

  return createHash('sha256').update(input).digest('hex')
}

/** Compute the SHA-256 hex key for a matched transcript id. */
export function conversationKeyFromId(id: string): string {
  return createHash('sha256').update(id).digest('hex')
}

export interface WorkerBrief {
  run_id: string
  invocation_id: string
  role: string
}

export interface TranscriptEvidence {
  id: string
  parent_id: string | null
  command: string | null
  /** The run invocation a worker's opening message names, when it names one. */
  brief: WorkerBrief | null
  tools: Map<string, number>
  content: string
  at_ms: number
}

export interface AttributionRoot {
  harness_root: string
  workspace_root: string
  embedded: boolean
}

export interface WorkflowIdentity {
  run_id: string
  persona: string
  stage: string | null
  role: 'supervisor' | 'stage'
  model_spec: string | null
  remedial: boolean
}

export interface RunEvidence {
  run_id: string
  state: Record<string, unknown>
  current_stage: string | null
  supervisor_model: string | null
  timeline: Array<{ at_ms: number; stage: string | null }>
}

export interface RunStorage {
  state: string
  events: string
  invocation: (invocationId: string) => string
}

export interface WorkflowEvidence {
  runs: RunEvidence[]
  workers: Map<string, WorkflowIdentity>
  storages: Map<string, RunStorage>
}

export interface EventAttribution {
  command: string
  persona_model: string
  tools: string[]
  fast_mode: 'fast' | 'non-fast' | 'unknown'
  governance: 'governed' | 'ad hoc' | 'unattributed'
  workflow_role: 'supervisor' | 'stage' | 'unattributed'
  stage: string
  remediation: 'remedial' | 'non-remedial' | 'unattributed'
}
