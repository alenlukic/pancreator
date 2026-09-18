import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { abortRun, getRunState } from '../../src/lib/engine.js'
import { initHorizonSession } from '../../src/lib/horizon.js'
import {
  installScheduleAgent,
  refreshScheduleAlerts,
  runScheduledJob,
  scheduleStatus,
  scheduleTick,
  validateSchedule,
} from '../../src/lib/schedule.js'
import type { ScheduleJob } from '../../src/lib/types.js'
import { createFixture, read, writeJson } from '../helpers.js'
import { checkpoint } from './delivery-helpers.js'

/** A job bound to a managed worktree rather than a workspace directory. */
function worktreeJob(id: string, worktree: string): ScheduleJob {
  const { workspace: _workspace, ...rest } = scheduledJob(id)
  return { ...rest, worktree }
}

function ledgerLines(root: string, id: string): string[] {
  const file = path.join(root, 'runtime/logs/schedule', `${id}.jsonl`)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trimEnd().split('\n').filter(Boolean)
}

function scheduledJob(
  id: string,
  overrides: Partial<ScheduleJob> = {},
): ScheduleJob {
  return {
    id,
    enabled: true,
    hour: 10,
    minute: 0,
    timezone: 'UTC',
    workspace: '.',
    action: { kind: 'command', command: 'true' },
    ...overrides,
  }
}

function configure(
  root: string,
  jobs: ScheduleJob[],
  overrides: Record<string, unknown> = {},
): void {
  const config = read(path.join(root, 'config.json')) as Record<string, unknown>
  writeJson(path.join(root, 'config.json'), {
    ...config,
    schedule: {
      enabled: true,
      catch_up_window_minutes: 30,
      grace_period_minutes: 30,
      jobs,
      ...overrides,
    },
  })
}

test('tick records fire, catch-up, drop, skip, and action failure outcomes', () => {
  const root = createFixture()
  configure(root, [
    scheduledJob('fired', { hour: 10, minute: 10 }),
    scheduledJob('caught-up'),
    scheduledJob('dropped', { catch_up_window_minutes: 5 }),
    scheduledJob('skipped', { enabled: false }),
    scheduledJob('failed'),
  ])

  assert.deepEqual(validateSchedule(root), { status: 'passed', jobs: 5 })

  // The launch agent polls every 300 s, so a real tick carries seconds and
  // milliseconds. An on-time start must still record `fired` at that instant.
  const tick = scheduleTick(root, {
    now: new Date('2026-01-05T10:10:02.137Z'),
    executeAction: (_root, job) => ({
      ok: job.id !== 'failed',
      reason:
        job.id === 'failed' ? 'action failed deliberately' : 'action passed',
      ...(job.id === 'failed' ? { exit_status: 7 } : {}),
    }),
  })

  assert.deepEqual(
    Object.fromEntries(
      tick.decisions.map((entry) => [entry.job_id, entry.outcome]),
    ),
    {
      fired: 'fired',
      'caught-up': 'caught_up',
      dropped: 'dropped',
      skipped: 'skipped',
      failed: 'failed',
    },
  )
  const failed = JSON.parse(
    readFileSync(
      path.join(root, 'runtime/logs/schedule/failed.jsonl'),
      'utf8',
    ).trim(),
  ) as Record<string, unknown>
  assert.deepEqual(
    {
      job_id: failed.job_id,
      occurrence_at: failed.occurrence_at,
      outcome: failed.outcome,
      reason: failed.reason,
      exit_status: failed.exit_status,
    },
    {
      job_id: 'failed',
      occurrence_at: '2026-01-05T10:00:00.000Z',
      outcome: 'failed',
      reason: 'action failed deliberately',
      exit_status: 7,
    },
  )
})

test('a deferred occurrence waits for the holding run and then starts', () => {
  const held = checkpoint('delivery@created')
  const root = held.root
  configure(root, [scheduledJob('busy')])
  const refuse = () => {
    throw new Error('a deferred action must not execute')
  }

  const tick = scheduleTick(root, {
    now: new Date('2026-01-05T10:05:00.000Z'),
    executeAction: refuse,
  })
  assert.equal(tick.decisions[0]?.outcome, 'deferred')
  assert.match(tick.decisions[0]?.reason ?? '', new RegExp(held.runId, 'u'))

  const second = scheduleTick(root, {
    now: new Date('2026-01-05T10:06:00.000Z'),
    executeAction: refuse,
  })
  assert.equal(second.decisions[0]?.outcome, 'deferred')
  // The standing deferral is the same decision, so the ledger keeps one line.
  assert.equal(ledgerLines(root, 'busy').length, 1)

  abortRun(root, held.runId, 'released for the scheduled job')

  let started = 0
  const resumed = scheduleTick(root, {
    now: new Date('2026-01-05T10:10:00.000Z'),
    executeAction: () => {
      started += 1
      return { ok: true, reason: 'the released occurrence ran' }
    },
  })

  assert.equal(started, 1)
  assert.equal(resumed.decisions[0]?.outcome, 'caught_up')
  assert.equal(resumed.decisions[0]?.occurrence_at, '2026-01-05T10:00:00.000Z')
})

