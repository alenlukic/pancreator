import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyReminderCache,
  supportsPromptCacheTtl,
} from '../../src/lib/governance/prompt-context/cache.js'
import { isRecord } from '../../src/lib/io.js'

function request() {
  return {
    model: 'gpt-6.1-sol',
    instructions: 'Provider instructions remain in their original role.',
    tools: [
      {
        type: 'function',
        name: 'read_fixture',
        parameters: { type: 'object' },
      },
      {
        type: 'function',
        name: 'check_fixture',
        parameters: { type: 'object' },
      },
    ],
    input: [
      {
        role: 'developer',
        content: [
          { type: 'input_text', text: 'Stable authorized governance.' },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Earlier question.' }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Current question.' }],
      },
    ],
    store: false,
    stream: true,
    comparison_response_id: 'resp_diagnostics_only',
  }
}

function messages(value: Record<string, unknown>) {
  assert.ok(Array.isArray(value.input))
  return value.input.map((message: unknown) => {
    assert.ok(isRecord(message))
    return message
  })
}

function parts(value: Record<string, unknown>) {
  assert.ok(Array.isArray(value.content))
  return value.content.map((part: unknown) => {
    assert.ok(isRecord(part))
    return part
  })
}

test('happy_path: final Responses body has a stable 12h foundation and a 30m history boundary', () => {
  const original = request()
  const before = structuredClone(original)
  const result = applyReminderCache(original, '/v1/responses')
  const input = messages(result.request)
  assert.deepEqual(original, before)
  assert.deepEqual(result.request.prompt_cache_options, {
    mode: 'implicit',
    ttl: '30m',
  })
  assert.equal(result.evidence.request_mode, 'implicit')
  assert.deepEqual(parts(input[0]!)[0]!.prompt_cache_breakpoint, {
    mode: 'explicit',
    ttl: '12h',
  })
  assert.deepEqual(parts(input[1]!)[0]!.prompt_cache_breakpoint, {
    mode: 'explicit',
    ttl: '30m',
  })
  assert.equal(parts(input[2]!)[0]!.prompt_cache_breakpoint, undefined)
  assert.deepEqual(result.request.tools, original.tools)
  assert.equal(result.request.instructions, original.instructions)
  assert.equal(
    result.request.comparison_response_id,
    original.comparison_response_id,
  )
  assert.equal(result.request.store, false)
  assert.equal(result.evidence.cache_hit, 'unverified')
  assert.equal(result.evidence.status, 'configured')

  const next = request()
  next.input[2]!.content[0]!.text = 'A changed current question.'
  assert.equal(
    applyReminderCache(next, '/v1/responses').evidence.prefix_sha256,
    result.evidence.prefix_sha256,
  )

  for (const change of [
    (value: ReturnType<typeof request>) => {
      value.tools.reverse()
    },
    (value: ReturnType<typeof request>) => {
      value.tools[0]!.parameters.type = 'string'
    },
    (value: ReturnType<typeof request>) => {
      value.input[0]!.content[0]!.text = 'New governance.'
    },
    (value: ReturnType<typeof request>) => {
      value.model = 'gpt-6-luna'
    },
  ]) {
    const changed = request()
    change(changed)
    assert.notEqual(
      applyReminderCache(changed, '/v1/responses').evidence.prefix_sha256,
      result.evidence.prefix_sha256,
    )
  }
})

test('hidden_edge_case: tool continuations retain roles, boundaries and the complete unchanged prefix', () => {
  const first = applyReminderCache(request(), '/v1/responses')
  const input = messages(first.request)
  const continuation = {
    ...first.request,
    input: [
      ...input,
      {
        type: 'function_call',
        call_id: 'call_one',
        name: 'read_fixture',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_one',
        output: 'Live result.',
      },
    ],
  }
  const next = applyReminderCache(continuation, '/v1/responses')
  assert.equal(next.evidence.prefix_sha256, first.evidence.prefix_sha256)
  assert.deepEqual(next.request.input, continuation.input)

  const framed = 'Complete registered reminder.'
  const split = applyReminderCache(
    {
      model: 'gpt-5.6',
      input: [
        {
          role: 'developer',
          content: [
            {
              type: 'input_text',
              text: `${framed}\nLive clock.`,
              prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' },
            },
          ],
        },
        { role: 'user', content: 'Question.' },
      ],
    },
    '/v1/responses',
    true,
    [framed],
  )
  const content = parts(messages(split.request)[0]!)
  assert.equal(
    content.map((part) => part.text).join(''),
    `${framed}\nLive clock.`,
  )
  assert.deepEqual(content[0]!.prompt_cache_breakpoint, {
    mode: 'explicit',
    ttl: '12h',
  })
  assert.equal(content[1]!.prompt_cache_breakpoint, undefined)
  assert.equal(split.evidence.history_ttl, undefined)
})

