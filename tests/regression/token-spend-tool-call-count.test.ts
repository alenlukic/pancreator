import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { generateTokenSpendReport } from '../../src/lib/token-spend.js'
import { createFixture } from '../fixture-template.js'

function projectSlug(absolute: string): string {
  return path.resolve(absolute).split(path.sep).filter(Boolean).join('-')
}

function usageEvent(conversationId: string, timestampMs: number): unknown {
  return {
    timestamp: String(timestampMs),
    conversationId,
    model: 'gpt-5.6-sol',
    kind: 'Usage-based',
    maxMode: false,
    requestsCosts: 1,
    isTokenBasedCall: true,
    isChargeable: true,
    isHeadless: false,
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalCents: 1,
    },
    chargedCents: 1,
  }
}

test('bare pan spend counts a conversation tool call once however many usage events the conversation has', async () => {
  const root = createFixture()
  const projectsRoot = path.join(root, 'cursor-projects')
  const conversationId = 'conversation-many-events'
  const transcriptPath = path.join(
    projectsRoot,
    projectSlug(root),
    'agent-transcripts',
    `${conversationId}.jsonl`,
  )

  mkdirSync(path.dirname(transcriptPath), { recursive: true })
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      role: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'ReadFile', input: {} }],
      },
    }),
  )

  const now = new Date('2026-09-22T16:00:00.000Z')
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        pagination: { hasNextPage: false },
        usageEvents: [1, 2, 3].map((offset) =>
          usageEvent(conversationId, now.getTime() - offset * 60_000),
        ),
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

  assert.equal(report.totals.events, 3)
  assert.deepEqual(
    report.slices.tools.map((row) => [row.key, row.call_count]),
    [['ReadFile', 1]],
  )
})
