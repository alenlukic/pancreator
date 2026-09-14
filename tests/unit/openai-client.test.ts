import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createOpenAiResponse,
  OPENAI_RESPONSES_URL,
} from '../../src/lib/executors/openai-client.js'

interface FakeCall {
  url: string
  init: RequestInit
}

function fakeFetch(respond: (call: FakeCall) => Response | Promise<Response>): {
  fetchImpl: typeof fetch
  calls: FakeCall[]
} {
  const calls: FakeCall[] = []
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call = { url: String(input), init: init ?? {} }

    calls.push(call)
    return respond(call)
  }) as typeof fetch

  return { fetchImpl, calls }
}

test('a successful call extracts output text, id, and usage', async () => {
  const { fetchImpl, calls } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          id: 'resp_123',
          model: 'gpt-6-astra',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Hello there.' }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        }),
        { status: 200 },
      ),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'Say hello.',
    fetchImpl,
  })

  assert.equal(result.ok, true)
  assert.equal(result.outputText, 'Hello there.')
  assert.equal(result.responseId, 'resp_123')
  assert.deepEqual(result.usage, {
    input_tokens: 5,
    output_tokens: 3,
    total_tokens: 8,
  })
  assert.equal(calls[0]?.url, OPENAI_RESPONSES_URL)

  const headers = calls[0]?.init.headers as Record<string, string>
  const sentBody = JSON.parse(String(calls[0]?.init.body)) as Record<
    string,
    unknown
  >

  assert.equal(headers.Authorization, 'Bearer sk-test')
  assert.equal(sentBody.model, 'gpt-6-astra')
  assert.equal(sentBody.input, 'Say hello.')
  assert.equal(sentBody.store, false)
})

test('optional request controls are forwarded when given', async () => {
  const { fetchImpl, calls } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          output_text: 'Short answer.',
        }),
        { status: 200 },
      ),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'Summarize this.',
    instructions: 'Be terse.',
    reasoningEffort: 'high',
    maxOutputTokens: 64,
    fetchImpl,
  })

  const sentBody = JSON.parse(String(calls[0]?.init.body)) as Record<
    string,
    unknown
  >

  assert.equal(result.outputText, 'Short answer.')
  assert.equal(sentBody.instructions, 'Be terse.')
  assert.deepEqual(sentBody.reasoning, { effort: 'high' })
  assert.equal(sentBody.max_output_tokens, 64)
})

test('function calls and tool definitions cross the client intact', async () => {
  const { fetchImpl, calls } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          id: 'resp_tools',
          output: [
            {
              type: 'function_call',
              call_id: 'call_1',
              name: 'read_file',
              arguments: '{"path":"src/cli.ts"}',
            },
            {
              type: 'function_call',
              call_id: 'call_2',
              name: 'run_shell',
              arguments: '{"command":"npm test"}',
            },
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Checking two things.' }],
            },
          ],
        }),
        { status: 200 },
      ),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: [
      { role: 'user', content: '# card' },
      {
        type: 'function_call_output',
        call_id: 'call_0',
        output: 'previous result',
      },
    ],
    tools: [
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a file.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    ],
    fetchImpl,
  })

  assert.equal(result.ok, true)
  // Text and calls arrive together; a turn may carry both.
  assert.equal(result.outputText, 'Checking two things.')
  assert.deepEqual(result.functionCalls, [
    {
      call_id: 'call_1',
      name: 'read_file',
      arguments: '{"path":"src/cli.ts"}',
    },
    {
      call_id: 'call_2',
      name: 'run_shell',
      arguments: '{"command":"npm test"}',
    },
  ])

  const sentBody = JSON.parse(String(calls[0]?.init.body)) as {
    input: unknown[]
    tools: { name: string }[]
  }

  // Structured input items and the tool catalog reach the API unchanged.
  assert.deepEqual(sentBody.input, [
    { role: 'user', content: '# card' },
    {
      type: 'function_call_output',
      call_id: 'call_0',
      output: 'previous result',
    },
  ])
  assert.deepEqual(
    sentBody.tools.map((tool) => tool.name),
    ['read_file'],
  )
})

