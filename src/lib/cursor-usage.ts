import path from 'node:path'
import { parseEnv } from 'node:util'

import { PanError, errorMessage, invariant } from './errors.js'
import { fileExists, isRecord, readText } from './io.js'
import { configuredWorkspaceRoot } from './project-config.js'

const CURSOR_USAGE_EVENTS_URL =
  'https://api.cursor.com/teams/filtered-usage-events'
const CURSOR_DASHBOARD_USAGE_EVENTS_URL =
  'https://cursor.com/api/dashboard/get-filtered-usage-events'

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
    events: value.usageEventsDisplay.map(parseUsageEvent),
    total: nonNegativeNumber(
      value.totalUsageEventsCount,
      'totalUsageEventsCount',
    ),
  }
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

/** Fetch personal usage events with each event's charged cost. */
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
      return {
        events,
        period: {
          start_date_ms: options.startDateMs,
          end_date_ms: options.endDateMs,
        },
        pages_fetched: page,
        source: 'Cursor dashboard personal usage',
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
