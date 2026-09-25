import path from 'node:path'
import { parseEnv } from 'node:util'

import { PanError, errorMessage, invariant } from './errors.js'
import { fileExists, isRecord, readText } from './io.js'
import { configuredWorkspaceRoot } from './project-config.js'

const CURSOR_USAGE_EVENTS_URL =
  'https://api.cursor.com/teams/filtered-usage-events'
const CURSOR_DASHBOARD_USAGE_EVENTS_URL =
  'https://cursor.com/api/dashboard/get-filtered-usage-events'
const CURSOR_DASHBOARD_AGGREGATES_URL =
  'https://cursor.com/api/dashboard/get-aggregated-usage-events'

const CURSOR_USAGE_PAGE_SIZE = 1_000
const CURSOR_USAGE_TIMEOUT_MS = 60_000
const MAX_USAGE_PAGES = 10_000

export interface CursorTokenUsage {
  input_tokens: number
  output_tokens: number
  cache_write_tokens: number
  cache_read_tokens: number
  model_cost_cents: number
}

export interface CursorUsageEvent {
  timestamp_ms: number
  model: string
  kind: string
  max_mode: boolean
  request_units: number
  token_based: boolean
  chargeable: boolean
  headless: boolean
  conversation_id: string | null
  cloud_agent_id: string | null
  automation_id: string | null
  token_usage: CursorTokenUsage | null
  charged_cents: number
  cursor_token_fee_cents: number
}

export interface CursorUsagePeriod {
  start_date_ms: number
  end_date_ms: number
}

export interface CursorUsageEventsResult {
  events: CursorUsageEvent[]
  period: CursorUsagePeriod
  pages_fetched: number
  source:
    | 'Cursor Admin API /teams/filtered-usage-events'
    | 'Cursor dashboard personal usage'
  aggregate_tokens: CursorTokenTotals | null
}

export interface CursorTokenTotals {
  input_tokens: number
  output_tokens: number
  cache_write_tokens: number
  cache_read_tokens: number
  cost_cents: number
}

interface CursorDashboardAggregates {
  totals: CursorTokenTotals
  models: Map<string, CursorTokenTotals>
}

export type CursorUsageCredential =
  | { kind: 'dashboard-session'; value: string }
  | { kind: 'admin-api-key'; value: string }

export interface FetchCursorDashboardUsageOptions {
  sessionToken: string
  startDateMs: number
  endDateMs: number
  fetchImpl?: typeof fetch
  eventsEndpoint?: string
  aggregatesEndpoint?: string
  timeoutMs?: number
}

export interface FetchCursorUsageEventsOptions {
  apiKey: string
  startDateMs: number
  endDateMs: number
  fetchImpl?: typeof fetch
  endpoint?: string
  timeoutMs?: number
}

function nonNegativeNumber(
  value: unknown,
  field: string,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) {
    return fallback
  }

  invariant(
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
    `Cursor usage response field '${field}' MUST be a non-negative number.`,
    { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
  )

  return value
}

