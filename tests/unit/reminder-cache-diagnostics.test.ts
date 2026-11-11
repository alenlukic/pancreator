import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PromptCacheComparisons,
  promptCacheDiagnostics,
} from '../../src/lib/governance/prompt-context/cache-diagnostics.js'
import { PromptCacheUsageObserver } from '../../src/lib/governance/prompt-context/cache-usage.js'

function request(key = 'session-one'): Record<string, unknown> {
  return {
    model: 'gpt-6.1-sol',
    prompt_cache_key: key,
    prompt_cache_options: { mode: 'implicit', ttl: '30m' },
    input: [{ role: 'user', content: 'Private fixture.' }],
  }
}

test('diagnostics retain only known metadata and safe counts', () => {
  assert.deepEqual(
    promptCacheDiagnostics({
      prompt_cache_diagnostics: {
        type: 'cache_miss',
        reason: 'tools_changed',
        comparison_reusable_tokens: 2000,
        cache_missed_tokens: 1900,
        prompt: 'private prompt',
        credential: 'private credential',
      },
    }),
    {
      type: 'cache_miss',
      reason: 'tools_changed',
      comparison_reusable_tokens: 2000,
      cache_missed_tokens: 1900,
    },
  )
  assert.deepEqual(
    promptCacheDiagnostics({
      prompt_cache_diagnostics: {
        type: 'cache_miss',
        reason: 'private provider error',
        comparison_reusable_tokens: -1,
        cache_missed_tokens: 1.5,
      },
    }),
    { type: 'cache_miss' },
  )
  assert.equal(
    promptCacheDiagnostics({ prompt_cache_diagnostics: { type: 'private' } }),
    undefined,
  )
  assert.equal(promptCacheDiagnostics({}), undefined)
})

test('consecutive comparisons preserve caller baselines and isolate credentials and sessions', () => {
  const comparisons = new PromptCacheComparisons()
  const first = request()
  const prepared = comparisons.prepare(first, 'account-one')
  assert.equal(prepared.comparison_response_id, undefined)
  comparisons.complete(prepared, 'resp_first')
  assert.equal(
    comparisons.prepare(request(), 'account-one').comparison_response_id,
    'resp_first',
  )
  assert.equal(
    comparisons.prepare(request(), 'account-two').comparison_response_id,
    undefined,
  )
  assert.equal(
    comparisons.prepare(request('other-session'), 'account-one')
      .comparison_response_id,
    undefined,
  )

  const caller = {
    ...request(),
    prompt_cache_options: { comparison_response_id: 'resp_pinned' },
  }
  assert.equal(
    comparisons.prepare(caller, 'account-one').comparison_response_id,
    'resp_pinned',
  )
  assert.deepEqual(caller.prompt_cache_options, {
    comparison_response_id: 'resp_pinned',
  })
  const disabled = {
    ...request(),
    prompt_cache_options: { comparison_response_id: null },
  }
  assert.equal(
    comparisons.prepare(disabled, 'account-one').comparison_response_id,
    undefined,
  )
  assert.equal(disabled.prompt_cache_options.comparison_response_id, null)
  assert.equal(
    comparisons.prepare({ previous_response_id: 'resp_lineage' }, 'account-one')
      .comparison_response_id,
    'resp_lineage',
  )
})

test('fallback conversation identity survives marker insertion and string normalization', () => {
  const comparisons = new PromptCacheComparisons()
  const first = { input: [{ role: 'user', content: 'Original task.' }] }
  comparisons.complete(comparisons.prepare(first, 'account'), 'resp_first')
  const next = {
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Original task.',
            prompt_cache_breakpoint: { mode: 'explicit', ttl: '30m' },
          },
        ],
      },
      { role: 'user', content: 'New question.' },
    ],
  }
  assert.equal(
    comparisons.prepare(next, 'account').comparison_response_id,
    'resp_first',
  )
  assert.equal(
    comparisons.prepare({ input: 'Original task.' }, 'account')
      .comparison_response_id,
    'resp_first',
  )
  assert.equal(
    comparisons.prepare({ input: 'Other task.' }, 'account')
      .comparison_response_id,
    undefined,
  )
})

test('baselines expire, evict, and resist late older completions', () => {
  let now = 0
  const comparisons = new PromptCacheComparisons(() => now, 2, 100)
  const older = comparisons.prepare(request(), 'account')
  const newer = comparisons.prepare(request(), 'account')
  comparisons.complete(newer, 'resp_newer')
  comparisons.complete(older, 'resp_older')
  comparisons.complete(newer, 'private malformed id')
  assert.equal(
    comparisons.prepare(request(), 'account').comparison_response_id,
    'resp_newer',
  )
  now = 100
  assert.equal(
    comparisons.prepare(request(), 'account').comparison_response_id,
    undefined,
  )

  for (const key of ['one', 'two', 'three']) {
    comparisons.complete(
      comparisons.prepare(request(key), 'account'),
      `resp_${key}`,
    )
  }
  assert.equal(
    comparisons.prepare(request('one'), 'account').comparison_response_id,
    undefined,
  )
  assert.equal(
    comparisons.prepare(request('two'), 'account').comparison_response_id,
    'resp_two',
  )
  assert.equal(
    comparisons.prepare(request('three'), 'account').comparison_response_id,
    'resp_three',
  )
})

test('JSON and chunked SSE report diagnostics without usage and retain completed IDs only', () => {
  for (const streaming of [false, true]) {
    for (const status of ['completed', 'incomplete', 'failed']) {
      const response = {
        id: 'resp_fixture',
        status,
        output: 'private output',
        prompt_cache_diagnostics: { type: 'cache_hit', extra: 'private' },
      }
      const seen: unknown[] = []
      const observer = new PromptCacheUsageObserver(
        streaming,
        (usage, diagnostics, completed) => {
          seen.push({ usage, diagnostics, completed })
        },
      )
      const data = streaming
        ? `data: ${JSON.stringify({ type: `response.${status}`, response })}\n\n`
        : JSON.stringify(response)

      for (let offset = 0; offset < data.length; offset += 3) {
        observer.write(Buffer.from(data.slice(offset, offset + 3)))
      }
      observer.finish()
      observer.finish()
      assert.deepEqual(seen, [
        {
          usage: undefined,
          diagnostics: { type: 'cache_hit' },
          completed: status === 'completed' ? 'resp_fixture' : undefined,
        },
      ])
      assert.equal(JSON.stringify(seen).includes('private'), false)
    }
  }
})