test('regression: growing tool loops retain automatic caching beyond the foundation', () => {
  const original = request()
  const first = applyReminderCache(
    {
      ...original,
      prompt_cache_options: { mode: 'explicit', ttl: '30m' },
    },
    '/v1/responses',
  )
  const input = messages(first.request)

  for (let turn = 0; turn < 3; turn++) {
    input.push(
      {
        type: 'function_call',
        call_id: `call_${turn}`,
        name: 'read_fixture',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: `call_${turn}`,
        output: `Reusable tool result ${turn}.`,
      },
    )
    const continued = applyReminderCache(
      { ...first.request, input },
      '/v1/responses',
    )
    assert.deepEqual(continued.request.prompt_cache_options, {
      mode: 'implicit',
      ttl: '30m',
    })
    assert.deepEqual(continued.request.input, input)
    assert.equal(continued.evidence.prefix_sha256, first.evidence.prefix_sha256)
    assert.equal(continued.evidence.foundation_ttl, '12h')
  }

  const noDeveloper = {
    model: original.model,
    instructions: original.instructions,
    input: input.slice(1),
    prompt_cache_options: { mode: 'explicit', ttl: '12h' },
  }
  const implicit = applyReminderCache(noDeveloper, '/v1/responses')
  assert.deepEqual(implicit.request.input, noDeveloper.input)
  assert.deepEqual(implicit.request.prompt_cache_options, {
    mode: 'implicit',
    ttl: '30m',
  })
  assert.equal(implicit.evidence.status, 'missing_developer_prefix')
  assert.deepEqual(
    applyReminderCache(noDeveloper, '/v1/responses', false).request,
    noDeveloper,
  )
})

test('critical_unhappy_path: invalid lifetimes fail before forwarding, including existing explicit markers', () => {
  for (const options of [
    { ttl: '24h' },
    { ttl: null },
    { mode: 'automatic' },
    '12h',
  ]) {
    assert.throws(
      () =>
        applyReminderCache(
          { ...request(), prompt_cache_options: options },
          '/v1/responses',
        ),
      { code: 'INVALID_PROMPT_CACHE_OPTIONS' },
    )
  }

  const invalid = request()
  const part = invalid.input[0]!.content[0]!

  for (const breakpoint of [
    { mode: 'explicit', ttl: '1d' },
    { mode: 'implicit', ttl: '12h' },
  ]) {
    assert.throws(
      () =>
        applyReminderCache(
          {
            ...invalid,
            input: [
              {
                role: 'developer',
                content: [{ ...part, prompt_cache_breakpoint: breakpoint }],
              },
            ],
          },
          '/v1/responses',
        ),
      { code: 'INVALID_PROMPT_CACHE_OPTIONS' },
    )
  }
})

test('probable_edge_case: unsupported models, Chat Completions and disabled caching keep the original shape', () => {
  for (const model of [
    'gpt-5',
    'gpt-5.5',
    'gpt-4.1',
    'claude-sonnet',
    'gpt-custom',
    'gpt-5.6.invalid',
  ]) {
    assert.equal(supportsPromptCacheTtl(model), false)
    const original = { ...request(), model }
    assert.deepEqual(
      applyReminderCache(original, '/v1/responses').request,
      original,
    )
  }

  for (const model of [
    'gpt-5.6',
    'gpt-5.6-mini',
    'gpt-5.7',
    'gpt-6-astra',
    'gpt-6.1-sol',
  ]) {
    assert.equal(supportsPromptCacheTtl(model), true)
  }

  const original = request()
  assert.deepEqual(
    applyReminderCache(original, '/v1/chat/completions').request,
    original,
  )
  assert.deepEqual(
    applyReminderCache(original, '/v1/responses', false).request,
    original,
  )
  const noPrefix = {
    ...original,
    input: original.input.slice(1),
    prompt_cache_key: 'not-context',
  }
  const result = applyReminderCache(noPrefix, '/v1/responses')
  assert.deepEqual(result.request, {
    ...noPrefix,
    prompt_cache_options: { mode: 'implicit', ttl: '30m' },
  })
  assert.equal(result.evidence.request_mode, 'implicit')
  assert.equal(result.evidence.status, 'missing_developer_prefix')
  assert.equal(result.evidence.cache_hit, 'unverified')
})
