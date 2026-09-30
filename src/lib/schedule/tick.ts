/**
 * The scheduler tick and its per-job decision, schedule alerts, schedule
 * validation and status, and the launch agent install and uninstall.
 */

import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { errorMessage, invariant, PanError } from '../errors.js'
import { parseHorizonQueue } from '../horizon/queue.js'
import {
  fileExists,
  readJson,
  appendJsonLine,
  writeJsonAtomic,
  resolveInside,
  ensureDir,
  writeTextAtomic,
} from '../io.js'
import {
  loadPipelineConfig,
  resolvePersonaMapping,
} from '../pipeline-config.js'
import { isSelfDevelopmentInstallation } from '../project-config.js'
import type { ScheduleJob } from '../types.js'
import { loadWorkflow, workflowPersonaNames } from '../workflow.js'
import {
  LAUNCH_AGENT_LABEL,
  MINUTE_MS,
  ON_TIME_START_TOLERANCE_MS,
  SCHEDULE_ROOT,
  alertHistoryPath,
  alertsPath,
  mostRecentScheduleOccurrence,
  readScheduleHistory,
  readScheduleLedger,
  recordDecision,
  resolveScheduleConfig,
  type ScheduleActionResult,
  type ScheduleAlert,
  type ScheduleAlertFile,
  type ScheduleDecisionRecord,
  type ScheduleOutcome,
  type ScheduleRuntime,
} from './ledger.js'
import {
  decision,
  executeScheduleAction,
  occupyingRun,
  targetForJob,
  validateSessionTarget,
} from './actions.js'

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
    job.self_development_only &&
    !isSelfDevelopmentInstallation(root)
  ) {
    const reason =
      'The job is self_development_only and this is not a self_development installation.'
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

  if (job.self_development_only && !isSelfDevelopmentInstallation(root)) {
    return {
      open: false,
      reason:
        'The job is self_development_only and this is not a self_development installation.',
      lastSuccessAt: null,
      disabled: true,
    }
  }

  const history = readScheduleHistory(root, job.id)

  // An immediate alert on a failed decision: open at once when the latest
  // decision is 'failed', cleared only by a later success.
  const successes = history.filter((entry) =>
    ['fired', 'caught_up'].includes(entry.outcome),
  )
  const lastSuccess = successes.at(-1)?.recorded_at ?? null
  const failures = history.filter((entry) => entry.outcome === 'failed')
  const lastFailure = failures.at(-1)

  if (
    lastFailure !== undefined &&
    (lastSuccess === null ||
      Date.parse(lastFailure.recorded_at) > Date.parse(lastSuccess))
  ) {
    return {
      open: true,
      reason: lastFailure.reason ?? 'The most recent run failed.',
      lastSuccessAt: lastSuccess,
      disabled: false,
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
