import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { generateTokenSpendReport } from '../../src/lib/token-spend.js'
import { createFixture } from '../fixture-template.js'

function writeJson(absolute: string, value: unknown): void {
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

function projectSlug(absolute: string): string {
  return path.resolve(absolute).split(path.sep).filter(Boolean).join('-')
}

test('token spend attributes embedded-installation conversations to workflow identity', async () => {
  const root = createFixture()
  const target = path.join(root, 'embedded-target')
  const embedded = path.join(target, '.pancreator')
  const projectsRoot = path.join(root, 'cursor-projects')

  const runId = '63287_Sep-22-0251_embedded'
  const conversationId = 'conversation-embedded'

  const now = new Date('2026-09-22T16:00:00.000Z')
  const eventTime = now.getTime() - 60_000

  const sourceConfig = JSON.parse(
    readFileSync(path.join(root, 'config.json'), 'utf8'),
  ) as Record<string, unknown>
  const embeddedConfig = {
    ...sourceConfig,
    workspace_id: 'embedded-target',
    workspace_root: '..',
    installation_mode: 'embedded',
    installations: [],
  }

  sourceConfig.installations = [{ id: 'embedded-target', path: embedded }]
  writeJson(path.join(root, 'config.json'), sourceConfig)
  writeJson(path.join(embedded, 'config.json'), embeddedConfig)

  writeJson(
    path.join(embedded, 'runtime/logs/workflows', runId, 'agent/state.json'),
    {
      run_id: runId,
      current_stage: 'implement',
      delegated_workers: [
        {
          invocation_id: '1_implement-1_abcdef12',
          role: 'worker',
          handle: conversationId,
        },
      ],
    },
  )
  writeJson(
    path.join(
      embedded,
      'runtime/logs/workflows',
      runId,
      'agent/invocations/1_implement-1_abcdef12.json',
    ),
    {
      stage: {
        slug: 'implement',
        persona: 'coder',
        model: 'gpt-5.6-sol[reasoning=high,fast=true]',
      },
      inputs: {},
    },
  )

  const transcript = [
    JSON.stringify({
      role: 'user',
      message: {
        content: [
          {
            type: 'text',
            text:
              '--- Cursor Command: pan-start ---\n' +
              '<timestamp>Tuesday, Sep 22, 2026, 11:59 AM (UTC-4)</timestamp>\n' +
              '<user_query>Implement the feature.</user_query>',
          },
        ],
      },
    }),
    JSON.stringify({
      role: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'ReadFile',
            input: { path: 'src/index.ts' },
          },
        ],
      },
    }),
  ].join('\n')
  const transcriptPath = path.join(
    projectsRoot,
    projectSlug(target),
    'agent-transcripts',
    `${conversationId}.jsonl`,
  )

  mkdirSync(path.dirname(transcriptPath), { recursive: true })
  writeFileSync(transcriptPath, transcript)

  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        pagination: { hasNextPage: false },
        usageEvents: [
          {
            timestamp: String(eventTime),
            userEmail: 'private@example.com',
            conversationId,
            model: 'gpt-5.6-sol',
            kind: 'Usage-based',
            maxMode: false,
            requestsCosts: 1,
            isTokenBasedCall: true,
            isChargeable: true,
            isHeadless: false,
            tokenUsage: {
              inputTokens: 100,
              outputTokens: 20,
              cacheWriteTokens: 30,
              cacheReadTokens: 50,
              totalCents: 2,
            },
            chargedCents: 2.25,
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  const report = await generateTokenSpendReport(root, {
    days: 14,
    apiKey: 'test-key',
    now,
    fetchImpl,
    cursorProjectsRoot: projectsRoot,
  })

  assert.deepEqual(report.attribution_sources, {
    workspaces_scanned: 2,
    embedded_installations_scanned: 1,
  })
  assert.equal(report.totals.total_tokens, 200)
  assert.equal(report.totals.cost_cents, 2.25)
  assert.equal(report.slices.commands[0]?.key, 'pan-start')
  assert.equal(report.slices.persona_models[0]?.key, 'coder · gpt-5.6-sol')
  assert.equal(report.slices.fast_mode[0]?.key, 'fast')
  assert.equal(report.slices.workflow_role[0]?.key, 'stage')
  assert.equal(report.slices.stages[0]?.key, 'implement')
  assert.equal(report.slices.remediation[0]?.key, 'non-remedial')
  assert.equal(report.slices.tools[0]?.key, 'ReadFile')
  assert.equal(report.slices.tools[0]?.call_count, 1)
  assert.equal(report.coverage.stage.known_token_percent, 100)

  const serialized = JSON.stringify(report)

  assert.ok(!serialized.includes('private@example.com'))
  assert.ok(!serialized.includes(conversationId))
  assert.ok(!serialized.includes('test-key'))
})