test('workflow jobs keep card attestation opt-in and record ladder pauses', () => {
  const root = createFixture()
  configure(root, [
    scheduledJob('ladder', {
      hour: 10,
      minute: 10,
      action: {
        kind: 'workflow',
        workflow: 'delivery',
        request_path: 'request.md',
      },
    }),
  ])
  let attestation: boolean | undefined
  let drives = 0

  const tick = scheduleTick(root, {
    now: new Date('2026-01-05T10:10:02.137Z'),
    // `operator_only` stays false so the typed ladder pause is the only clause
    // that can stop the away loop. Without that guard the loop would ask the
    // away evaluator to advance the blocker and drive the run again.
    driveWorkflow: (_root, runId, options) => {
      attestation = options?.attestSupervisorCard
      drives += 1
      return {
        state: {
          ...getRunState(root, runId),
          horizon_ladder: {
            retries_spent: 0,
            strategy_switches_spent: 0,
            replans_spent: 0,
            last_failure_signature: [],
            approaches_tried: [],
            pause_kind: 'ladder_exhausted' as const,
          },
        },
        stop: {
          type: 'operator_pause',
          action: 'operator_decision',
          stage: 'verify',
          operator_only: false,
          reason: 'ladder exhausted',
        },
        handoff_reason: 'ladder exhausted',
        steps: 1,
        decisions_applied: [],
        last_autostart: null,
        supervisor_card_attested_by: null,
      }
    },
  })

  assert.equal(attestation, false)
  assert.equal(drives, 1)
  assert.equal(tick.decisions[0]?.outcome, 'failed')
  assert.equal(tick.decisions[0]?.reason, 'ladder exhausted')
})

test('an opted-in prompt writes the inbox request and starts a run', () => {
  const root = createFixture()
  configure(root, [
    scheduledJob('plain-text', {
      hour: 10,
      minute: 10,
      action: {
        kind: 'prompt',
        prompt: 'Prepare the scheduled plain-text report.',
        workflow: 'delivery',
        attest_supervisor_card: true,
      },
    }),
  ])
  let attestation: boolean | undefined

  const tick = scheduleTick(root, {
    now: new Date('2026-01-05T10:10:02.137Z'),
    driveWorkflow: (_root, runId, options) => {
      attestation = options?.attestSupervisorCard
      return {
        state: getRunState(root, runId),
        stop: { type: 'terminal', status: 'succeeded' },
        handoff_reason: null,
        steps: 1,
        decisions_applied: [],
        last_autostart: null,
        supervisor_card_attested_by: 'schedule:plain-text',
      }
    },
  })

  const record = tick.decisions[0]
  assert.equal(attestation, true)
  assert.equal(record?.outcome, 'fired')
  assert.ok(record?.run_id)
  const run = getRunState(root, record?.run_id as string)
  assert.equal(
    run.request.source_path,
    'runtime/inbox/active/schedule-plain-text-20260105101000000.md',
  )
  assert.equal(
    readFileSync(path.join(root, run.request.stored_path), 'utf8'),
    'Prepare the scheduled plain-text report.\n',
  )
})

test('an alert opens without a success, survives the next occurrence, and clears only on one', () => {
  const root = createFixture()
  configure(root, [scheduledJob('dead-man')])
  const historyPath = path.join(root, 'runtime/logs/schedule/alerts.jsonl')
  const history = () => readFileSync(historyPath, 'utf8')

  const opened = refreshScheduleAlerts(
    root,
    new Date('2026-01-05T11:00:00.001Z'),
  )
  assert.equal(opened.alerts[0]?.job_id, 'dead-man')
  assert.match(history(), /"event":"opened"/u)

  // Absence of success is the trigger, so the next scheduled occurrence must
  // not report a recovery that never happened.
  const nextOccurrence = refreshScheduleAlerts(
    root,
    new Date('2026-01-06T10:00:30.000Z'),
  )
  assert.deepEqual(nextOccurrence.alerts, opened.alerts)
  assert.equal(/"event":"cleared"/u.test(history()), false)

  const completed = runScheduledJob(root, 'dead-man', {
    now: new Date('2026-01-06T10:01:00.000Z'),
    executeAction: () => ({ ok: true, reason: 'manual recovery succeeded' }),
  })
  assert.deepEqual(completed.alerts.alerts, [])
  assert.deepEqual(scheduleStatus(root), completed.alerts)
  assert.match(history(), /"event":"cleared"/u)
})

