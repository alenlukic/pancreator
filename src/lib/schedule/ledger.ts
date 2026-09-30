/**
 * Scheduler constants and record shapes, schedule occurrence arithmetic,
 * schedule configuration, and the per-job decision ledger.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import type { driveRun } from '../headless-driver.js'
import { resolveInside, fileExists, appendJsonLine } from '../io.js'
import { loadProjectConfig } from '../project-config.js'
import type { ScheduleJob, ScheduleConfig } from '../types.js'

export const SCHEDULE_ROOT = path.posix.join('runtime', 'logs', 'schedule')
const DEFAULT_CATCH_UP_WINDOW_MINUTES = 360
const DEFAULT_GRACE_PERIOD_MINUTES = 60
export const MINUTE_MS = 60_000
const MAX_OCCURRENCE_SCAN_MINUTES = 8 * 24 * 60
/**
 * An occurrence started within one trigger interval of its scheduled minute is
 * on time. `library/templates/launchd-schedule.plist` polls every 300 seconds,
 * so a tick practically never lands on the scheduled second, and a stricter
 * test would label every real start a catch-up.
 */
export const ON_TIME_START_TOLERANCE_MS = 5 * MINUTE_MS
export const LAUNCH_AGENT_LABEL = 'com.pancreator.schedule'

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

export function alertsPath(root: string): string {
  return resolveInside(root, path.posix.join(SCHEDULE_ROOT, 'alerts.json'))
}

export function alertHistoryPath(root: string): string {
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

export function recordDecision(
  root: string,
  record: ScheduleDecisionRecord,
): ScheduleDecisionRecord {
  appendJsonLine(jobLedgerPath(root, record.job_id), record)
  return record
}
