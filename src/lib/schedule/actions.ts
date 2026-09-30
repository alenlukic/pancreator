/**
 * Scheduled action execution: target resolution, the workflow and horizon
 * session actions, and the decision record each action produces.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { createRun } from '../engine/create-run.js'
import { invariant } from '../errors.js'
import { driveRun } from '../headless-driver.js'
import { initHorizonSession } from '../horizon/lifecycle.js'
import { parseHorizonQueue } from '../horizon/queue.js'
import { writeTextAtomic, resolveInside, readJson } from '../io.js'
import { listRunStatesWhere, runIsLive } from '../state.js'
import type {
  ScheduleJob,
  ManagedWorktreeReference,
  ScheduleAction,
} from '../types.js'
import { resolveWorktreeWorkspace } from '../worktree/create.js'
import { readWorktreeIndex } from '../worktree/registry.js'
import type {
  ScheduleActionResult,
  ScheduleDecisionRecord,
  ScheduleOutcome,
  ScheduleRuntime,
} from './ledger.js'

/**
 * Resolve a scheduled job's target: its managed worktree when it names one,
 * otherwise its workspace path resolved against the harness root. Throws
 * `PanError` `INVALID_SCHEDULE` for an unregistered worktree name.
 */
export function targetForJob(
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

/**
 * The id of a live run bound to the job's target workspace, or null when no
 * live run occupies it.
 */
export function occupyingRun(root: string, job: ScheduleJob): string | null {
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
  const driven = (runtime.driveWorkflow ?? driveRun)(root, run.run_id, {
    attestSupervisorCard: action.attest_supervisor_card ?? false,
    attestedBy: `schedule:${job.id}`,
  })
  const ok =
    driven.stop.type === 'terminal' && driven.stop.status === 'succeeded'

  if (driven.stop.type === 'operator_pause') {
    // No supervisor runs inside a scheduled job, so the run waits for one.
    return {
      ok: false,
      run_id: run.run_id,
      reason:
        `Workflow run '${run.run_id}' waits for a supervisor decision ` +
        `(${driven.stop.action} at stage '${driven.stop.stage}'). ` +
        `Resume it with /pan-resume ${run.run_id}.`,
    }
  }

  return {
    ok,
    run_id: run.run_id,
    reason: ok
      ? `Workflow run '${run.run_id}' succeeded.`
      : (driven.handoff_reason ??
        `Workflow run '${run.run_id}' stopped as ${driven.stop.type}.`),
  }
}

/**
 * Check that every task in a session job's horizon queue that names a
 * workspace or worktree targets the job's own workspace. Throws `PanError`
 * `INVALID_SCHEDULE` for a mismatch and `INVALID_JSON` for an unreadable queue.
 */
export function validateSessionTarget(
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
      // A scheduled job has no chat open, so the harness-owned driver is the
      // supervisor here and the session arbiter reasons about every stop.
      '--headless',
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

/**
 * Perform one scheduled occurrence and report whether it succeeded. A
 * `command` action runs through the shell in the target directory; a
 * `session` action starts a headless long-horizon session through `bin/pan`;
 * a `workflow` or `prompt` action creates a run (writing the prompt request
 * into the inbox queue first) and drives it headless. Subprocesses time out
 * after 24 hours.
 */
export function executeScheduleAction(
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

/**
 * Build the schedule decision record for one occurrence, carrying the run id,
 * session id, and exit status from the action result when present and the
 * damaged ledger line count when non-zero.
 */
export function decision(
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