test('a damaged job records its own failure without stopping its peers', () => {
  const torn = createFixture()
  configure(torn, [scheduledJob('alpha'), scheduledJob('beta')])
  mkdirSync(path.join(torn, 'runtime/logs/schedule'), { recursive: true })
  writeFileSync(
    path.join(torn, 'runtime/logs/schedule/alpha.jsonl'),
    '{"schema_version":1,"job_id":"alpha","occurrence_at":"2026-01-0\n',
  )

  const tick = scheduleTick(torn, {
    now: new Date('2026-01-05T10:02:00.000Z'),
    executeAction: () => ({ ok: true, reason: 'the stub action succeeded' }),
  })

  assert.deepEqual(
    Object.fromEntries(
      tick.decisions.map((entry) => [entry.job_id, entry.outcome]),
    ),
    { alpha: 'fired', beta: 'fired' },
  )
  assert.equal(tick.decisions[0]?.damaged_ledger_lines, 1)
  assert.equal(
    existsSync(path.join(torn, 'runtime/logs/schedule/alerts.json')),
    true,
  )

  const unresolvable = createFixture()
  configure(unresolvable, [
    worktreeJob('broken', 'never-created'),
    scheduledJob('healthy'),
  ])

  const second = scheduleTick(unresolvable, {
    now: new Date('2026-01-05T10:02:00.000Z'),
    executeAction: () => ({ ok: true, reason: 'the stub action succeeded' }),
  })

  assert.equal(second.decisions[0]?.outcome, 'failed')
  assert.match(second.decisions[0]?.reason ?? '', /never-created/u)
  assert.equal(second.decisions[1]?.outcome, 'fired')
  assert.equal(ledgerLines(unresolvable, 'broken').length, 1)
  assert.equal(
    existsSync(path.join(unresolvable, 'runtime/logs/schedule/alerts.json')),
    true,
  )
})

test('a handled occurrence is reported again but recorded once', () => {
  const root = createFixture()
  configure(root, [scheduledJob('daily')])
  let started = 0
  const action = () => {
    started += 1
    return { ok: true, reason: 'the stub action succeeded' }
  }

  scheduleTick(root, {
    now: new Date('2026-01-05T10:00:02.137Z'),
    executeAction: action,
  })
  const polled = scheduleTick(root, {
    now: new Date('2026-01-05T10:05:01.004Z'),
    executeAction: action,
  })

  assert.equal(started, 1)
  assert.equal(polled.decisions[0]?.outcome, 'skipped')
  assert.equal(ledgerLines(root, 'daily').length, 1)
})

test('a session job checks its queue targets and receives the job workspace', () => {
  const root = createFixture()
  mkdirSync(path.join(root, 'runtime/inbox/queue'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime/inbox/queue/session-task.md'),
    '# Session task\n',
  )
  const task = {
    id: 'first',
    title: 'first task',
    kind: 'workflow',
    workflow: 'planning',
    request_path: 'runtime/inbox/queue/session-task.md',
  }
  const writeQueue = (extra: Record<string, unknown>): void => {
    writeJson(path.join(root, 'runtime/queue.json'), {
      schema_version: 1,
      tasks: [{ ...task, ...extra }],
    })
  }
  configure(root, [
    scheduledJob('session', {
      action: { kind: 'session', queue_path: 'runtime/queue.json' },
    }),
  ])

  writeQueue({ workspace: 'elsewhere' })
  assert.throws(() => validateSchedule(root), /targets a different workspace/u)

  writeQueue({})
  assert.deepEqual(validateSchedule(root), { status: 'passed', jobs: 1 })

  // A task that names no target inherits the scheduled job's workspace.
  const session = initHorizonSession(root, 'runtime/queue.json', {
    workspace: 'chosen',
  })
  assert.equal(session.tasks[0]?.workspace, 'chosen')
})

test('a failed launch agent load removes the plist it rendered', () => {
  const root = createFixture()
  const home = path.join(root, 'operator-home')
  const plist = path.join(
    home,
    'Library/LaunchAgents/com.pancreator.schedule.plist',
  )
  mkdirSync(path.dirname(plist), { recursive: true })

  assert.throws(
    () =>
      installScheduleAgent(root, {
        platform: 'darwin',
        home,
        runLaunchctl: () => ({ status: 1 }),
      }),
    /rerun 'pan schedule install-agent'/u,
  )
  assert.equal(existsSync(plist), false)
})
