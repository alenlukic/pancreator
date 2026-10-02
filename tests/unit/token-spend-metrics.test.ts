/**
 * Unit tests for the included and on-demand split of spend metrics.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CursorUsageEvent } from '../../src/lib/cursor-usage.js'
import {
  addMetrics,
  emptyMetrics,
  eventMetrics,
} from '../../src/lib/token-spend/metrics.js'

function event(kind: string): CursorUsageEvent {
  return {
    timestamp_ms: 1_780_000_000_000,
    model: 'claude-opus-5-5-high',
    kind,
    max_mode: false,
    request_units: 1,
    token_based: true,
    chargeable: true,
    headless: false,
    conversation_id: null,
    cloud_agent_id: null,
    automation_id: null,
    token_usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_write_tokens: 0,
      cache_read_tokens: 85,
      model_cost_cents: 2,
    },
    charged_cents: 2.5,
    cursor_token_fee_cents: 0.5,
  }
}

test('an event billed against included usage carries its charge and fee as included', () => {
  for (const kind of [
    'USAGE_EVENT_KIND_INCLUDED_IN_BUSINESS',
    'USAGE_EVENT_KIND_INCLUDED_IN_PRO',
    'Included in Business',
  ]) {
    const metrics = eventMetrics(event(kind))

    assert.deepEqual(
      [
        metrics.cost_cents,
        metrics.included_cost_cents,
        metrics.included_fee_cents,
      ],
      [2.5, 2.5, 0.5],
      kind,
    )
  }
})

test('every other event kind is on-demand usage with nothing included', () => {
  for (const kind of [
    'USAGE_EVENT_KIND_USAGE_BASED',
    'Usage-based',
    'USAGE_EVENT_KIND_ERRORED_NOT_CHARGED',
    'unknown',
  ]) {
    const metrics = eventMetrics(event(kind))

    assert.deepEqual(
      [metrics.included_cost_cents, metrics.included_fee_cents],
      [0, 0],
      kind,
    )
  }
})

test('summed metrics keep included usage inside charged cost', () => {
  const total = emptyMetrics()

  addMetrics(
    total,
    eventMetrics(event('USAGE_EVENT_KIND_INCLUDED_IN_BUSINESS')),
  )
  addMetrics(total, eventMetrics(event('USAGE_EVENT_KIND_USAGE_BASED')))

  assert.deepEqual(
    [
      total.cost_cents,
      total.included_cost_cents,
      total.cursor_fee_cents,
      total.included_fee_cents,
    ],
    [5, 2.5, 1, 0.5],
  )
})
