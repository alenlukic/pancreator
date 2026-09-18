import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { createRun } from './engine.js'
import { PanError, errorMessage, invariant } from './errors.js'
import { driveRun } from './headless-driver.js'
import {
  driveRunUnderAwayMode,
  initHorizonSession,
  parseHorizonQueue,
} from './horizon.js'
import {
  appendJsonLine,
  ensureDir,
  fileExists,
  readJson,
  resolveInside,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import { loadPipelineConfig, resolvePersonaMapping } from './pipeline-config.js'
import { loadProjectConfig } from './project-config.js'
import { listRunStatesWhere, runIsLive } from './state.js'
import type {
  ManagedWorktreeReference,
  ScheduleAction,
  ScheduleConfig,
  ScheduleJob,
} from './types.js'
import { loadWorkflow, workflowPersonaNames } from './workflow.js'
import { readWorktreeIndex, resolveWorktreeWorkspace } from './worktrees.js'

const SCHEDULE_ROOT = path.posix.join('runtime', 'logs', 'schedule')
const DEFAULT_CATCH_UP_WINDOW_MINUTES = 360
const DEFAULT_GRACE_PERIOD_MINUTES = 60
const MINUTE_MS = 60_000
const MAX_OCCURRENCE_SCAN_MINUTES = 8 * 24 * 60
/**
 * An occurrence started within one trigger interval of its scheduled minute is
 * on time. `library/templates/launchd-schedule.plist` polls every 300 seconds,
 * so a tick practically never lands on the scheduled second, and a stricter
 * test would label every real start a catch-up.
 */
const ON_TIME_START_TOLERANCE_MS = 5 * MINUTE_MS
const LAUNCH_AGENT_LABEL = 'com.pancreator.schedule'

export type ScheduleOutcome =
  | 'fired'
  | 'caught_up'
  | 'deferred'
  | 'dropped'
  | 'skipped'
  | 'failed'

export interface ScheduleDecisionRecord {
  schema_version: 1
  job_id: string
  occurrence_at: string
  outcome: ScheduleOutcome
  reason: string
  recorded_at: string
  run_id?: string
  session_id?: string
  exit_status?: number | null
  damaged_ledger_lines?: number
}

export interface ScheduleAlert {
  job_id: string
  opened_at: string
  reason: string
  last_success_at: string | null
}

export interface ScheduleAlertFile {
  schema_version: 1
  updated_at: string
  alerts: ScheduleAlert[]
}

export interface ScheduleActionResult {
  ok: boolean
  reason: string
  run_id?: string
  session_id?: string
  exit_status?: number | null
}

export interface ScheduleRuntime {
  now?: Date
  driveWorkflow?: typeof driveRun
  executeAction?: (
    root: string,
    job: ScheduleJob,
    occurrence: Date,
  ) => ScheduleActionResult
}

const weekdayNumbers: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/**
 * One formatter per zone. An occurrence scan walks up to eight days of
 * candidate minutes, so a formatter built per candidate dominated the scan.
 */
function formatter(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? ''
  const cached = formatters.get(key)

  if (cached) {
    return cached
  }

  const created = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  formatters.set(key, created)
  return created
}

function localScheduleParts(
  instant: Date,
  timeZone?: string,
): { weekday: number; hour: number; minute: number } {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  return {
    weekday: weekdayNumbers[values.weekday ?? ''] ?? -1,
    hour: Number(values.hour),
    minute: Number(values.minute),
  }
}

/** Most recent real minute that matches a job's wall-clock schedule. */
export function mostRecentScheduleOccurrence(
  job: Pick<ScheduleJob, 'hour' | 'minute' | 'weekdays' | 'timezone'>,
  at: Date,
): Date {
  const candidate = new Date(at)
  candidate.setUTCSeconds(0, 0)
  const weekdays = job.weekdays ? new Set<number>(job.weekdays) : null

  for (let scanned = 0; scanned <= MAX_OCCURRENCE_SCAN_MINUTES; scanned += 1) {
    const parts = localScheduleParts(candidate, job.timezone)

    if (
      parts.hour === job.hour &&
      parts.minute === job.minute &&
      (!weekdays || weekdays.has(parts.weekday))
    ) {
      return candidate
    }

    candidate.setTime(candidate.getTime() - MINUTE_MS)
  }

  throw new PanError(
    `No occurrence found for scheduled job within eight days.`,
    {
      code: 'SCHEDULE_OCCURRENCE_NOT_FOUND',
    },
  )
}

export function resolveScheduleConfig(root: string): Required<
  Pick<ScheduleConfig, 'enabled' | 'jobs'>
> & {
  catch_up_window_minutes: number
  grace_period_minutes: number
} {
  const configured = loadProjectConfig(root).schedule

  return {
    enabled: configured?.enabled ?? false,
    catch_up_window_minutes:
      configured?.catch_up_window_minutes ?? DEFAULT_CATCH_UP_WINDOW_MINUTES,
    grace_period_minutes:
      configured?.grace_period_minutes ?? DEFAULT_GRACE_PERIOD_MINUTES,
    jobs: configured?.jobs ?? [],
  }
}

function jobLedgerPath(root: string, jobId: string): string {
  return resolveInside(root, path.posix.join(SCHEDULE_ROOT, `${jobId}.jsonl`))
}

function alertsPath(root: string): string {
  return resolveInside(root, path.posix.join(SCHEDULE_ROOT, 'alerts.json'))
}

function alertHistoryPath(root: string): string {
  return resolveInside(root, path.posix.join(SCHEDULE_ROOT, 'alerts.jsonl'))
}

/**
 * Decisions a job's ledger holds, and the number of lines that did not parse.
 * A torn append is the ordinary outcome of a crash mid-write, and one damaged
 * line must not hide the healthy records from a tick that only needs them;
 * `listRunStates` skips an unreadable run record for the same reason. The
 * caller carries `damaged` into its next decision record so the damage stays
 * visible to an operator reading the ledger.
 */
export function readScheduleLedger(
  root: string,
  jobId: string,
): { records: ScheduleDecisionRecord[]; damaged: number } {
  const ledger = jobLedgerPath(root, jobId)

  if (!fileExists(ledger)) {
    return { records: [], damaged: 0 }
  }

  const records: ScheduleDecisionRecord[] = []
  let damaged = 0

  for (const line of readFileSync(ledger, 'utf8').split('\n')) {
    if (line.trim().length === 0) {
      continue
    }

    try {
      records.push(JSON.parse(line) as ScheduleDecisionRecord)
    } catch {
      damaged += 1
    }
  }

  return { records, damaged }
}

export function readScheduleHistory(
  root: string,
  jobId: string,
): ScheduleDecisionRecord[] {
  return readScheduleLedger(root, jobId).records
}

function recordDecision(
  root: string,
  record: ScheduleDecisionRecord,
): ScheduleDecisionRecord {
  appendJsonLine(jobLedgerPath(root, record.job_id), record)
  return record
}

function targetForJob(
  root: string,
  job: ScheduleJob,
): {
  absolute: string
  workspace: string | null
  worktree: ManagedWorktreeReference | null
} {
  if (job.worktree) {
    const record = readWorktreeIndex(root).worktrees.find(
      (candidate) => candidate.name === job.worktree,
    )
    invariant(record, `Unknown scheduled worktree: ${job.worktree}`, {
      code: 'INVALID_SCHEDULE',
    })
    const workspace = resolveWorktreeWorkspace(root, job.worktree)
    return {
      absolute: path.resolve(root, workspace),
      workspace: workspace,
      worktree: record,
    }
  }

  const workspace = job.workspace as string
  return {
    absolute: path.isAbsolute(workspace)
      ? path.resolve(workspace)
      : path.resolve(root, workspace),
    workspace,
    worktree: null,
  }
}

function occupyingRun(root: string, job: ScheduleJob): string | null {
  const target = targetForJob(root, job).absolute
  // The workspace binding never moves through the write-ahead log, so the
  // prefilter drops every unrelated run without replaying its event log.
  // Liveness is not such a field and stays on the loaded state.
  const occupied = listRunStatesWhere(
    root,
    (materialized) =>
      path.resolve(root, materialized.workspace_root || '.') === target,
  ).find((state) => runIsLive(state))
  return occupied?.run_id ?? null
}

function promptRequestPath(job: ScheduleJob, occurrence: Date): string {
  const instant = occurrence.toISOString().replaceAll(/[^0-9]/gu, '')
  return path.posix.join(
    'runtime',
    'inbox',
    'queue',
    `schedule-${job.id}-${instant}.md`,
  )
}

function runWorkflowAction(
  root: string,
  job: ScheduleJob,
  occurrence: Date,
  action: Extract<ScheduleAction, { kind: 'workflow' | 'prompt' }>,
  runtime: ScheduleRuntime,
): ScheduleActionResult {
  const target = targetForJob(root, job)
  const requestPath =
    action.kind === 'prompt'
      ? promptRequestPath(job, occurrence)
      : action.request_path

  if (action.kind === 'prompt') {
    writeTextAtomic(resolveInside(root, requestPath), action.prompt)
  }

  const run = createRun(root, {
    workflowSlug:
      action.kind === 'prompt'
        ? (action.workflow ?? 'planning')
        : action.workflow,
    requestPath,
    title: `Scheduled job ${job.id}`,
    workspace: target.worktree ? target.worktree.path : target.workspace,
    worktree: target.worktree,
    involvement: action.involvement,
    verification: action.verification,
    pipelineConfigName: action.pipeline_config,
  })
  const attempt = driveRunUnderAwayMode(
    root,
    run.run_id,
    {
      attestSupervisorCard: action.attest_supervisor_card ?? false,
      attestedBy: `schedule:${job.id}`,
    },
    runtime.driveWorkflow ?? driveRun,
  )

  if (attempt.blocked !== null) {
    return { ok: false, run_id: run.run_id, reason: attempt.blocked }
  }

  const driven = attempt.driven
  const ok =
    driven.stop.type === 'terminal' && driven.stop.status === 'succeeded'

  return {
    ok,
    run_id: run.run_id,
    reason: ok
      ? `Workflow run '${run.run_id}' succeeded.`
      : (driven.handoff_reason ??
        `Workflow run '${run.run_id}' stopped as ${driven.stop.type}.`),
  }
}

function validateSessionTarget(
  root: string,
  job: ScheduleJob,
  action: Extract<ScheduleAction, { kind: 'session' }>,
): void {
  const queue = parseHorizonQueue(
    readJson(resolveInside(root, action.queue_path)),
    action.queue_path,
  )
  const expected = targetForJob(root, job).absolute

  for (const task of queue.tasks) {
    if (!task.workspace && !task.worktree) {
      continue
    }

    const actual = task.worktree
      ? path.resolve(root, resolveWorktreeWorkspace(root, task.worktree))
      : path.isAbsolute(task.workspace as string)
        ? path.resolve(task.workspace as string)
        : path.resolve(root, task.workspace as string)
    invariant(
      actual === expected,
      `Scheduled session job '${job.id}' task '${task.id}' targets a different workspace.`,
      { code: 'INVALID_SCHEDULE' },
    )
  }
}

/**
 * Terminal status a `pan horizon start --json` run reported. Subprocess output
 * is untrusted text, so an unparsable payload is no status at all.
 */
export function parseHorizonSessionStatus(stdout: string): string | null {
  let output: unknown

  try {
    output = JSON.parse(stdout)
  } catch {
    return null
  }

  return output !== null &&
    typeof output === 'object' &&
    'status' in output &&
    typeof output.status === 'string'
    ? output.status
    : null
}

function runSessionAction(
  root: string,
  job: ScheduleJob,
  action: Extract<ScheduleAction, { kind: 'session' }>,
): ScheduleActionResult {
  validateSessionTarget(root, job, action)

  const target = targetForJob(root, job)
  const session = initHorizonSession(root, action.queue_path, {
    involvement: action.involvement,
    ...(target.worktree
      ? { worktree: target.worktree.name }
      : target.workspace
        ? { workspace: target.workspace }
        : {}),
  })
  const command = spawnSync(
    path.join(root, 'bin', 'pan'),
    [
      'horizon',
      'start',
      session.session_id,
      '--attest-supervisor-card',
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 86_400_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  )

  const terminalStatus =
    !command.error && command.status === 0
      ? parseHorizonSessionStatus(command.stdout)
      : null
  // `empty` is the session's verdict when a task did not succeed, so only
  // `succeeded` counts as the scheduled job having done its work.
  const ok = terminalStatus === 'succeeded'

  return {
    ok,
    session_id: session.session_id,
    exit_status: command.status,
    reason: ok
      ? `Long-horizon session '${session.session_id}' succeeded.`
      : `Long-horizon session '${session.session_id}' failed or deferred: ${command.error?.message ?? command.stderr.trim() ?? terminalStatus ?? `exit ${String(command.status)}`}`,
  }
}

function executeScheduleAction(
  root: string,
  job: ScheduleJob,
  occurrence: Date,
  runtime: ScheduleRuntime,
): ScheduleActionResult {
  const action = job.action

  if (action.kind === 'command') {
    const target = targetForJob(root, job)
    const command = spawnSync(action.command, {
      cwd: target.absolute,
      encoding: 'utf8',
      shell: true,
      timeout: 86_400_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    const ok = !command.error && command.status === 0
    return {
      ok,
      exit_status: command.status,
      reason: ok
        ? 'Command completed successfully.'
        : `Command failed: ${command.error?.message ?? command.stderr.trim() ?? `exit ${String(command.status)}`}`,
    }
  }

  if (action.kind === 'session') {
    return runSessionAction(root, job, action)
  }

  return runWorkflowAction(root, job, occurrence, action, runtime)
}

function decision(
  job: ScheduleJob,
  occurrence: Date,
  outcome: ScheduleOutcome,
  reason: string,
  now: Date,
  action?: ScheduleActionResult,
  damagedLedgerLines = 0,
): ScheduleDecisionRecord {
  return {
    schema_version: 1,
    job_id: job.id,
    occurrence_at: occurrence.toISOString(),
    outcome,
    reason,
    recorded_at: now.toISOString(),
    ...(action?.run_id ? { run_id: action.run_id } : {}),
    ...(action?.session_id ? { session_id: action.session_id } : {}),
    ...(action && 'exit_status' in action
      ? { exit_status: action.exit_status ?? null }
      : {}),
    ...(damagedLedgerLines > 0
      ? { damaged_ledger_lines: damagedLedgerLines }
      : {}),
  }
}

/**
 * Append the decision only when it says something the ledger does not already
 * hold for this occurrence. A poll that re-observes a standing state is not a
 * new decision, and appending one per poll would grow the ledger by the
 * trigger interval rather than by the schedule.
 */
function emit(
  root: string,
  record: ScheduleDecisionRecord,
  persist: boolean,
): ScheduleDecisionRecord {
  return persist ? recordDecision(root, record) : record
}

function alreadyRecorded(
  history: ScheduleDecisionRecord[],
  occurrence: Date,
  outcome: ScheduleOutcome,
  reason: string,
): boolean {
  const at = occurrence.toISOString()
  return history.some(
    (entry) =>
      entry.occurrence_at === at &&
      entry.outcome === outcome &&
      entry.reason === reason,
  )
}

const handledOutcomes = new Set<ScheduleOutcome>([
  'fired',
  'caught_up',
  'dropped',
  'failed',
])

function decideJob(
  root: string,
  config: ReturnType<typeof resolveScheduleConfig>,
  job: ScheduleJob,
  now: Date,
  runtime: ScheduleRuntime,
  forced: boolean,
): ScheduleDecisionRecord {
  const occurrence = forced
    ? new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS)
    : mostRecentScheduleOccurrence(job, now)
  const ledger = readScheduleLedger(root, job.id)
  const history = ledger.records
  const damaged = ledger.damaged

  if (!forced && (!config.enabled || !job.enabled)) {
    const reason = config.enabled
      ? 'The job is disabled.'
      : 'Scheduling is disabled.'
    return emit(
      root,
      decision(job, occurrence, 'skipped', reason, now, undefined, damaged),
      !alreadyRecorded(history, occurrence, 'skipped', reason),
    )
  }

  if (
    !forced &&
    history.some(
      (entry) =>
        entry.occurrence_at === occurrence.toISOString() &&
        handledOutcomes.has(entry.outcome),
    )
  ) {
    // The occurrence already has its durable decision. Reporting the skip to
    // the caller keeps the tick's own answer complete without a second record.
    return emit(
      root,
      decision(
        job,
        occurrence,
        'skipped',
        'The occurrence was already handled.',
        now,
        undefined,
        damaged,
      ),
      false,
    )
  }

  const windowMinutes =
    job.catch_up_window_minutes ?? config.catch_up_window_minutes
  const age = now.getTime() - occurrence.getTime()

  if (!forced && age > windowMinutes * MINUTE_MS) {
    return emit(
      root,
      decision(
        job,
        occurrence,
        'dropped',
        `The occurrence is older than its ${windowMinutes}-minute catch-up window.`,
        now,
        undefined,
        damaged,
      ),
      true,
    )
  }

  const busyRun = occupyingRun(root, job)

  if (busyRun) {
    const reason = `Run '${busyRun}' already holds the target workspace.`
    return emit(
      root,
      decision(job, occurrence, 'deferred', reason, now, undefined, damaged),
      !alreadyRecorded(history, occurrence, 'deferred', reason),
    )
  }

  let action: ScheduleActionResult

  try {
    action = runtime.executeAction
      ? runtime.executeAction(root, job, occurrence)
      : executeScheduleAction(root, job, occurrence, runtime)
  } catch (error) {
    action = { ok: false, reason: errorMessage(error) }
  }

  const outcome: ScheduleOutcome = action.ok
    ? forced || age <= ON_TIME_START_TOLERANCE_MS
      ? 'fired'
      : 'caught_up'
    : 'failed'
  return emit(
    root,
    decision(job, occurrence, outcome, action.reason, now, action, damaged),
    true,
  )
}

function readAlerts(root: string): ScheduleAlertFile {
  const file = alertsPath(root)

  if (!fileExists(file)) {
    return {
      schema_version: 1,
      updated_at: new Date(0).toISOString(),
      alerts: [],
    }
  }

  return readJson(file) as ScheduleAlertFile
}

function alertReason(
  root: string,
  config: ReturnType<typeof resolveScheduleConfig>,
  job: ScheduleJob,
  now: Date,
): {
  open: boolean
  reason: string
  lastSuccessAt: string | null
  disabled: boolean
} {
  if (!config.enabled || !job.enabled) {
    return {
      open: false,
      reason: 'Scheduling or the job is disabled.',
      lastSuccessAt: null,
      disabled: true,
    }
  }

  const occurrence = mostRecentScheduleOccurrence(job, now)
  const previous = mostRecentScheduleOccurrence(
    job,
    new Date(occurrence.getTime() - MINUTE_MS),
  )
  const interval = occurrence.getTime() - previous.getTime()

  const window =
    (job.catch_up_window_minutes ?? config.catch_up_window_minutes) * MINUTE_MS
  const grace =
    (job.grace_period_minutes ?? config.grace_period_minutes) * MINUTE_MS

  const successes = readScheduleHistory(root, job.id).filter((entry) =>
    ['fired', 'caught_up'].includes(entry.outcome),
  )
  const lastSuccess = successes.at(-1)?.recorded_at ?? null

  const overdue = lastSuccess
    ? now.getTime() - Date.parse(lastSuccess) > interval + window + grace
    : now.getTime() - occurrence.getTime() > window + grace

  return {
    open: overdue,
    reason: lastSuccess
      ? `The most recent success is older than the schedule interval plus its window and grace period.`
      : `No success was recorded before the catch-up window and grace period expired.`,
    lastSuccessAt: lastSuccess,
    disabled: false,
  }
}

export function refreshScheduleAlerts(
  root: string,
  now = new Date(),
): ScheduleAlertFile {
  const config = resolveScheduleConfig(root)
  const current = readAlerts(root)
  const existing = new Map(current.alerts.map((alert) => [alert.job_id, alert]))
  const next: ScheduleAlert[] = []

  for (const job of config.jobs) {
    const open = existing.get(job.id)
    let status: ReturnType<typeof alertReason>

    try {
      status = alertReason(root, config, job, now)
    } catch {
      // A job the evaluator cannot read keeps whatever notice it already has.
      // Its own decision record carries the diagnostic, and the peers of a
      // damaged job still get their alerts refreshed.
      if (open) {
        next.push(open)
      }

      continue
    }

    if (status.open) {
      const alert =
        open ??
        ({
          job_id: job.id,
          opened_at: now.toISOString(),
          reason: status.reason,
          last_success_at: status.lastSuccessAt,
        } satisfies ScheduleAlert)
      next.push(alert)

      if (!open) {
        appendJsonLine(alertHistoryPath(root), {
          event: 'opened',
          ...alert,
          recorded_at: now.toISOString(),
        })
      }

      continue
    }

    if (!open) {
      continue
    }

    // Absence of success is the trigger, so only a success recorded after the
    // alert opened clears it. The overdue predicate of a job that never ran is
    // measured from the newest occurrence and goes false at every scheduled
    // minute, which would otherwise report a recovery that never happened.
    const clearedReason = status.disabled
      ? status.reason
      : status.lastSuccessAt !== null &&
          Date.parse(status.lastSuccessAt) >= Date.parse(open.opened_at)
        ? 'A success was recorded after the alert opened.'
        : null

    if (clearedReason === null) {
      next.push(open)
      continue
    }

    appendJsonLine(alertHistoryPath(root), {
      event: 'cleared',
      job_id: job.id,
      opened_at: open.opened_at,
      last_success_at: status.lastSuccessAt,
      reason: clearedReason,
      recorded_at: now.toISOString(),
    })
  }

  const configuredIds = new Set(config.jobs.map((job) => job.id))

  for (const alert of current.alerts) {
    if (!configuredIds.has(alert.job_id)) {
      appendJsonLine(alertHistoryPath(root), {
        event: 'cleared',
        job_id: alert.job_id,
        opened_at: alert.opened_at,
        last_success_at: alert.last_success_at,
        reason: 'The job is no longer configured.',
        recorded_at: now.toISOString(),
      })
    }
  }

  const result: ScheduleAlertFile = {
    schema_version: 1,
    updated_at: now.toISOString(),
    alerts: next,
  }
  writeJsonAtomic(alertsPath(root), result)
  return result
}

export function scheduleTick(
  root: string,
  runtime: ScheduleRuntime = {},
): { decisions: ScheduleDecisionRecord[]; alerts: ScheduleAlertFile } {
  const now = runtime.now ?? new Date()
  const config = resolveScheduleConfig(root)
  const decisions = config.jobs.map((job) => {
    try {
      return decideJob(root, config, job, now, runtime, false)
    } catch (error) {
      // One job the tick cannot evaluate must not hide its peers or stop the
      // dead-man refresh, so its failure becomes that job's own record. A
      // standing failure repeats in the returned report but not in the ledger.
      const reason = `The job could not be evaluated: ${errorMessage(error)}`
      const occurrence = new Date(
        Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS,
      )
      const ledger = readScheduleLedger(root, job.id)
      const last = ledger.records.at(-1)
      return emit(
        root,
        decision(
          job,
          occurrence,
          'failed',
          reason,
          now,
          undefined,
          ledger.damaged,
        ),
        !(last?.outcome === 'failed' && last.reason === reason),
      )
    }
  })
  return { decisions, alerts: refreshScheduleAlerts(root, now) }
}

export function runScheduledJob(
  root: string,
  jobId: string,
  runtime: ScheduleRuntime = {},
): { decision: ScheduleDecisionRecord; alerts: ScheduleAlertFile } {
  const now = runtime.now ?? new Date()
  const config = resolveScheduleConfig(root)
  const job = config.jobs.find((candidate) => candidate.id === jobId)
  invariant(job, `Unknown scheduled job: ${jobId}`, {
    code: 'SCHEDULE_JOB_NOT_FOUND',
  })
  const result = decideJob(root, config, job, now, runtime, true)
  return { decision: result, alerts: refreshScheduleAlerts(root, now) }
}

export function scheduleStatus(root: string): ScheduleAlertFile {
  return readAlerts(root)
}

export function validateSchedule(root: string): {
  status: 'passed'
  jobs: number
} {
  const config = resolveScheduleConfig(root)

  for (const job of config.jobs) {
    targetForJob(root, job)
    const action = job.action

    if (action.kind === 'command') {
      continue
    }

    if (action.kind === 'session') {
      validateSessionTarget(root, job, action)

      const queue = parseHorizonQueue(
        readJson(resolveInside(root, action.queue_path)),
        action.queue_path,
      )
      const pipeline = loadPipelineConfig(root)

      for (const task of queue.tasks) {
        if (task.kind !== 'workflow') {
          continue
        }

        const workflow = loadWorkflow(root, task.workflow ?? 'planning')
        invariant(
          task.request_path !== undefined &&
            existsSync(resolveInside(root, task.request_path)),
          `Scheduled session job '${job.id}' task '${task.id}' request does not exist: ${task.request_path ?? '(missing)'}`,
          { code: 'INVALID_SCHEDULE' },
        )

        for (const persona of workflowPersonaNames(workflow)) {
          resolvePersonaMapping(pipeline.config, persona)
        }
      }

      continue
    }

    const workflow = loadWorkflow(
      root,
      action.kind === 'prompt'
        ? (action.workflow ?? 'planning')
        : action.workflow,
    )
    const pipeline = loadPipelineConfig(
      root,
      action.pipeline_config ?? undefined,
    )

    for (const persona of workflowPersonaNames(workflow)) {
      resolvePersonaMapping(pipeline.config, persona)
    }

    if (action.kind === 'workflow') {
      invariant(
        existsSync(resolveInside(root, action.request_path)),
        `Scheduled job '${job.id}' request does not exist: ${action.request_path}`,
        { code: 'INVALID_SCHEDULE' },
      )
    }
  }

  return { status: 'passed', jobs: config.jobs.length }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function installScheduleAgent(
  root: string,
  options: {
    platform?: NodeJS.Platform
    home?: string
    runLaunchctl?: (args: string[]) => { status: number | null; error?: Error }
  } = {},
): { status: 'installed'; path: string; portable_command: string } {
  const portableCommand = `${path.join(root, 'bin', 'pan')} schedule tick`
  invariant(
    (options.platform ?? process.platform) === 'darwin',
    `install-agent is available only on macOS. Use '${portableCommand}' from any external trigger.`,
    { code: 'SCHEDULE_AGENT_UNSUPPORTED' },
  )
  const template = readFileSync(
    resolveInside(root, 'library/templates/launchd-schedule.plist'),
    'utf8',
  )
  const scheduleDirectory = resolveInside(root, SCHEDULE_ROOT)
  ensureDir(scheduleDirectory)
  const target = path.join(
    options.home ?? homedir(),
    'Library',
    'LaunchAgents',
    `${LAUNCH_AGENT_LABEL}.plist`,
  )
  const rendered = template
    .replaceAll('{{LABEL}}', LAUNCH_AGENT_LABEL)
    .replaceAll('{{PROGRAM}}', xmlEscape(path.join(root, 'bin', 'pan')))
    .replaceAll('{{WORKING_DIRECTORY}}', xmlEscape(root))
    .replaceAll(
      '{{STDOUT_PATH}}',
      xmlEscape(path.join(scheduleDirectory, 'agent.stdout.log')),
    )
    .replaceAll(
      '{{STDERR_PATH}}',
      xmlEscape(path.join(scheduleDirectory, 'agent.stderr.log')),
    )
  writeTextAtomic(target, rendered)

  const launchctl =
    options.runLaunchctl ??
    ((args: string[]) => {
      const result = spawnSync('launchctl', args, { encoding: 'utf8' })
      return {
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      }
    })
  const loaded = launchctl(['load', target])

  if (loaded.error || loaded.status !== 0) {
    // A rendered plist the operator never asked to keep is partial state on
    // their host, so the failed install removes what it wrote.
    rmSync(target, { force: true })
    throw new PanError(
      `launchctl failed to load ${target}. The rendered plist was removed; rerun 'pan schedule install-agent' once the cause is fixed.`,
      { code: 'SCHEDULE_AGENT_INSTALL_FAILED' },
    )
  }
  return {
    status: 'installed',
    path: target,
    portable_command: portableCommand,
  }
}

export function uninstallScheduleAgent(
  _root: string,
  options: {
    platform?: NodeJS.Platform
    home?: string
    runLaunchctl?: (args: string[]) => { status: number | null; error?: Error }
  } = {},
): { status: 'uninstalled'; path: string } {
  invariant(
    (options.platform ?? process.platform) === 'darwin',
    `uninstall-agent is available only on macOS.`,
    { code: 'SCHEDULE_AGENT_UNSUPPORTED' },
  )
  const target = path.join(
    options.home ?? homedir(),
    'Library',
    'LaunchAgents',
    `${LAUNCH_AGENT_LABEL}.plist`,
  )

  if (fileExists(target)) {
    const launchctl =
      options.runLaunchctl ??
      ((args: string[]) => {
        const result = spawnSync('launchctl', args, { encoding: 'utf8' })
        return {
          status: result.status,
          ...(result.error ? { error: result.error } : {}),
        }
      })
    const unloaded = launchctl(['unload', target])
    invariant(
      !unloaded.error && unloaded.status === 0,
      `launchctl failed to unload ${target}.`,
      { code: 'SCHEDULE_AGENT_UNINSTALL_FAILED' },
    )
    rmSync(target, { force: true })
  }

  return { status: 'uninstalled', path: target }
}
