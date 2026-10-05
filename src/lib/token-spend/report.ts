/**
 * Spend record collection, aggregation, and the token spend report over a
 * window of days.
 */

import {
  fetchCursorDashboardUsageEvents,
  fetchCursorUsageEvents,
  resolveCursorUsageCredential,
  type CursorUsageEvent,
  type CursorUsageEventsResult,
} from '../cursor-usage.js'
import { invariant } from '../errors.js'
import { attributionRoots, readTranscripts } from './transcripts.js'
import {
  attributionForEvent,
  copilotSessionCount,
  readSupervisorCommands,
  resolveTranscriptWorkflow,
} from './attribution.js'
import {
  type AggregateSpendRecordsResult,
  type CollectSpendRecordsOptions,
  type CollectSpendRecordsResult,
  conversationKeyFromId,
  type EventAttribution,
  type GenerateTokenSpendReportOptions,
  type SpendCoverage,
  spendEventKey,
  type SpendMetrics,
  type SpendRecord,
  type TokenSpendReport,
} from './model.js'
import {
  addMetrics,
  emptyMetrics,
  eventMetrics,
  foldedRows,
  MAX_SLICE_ROWS,
  metricsMapRow,
  roundedMetrics,
  roundRows,
  sortedRows,
} from './metrics.js'

const DAY_MS = 24 * 60 * 60 * 1_000

const DEFAULT_REPORT_DAYS = 14

const MAX_REPORT_DAYS = 365

function coverage(
  events: CursorUsageEvent[],
  known: (attribution: EventAttribution) => boolean,
  attributions: EventAttribution[],
): SpendCoverage {
  const totalTokens = events.reduce(
    (total, event) => total + eventMetrics(event).total_tokens,
    0,
  )
  let knownEvents = 0
  let knownTokens = 0

  attributions.forEach((attribution, index) => {
    if (!known(attribution)) {
      return
    }

    knownEvents += 1
    knownTokens += eventMetrics(events[index] as CursorUsageEvent).total_tokens
  })

  return {
    known_events: knownEvents,
    total_events: events.length,
    known_tokens: knownTokens,
    total_tokens: totalTokens,
    known_token_percent:
      totalTokens === 0 ? null : (knownTokens / totalTokens) * 100,
  }
}

