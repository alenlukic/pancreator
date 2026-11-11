import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { startReminderRelay } from '../../src/lib/governance/prompt-context/relay.js'
import { isRecord, readText } from '../../src/lib/io.js'
import { createTestTempDirectory } from '../temp.js'

const USAGE = {
  input_tokens: 4096,
  input_tokens_details: {
    cached_tokens: 1024,
    cache_write_tokens: 2048,
    cache_write_tokens_details: { ttl_30m_tokens: 512, ttl_12h_tokens: 1536 },
  },
}
const SSE = `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_wire_synthetic', usage: USAGE, prompt_cache_diagnostics: { type: 'cache_miss', reason: 'tools_changed', cache_missed_tokens: 3072 } } })}\n\ndata: [DONE]\n\n`
const SHORT_RESPONSE = JSON.stringify({
  id: 'resp_short_synthetic',
  usage: {
    input_tokens: 20,
    input_tokens_details: {
      cached_tokens: 0,
      cache_write_tokens: 0,
      cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 },
    },
  },
})

test(
  'happy_path: relay puts two lifetimes on the final synthetic wire and preserves response bytes and usage',
  { timeout: 15_000 },
  async () => {
    const root = createTestTempDirectory('reminder-cache-wire-')
    const received: unknown[] = []
    const upstream = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        const value: unknown = JSON.parse(body)
        received.push(value)
        const short = isRecord(value) && value.stream === false
        response.writeHead(200, {
          'content-type':
            short || request.url === '/v1/chat/completions'
              ? 'application/json'
              : 'text/event-stream',
        })

        if (short) {
          response.end(SHORT_RESPONSE)
        } else if (request.url === '/v1/chat/completions') {
          response.end('{"choices":[]}')
        } else {
          response.write(SSE.slice(0, 17))
          response.end(SSE.slice(17))
        }
      })
    })
    await new Promise<void>((resolve) => {
      upstream.listen(0, '127.0.0.1', resolve)
    })
    const address = upstream.address()
    assert.ok(address && typeof address !== 'string')
    const relay = await startReminderRelay(root, {
      upstream: `http://127.0.0.1:${address.port}`,
    })

    try {
      assert.equal((await fetch(`${relay.url}/pan/health`)).status, 200)
      const send = (body: unknown, route = '/v1/responses') =>
        fetch(`${relay.url}${route}`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer synthetic-wire-credential',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        })
      const body = {
        model: 'gpt-6.1-sol',
        input: [
          { role: 'developer', content: 'Synthetic stable governance.' },
          { role: 'user', content: 'Reusable history.' },
          { role: 'user', content: 'Current synthetic question.' },
        ],
        tools: [
          {
            type: 'function',
            name: 'read_fixture',
            parameters: { type: 'object' },
          },
        ],
        store: false,
        stream: true,
      }
      const first = await send(body)
      assert.equal(first.status, 200)
      assert.equal(await first.text(), SSE)
      const forwarded = received[0]
      assert.ok(isRecord(forwarded) && Array.isArray(forwarded.input))
      assert.deepEqual(forwarded.prompt_cache_options, {
        mode: 'implicit',
        ttl: '30m',
      })
      assert.deepEqual(forwarded.tools, body.tools)
      assert.equal(forwarded.store, false)
      const developer = forwarded.input[0]
      const history = forwarded.input[1]
      assert.ok(isRecord(developer) && Array.isArray(developer.content))
      assert.ok(isRecord(history) && Array.isArray(history.content))
      assert.deepEqual(developer.content[0].prompt_cache_breakpoint, {
        mode: 'explicit',
        ttl: '12h',
      })
      assert.deepEqual(history.content[0].prompt_cache_breakpoint, {
        mode: 'explicit',
        ttl: '30m',
      })
      assert.deepEqual(forwarded.input[2], body.input[2])

      const continued = await send({
        ...forwarded,
        input: [
          ...forwarded.input,
          {
            type: 'function_call_output',
            call_id: 'call_synthetic',
            output: 'Synthetic output.',
          },
        ],
      })
      assert.equal(await continued.text(), SSE)
      const compared = received[1]
      assert.ok(isRecord(compared) && isRecord(compared.prompt_cache_options))
      assert.equal(
        compared.prompt_cache_options.comparison_response_id,
        'resp_wire_synthetic',
      )
      const health: unknown = await (
        await fetch(`${relay.url}/pan/health`)
      ).json()
      assert.ok(isRecord(health) && isRecord(health.cache_validation))
      assert.equal(health.cache_validation.comparisons, 1)
      assert.equal(health.cache_validation.misses, 1)
      assert.equal(health.cache_validation.cached_input_share, 0.25)
      const unchanged = { ...body, model: 'gpt-4.1' }
      assert.equal(await (await send(unchanged)).text(), SSE)
      assert.deepEqual(received[2], unchanged)
      const chat = {
        model: 'gpt-6.1-sol',
        messages: [{ role: 'user', content: 'Synthetic chat.' }],
      }
      assert.equal(
        await (await send(chat, '/v1/chat/completions')).text(),
        '{"choices":[]}',
      )
      assert.deepEqual(received[3], chat)
      const short = await send({
        ...body,
        input: [
          { role: 'developer', content: 'Short prefix.' },
          { role: 'user', content: 'Question.' },
        ],
        stream: false,
      })
      assert.equal(await short.text(), SHORT_RESPONSE)
      const before = received.length
      const invalid = await send({
        ...body,
        prompt_cache_options: { ttl: '24h' },
      })
      assert.equal(invalid.status, 422)
      assert.deepEqual(await invalid.json(), {
        error: { code: 'INVALID_PROMPT_CACHE_OPTIONS' },
      })
      assert.equal(received.length, before)

      const audit = readText(relay.audit_path)
      assert.equal(audit.includes('synthetic-wire-credential'), false)
      assert.equal(audit.includes('Synthetic stable governance'), false)
      assert.equal(audit.includes('Current synthetic question'), false)
      const entries: unknown[] = audit
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const requests = entries.filter(
        (entry) => isRecord(entry) && entry.event === 'request',
      )
      const usage = entries.filter(
        (entry) => isRecord(entry) && entry.event === 'cache_usage',
      )
      assert.equal(requests.length, 5)
      assert.equal(usage.length, 4)
      const observed = usage[0]
      assert.ok(isRecord(observed))
      assert.equal(observed.cache_hit, true)
      assert.equal(observed.input_tokens, 4096)
      assert.equal(observed.cached_tokens, 1024)
      assert.equal(observed.cache_write_tokens, 2048)
      assert.equal(observed.ttl_30m_tokens, 512)
      assert.equal(observed.ttl_12h_tokens, 1536)
      assert.equal(observed.ordinary_input_tokens, 1024)
      assert.equal(observed.response_id, 'resp_wire_synthetic')
      assert.equal(typeof observed.latency_ms, 'number')
      const diagnosed = usage[1]
      assert.ok(isRecord(diagnosed))
      assert.deepEqual(diagnosed.prompt_cache_diagnostics, {
        type: 'cache_miss',
        reason: 'tools_changed',
        cache_missed_tokens: 3072,
      })
      assert.equal(diagnosed.comparison_response_id, 'resp_wire_synthetic')
      assert.equal(diagnosed.cache_validation, 'miss')
      const missed = usage.at(-1)
      assert.ok(isRecord(missed))
      assert.equal(missed.cache_hit, false)
      assert.equal(missed.cache_write_tokens, 0)
      assert.equal(missed.ttl_12h_tokens, 0)
      assert.equal(missed.ordinary_input_tokens, 20)
    } finally {
      await relay.close()
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
    }
  },
)
