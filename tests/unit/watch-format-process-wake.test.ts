import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatProcessWakeLines,
  type GenericWatchRecordEntry,
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
