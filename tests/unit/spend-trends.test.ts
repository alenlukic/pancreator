/**
 * Unit tests for the per-day spend trend series.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SpendRecord } from '../../src/lib/token-spend.js'
import { emptyMetrics } from '../../src/lib/token-spend/metrics.js'
import {
  MAX_TREND_KEYS,
  modelProvider,
  spendTrends,
} from '../../src/lib/token-spend/trends.js'

function record(
  date: string,
  model: string,
  costCents: number,
  role: SpendRecord['attribution']['workflow_role'] = 'stage',
): SpendRecord {
  return {
    key: `${date}-${model}-${costCents}`,
    source: 'personal',
    timestamp_ms: Date.parse(`${date}T12:00:00.000Z`),
    model,
    metrics: {
      ...emptyMetrics(),
      events: 1,
      total_tokens: 100,
      cost_cents: costCents,
    },
    attribution: {
      command: 'pan-start',
      persona_model: `coder · ${model}`,
      tools: [],
      fast_mode: 'unknown',
      governance: 'governed',
      workflow_role: role,
      stage: 'build',
      remediation: 'non-remedial',
    },
    conversation_key: null,
  }
}

test('model names map to their vendor', () => {
  assert.equal(modelProvider('claude-4.6-opus-high-thinking'), 'Anthropic')
  assert.equal(modelProvider('gpt-5.5-medium'), 'OpenAI')
  assert.equal(modelProvider('gemini-3.8-flash'), 'Google')
  assert.equal(modelProvider('grok-4.7-high-fast'), 'xAI')
  assert.equal(modelProvider('composer-2.5-fast'), 'Cursor')
  assert.equal(modelProvider('mystery-1'), 'Other')
})

test('each dimension aligns daily cost with its costliest keys', () => {
  const trends = spendTrends([
    record('2026-09-02', 'gpt-5.5', 300, 'supervisor'),
    record('2026-09-01', 'claude-opus', 500),
    record('2026-09-02', 'claude-opus', 100),
  ])
  const models = trends.dimensions.model

  assert.deepEqual(models.keys, ['claude-opus', 'gpt-5.5'])
  assert.deepEqual(models.rows, [
    { date: '2026-09-01', cost_cents: [500, 0], total_tokens: [100, 0] },
    { date: '2026-09-02', cost_cents: [100, 300], total_tokens: [100, 100] },
  ])
  assert.deepEqual(trends.dimensions.workflow_role.keys, [
    'stage',
    'supervisor',
  ])
  assert.deepEqual(trends.dimensions.persona.keys, ['coder'])
  assert.deepEqual(trends.dimensions.provider.keys, ['Anthropic', 'OpenAI'])
})

test('keys past the cap fold into one trailing Other', () => {
  const records = Array.from({ length: MAX_TREND_KEYS + 3 }, (_, index) =>
    record('2026-09-01', `model-${index}`, 1000 - index),
  )
  const models = spendTrends(records).dimensions.model

  assert.equal(models.keys.length, MAX_TREND_KEYS)
  assert.equal(models.keys.at(-1), 'Other')
  assert.equal(
    models.rows[0]?.cost_cents.reduce((sum, value) => sum + value, 0),
    records.reduce((sum, item) => sum + item.metrics.cost_cents, 0),
  )
})
