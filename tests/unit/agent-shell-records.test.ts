import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  classifyShellRecord,
  parseProcessTable,
  readAgentShellRecords,
  type AgentShellRecord,
  type ProcessTable,
} from '../../src/lib/agent-index/shell-records.js'
import { createTestTempDirectory } from '../temp.js'

function baseRecord(
  overrides: Partial<AgentShellRecord> = {},
): AgentShellRecord {
  return {
    record_path: 'runtime/logs/shell/x/record.json',
    label: 'bash',
    pid: 100,
    wrapper_pid: 99,
    started_at: '2026-10-01T00:00:00.000Z',
    ended_at: null,
    exit_code: null,
    parent_record: null,
    cursor_conversation_id: 'agent-1',
    wrapper_process_identity: 'Mon Oct  1 00:00:00 2026',
    heartbeat_seconds: 30,
    heartbeat_age_seconds: 5,
    log_bytes: 10,
    last_output_at: null,
    silent_seconds: null,
    process_state: 'running',
    tree_cpu_seconds: 0,
    ...overrides,
  }
}

test('classifyShellRecord marks ended records exited', () => {
  const table: ProcessTable = new Map()
  const state = classifyShellRecord(
    baseRecord({ ended_at: '2026-10-01T00:01:00.000Z', exit_code: 0 }),
    null,
    table,
  )
  assert.equal(state, 'exited')
})

test('classifyShellRecord marks a stopped command from process stat T', () => {
  const table: ProcessTable = new Map([
    [
      99,
      {
        pid: 99,
        ppid: 1,
        stat: 'S',
        time: '0:00.01',
        lstart: 'Mon Oct  1 00:00:00 2026',
      },
    ],
    [
      100,
      {
        pid: 100,
        ppid: 99,
        stat: 'T',
        time: '0:00.01',
        lstart: 'Mon Oct  1 00:00:00 2026',
      },
    ],
  ])
  const state = classifyShellRecord(baseRecord(), null, table)
  assert.equal(state, 'stopped')
})

test('readAgentShellRecords classifies busy then idle against the previous wake', () => {
  const root = createTestTempDirectory('shell-records-busy-')
  const directory = path.join(
    root,
    'runtime',
    'logs',
    'shell',
    '20261001T000000Z-probe-abcdef01',
  )
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, 'record.json'),
    JSON.stringify(
      baseRecord({
        record_path: 'unused',
        started_at: new Date().toISOString(),
      }),
    ),
  )
  const writeHeartbeat = (logBytes: number): void => {
    writeFileSync(
      path.join(directory, 'heartbeat.json'),
      JSON.stringify({ log_bytes: logBytes, last_output_at: null }),
    )
  }
  const tableAt = (cpu: string): ProcessTable =>
    new Map([
      [
        99,
        {
          pid: 99,
          ppid: 1,
          stat: 'S',
          time: '0:00.01',
          lstart: 'Mon Oct  1 00:00:00 2026',
        },
      ],
      [
        100,
        {
          pid: 100,
          ppid: 99,
          stat: 'S',
          time: cpu,
          lstart: 'Mon Oct  1 00:00:00 2026',
        },
      ],
    ])
  const ids = new Set(['agent-1'])
  const startMs = Date.now()
  const read = (offsetMs: number, cpu: string): string | undefined =>
    readAgentShellRecords(
      root,
      ids,
      startMs - 60_000,
      startMs + offsetMs,
      tableAt(cpu),
    )[0]?.process_state

  writeHeartbeat(10)
  assert.equal(read(0, '0:00.02'), 'running')
  assert.equal(
    read(1_000, '0:00.02'),
    'running',
    'a read inside one wake keeps the baseline',
  )
  writeHeartbeat(40)
  assert.equal(
    read(15_000, '0:00.02'),
    'busy',
    'output grew since the previous wake',
  )
  assert.equal(
    read(30_000, '0:00.02'),
    'idle',
    'no output and no CPU since the previous wake',
  )
  assert.equal(
    read(45_000, '0:01.50'),
    'busy',
    'CPU grew since the previous wake',
  )
})

test('readAgentShellRecords links a record by host_session_id when no Cursor id is set', () => {
  const root = createTestTempDirectory('shell-records-host-')
  const directory = path.join(
    root,
    'runtime/logs/shell/20261001T000000Z-probe-abcdef02',
  )
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, 'record.json'),
    JSON.stringify({
      ...baseRecord({
        cursor_conversation_id: null,
        started_at: new Date().toISOString(),
      }),
      host: 'copilot-cli',
      host_session_id: 'copilot-session-1',
    }),
  )
  const nowMs = Date.now()
  const records = readAgentShellRecords(
    root,
    new Set(['copilot-session-1']),
    nowMs - 60_000,
    nowMs,
    new Map(),
  )

  assert.equal(records.length, 1)
  assert.equal(records[0]?.cursor_conversation_id, 'copilot-session-1')
})

test('parseProcessTable keeps the full lstart so a live wrapper matches its identity', () => {
  const table = parseProcessTable(
    [
      '   99     1 S      0:00.01 Mon Oct  1 00:00:00 2026',
      '  100    99 T      0:00.00 Mon Oct  1 00:00:00 2026',
      '',
    ].join('\n'),
  )

  assert.ok(table)
  assert.equal(table.get(99)?.lstart, 'Mon Oct  1 00:00:00 2026')
  assert.equal(table.get(99)?.time, '0:00.01')
  assert.equal(classifyShellRecord(baseRecord(), null, table), 'stopped')
  assert.equal(
    classifyShellRecord(baseRecord({ pid: 99 }), null, table),
    'running',
  )
})
