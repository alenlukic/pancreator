import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchCursorUsageEvents,
  type FetchCursorUsageEventsOptions,
} from '../../src/lib/cursor-usage.js'
import { PanError } from '../../src/lib/errors.js'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('Cursor usage client paginates and normalizes token and cost fields', async () => {
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> =
    []
  const pages = [
    {
      pagination: { hasNextPage: true },
      usageEvents: [
        {
          timestamp: '1780000000000',
          model: 'composer-2',
          kind: 'Usage-based',
          maxMode: false,
          requestsCosts: 2,
          isTokenBasedCall: true,
          isChargeable: true,
          isHeadless: false,
          conversationId: 'conversation-1',
          tokenUsage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheWriteTokens: 3,
            cacheReadTokens: 7,
            totalCents: 1.25,
          },
          chargedCents: 1.5,
          cursorTokenFee: 0.25,
        },
      ],
    },
    {
      pagination: { hasNextPage: false },
      usageEvents: [
        {
          timestamp: '1780003600000',
          model: 'composer-2',
          kind: 'Included',
          maxMode: true,
          requestsCosts: 1,
          isTokenBasedCall: false,
          isChargeable: false,
          isHeadless: true,
          cloudAgentId: 'agent-1',
          chargedCents: 0,
        },
      ],
    },
  ]
  const fetchImpl: typeof fetch = async (_input, init) => {
    requests.push({
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })

    return response(pages[requests.length - 1])
  }
  const options: FetchCursorUsageEventsOptions = {
    apiKey: 'secret-key',
    startDateMs: 1779990000000,
    endDateMs: 1780010000000,
    fetchImpl,
  }
  const result = await fetchCursorUsageEvents(options)

  assert.equal(result.pages_fetched, 2)
  assert.equal(result.events.length, 2)
  assert.deepEqual(result.events[0]?.token_usage, {
    input_tokens: 10,
    output_tokens: 5,
    cache_write_tokens: 3,
    cache_read_tokens: 7,
    model_cost_cents: 1.25,
  })
  assert.equal(result.events[1]?.token_usage, null)
  assert.equal(
    requests[0]?.headers.get('Authorization'),
    'Basic c2VjcmV0LWtleTo=',
  )
  assert.deepEqual(
    requests.map((item) => item.body.page),
    [1, 2],
  )
  assert.ok(requests.every((item) => item.body.pageSize === 1_000))
})

test('Cursor usage client reports authorization failures without the key', async () => {
  const fetchImpl: typeof fetch = async () =>
    response({ error: { message: 'secret-key is invalid' } }, 401)

  await assert.rejects(
    () =>
      fetchCursorUsageEvents({
        apiKey: 'secret-key',
        startDateMs: 1,
        endDateMs: 2,
        fetchImpl,
      }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'CURSOR_USAGE_UNAUTHORIZED' &&
      !error.message.includes('secret-key'),
  )
})
