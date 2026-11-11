import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PromptCacheUsageObserver,
  promptCacheUsage,
  type PromptCacheUsage,
} from '../../src/lib/governance/prompt-context/cache-usage.js'

const RESPONSE = {
  id: 'resp_synthetic',
  output: [{ content: 'Private generated text must never enter the audit.' }],
  usage: {
    input_tokens: 12000,
    input_tokens_details: {
      cached_tokens: 4000,
      cache_write_tokens: 7000,
      cache_write_tokens_details: {
        ttl_30m_tokens: 3000,
        ttl_12h_tokens: 4000,
      },
    },
  },
}

const EXPECTED = {
  response_id: 'resp_synthetic',
  input_tokens: 12000,
  cached_tokens: 4000,
  cache_write_tokens: 7000,
  ttl_30m_tokens: 3000,
  ttl_12h_tokens: 4000,
  ordinary_input_tokens: 1000,
}

test('happy_path: billing counters distinguish reads, both write lifetimes and ordinary input without double charges', () => {
  assert.deepEqual(promptCacheUsage(RESPONSE), EXPECTED)
  const seen: Array<PromptCacheUsage | undefined> = []
  const observer = new PromptCacheUsageObserver(false, (usage) => {
    seen.push(usage)
  })
  observer.write(Buffer.from(JSON.stringify(RESPONSE)))
  observer.finish()
  observer.finish()
  assert.deepEqual(seen, [EXPECTED])
  assert.equal(JSON.stringify(seen).includes('Private generated'), false)
})

test('hidden_edge_case: arbitrary SSE and UTF-8 chunk boundaries preserve exactly one final usage record', () => {
  const seen: Array<PromptCacheUsage | undefined> = []
  const observer = new PromptCacheUsageObserver(true, (usage) => {
    seen.push(usage)
  })
  const stream = Buffer.from(
    `: keepalive\r\n\r\ndata: {"type":"response.output_text.delta","delta":"💡 private"}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: RESPONSE })}\r\n\r\ndata: [DONE]\n\n`,
  )

  for (let index = 0; index < stream.length; index += 3) {
    observer.write(stream.subarray(index, index + 3))
  }
  observer.finish()
  assert.deepEqual(seen, [EXPECTED])
})

test('critical_unhappy_path: oversized, malformed or interrupted evidence is unavailable and recovers at the next event', () => {
  for (const streaming of [true, false]) {
    const seen: Array<PromptCacheUsage | undefined> = []
    const observer = new PromptCacheUsageObserver(
      streaming,
      (usage) => {
        seen.push(usage)
      },
      1024,
    )
    observer.write(Buffer.from(`data: ${'x'.repeat(2048)}\n\n`))

    if (streaming) {
      observer.write(Buffer.from('data: invalid json\n\n'))
      observer.write(
        Buffer.from(
          `data: ${JSON.stringify({ type: 'response.completed', response: RESPONSE })}\n\n`,
        ),
      )
    }
    observer.finish()
    assert.deepEqual(seen, streaming ? [EXPECTED] : [undefined])
  }

  const seen: Array<PromptCacheUsage | undefined> = []
  const observer = new PromptCacheUsageObserver(true, (usage) => {
    seen.push(usage)
  })
  observer.write(
    Buffer.from(
      `data: ${JSON.stringify({ type: 'response.completed', response: RESPONSE })}`,
    ),
  )
  observer.finish()
  assert.deepEqual(seen, [undefined])
})

test('probable_edge_case: missing counters stay missing and invalid counts never produce a negative ordinary total', () => {
  assert.equal(promptCacheUsage({}), undefined)
  assert.equal(promptCacheUsage({ usage: {} }), undefined)
  const result = promptCacheUsage({
    id: 'private text',
    usage: {
      input_tokens: 1,
      input_tokens_details: {
        cached_tokens: 2,
        cache_write_tokens: -4,
        cache_write_tokens_details: { ttl_30m_tokens: 1.5, ttl_12h_tokens: 0 },
      },
    },
  })
  assert.equal(result?.response_id, undefined)
  assert.equal(result?.cache_write_tokens, undefined)
  assert.equal(result?.ttl_30m_tokens, undefined)
  assert.equal(result?.ttl_12h_tokens, 0)
  assert.equal(result?.ordinary_input_tokens, undefined)
})