function nonNegativeNumericString(value: unknown, field: string): number {
  const parsed =
    typeof value === 'string' && value.trim().length > 0 ? Number(value) : value

  return nonNegativeNumber(parsed, field)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseTimestamp(value: unknown): number {
  const parsed =
    typeof value === 'string' || typeof value === 'number'
      ? Number(value)
      : Number.NaN

  invariant(
    Number.isFinite(parsed) && parsed >= 0,
    "Cursor usage response field 'timestamp' MUST contain epoch milliseconds.",
    { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
  )

  return parsed
}

function parseTokenUsage(value: unknown): CursorTokenUsage | null {
  if (value === undefined || value === null) {
    return null
  }

  invariant(
    isRecord(value),
    "Cursor usage field 'tokenUsage' MUST be an object.",
    {
      code: 'CURSOR_USAGE_INVALID_RESPONSE',
    },
  )

  return {
    input_tokens: nonNegativeNumber(
      value.inputTokens,
      'tokenUsage.inputTokens',
      0,
    ),
    output_tokens: nonNegativeNumber(
      value.outputTokens,
      'tokenUsage.outputTokens',
      0,
    ),
    cache_write_tokens: nonNegativeNumber(
      value.cacheWriteTokens,
      'tokenUsage.cacheWriteTokens',
      0,
    ),
    cache_read_tokens: nonNegativeNumber(
      value.cacheReadTokens,
      'tokenUsage.cacheReadTokens',
      0,
    ),
    model_cost_cents: nonNegativeNumber(
      value.totalCents,
      'tokenUsage.totalCents',
      0,
    ),
  }
}

function parseUsageEvent(value: unknown): CursorUsageEvent {
  invariant(isRecord(value), 'Cursor usage events MUST be objects.', {
    code: 'CURSOR_USAGE_INVALID_RESPONSE',
  })
  invariant(
    typeof value.model === 'string' && value.model.length > 0,
    "Cursor usage response field 'model' MUST be a non-empty string.",
    { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
  )

  return {
    timestamp_ms: parseTimestamp(value.timestamp),
    model: value.model,
    kind: typeof value.kind === 'string' ? value.kind : 'unknown',
    max_mode: value.maxMode === true,
    request_units: nonNegativeNumber(value.requestsCosts, 'requestsCosts', 0),
    token_based: value.isTokenBasedCall === true,
    chargeable: value.isChargeable === true,
    headless: value.isHeadless === true,
    conversation_id: optionalString(value.conversationId),
    cloud_agent_id: optionalString(value.cloudAgentId),
    automation_id: optionalString(value.automationId),
    token_usage: parseTokenUsage(value.tokenUsage),
    charged_cents: nonNegativeNumber(value.chargedCents, 'chargedCents', 0),
    cursor_token_fee_cents: nonNegativeNumber(
      value.cursorTokenFee,
      'cursorTokenFee',
      0,
    ),
  }
}

function parseUsagePage(value: unknown): {
  events: CursorUsageEvent[]
  hasNextPage: boolean
} {
  invariant(
    isRecord(value) && Array.isArray(value.usageEvents),
    "Cursor usage response MUST contain a 'usageEvents' array.",
    { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
  )

  const pagination = isRecord(value.pagination) ? value.pagination : {}

  return {
    events: value.usageEvents.map(parseUsageEvent),
    hasNextPage: pagination.hasNextPage === true,
  }
}

function parseDashboardUsagePage(value: unknown): {
  events: CursorUsageEvent[]
  total: number
} {
  invariant(
    isRecord(value) && Array.isArray(value.usageEventsDisplay),
    "Cursor dashboard usage response MUST contain a 'usageEventsDisplay' array.",
    { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
  )

  return {
    events: value.usageEventsDisplay.map((event) => ({
      ...parseUsageEvent(event),
      charged_cents: 0,
    })),
    total: nonNegativeNumber(
      value.totalUsageEventsCount,
      'totalUsageEventsCount',
    ),
  }
}

function emptyTokenTotals(): CursorTokenTotals {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    cost_cents: 0,
  }
}

function addTokenTotals(
  target: CursorTokenTotals,
  addition: CursorTokenTotals,
): void {
  target.input_tokens += addition.input_tokens
  target.output_tokens += addition.output_tokens
  target.cache_write_tokens += addition.cache_write_tokens
  target.cache_read_tokens += addition.cache_read_tokens
  target.cost_cents += addition.cost_cents
}

function parseDashboardAggregates(value: unknown): CursorDashboardAggregates {
  invariant(
    isRecord(value),
    'Cursor dashboard aggregate usage response MUST be an object.',
    { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
  )

  const totals = {
    input_tokens: nonNegativeNumericString(
      value.totalInputTokens,
      'totalInputTokens',
    ),
    output_tokens: nonNegativeNumericString(
      value.totalOutputTokens,
      'totalOutputTokens',
    ),
    cache_write_tokens: nonNegativeNumericString(
      value.totalCacheWriteTokens,
      'totalCacheWriteTokens',
    ),
    cache_read_tokens: nonNegativeNumericString(
      value.totalCacheReadTokens,
      'totalCacheReadTokens',
    ),
    cost_cents: nonNegativeNumber(value.totalCostCents, 'totalCostCents'),
  }
  const models = new Map<string, CursorTokenTotals>()
  const aggregations = Array.isArray(value.aggregations)
    ? value.aggregations
    : []

  for (const aggregation of aggregations) {
    invariant(
      isRecord(aggregation) &&
        typeof aggregation.modelIntent === 'string' &&
        aggregation.modelIntent.length > 0,
      'Cursor dashboard model aggregates MUST name a model.',
      { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
    )

    const modelTotals = {
      input_tokens: nonNegativeNumericString(
        aggregation.inputTokens ?? '0',
        'aggregations.inputTokens',
      ),
      output_tokens: nonNegativeNumericString(
        aggregation.outputTokens ?? '0',
        'aggregations.outputTokens',
      ),
      cache_write_tokens: nonNegativeNumericString(
        aggregation.cacheWriteTokens ?? '0',
        'aggregations.cacheWriteTokens',
      ),
      cache_read_tokens: nonNegativeNumericString(
        aggregation.cacheReadTokens ?? '0',
        'aggregations.cacheReadTokens',
      ),
      cost_cents: nonNegativeNumber(
        aggregation.totalCents,
        'aggregations.totalCents',
        0,
      ),
    }
    const combined = models.get(aggregation.modelIntent) ?? emptyTokenTotals()

    addTokenTotals(combined, modelTotals)
    models.set(aggregation.modelIntent, combined)
  }

  return { totals, models }
}

function proportionalValue(
  rawValue: number,
  rawTotal: number,
  aggregateTotal: number,
  eligibleCount: number,
): number {
  if (aggregateTotal === 0 || eligibleCount === 0) {
    return 0
  }

  return rawTotal > 0
    ? (rawValue / rawTotal) * aggregateTotal
    : aggregateTotal / eligibleCount
}

function rawTokenTotals(tokenEvents: CursorUsageEvent[]): CursorTokenTotals {
  return tokenEvents.reduce((totals, event) => {
    const usage = event.token_usage

    if (usage !== null) {
      addTokenTotals(totals, {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_write_tokens: usage.cache_write_tokens,
        cache_read_tokens: usage.cache_read_tokens,
        cost_cents: usage.model_cost_cents,
      })
    }

    return totals
  }, emptyTokenTotals())
}

/** Scale one event's usage so the eligible events sum to the aggregate totals. */
function proportionalUsage(
  usage: CursorTokenUsage,
  raw: CursorTokenTotals,
  aggregate: CursorTokenTotals,
  eligibleCount: number,
): CursorTokenUsage {
  return {
    input_tokens: proportionalValue(
      usage.input_tokens,
      raw.input_tokens,
      aggregate.input_tokens,
      eligibleCount,
    ),
    output_tokens: proportionalValue(
      usage.output_tokens,
      raw.output_tokens,
      aggregate.output_tokens,
      eligibleCount,
    ),
    cache_write_tokens: proportionalValue(
      usage.cache_write_tokens,
      raw.cache_write_tokens,
      aggregate.cache_write_tokens,
      eligibleCount,
    ),
    cache_read_tokens: proportionalValue(
      usage.cache_read_tokens,
      raw.cache_read_tokens,
      aggregate.cache_read_tokens,
      eligibleCount,
    ),
    model_cost_cents: proportionalValue(
      usage.model_cost_cents,
      raw.cost_cents,
      aggregate.cost_cents,
      eligibleCount,
    ),
  }
}

function normalizeDashboardEvents(
  events: CursorUsageEvent[],
  aggregates: CursorDashboardAggregates,
): CursorUsageEvent[] {
  const groups = new Map<string, CursorUsageEvent[]>()

  for (const event of events) {
    const group = groups.get(event.model) ?? []

    group.push(event)
    groups.set(event.model, group)
  }

  const normalized: CursorUsageEvent[] = []

  for (const [model, modelEvents] of groups) {
    const aggregate = aggregates.models.get(model) ?? emptyTokenTotals()
    const tokenEvents = modelEvents.filter(
      (event) => event.token_usage !== null,
    )
    const raw = rawTokenTotals(tokenEvents)

    for (const event of modelEvents) {
      const usage = event.token_usage
      const tokenUsage =
        usage === null
          ? null
          : proportionalUsage(usage, raw, aggregate, tokenEvents.length)

      normalized.push({
        ...event,
        token_usage: tokenUsage,
        charged_cents: tokenUsage?.model_cost_cents ?? 0,
      })
    }
  }

  const tokenEvents = normalized.filter((event) => event.token_usage !== null)
  const raw = rawTokenTotals(tokenEvents)

  return normalized.map((event) => {
    const usage = event.token_usage

    if (usage === null) {
      return event
    }

    const tokenUsage = proportionalUsage(
      usage,
      raw,
      aggregates.totals,
      tokenEvents.length,
    )

    return {
      ...event,
      token_usage: tokenUsage,
      charged_cents: tokenUsage.model_cost_cents,
    }
  })
}

export function credentialRoots(root: string): string[] {
  const installationRoot = path.resolve(root)
  const workspaceRoot = path.resolve(root, configuredWorkspaceRoot(root))

  return workspaceRoot === installationRoot
    ? [installationRoot]
    : [installationRoot, workspaceRoot]
}

function resolveCredentialFromEnvironment(
  environment: Record<string, string | undefined>,
): CursorUsageCredential | null {
  const sessionToken = environment.CURSOR_SESSION_TOKEN

  if (typeof sessionToken === 'string' && sessionToken.length > 0) {
    return { kind: 'dashboard-session', value: sessionToken }
  }

  const adminKey = environment.CURSOR_ADMIN_API_KEY

  return typeof adminKey === 'string' && adminKey.length > 0
    ? { kind: 'admin-api-key', value: adminKey }
    : null
}

/** Resolve a personal dashboard session first, then a team Admin API key. */
export function resolveCursorUsageCredential(
  root: string,
): CursorUsageCredential {
  const processCredential = resolveCredentialFromEnvironment(process.env)

  if (processCredential !== null) {
    return processCredential
  }

  for (const candidateRoot of credentialRoots(root)) {
    const candidate = path.join(candidateRoot, '.env')

    if (!fileExists(candidate)) {
      continue
    }

    let parsed: Record<string, string | undefined>

    try {
      parsed = parseEnv(readText(candidate))
    } catch {
      continue
    }

    const credential = resolveCredentialFromEnvironment(parsed)

    if (credential !== null) {
      return credential
    }
  }

  throw new PanError(
    'Cursor usage reporting needs CURSOR_SESSION_TOKEN or ' +
      'CURSOR_ADMIN_API_KEY in the process environment or the ' +
      'installation/workspace .env file.',
    { code: 'CURSOR_USAGE_CREDENTIAL_MISSING' },
  )
}

/** Fetch every team usage page in one inclusive time window. */
export async function fetchCursorUsageEvents(
  options: FetchCursorUsageEventsOptions,
): Promise<CursorUsageEventsResult> {
  invariant(
    options.apiKey.length > 0,
    'Cursor usage reporting requires a non-empty API key.',
    { code: 'CURSOR_ADMIN_API_KEY_MISSING' },
  )
  invariant(
    Number.isFinite(options.startDateMs) &&
      Number.isFinite(options.endDateMs) &&
      options.startDateMs <= options.endDateMs,
    'Cursor usage reporting requires a valid inclusive date range.',
    { code: 'INVALID_ARGUMENT' },
  )

  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = options.endpoint ?? CURSOR_USAGE_EVENTS_URL
  const timeoutMs = options.timeoutMs ?? CURSOR_USAGE_TIMEOUT_MS

  const events: CursorUsageEvent[] = []
  let page = 1

  while (page <= MAX_USAGE_PAGES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response

    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${options.apiKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: options.startDateMs,
          endDate: options.endDateMs,
          page,
          pageSize: CURSOR_USAGE_PAGE_SIZE,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      const timedOut = error instanceof Error && error.name === 'AbortError'

      throw new PanError(
        timedOut
          ? `Cursor usage request timed out after ${timeoutMs}ms.`
          : `Cursor usage request failed: ${errorMessage(error)}.`,
        {
          code: timedOut
            ? 'CURSOR_USAGE_TIMEOUT'
            : 'CURSOR_USAGE_REQUEST_FAILED',
        },
      )
    }

    let body: unknown

    try {
      body = await response.json()
    } catch {
      clearTimeout(timer)
      throw new PanError(
        `Cursor usage API returned invalid JSON (status ${response.status}).`,
        { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
      )
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new PanError(
        `Cursor usage API request failed with status ${response.status}.`,
        {
          code:
            response.status === 401 || response.status === 403
              ? 'CURSOR_USAGE_UNAUTHORIZED'
              : 'CURSOR_USAGE_REQUEST_FAILED',
        },
      )
    }

    const parsed = parseUsagePage(body)

    events.push(...parsed.events)

    if (!parsed.hasNextPage) {
      return {
        events,
        period: {
          start_date_ms: options.startDateMs,
          end_date_ms: options.endDateMs,
        },
        pages_fetched: page,
        source: 'Cursor Admin API /teams/filtered-usage-events',
        aggregate_tokens: null,
      }
    }

    page += 1
  }

  throw new PanError(
    `Cursor usage pagination exceeded ${MAX_USAGE_PAGES} pages.`,
    { code: 'CURSOR_USAGE_PAGINATION_LIMIT' },
  )
}

async function fetchDashboardJson(
  endpoint: string,
  sessionToken: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response

  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Cookie: `WorkosCursorSessionToken=${sessionToken}`,
        'Content-Type': 'application/json',
        Origin: 'https://cursor.com',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    const timedOut = error instanceof Error && error.name === 'AbortError'

    throw new PanError(
      timedOut
        ? `Cursor usage request timed out after ${timeoutMs}ms.`
        : `Cursor usage request failed: ${errorMessage(error)}.`,
      {
        code: timedOut ? 'CURSOR_USAGE_TIMEOUT' : 'CURSOR_USAGE_REQUEST_FAILED',
      },
    )
  }

  try {
    const result: unknown = await response.json()

    if (!response.ok) {
      throw new PanError(
        `Cursor dashboard usage request failed with status ${response.status}.`,
        {
          code:
            response.status === 401 || response.status === 403
              ? 'CURSOR_USAGE_UNAUTHORIZED'
              : 'CURSOR_USAGE_REQUEST_FAILED',
        },
      )
    }

    return result
  } catch (error) {
    if (error instanceof PanError) {
      throw error
    }

    throw new PanError(
      `Cursor dashboard usage API returned invalid JSON (status ${response.status}).`,
      { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch personal usage events and exact aggregate token totals. */
export async function fetchCursorDashboardUsageEvents(
  options: FetchCursorDashboardUsageOptions,
): Promise<CursorUsageEventsResult> {
  invariant(
    options.sessionToken.length > 0,
    'Cursor usage reporting requires a non-empty dashboard session token.',
    { code: 'CURSOR_USAGE_CREDENTIAL_MISSING' },
  )
  invariant(
    Number.isFinite(options.startDateMs) &&
      Number.isFinite(options.endDateMs) &&
      options.startDateMs <= options.endDateMs,
    'Cursor usage reporting requires a valid inclusive date range.',
    { code: 'INVALID_ARGUMENT' },
  )

  const fetchImpl = options.fetchImpl ?? fetch
  const eventsEndpoint =
    options.eventsEndpoint ?? CURSOR_DASHBOARD_USAGE_EVENTS_URL
  const aggregatesEndpoint =
    options.aggregatesEndpoint ?? CURSOR_DASHBOARD_AGGREGATES_URL
  const timeoutMs = options.timeoutMs ?? CURSOR_USAGE_TIMEOUT_MS

  const commonBody = {
    startDate: String(options.startDateMs),
    endDate: String(options.endDateMs),
  }

  const events: CursorUsageEvent[] = []
  let page = 1

  while (page <= MAX_USAGE_PAGES) {
    const body = await fetchDashboardJson(
      eventsEndpoint,
      options.sessionToken,
      {
        ...commonBody,
        page,
        pageSize: CURSOR_USAGE_PAGE_SIZE,
      },
      fetchImpl,
      timeoutMs,
    )
    const parsed = parseDashboardUsagePage(body)

    events.push(...parsed.events)

    if (events.length >= parsed.total) {
      const aggregateBody = await fetchDashboardJson(
        aggregatesEndpoint,
        options.sessionToken,
        commonBody,
        fetchImpl,
        timeoutMs,
      )
      const aggregates = parseDashboardAggregates(aggregateBody)

      return {
        events: normalizeDashboardEvents(events, aggregates),
        period: {
          start_date_ms: options.startDateMs,
          end_date_ms: options.endDateMs,
        },
        pages_fetched: page,
        source: 'Cursor dashboard personal usage',
        aggregate_tokens: aggregates.totals,
      }
    }

    invariant(
      parsed.events.length > 0,
      'Cursor dashboard usage pagination ended before the reported total.',
      { code: 'CURSOR_USAGE_INVALID_RESPONSE' },
    )
    page += 1
  }

  throw new PanError(
    `Cursor usage pagination exceeded ${MAX_USAGE_PAGES} pages.`,
    { code: 'CURSOR_USAGE_PAGINATION_LIMIT' },
  )
}
