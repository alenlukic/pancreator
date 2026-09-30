import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  AgentActivity,
  ShellHeartbeat,
} from '../../src/lib/agent-index.js'
import {
  formatOpenCallSuffix,
  formatProcessWakeLines,
  formatWakeLine,
  type GenericWatchRecordEntry,
  type WatchObservation,
  type WatchRecordEntry,
} from '../../src/lib/watch.js'

function baseEntry(
  overrides: Partial<GenericWatchRecordEntry> = {},
): GenericWatchRecordEntry {
  return {
    schema_version: 1,
    event: 'wake',
    subject: '4242',
    label: 'build',
    recorded_at: '2026-09-30T19:00:00.000Z',
    cadence_seconds: 60,
    wake: 3,
    watch_session_id: 'session-1',
    ...overrides,
  }
}

test('formatProcessWakeLines renders growth with an indented tail', () => {
  const line = formatProcessWakeLines(
    baseEntry({
      output: {
        path: 'runtime/logs/shell/x/output.log',
        exists: true,
        size: 13,
        mtime_ms: 0,
        growth_bytes: 7,
        silent_seconds: 0,
        tail: ['first', 'second'],
      },
    }),
  )

  assert.equal(
    line,
    '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z +7B\n  first\n  second',
  )
})

test('formatProcessWakeLines reports silence once past two cadences', () => {
  const line = formatProcessWakeLines(
    baseEntry({
      cadence_seconds: 10,
      output: {
        path: 'runtime/logs/shell/x/output.log',
        exists: true,
        size: 13,
        mtime_ms: 0,
        growth_bytes: 0,
        silent_seconds: 25,
      },
    }),
  )

  assert.equal(
    line,
    '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z no new output for 25s',
  )
})

test('formatProcessWakeLines stays quiet about silence under two cadences', () => {
  const line = formatProcessWakeLines(
    baseEntry({
      cadence_seconds: 60,
      output: {
        path: 'runtime/logs/shell/x/output.log',
        exists: true,
        size: 13,
        mtime_ms: 0,
        growth_bytes: 0,
        silent_seconds: 15,
      },
    }),
  )

  assert.equal(line, '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z')
})

test('formatProcessWakeLines appends the terminal state and the linked pan-run heartbeat', () => {
  const line = formatProcessWakeLines(
    baseEntry({
      terminal_state: 'exited',
      output: {
        path: 'runtime/logs/shell/x/output.log',
        exists: true,
        size: 13,
        mtime_ms: 0,
        growth_bytes: null,
        silent_seconds: 2,
        tail: ['done'],
      },
      heartbeat: {
        elapsed_seconds: 42,
        log_bytes: 13,
        last_output_at: '2026-09-30T18:59:58.000Z',
        beat_age_seconds: 3.7,
      },
    }),
  )

  assert.equal(
    line,
    '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z -> exited\n' +
      '  done\n' +
      '  (pan-run beat 3s ago, 42s elapsed)',
  )
})

test('formatProcessWakeLines with no output or heartbeat matches the original one-line shape', () => {
  const line = formatProcessWakeLines(baseEntry({ terminal_state: 'elapsed' }))

  assert.equal(
    line,
    '[pan watch:build] wake 3 at 2026-09-30T19:00:00.000Z -> elapsed',
  )
})

// ── formatWakeLine / formatOpenCallSuffix ───────────────────────────────────

function baseObservation(
  overrides: Partial<WatchObservation> = {},
): WatchObservation {
  return {
    observed_at: '2026-09-30T19:00:00.000Z',
    output_path: 'runtime/logs/workflows/r/agent/output.json',
    output_present: true,
    output_parses: true,
    output_matches_invocation: true,
    output_is_scaffold: false,
    output_missing_required_fields: [],
    watched_paths: [],
    fingerprint: 'abc123',
    ...overrides,
  }
}

function baseWakeEntry(
  overrides: Partial<WatchRecordEntry> = {},
): WatchRecordEntry {
  return {
    schema_version: 1,
    event: 'wake',
    run_id: 'run-1',
    invocation_id: '00_implement-1_aaaaaaaa',
    recorded_at: '2026-09-30T19:00:00.000Z',
    cadence_seconds: 60,
    wake: 3,
    changed: false,
    unchanged_wakes: 2,
    ...overrides,
  }
}

function shellOpenCallActivity(
  shellHeartbeat: ShellHeartbeat | null,
): AgentActivity {
  return {
    agent_id: 'agent-1',
    aliases: [],
    event_file: 'runtime/logs/agents/agent-1.jsonl',
    event_count: 4,
    last_event_kind: 'call_started',
    last_event_tool: 'Shell',
    last_event_at: '2026-09-30T18:59:50.000Z',
    last_event_age_seconds: 10,
    open_call: {
      tool: 'Shell',
      started_at: '2026-09-30T18:58:50.000Z',
      shell_heartbeat: shellHeartbeat,
    },
    stall_suppressed: shellHeartbeat !== null,
    stop: null,
    signature: 'sig-1',
  }
}

test('formatWakeLine is unchanged when the observation carries no agent_activity', () => {
  const line = formatWakeLine(baseWakeEntry({ observation: baseObservation() }))

  assert.equal(
    line,
    '[pan watch:00_implement-1_aaaaaaaa] wake 3 at 2026-09-30T19:00:00.000Z: ' +
      'output present, unchanged x2',
  )
})

test('formatWakeLine appends the open-call suffix when agent_activity carries a linked shell heartbeat', () => {
  const activity = shellOpenCallActivity({
    record_path: 'runtime/logs/shell/x/record.json',
    heartbeat_at: '2026-09-30T18:59:55.000Z',
    age_seconds: 5,
    label: 'npm',
    pid: 4242,
    elapsed_seconds: 65,
    log_bytes: 128,
    last_output_at: '2026-09-30T18:59:55.000Z',
    recent_lines: ['compiling', 'done'],
  })
  const line = formatWakeLine(
    baseWakeEntry({
      observation: baseObservation({ agent_activity: activity }),
    }),
  )

  assert.match(
    line,
    /open:Shell \d+s \[pan-run npm pid=4242 beat 5s ago: done\]$/u,
  )
})

test('formatOpenCallSuffix names a shell open call with no linked record', () => {
  const activity = shellOpenCallActivity(null)

  assert.match(
    formatOpenCallSuffix(activity),
    /^ open:Shell \d+s \[no pan-run heartbeat\]$/u,
  )
})

test('formatOpenCallSuffix omits the heartbeat bracket for a non-shell open call', () => {
  const activity: AgentActivity = {
    agent_id: 'agent-1',
    aliases: [],
    event_file: 'runtime/logs/agents/agent-1.jsonl',
    event_count: 2,
    last_event_kind: 'call_started',
    last_event_tool: 'Read',
    last_event_at: '2026-09-30T18:59:50.000Z',
    last_event_age_seconds: 10,
    open_call: {
      tool: 'Read',
      started_at: '2026-09-30T18:59:40.000Z',
      shell_heartbeat: null,
    },
    stall_suppressed: true,
    stop: null,
    signature: 'sig-2',
  }

  assert.match(formatOpenCallSuffix(activity), /^ open:Read \d+s$/u)
})

test('formatOpenCallSuffix is empty with no open call', () => {
  assert.equal(formatOpenCallSuffix(null), '')
  assert.equal(formatOpenCallSuffix(undefined), '')
})
