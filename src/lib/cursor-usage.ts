import path from 'node:path'
import { parseEnv } from 'node:util'

import { PanError, errorMessage, invariant } from './errors.js'
import { fileExists, isRecord, readText } from './io.js'
import { configuredWorkspaceRoot } from './project-config.js'

const CURSOR_USAGE_EVENTS_URL =
  'https://api.cursor.com/teams/filtered-usage-events'
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
    ),
    output_tokens: nonNegativeNumber(
      value.outputTokens,
      'tokenUsage.outputTokens',
    ),
    cache_write_tokens: nonNegativeNumber(
      value.cacheWriteTokens,
      'tokenUsage.cacheWriteTokens',
    ),
    cache_read_tokens: nonNegativeNumber(
      value.cacheReadTokens,
      'tokenUsage.cacheReadTokens',
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

function credentialRoots(root: string): string[] {
  const installationRoot = path.resolve(root)
  const workspaceRoot = path.resolve(root, configuredWorkspaceRoot(root))

  return workspaceRoot === installationRoot
    ? [installationRoot]
    : [installationRoot, workspaceRoot]
}

/** Resolve the admin-scoped key without returning its source or metadata. */
export function resolveCursorAdminApiKey(root: string): string {
  const processKey = process.env.CURSOR_ADMIN_API_KEY

  if (typeof processKey === 'string' && processKey.length > 0) {
    return processKey
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

    const key = parsed.CURSOR_ADMIN_API_KEY

    if (typeof key === 'string' && key.length > 0) {
      return key
    }
  }

  throw new PanError(
    'Cursor usage reporting needs CURSOR_ADMIN_API_KEY in the process ' +
      'environment or the installation/workspace .env file.',
    { code: 'CURSOR_ADMIN_API_KEY_MISSING' },
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
      }
    }

    page += 1
  }

  throw new PanError(
    `Cursor usage pagination exceeded ${MAX_USAGE_PAGES} pages.`,
    { code: 'CURSOR_USAGE_PAGINATION_LIMIT' },
  )
}