test('a turn carrying only a function call is not an empty response', async () => {
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          id: 'resp_call_only',
          output: [
            {
              type: 'function_call',
              call_id: 'call_1',
              name: 'list_directory',
              arguments: '{"path":"."}',
            },
          ],
        }),
        { status: 200 },
      ),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'Look around.',
    fetchImpl,
  })

  // A tool-only turn is how the loop advances, so it must not report
  // OPENAI_NO_OUTPUT the way a genuinely empty turn does.
  assert.equal(result.ok, true)
  assert.equal(result.outputText, undefined)
  assert.equal(result.functionCalls.length, 1)
})

test('multiple message text blocks are concatenated', async () => {
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: 'Part one. ' },
                { type: 'output_text', text: 'Part two.' },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'x',
    fetchImpl,
  })

  assert.equal(result.outputText, 'Part one. Part two.')
})

test('a successful response without text fails explicitly', async () => {
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(JSON.stringify({ output: [] }), {
        status: 200,
      }),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'x',
    fetchImpl,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'OPENAI_NO_OUTPUT')
})

test('an incomplete response fails even when it contains partial text', async () => {
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output_text: 'Partial',
        }),
        { status: 200 },
      ),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'x',
    fetchImpl,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'OPENAI_INCOMPLETE_RESPONSE')
  assert.match(result.error ?? '', /max_output_tokens/u)
})

test('a response-level error fails despite an HTTP success status', async () => {
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          status: 'failed',
          error: { message: 'Generation failed.' },
        }),
        { status: 200 },
      ),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'x',
    fetchImpl,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'OPENAI_RESPONSE_NOT_COMPLETED')
  assert.equal(result.error, 'Generation failed.')
})

test('a non-2xx status surfaces the API error message', async () => {
  const { fetchImpl } = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          error: { message: "The model 'nope' does not exist." },
        }),
        { status: 404 },
      ),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'nope',
    input: 'x',
    fetchImpl,
  })

  assert.equal(result.ok, false)
  assert.equal(result.httpStatus, 404)
  assert.equal(result.code, 'OPENAI_HTTP_ERROR')
  assert.equal(result.error, "The model 'nope' does not exist.")
})

test('invalid JSON reports an invalid response', async () => {
  const { fetchImpl } = fakeFetch(
    () => new Response('not json', { status: 200 }),
  )

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'x',
    fetchImpl,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'OPENAI_INVALID_RESPONSE')
})

test('a network failure is normalized instead of thrown', async () => {
  const fetchImpl = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof fetch

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'x',
    fetchImpl,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'OPENAI_REQUEST_FAILED')
  assert.equal(result.httpStatus, null)
})

test('an aborted request reports a timeout', async () => {
  const fetchImpl = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('This operation was aborted.')

        error.name = 'AbortError'
        reject(error)
      })
    })) as typeof fetch

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'x',
    timeoutMs: 5,
    fetchImpl,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'OPENAI_TIMEOUT')
})

test('the timeout also bounds reading the response body', async () => {
  const fetchImpl = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) =>
    ({
      ok: true,
      status: 200,
      json: () =>
        new Promise<unknown>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('This operation was aborted.')

            error.name = 'AbortError'
            reject(error)
          })
        }),
    }) as Response) as typeof fetch

  const result = await createOpenAiResponse({
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    input: 'x',
    timeoutMs: 5,
    fetchImpl,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'OPENAI_TIMEOUT')
})

test('the API key is never copied into the request body', async () => {
  const secret = 'sk-secret-value'
  const { fetchImpl, calls } = fakeFetch(
    () =>
      new Response(JSON.stringify({ output_text: 'ok' }), {
        status: 200,
      }),
  )

  await createOpenAiResponse({
    apiKey: secret,
    model: 'gpt-6-astra',
    input: 'x',
    fetchImpl,
  })

  assert.doesNotMatch(String(calls[0]?.init.body), new RegExp(secret, 'u'))
})