test('token spend keeps tool totals non-additive and unmatched usage visible', async () => {
  const root = createFixture()
  const transcripts = path.join(root, 'transcripts')
  const now = new Date('2026-09-22T16:00:00.000Z')

  mkdirSync(transcripts, { recursive: true })
  writeFileSync(
    path.join(transcripts, 'known-conversation.jsonl'),
    [
      JSON.stringify({
        role: 'user',
        message: {
          content: [
            {
              type: 'text',
              text:
                '--- Cursor Command: pan-status ---\n' +
                '<timestamp>Tuesday, Sep 22, 2026, 11:59 AM (UTC-4)</timestamp>',
            },
          ],
        },
      }),
      JSON.stringify({
        role: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'ReadFile', input: {} },
            { type: 'tool_use', name: 'Shell', input: {} },
          ],
        },
      }),
    ].join('\n'),
  )

  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        pagination: { hasNextPage: false },
        usageEvents: [
          {
            timestamp: String(now.getTime() - 1_000),
            conversationId: 'known-conversation',
            model: 'composer',
            kind: 'Usage-based',
            maxMode: false,
            requestsCosts: 1,
            isTokenBasedCall: true,
            isChargeable: true,
            isHeadless: false,
            tokenUsage: {
              inputTokens: 10,
              outputTokens: 10,
              cacheWriteTokens: 0,
              cacheReadTokens: 0,
              totalCents: 1,
            },
            chargedCents: 1,
          },
          {
            timestamp: String(now.getTime() - 500),
            conversationId: 'missing-conversation',
            model: 'composer',
            kind: 'Usage-based',
            maxMode: false,
            requestsCosts: 1,
            isTokenBasedCall: true,
            isChargeable: true,
            isHeadless: false,
            tokenUsage: {
              inputTokens: 5,
              outputTokens: 5,
              cacheWriteTokens: 0,
              cacheReadTokens: 0,
              totalCents: 0.5,
            },
            chargedCents: 0.5,
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  const report = await generateTokenSpendReport(root, {
    apiKey: 'test-key',
    now,
    fetchImpl,
    transcriptsRoot: transcripts,
  })

  assert.equal(report.totals.total_tokens, 30)
  assert.equal(report.slices.tools.length, 2)
  assert.ok(report.slices.tools.every((row) => row.metrics.total_tokens === 20))
  assert.equal(report.coverage.command.known_tokens, 20)
  assert.equal(report.coverage.command.total_tokens, 30)
  assert.ok(report.slices.commands.some((row) => row.key === 'Unattributed'))
})

test('personal spend normalizes attributed metrics to exact aggregate totals', async () => {
  const root = createFixture()
  const transcripts = path.join(root, 'transcripts')
  const now = new Date('2026-09-22T16:00:00.000Z')

  mkdirSync(transcripts, { recursive: true })
  writeFileSync(
    path.join(transcripts, 'known-conversation.jsonl'),
    [
      JSON.stringify({
        role: 'user',
        message: {
          content: [
            {
              type: 'text',
              text: '--- Cursor Command: pan-spend ---',
            },
          ],
        },
      }),
    ].join('\n'),
  )

  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)

    if (url.endsWith('aggregated')) {
      return new Response(
        JSON.stringify({
          aggregations: [
            {
              modelIntent: 'composer',
              inputTokens: '10',
              outputTokens: '5',
              cacheWriteTokens: '3',
              cacheReadTokens: '12',
              totalCents: 1,
            },
          ],
          totalInputTokens: '10',
          totalOutputTokens: '5',
          totalCacheWriteTokens: '3',
          totalCacheReadTokens: '12',
          totalCostCents: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        totalUsageEventsCount: 1,
        usageEventsDisplay: [
          {
            timestamp: String(now.getTime() - 1_000),
            conversationId: 'known-conversation',
            model: 'composer',
            kind: 'Usage-based',
            tokenUsage: {
              inputTokens: 10,
              outputTokens: 5,
              cacheWriteTokens: 3,
              totalCents: 1,
            },
            chargedCents: 1,
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const report = await generateTokenSpendReport(root, {
    sessionToken: 'session-secret',
    now,
    fetchImpl,
    endpoint: 'https://example.test/events',
    aggregatesEndpoint: 'https://example.test/aggregated',
    transcriptsRoot: transcripts,
  })

  assert.equal(report.period.source, 'Cursor dashboard personal usage')
  assert.equal(report.totals.total_tokens, 30)
  assert.equal(report.totals.cache_read_tokens, 12)
  assert.equal(report.totals.cost_cents, 1)
  assert.equal(report.period.cost_basis, 'model-cost')
  assert.equal(report.slices.commands[0]?.metrics.total_tokens, 30)
  assert.equal(report.slices.commands[0]?.metrics.cost_cents, 1)
  assert.equal(report.coverage.command.total_tokens, 30)
  assert.ok(
    report.warnings.some((warning) =>
      warning.includes('event allocations are inferred'),
    ),
  )
})
