/**
 * Unit tests for the spend-sync module:
 * - spendEventKey and conversationKeyFromId (AC-4 helper)
 * - selectSpendRecord (AC-3, AC-6, TC-14)
 * - mergeLedger merge and prune (AC-3)
 * - combineSpendSnapshots dedup, instance totals, and cost basis (AC-6, AC-7)
 * - parseSpendSnapshot validation (AC-7)
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  combineSpendSnapshots,
  derivedCursorFeeCents,
  mergeLedger,
  parseSpendSnapshot,
  selectSpendRecord,
  type SpendLedger,
  type SpendSnapshot,
} from '../../src/lib/spend-sync.js'
import {
  aggregateSpendRecords,
  spendEventKey,
  conversationKeyFromId,
} from '../../src/lib/token-spend.js'
import type { SpendRecord } from '../../src/lib/token-spend.js'

function makeRecord(overrides: Partial<SpendRecord> = {}): SpendRecord {
  return {
    key: 'aabbcc',
    source: 'team',
    timestamp_ms: Date.now(),
    model: 'gpt-4',
    metrics: {
      events: 1,
      request_units: 1,
      input_tokens: 100,
      output_tokens: 50,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 150,
      cost_cents: 0.01,
      cursor_fee_cents: 0.002,
    },
    attribution: {
      command: 'Unattributed',
      persona_model: 'Unattributed · gpt-4',
      tools: [],
      fast_mode: 'unknown',
      governance: 'unattributed',
      workflow_role: 'unattributed',
      stage: 'Unattributed',
      remediation: 'unattributed',
    },
    conversation_key: null,
    ...overrides,
  }
}

function attributedRecord(overrides: Partial<SpendRecord> = {}): SpendRecord {
  return makeRecord({
    attribution: {
      command: '/pan-spend',
      persona_model: 'coder · claude-3-5-sonnet',
      tools: ['Read'],
      fast_mode: 'non-fast',
      governance: 'governed',
      workflow_role: 'stage',
      stage: 'implement',
      remediation: 'non-remedial',
    },
    ...overrides,
  })
}

test('spendEventKey produces a 64-character hex string', () => {
  const record = makeRecord()
  const event = {
    timestamp_ms: record.timestamp_ms,
    model: record.model,
    kind: 'normal',
    max_mode: false,
    request_units: 1,
    token_based: true,
    chargeable: true,
    headless: false,
    conversation_id: null,
    cloud_agent_id: null,
    automation_id: null,
    token_usage: null,
    charged_cents: 0,
    cursor_token_fee_cents: 0,
  }

  const key = spendEventKey(event, 'team')

  assert.match(key, /^[0-9a-f]{64}$/)
})

test('conversationKeyFromId produces a 64-character hex key', () => {
  const key = conversationKeyFromId('some-transcript-id')

  assert.match(key, /^[0-9a-f]{64}$/)
  // Deterministic
  assert.equal(key, conversationKeyFromId('some-transcript-id'))
})

test('the selection rule prefers a higher attribution score', () => {
  const unattributed = makeRecord({ key: 'shared' })
  const attributed = attributedRecord({ key: 'shared' })

  const result = selectSpendRecord(
    attributed,
    unattributed,
    'instance-a',
    'instance-b',
    '2026-01-02T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
  )

  assert.equal(result, attributed)
})

test('a tie goes to the newer synced_at', () => {
  const older = makeRecord({ key: 'shared' })
  const newer = makeRecord({ key: 'shared' })

  const result = selectSpendRecord(
    newer,
    older,
    'instance-b',
    'instance-a',
    '2026-01-03T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
  )

  assert.equal(result, newer)
})

test('a further tie goes to the lexicographically smaller instance_id', () => {
  const a = makeRecord({ key: 'shared' })
  const b = makeRecord({ key: 'shared' })
  const syncedAt = '2026-01-01T00:00:00.000Z'

  const result = selectSpendRecord(
    a,
    b,
    'aaa-instance',
    'bbb-instance',
    syncedAt,
    syncedAt,
  )

  assert.equal(result, a) // 'aaa' < 'bbb'
})

const NOW = new Date('2026-09-25T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const INSTANCE_A = '00000000-0000-4000-8000-00000000000a'
const INSTANCE_B = '00000000-0000-4000-8000-00000000000b'

function hex(label: string): string {
  return conversationKeyFromId(label)
}

function snapshotOf(
  instanceId: string,
  records: SpendRecord[],
  toolCalls: SpendSnapshot['tool_calls'] = {},
): SpendSnapshot {
  return {
    schema_version: 1,
    instance_id: instanceId,
    label: `host-${instanceId.slice(-1)}`,
    harness_version: '7.26.0',
    synced_at: '2026-09-24T00:00:00.000Z',
    attribution_sources: {
      workspaces_scanned: 1,
      embedded_installations_scanned: 0,
    },
    records,
    tool_calls: toolCalls,
  }
}

test('the ledger merge keeps one record per key, prefers the better attributed record, and prunes records older than 365 days', () => {
  const recent = NOW.getTime() - DAY_MS
  const ledger: SpendLedger = {
    schema_version: 1,
    instance_id: INSTANCE_A,
    records: [
      makeRecord({
        key: hex('e1'),
        timestamp_ms: recent,
        conversation_key: hex('c1'),
      }),
      makeRecord({
        key: hex('stale'),
        timestamp_ms: NOW.getTime() - 366 * DAY_MS,
        conversation_key: hex('c-stale'),
      }),
      makeRecord({ key: hex('e3'), timestamp_ms: recent }),
      attributedRecord({ key: hex('e5'), timestamp_ms: recent }),
    ],
    tool_calls: {
      [hex('c1')]: { Read: 1 },
      [hex('c-stale')]: { Grep: 1 },
    },
    updated_at: '2026-09-24T00:00:00.000Z',
  }
  const incoming = [
    attributedRecord({
      key: hex('e1'),
      timestamp_ms: recent,
      conversation_key: hex('c1'),
    }),
    makeRecord({ key: hex('e4'), timestamp_ms: recent }),
    makeRecord({ key: hex('e5'), timestamp_ms: recent }),
  ]
  const incomingToolCalls = new Map([
    [
      hex('c1'),
      new Map([
        ['Read', 2],
        ['Edit', 1],
      ]),
    ],
  ])

  const merged = mergeLedger(
    ledger,
    incoming,
    incomingToolCalls,
    INSTANCE_A,
    NOW.toISOString(),
    NOW,
  )
  const byKey = new Map(merged.records.map((record) => [record.key, record]))

  assert.equal(merged.records.length, byKey.size)
  assert.deepEqual(
    [...byKey.keys()].sort(),
    [hex('e1'), hex('e3'), hex('e4'), hex('e5')].sort(),
  )
  assert.equal(byKey.get(hex('e1'))?.attribution.command, '/pan-spend')
  assert.equal(byKey.get(hex('e5'))?.attribution.command, '/pan-spend')
  assert.deepEqual(merged.tool_calls, { [hex('c1')]: { Read: 2, Edit: 1 } })
  assert.equal(merged.updated_at, NOW.toISOString())
})

test('counts each event once when snapshots share an event key, and instance totals sum to the report totals', () => {
  const recent = NOW.getTime() - DAY_MS
  const shared = hex('shared')
  const report = combineSpendSnapshots(
    [
      snapshotOf(INSTANCE_A, [
        attributedRecord({ key: shared, timestamp_ms: recent }),
        makeRecord({ key: hex('only-a'), timestamp_ms: recent }),
      ]),
      snapshotOf(INSTANCE_B, [
        makeRecord({ key: shared, timestamp_ms: recent }),
        makeRecord({ key: hex('only-b1'), timestamp_ms: recent }),
        makeRecord({ key: hex('only-b2'), timestamp_ms: recent }),
      ]),
    ],
    { days: 14, now: NOW },
  )

  assert.equal(report.totals.events, 4)
  assert.equal(
    report.slices.commands.find((row) => row.key === '/pan-spend')?.metrics
      .events,
    1,
  )

  const [a, b] = report.instances

  assert.deepEqual(
    [a?.records_in_window, a?.records_selected],
    [2, 2],
    'instance A supplies the shared event',
  )
  assert.deepEqual([b?.records_in_window, b?.records_selected], [3, 2])

  for (const field of [
    'events',
    'total_tokens',
    'cost_cents',
    'cursor_fee_cents',
  ] as const) {
    assert.equal(
      report.instances.reduce(
        (total, instance) => total + instance.totals[field],
        0,
      ),
      report.totals[field],
      `sum of instances[].totals.${field}`,
    )
  }
})

test('aggregates every instance snapshot with the local report keys and tool calls from the selected record instance', () => {
  const recent = NOW.getTime() - DAY_MS
  const shared = hex('shared')
  const conversation = hex('conversation')
  const report = combineSpendSnapshots(
    [
      snapshotOf(
        INSTANCE_B,
        [
          makeRecord({
            key: shared,
            timestamp_ms: recent,
            conversation_key: conversation,
          }),
        ],
        { [conversation]: { Read: 5 } },
      ),
      snapshotOf(
        INSTANCE_A,
        [
          attributedRecord({
            key: shared,
            timestamp_ms: recent,
            conversation_key: conversation,
          }),
        ],
        { [conversation]: { Read: 1 } },
      ),
    ],
    { days: 14, now: NOW },
  )

  const local = aggregateSpendRecords([], new Map())

  assert.equal(report.scope, 'multi-instance')
  assert.equal(report.period.source, 'Pancreator spend sync')
  assert.equal(report.attribution_sources.instances, 2)
  assert.equal(report.attribution_sources.workspaces_scanned, 2)
  assert.deepEqual(
    Object.keys(report.slices).sort(),
    Object.keys(local.slices).sort(),
  )
  assert.deepEqual(
    Object.keys(report.coverage).sort(),
    Object.keys(local.coverage).sort(),
  )
  assert.deepEqual(
    Object.keys(report.token_categories).sort(),
    Object.keys(local.token_categories).sort(),
  )
  assert.deepEqual(
    report.slices.tools.map((row) => [row.key, row.call_count]),
    [['Read', 1]],
  )
})

test('only the latest snapshot of each instance counts, whatever the upload order', () => {
  const recent = NOW.getTime() - DAY_MS
  const newer = {
    ...snapshotOf(INSTANCE_A, [
      makeRecord({ key: hex('e1'), timestamp_ms: recent }),
    ]),
    label: 'renamed-host',
    synced_at: '2026-09-24T12:00:00.000Z',
  }
  const older = snapshotOf(INSTANCE_A, [
    attributedRecord({ key: hex('e1'), timestamp_ms: recent }),
    makeRecord({ key: hex('dropped'), timestamp_ms: recent }),
  ])

  const report = combineSpendSnapshots([newer, older], { days: 14, now: NOW })

  assert.equal(report.totals.events, 1)
  assert.equal(report.slices.commands[0]?.key, 'Unattributed')
  assert.deepEqual(
    report.instances.map((instance) => [instance.label, instance.synced_at]),
    [['renamed-host', '2026-09-24T12:00:00.000Z']],
  )
  assert.ok(
    report.warnings.includes(
      'Ignored 1 superseded snapshot(s); each instance contributes only its latest sync.',
    ),
  )
})

test('cost basis is charged for team and personal records', () => {
  const recent = NOW.getTime() - DAY_MS
  const basis = (records: SpendRecord[]): string =>
    combineSpendSnapshots([snapshotOf(INSTANCE_A, records)], {
      days: 14,
      now: NOW,
    }).period.cost_basis

  const team = makeRecord({
    key: hex('team'),
    source: 'team',
    timestamp_ms: recent,
  })
  const personal = makeRecord({
    key: hex('personal'),
    source: 'personal',
    timestamp_ms: recent,
  })

  assert.equal(basis([team]), 'charged')
  assert.equal(basis([personal]), 'charged')
  assert.equal(basis([team, personal]), 'charged')
})

test('an invalid snapshot envelope is rejected and a malformed record is skipped', () => {
  const valid = makeRecord({ key: hex('valid') })
  const snapshot = snapshotOf(INSTANCE_A, [valid])

  assert.equal(parseSpendSnapshot({ ...snapshot, schema_version: 2 }), null)
  assert.equal(parseSpendSnapshot({ ...snapshot, records: 'x' }), null)
  assert.equal(parseSpendSnapshot('not a snapshot'), null)

  const parsed = parseSpendSnapshot({
    ...snapshot,
    records: [
      valid,
      { ...valid, key: 'raw-conversation-id' },
      { ...valid, metrics: null },
      null,
    ],
    tool_calls: { [hex('c')]: { Read: 1 }, 'raw-id': { Read: 1 } },
  })

  assert.equal(parsed?.skipped_records, 3)
  assert.deepEqual(
    parsed?.snapshot.records.map((record) => record.key),
    [hex('valid')],
  )
  assert.deepEqual(Object.keys(parsed?.snapshot.tool_calls ?? {}), [hex('c')])
})

test('the derived Cursor fee is $0.25 per million tokens on models Cursor does not own after the fee started', () => {
  const after = Date.parse('2026-09-01T00:00:00.000Z')
  const before = Date.parse('2026-08-27T17:00:00.000Z')

  assert.equal(derivedCursorFeeCents('claude-opus-5-5-high', after, 4e6), 100)
  assert.equal(derivedCursorFeeCents('claude-opus-5-5-high', before, 4e6), 0)

  for (const model of [
    'cursor-grok-4.6-high-fast',
    'composer-2.5-fast',
    'Grok 4.6 (Auto Balanced)',
    'default',
  ]) {
    assert.equal(derivedCursorFeeCents(model, after, 4e6), 0, model)
  }
})

test('a record synced before fees were recorded gets a derived fee and the report warns', () => {
  const recent = NOW.getTime() - DAY_MS
  const current = makeRecord({ key: hex('current'), timestamp_ms: recent })
  const { cursor_fee_cents: _, ...legacyMetrics } = current.metrics
  const parsed = parseSpendSnapshot({
    ...snapshotOf(INSTANCE_A, []),
    records: [
      current,
      { ...current, key: hex('legacy'), metrics: legacyMetrics },
    ],
  })

  assert.equal(parsed?.skipped_records, 0)
  assert.deepEqual(
    parsed?.snapshot.records.map((record) => [
      record.metrics.cursor_fee_cents,
      record.fee_derived,
    ]),
    [
      [0.002, undefined],
      [150 * 0.000025, true],
    ],
  )

  const report = combineSpendSnapshots(
    parsed === null ? [] : [parsed.snapshot],
    { days: 14, now: NOW },
  )

  assert.equal(report.totals.cost_cents, 0.02)
  assert.ok(
    report.warnings.some((warning) =>
      warning.startsWith('1 event(s) were synced before Cursor fees'),
    ),
  )
})
