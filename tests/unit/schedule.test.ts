import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { loadProjectConfig } from '../../src/lib/project-config.js'
import {
  installScheduleAgent,
  mostRecentScheduleOccurrence,
  parseHorizonSessionStatus,
  refreshScheduleAlerts,
  scheduleTick,
} from '../../src/lib/schedule.js'
import type { ScheduleJob } from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

function commandJob(overrides: Partial<ScheduleJob> = {}): ScheduleJob {
  return {
    id: 'daily',
    enabled: true,
    hour: 10,
    minute: 0,
    timezone: 'UTC',
    workspace: '.',
    action: { kind: 'command', command: 'true' },
    ...overrides,
  }
}

function writeSchedule(root: string, jobs: ScheduleJob[]): void {
  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        schedule: {
          enabled: true,
          catch_up_window_minutes: 30,
          grace_period_minutes: 30,
          jobs,
        },
      },
      null,
      2,
    )}\n`,
  )
}

test('schedule configuration accepts four actions and rejects malformed jobs', () => {
  const root = createTestTempDirectory('pancreator-schedule-config-')
  writeSchedule(root, [
    commandJob(),
    commandJob({
      id: 'workflow',
      action: {
        kind: 'workflow',
        workflow: 'planning',
        request_path: 'runtime/inbox/queue/request.md',
      },
    }),
    commandJob({
      id: 'session',
      action: { kind: 'session', queue_path: 'runtime/queue.json' },
    }),
    commandJob({
      id: 'prompt',
      action: { kind: 'prompt', prompt: 'Prepare the report.' },
    }),
  ])

  assert.deepEqual(
    loadProjectConfig(root).schedule?.jobs.map((job) => job.action),
    [
      { kind: 'command', command: 'true' },
      {
        kind: 'workflow',
        workflow: 'planning',
        request_path: 'runtime/inbox/queue/request.md',
      },
      { kind: 'session', queue_path: 'runtime/queue.json' },
      { kind: 'prompt', prompt: 'Prepare the report.' },
    ],
  )
})

test('schedule configuration rejects each malformed rule by name', () => {
  const root = createTestTempDirectory('pancreator-schedule-invalid-')
  const cases: [string, unknown, RegExp][] = [
    [
      'both targets',
      [{ ...commandJob(), worktree: 'also-set' }],
      /exactly one of workspace or worktree/u,
    ],
    [
      'no target',
      [{ ...commandJob(), workspace: '   ' }],
      /exactly one of workspace or worktree/u,
    ],
    ['duplicate id', [commandJob(), commandJob()], /duplicates 'daily'/u],
    [
      'hour out of range',
      [commandJob({ hour: 24 })],
      /hour MUST be an integer/u,
    ],
    [
      'minute out of range',
      [commandJob({ minute: 60 })],
      /minute MUST be an integer/u,
    ],
    [
      'repeated weekday',
      [commandJob({ weekdays: [1, 1] })],
      /weekdays MUST contain unique integers/u,
    ],
    [
      'unknown timezone',
      [commandJob({ timezone: 'Mars/Olympus' })],
      /timezone MUST be a valid IANA timezone/u,
    ],
    [
      'negative window',
      [commandJob({ catch_up_window_minutes: -1 })],
      /catch_up_window_minutes MUST be a non-negative integer/u,
    ],
    [
      'field the kind does not allow',
      [
        {
          ...commandJob(),
          action: { kind: 'command', command: 'true', workflow: 'planning' },
        },
      ],
      /unsupported fields for 'command'/u,
    ],
    [
      'workflow action without a request',
      [
        {
          ...commandJob(),
          action: { kind: 'workflow', workflow: 'planning' },
        },
      ],
      /non-empty workflow and request_path/u,
    ],
    [
      'prompt action without text',
      [{ ...commandJob(), action: { kind: 'prompt', prompt: '  ' } }],
      /prompt MUST be non-empty/u,
    ],
  ]

  for (const [label, jobs, expected] of cases) {
    writeFileSync(
      path.join(root, 'config.json'),
      JSON.stringify({
        schema_version: 1,
        schedule: { enabled: true, jobs },
      }),
    )
    assert.throws(() => loadProjectConfig(root), expected, label)
  }
})

test('occurrences resolve in the declared IANA timezone and weekday', () => {
  const occurrence = mostRecentScheduleOccurrence(
    commandJob({
      hour: 9,
      minute: 30,
      weekdays: [1],
      timezone: 'America/New_York',
    }),
    new Date('2026-01-05T14:45:00.000Z'),
  )

  assert.equal(occurrence.toISOString(), '2026-01-05T14:30:00.000Z')
})

test('an omitted timezone resolves the occurrence in the machine local zone', () => {
  const at = new Date('2026-01-05T14:45:00.000Z')
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const wallClock = {
    hour: Number(parts.find((part) => part.type === 'hour')?.value),
    minute: Number(parts.find((part) => part.type === 'minute')?.value),
  }

  // The host wall clock of `at` must resolve back to `at` itself. A fallback
  // pinned to UTC instead of the machine zone misses on any offset host.
  assert.equal(
    mostRecentScheduleOccurrence(wallClock, at).toISOString(),
    at.toISOString(),
  )
  assert.equal(
    mostRecentScheduleOccurrence(wallClock, at).toISOString(),
    mostRecentScheduleOccurrence(
      {
        ...wallClock,
        timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      at,
    ).toISOString(),
  )
})

test('a horizon session status decodes only from a well-formed payload', () => {
  assert.equal(
    parseHorizonSessionStatus('{"session_id":"s","status":"succeeded"}'),
    'succeeded',
  )
  // `empty` is the session verdict when a task did not succeed, so the caller
  // must see it rather than a success.
  assert.equal(parseHorizonSessionStatus('{"status":"empty"}'), 'empty')
  assert.equal(parseHorizonSessionStatus('not json'), null)
  assert.equal(parseHorizonSessionStatus('{"status":7}'), null)
  assert.equal(parseHorizonSessionStatus('null'), null)
})

test('catch-up runs through its boundary and drops the first instant past it', () => {
  const atBoundary = createTestTempDirectory('pancreator-schedule-window-')
  writeSchedule(atBoundary, [commandJob()])
  const caughtUp = scheduleTick(atBoundary, {
    now: new Date('2026-01-05T10:30:00.000Z'),
    executeAction: () => ({ ok: true, reason: 'test action succeeded' }),
  })
  assert.equal(caughtUp.decisions[0]?.outcome, 'caught_up')

  const pastBoundary = createTestTempDirectory('pancreator-schedule-window-')
  writeSchedule(pastBoundary, [commandJob()])
  const dropped = scheduleTick(pastBoundary, {
    now: new Date('2026-01-05T10:30:00.001Z'),
    executeAction: () => ({ ok: true, reason: 'must not run' }),
  })
  assert.equal(dropped.decisions[0]?.outcome, 'dropped')
})

test('an absent success opens an alert only after window plus grace', () => {
  const root = createTestTempDirectory('pancreator-schedule-alert-')
  writeSchedule(root, [commandJob()])

  const boundary = refreshScheduleAlerts(
    root,
    new Date('2026-01-05T11:00:00.000Z'),
  )
  assert.deepEqual(boundary.alerts, [])

  const overdue = refreshScheduleAlerts(
    root,
    new Date('2026-01-05T11:00:00.001Z'),
  )
  assert.equal(overdue.alerts[0]?.job_id, 'daily')
  assert.match(overdue.alerts[0]?.reason ?? '', /No success/u)
})

test('the launch agent installer refuses non-macOS hosts with the portable entry point', () => {
  const root = createTestTempDirectory('pancreator-schedule-agent-')
  assert.throws(
    () => installScheduleAgent(root, { platform: 'linux' }),
    /pan schedule tick/u,
  )
})
