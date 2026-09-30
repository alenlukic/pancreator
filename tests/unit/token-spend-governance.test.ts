import assert from 'node:assert/strict'
import test from 'node:test'

import type { CursorUsageEvent } from '../../src/lib/cursor-usage.js'
import { attributionForEvent } from '../../src/lib/token-spend/attribution.js'

const EVENT: CursorUsageEvent = {
  timestamp_ms: 0,
  model: 'model-a',
  kind: 'usage',
  max_mode: false,
  request_units: 1,
  token_based: true,
  chargeable: true,
  headless: false,
  conversation_id: 'conversation-without-transcript',
  cloud_agent_id: null,
  automation_id: null,
  token_usage: null,
  charged_cents: 1,
  cursor_token_fee_cents: 0,
}

test('an event with no transcript and no worker identity is unattributed, not governed', () => {
  const attribution = attributionForEvent(EVENT, new Map(), [], new Map(), null)

  assert.equal(attribution.governance, 'unattributed')
  assert.equal(attribution.command, 'Unattributed')
})
