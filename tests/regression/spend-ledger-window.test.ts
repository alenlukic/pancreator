import assert from 'node:assert/strict'
import test from 'node:test'

import { ledgerWindow } from '../../src/lib/spend-sync.js'

const DAY_MS = 24 * 60 * 60 * 1000

test('the sync ledger window spans a full-year ledger larger than the call stack allows to spread', () => {
  const now = new Date('2026-09-25T12:00:00.000Z')
  const earliest = now.getTime() - 364 * DAY_MS
  const latest = now.getTime() - 1_000
  const records = Array.from({ length: 250_000 }, (_, index) => ({
    timestamp_ms: now.getTime() - DAY_MS - (index % 1_000) * 1_000,
  }))

  records[137_000] = { timestamp_ms: earliest }
  records[61_000] = { timestamp_ms: latest }

  assert.deepEqual(ledgerWindow(records, now), {
    start: new Date(earliest).toISOString(),
    end: new Date(latest).toISOString(),
  })
  assert.deepEqual(ledgerWindow([], now), {
    start: new Date(now.getTime() - 365 * DAY_MS).toISOString(),
    end: now.toISOString(),
  })
})