function reportDays(value: number | undefined): number {
  const days = value ?? DEFAULT_REPORT_DAYS

  invariant(
    Number.isInteger(days) && days >= 1 && days <= MAX_REPORT_DAYS,
    `--days MUST be an integer from 1 to ${MAX_REPORT_DAYS}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  return days
}

/**
 * Fetch, correlate, and return attributed spend records without aggregating.
 * The records are privacy-safe: all identifiers are replaced with SHA-256 hex keys.
 */
export async function collectSpendRecords(
  root: string,
  options: CollectSpendRecordsOptions = {},
): Promise<CollectSpendRecordsResult> {
  const days = reportDays(options.days)
  const now = options.now ?? new Date()
  const endDateMs = now.getTime()
  const startDateMs = endDateMs - days * DAY_MS

  const requestOptions = {
    startDateMs,
    endDateMs,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  }
  let usage: CursorUsageEventsResult

  if (options.sessionToken !== undefined) {
    usage = await fetchCursorDashboardUsageEvents({
      ...requestOptions,
      sessionToken: options.sessionToken,
      ...(options.endpoint ? { eventsEndpoint: options.endpoint } : {}),
    })
  } else if (options.apiKey !== undefined) {
    usage = await fetchCursorUsageEvents({
      ...requestOptions,
      apiKey: options.apiKey,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    })
  } else {
    const credential = resolveCursorUsageCredential(root)

    usage =
      credential.kind === 'dashboard-session'
        ? await fetchCursorDashboardUsageEvents({
            ...requestOptions,
            sessionToken: credential.value,
          })
        : await fetchCursorUsageEvents({
            ...requestOptions,
            apiKey: credential.value,
          })
  }

  const source: 'team' | 'personal' =
    usage.source === 'Cursor Admin API /teams/filtered-usage-events'
      ? 'team'
      : 'personal'

  const { roots, warnings: attributionWarnings } = attributionRoots(root)
  const transcripts = readTranscripts(
    roots,
    startDateMs,
    options.transcriptsRoot,
    options.cursorProjectsRoot,
  )
  const workflow = resolveTranscriptWorkflow(
    root,
    roots,
    transcripts,
    options.transcriptsRoot,
  )

  const supervisorCommands = readSupervisorCommands(root)
  const records: SpendRecord[] = []
  const tool_calls = new Map<string, Map<string, number>>()

  for (const event of usage.events) {
    const attribution = attributionForEvent(
      event,
      transcripts,
      workflow.runs,
      workflow.workers,
      supervisorCommands,
    )
    const key = spendEventKey(event, source)

    const rawTranscriptId =
      event.conversation_id !== null && transcripts.has(event.conversation_id)
        ? event.conversation_id
        : event.cloud_agent_id !== null && transcripts.has(event.cloud_agent_id)
          ? event.cloud_agent_id
          : null

    const conversation_key =
      rawTranscriptId === null ? null : conversationKeyFromId(rawTranscriptId)

    records.push({
      key,
      source,
      timestamp_ms: event.timestamp_ms,
      model: event.model,
      metrics: eventMetrics(event),
      attribution,
      conversation_key,
    })

    // Tool calls count once per matched conversation, not once per event.
    if (
      rawTranscriptId !== null &&
      conversation_key !== null &&
      !tool_calls.has(conversation_key)
    ) {
      tool_calls.set(
        conversation_key,
        new Map(transcripts.get(rawTranscriptId)?.tools ?? []),
      )
    }
  }

  return {
    records,
    tool_calls,
    usage: {
      source: usage.source,
      pages_fetched: usage.pages_fetched,
    },
    attribution_sources: {
      workspaces_scanned: roots.length,
      embedded_installations_scanned: roots.filter((item) => item.embedded)
        .length,
    },
    warnings: [
      ...attributionWarnings,
      ...copilotSessionWarnings(
        copilotSessionCount(workflow.storages, startDateMs, endDateMs),
      ),
    ],
  }
}

/** The unattributed host `copilot` line, empty when no Copilot session ran. */
export function copilotSessionWarnings(count: number): string[] {
  return count === 0
    ? []
    : [
        `Unattributed host copilot: ${count} GitHub Copilot worker ` +
          `session${count === 1 ? '' : 's'} ran in this period. Copilot ` +
          `usage is unmetered, so these sessions are absent from every total.`,
      ]
}

/** Aggregate spend records into totals, daily series, slices, and coverage. */
export function aggregateSpendRecords(
  records: SpendRecord[],
  tool_calls: Map<string, Map<string, number>>,
): AggregateSpendRecordsResult {
  const totals = emptyMetrics()
  const daily = new Map<string, SpendMetrics>()

  const commands = new Map<string, SpendMetrics>()
  const personaModels = new Map<string, SpendMetrics>()
  const toolMetrics = new Map<string, SpendMetrics>()
  const fastModes = new Map<string, SpendMetrics>()

  const governance = new Map<string, SpendMetrics>()
  const roles = new Map<string, SpendMetrics>()
  const stages = new Map<string, SpendMetrics>()
  const remediation = new Map<string, SpendMetrics>()

  const syntheticEvents: CursorUsageEvent[] = []
  const syntheticAttributions: EventAttribution[] = []

  for (const record of records) {
    const { metrics, attribution } = record
    const date = new Date(record.timestamp_ms).toISOString().slice(0, 10)

    addMetrics(totals, metrics)
    metricsMapRow(daily, date, metrics)
    metricsMapRow(commands, attribution.command, metrics)
    metricsMapRow(personaModels, attribution.persona_model, metrics)
    metricsMapRow(fastModes, attribution.fast_mode, metrics)
    metricsMapRow(governance, attribution.governance, metrics)
    metricsMapRow(roles, attribution.workflow_role, metrics)
    metricsMapRow(stages, attribution.stage, metrics)
    metricsMapRow(remediation, attribution.remediation, metrics)

    for (const tool of attribution.tools) {
      metricsMapRow(toolMetrics, tool, metrics)
    }

    // Build synthetic event/attribution arrays for coverage computation.
    syntheticEvents.push({
      timestamp_ms: record.timestamp_ms,
      model: record.model,
      kind: 'unknown',
      max_mode: false,
      request_units: metrics.request_units,
      token_based: true,
      chargeable: true,
      headless: false,
      conversation_id: null,
      cloud_agent_id: null,
      automation_id: null,
      token_usage: {
        input_tokens: metrics.input_tokens,
        output_tokens: metrics.output_tokens,
        cache_write_tokens: metrics.cache_write_tokens,
        cache_read_tokens: metrics.cache_read_tokens,
        model_cost_cents: metrics.cost_cents,
      },
      charged_cents: metrics.cost_cents,
      cursor_token_fee_cents: metrics.cursor_fee_cents,
    })
    syntheticAttributions.push(attribution)
  }

  // Build per-conversation_key tool call counts.
  const flatToolCalls = new Map<string, number>()

  for (const [, toolMap] of tool_calls) {
    for (const [tool, count] of toolMap) {
      flatToolCalls.set(tool, (flatToolCalls.get(tool) ?? 0) + count)
    }
  }

  const sortedToolRows = sortedRows(toolMetrics)
  const visibleToolRows =
    sortedToolRows.length <= MAX_SLICE_ROWS
      ? sortedToolRows
      : [
          ...sortedToolRows.slice(0, MAX_SLICE_ROWS - 1),
          {
            key: 'Other',
            metrics: sortedToolRows
              .slice(MAX_SLICE_ROWS - 1)
              .reduce((m, row) => {
                addMetrics(m, row.metrics)

                return m
              }, emptyMetrics()),
          },
        ]
  const retainedTools = new Set(
    visibleToolRows.filter((row) => row.key !== 'Other').map((row) => row.key),
  )
  const tools = visibleToolRows.map((row) => ({
    ...row,
    metrics: roundedMetrics(row.metrics),
    call_count:
      row.key === 'Other'
        ? [...flatToolCalls.entries()]
            .filter(([tool]) => !retainedTools.has(tool))
            .reduce((total, [, count]) => total + count, 0)
        : (flatToolCalls.get(row.key) ?? 0),
  }))

  const dailyPoints = [...daily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, metrics]) => ({ date, ...roundedMetrics(metrics) }))

  return {
    totals: roundedMetrics(totals),
    token_categories: {
      input: totals.input_tokens,
      output: totals.output_tokens,
      cache_write: totals.cache_write_tokens,
      cache_read: totals.cache_read_tokens,
      cached: totals.cache_write_tokens + totals.cache_read_tokens,
    },
    daily: dailyPoints,
    slices: {
      commands: roundRows(foldedRows(commands)),
      persona_models: roundRows(foldedRows(personaModels)),
      tools,
      fast_mode: roundRows(foldedRows(fastModes)),
      governance: roundRows(foldedRows(governance)),
      workflow_role: roundRows(foldedRows(roles)),
      stages: roundRows(foldedRows(stages)),
      remediation: roundRows(foldedRows(remediation)),
    },
    coverage: {
      command: coverage(
        syntheticEvents,
        (item) => item.command !== 'Unattributed',
        syntheticAttributions,
      ),
      persona: coverage(
        syntheticEvents,
        (item) => !item.persona_model.startsWith('Unattributed ·'),
        syntheticAttributions,
      ),
      tools: coverage(
        syntheticEvents,
        (item) => item.tools.length > 0,
        syntheticAttributions,
      ),
      fast_mode: coverage(
        syntheticEvents,
        (item) => item.fast_mode !== 'unknown',
        syntheticAttributions,
      ),
      governance: coverage(
        syntheticEvents,
        (item) => item.governance !== 'unattributed',
        syntheticAttributions,
      ),
      workflow_role: coverage(
        syntheticEvents,
        (item) => item.workflow_role !== 'unattributed',
        syntheticAttributions,
      ),
      stage: coverage(
        syntheticEvents,
        (item) => item.stage !== 'Unattributed',
        syntheticAttributions,
      ),
      remediation: coverage(
        syntheticEvents,
        (item) => item.remediation !== 'unattributed',
        syntheticAttributions,
      ),
    },
    warnings: [
      'Cursor does not meter tokens per tool. Tool token totals overlap when a conversation used more than one tool.',
      'Cursor usage events do not expose Fast mode. Fast attribution uses exact fast=true or fast=false model declarations and leaves all other events unknown.',
    ],
  }
}

/** Fetch, correlate, and aggregate a compact token spend report. */
export async function generateTokenSpendReport(
  root: string,
  options: GenerateTokenSpendReportOptions = {},
): Promise<TokenSpendReport> {
  const days = reportDays(options.days)
  const now = options.now ?? new Date()

  const collected = await collectSpendRecords(root, { ...options, days, now })
  const aggregated = aggregateSpendRecords(
    collected.records,
    collected.tool_calls,
  )

  const endDateMs = now.getTime()
  const startDateMs = endDateMs - days * DAY_MS

  return {
    schema_version: 2,
    generated_at: now.toISOString(),
    period: {
      days,
      start: new Date(startDateMs).toISOString(),
      end: now.toISOString(),
      timezone: 'UTC',
      source: collected.usage.source,
      cost_basis: 'charged',
      pages_fetched: collected.usage.pages_fetched,
    },
    attribution_sources: collected.attribution_sources,
    totals: aggregated.totals,
    token_categories: aggregated.token_categories,
    daily: aggregated.daily,
    slices: aggregated.slices,
    coverage: aggregated.coverage,
    warnings: [
      ...collected.warnings,
      ...aggregated.warnings,
      'Unmatched usage remains unattributed; no email, conversation identifier, or raw event is included in this report.',
    ],
  }
}
