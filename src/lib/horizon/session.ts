/**
 * Long-horizon session types, the session and handoff files, and the small
 * helpers every horizon module shares.
 */

import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { PanError } from '../errors.js'
import {
  fileExists,
  readJson,
  isRecord,
  writeJsonAtomic,
  appendJsonLine,
  resolveInside,
  writeTextAtomic,
} from '../io.js'
import type { SupervisorBootstrap } from '../governance/supervisor-card.js'
import type { RunState, RunContract } from '../types.js'
import { eligibleHorizonTask } from './queue.js'

export const HORIZON_ROOT = path.join('runtime', 'logs', 'horizon')
export const HORIZON_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

export type HorizonTaskKind = 'workflow' | 'prompt'
export type HorizonTaskStatus =
  | 'pending'
  | 'running'
  | 'replanning'
  | 'succeeded'
  | 'failed'
  | 'deferred'
  | 'blocked'
  | 'excluded'

export interface HorizonTask {
  id: string
  title: string
  kind: HorizonTaskKind
  workflow?: string
  request_path?: string
  prompt?: string
  workspace?: string
  worktree?: string
  grants?: Array<{ name: string; path: string }>
  depends_on: string[]
  status: HorizonTaskStatus
  /**
   * Durable copy of the request the first run stored. `createRun` claims an
   * inbox item by moving it out of the queue, so a task the third rung
   * returns to `pending` reopens against this copy rather than against a
   * path the earlier run already consumed.
   */
  request_stored_path: string | null
  run_id: string | null
  replan_run_id: string | null
  result_path: string | null
  /**
   * Where the task's work went after its own run: the delivery run or the
   * cohort session that approving its plan started. The task finishes when
   * the route finishes, not when the planning run does. Absent on records
   * written before routes were tracked, which read as no route.
   */
  route?: HorizonTaskRoute | null
  ladder: {
    retries_spent: number
    strategy_switches_spent: number
    replans_spent: number
    last_failure_signature: string[]
  }
}

export interface HorizonTaskRoute {
  kind: 'delivery' | 'cohort'
  /** The single delivery run, for a `delivery` route. */
  run_id: string | null
  cohort_id: string | null
  /** The release run the last cohort integration started, once it exists. */
  release_run_id: string | null
  /** The route failed to start; the manual commands complete it. */
  failed: { error: string; manual_commands: string[] } | null
}

/** The role one live run plays inside a task. */
export type HorizonLiveRunRole =
  | 'task'
  | 'replan'
  | 'delivery'
  | 'chunk'
  | 'release'

/**
 * One run the session's supervisor owes attention to right now, with the
 * bootstrap command set the supervisor otherwise rebuilds by hand.
 */
export interface HorizonLiveRun extends SupervisorBootstrap {
  role: HorizonLiveRunRole
  chunk: string | null
  status: RunState['status']
  current_stage: string | null
  pending_action: RunState['pending_action']
  pause_reason: string | null
  worktree: string | null
  horizon_ladder: RunState['horizon_ladder'] | null
}

/** Cohort commands the route offers at this moment, or null when none apply. */
export interface HorizonRouteCommands {
  start_command: string | null
  integrate_command: string | null
  record_abandoned_cohort_command: string | null
  release_command: string | null
  manual_commands: string[]
}

export interface HorizonRouteProgress {
  route: HorizonTaskRoute
  finished: boolean
  /** A terminal failure on the route the supervisor has to reason about. */
  stopped: string | null
  live_runs: HorizonLiveRun[]
  commands: HorizonRouteCommands
}

export interface HorizonBoundaryRecord {
  sequence: number
  handoff_consumed: string | null
  task_opened: string
  process_id: number
  recorded_at: string
}

export interface HorizonSessionState {
  schema_version: 1
  session_id: string
  created_at: string
  updated_at: string
  involvement_profile: string
  contracts: RunContract[]
  status: 'created' | 'running' | 'succeeded' | 'empty' | 'abandoned'
  preflight: {
    selected_mode: string
    away_mode_armed: boolean
    away_mode_override: {
      setting: 'away_mode.enabled'
      applied_value: true
      reason: string
    }
    card_attestation_authorized: boolean
    armed_at: string | null
  }
  tasks: HorizonTask[]
  edges: Array<{ from: string; to: string }>
  active_task_id: string | null
  handoff_sequence: number
  latest_handoff: string | null
  boundaries: HorizonBoundaryRecord[]
}

export interface HorizonQueueTaskInput {
  id: string
  title: string
  kind: HorizonTaskKind
  workflow?: string
  request_path?: string
  prompt?: string
  workspace?: string
  worktree?: string
  grants?: Array<{ name: string; path: string }>
  depends_on?: string[]
}

export interface HorizonQueueInput {
  schema_version?: 1
  involvement_profile?: string
  tasks: HorizonQueueTaskInput[]
  edges?: Array<{ from: string; to: string }>
}

export interface HorizonNextResult {
  session: HorizonSessionState
  task: HorizonTask | null
  run: RunState | null
  prompt_result?: { ok: boolean; artifact_path: string; error?: string }
}

export function now(): string {
  return new Date().toISOString()
}

export function fail(message: string): never {
  throw new PanError(message, { code: 'INVALID_HORIZON_STATE' })
}

export function horizonDir(root: string, sessionId: string): string {
  if (!HORIZON_ID.test(sessionId)) {
    fail(`Invalid horizon session id: ${sessionId}`)
  }

  return path.join(root, HORIZON_ROOT, sessionId)
}

export function sessionPath(root: string, sessionId: string): string {
  return path.join(horizonDir(root, sessionId), 'session.json')
}

export function mutexPath(root: string, sessionId: string): string {
  return path.join(horizonDir(root, sessionId), '.operation-mutex')
}

export function requireString(value: unknown, source: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${source} MUST be a non-empty string.`)
  }

  return value
}

export function parseStringArray(value: unknown, source: string): string[] {
  if (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  ) {
    return (value ?? []) as string[]
  }

  fail(`${source} MUST be a string array.`)
}

export function loadHorizonSession(
  root: string,
  sessionId: string,
): HorizonSessionState {
  const file = sessionPath(root, sessionId)

  if (!fileExists(file)) {
    fail(`Unknown horizon session: ${sessionId}`)
  }

  const value = readJson(file)

  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    !Array.isArray(value.tasks)
  ) {
    fail(`${file} MUST contain a horizon schema version 1 record.`)
  }

  return value as unknown as HorizonSessionState
}

export function persistHorizonSession(
  root: string,
  state: HorizonSessionState,
  event: string,
  details: Record<string, unknown> = {},
): HorizonSessionState {
  const next = { ...state, updated_at: now() }
  writeJsonAtomic(sessionPath(root, state.session_id), next)
  appendJsonLine(
    path.join(horizonDir(root, state.session_id), 'events.jsonl'),
    {
      schema_version: 1,
      event_id: randomUUID(),
      event,
      session_id: state.session_id,
      recorded_at: next.updated_at,
      ...details,
    },
  )
  return next
}

export function writeHandoff(
  root: string,
  state: HorizonSessionState,
  transition: string,
  lastTaskId: string | null,
): HorizonSessionState {
  const sequence = state.handoff_sequence + 1
  const relative = path.posix.join(
    HORIZON_ROOT,
    state.session_id,
    'handoffs',
    `${String(sequence).padStart(4, '0')}.json`,
  )
  const absolute = resolveInside(root, relative)

  const openDeferrals = state.tasks
    .filter((task) => task.status === 'deferred')
    .map((task) => task.id)
  const eligible = eligibleHorizonTask(state)
  const nextAction = eligible
    ? `Open task '${eligible.id}' in a new driver process.`
    : state.active_task_id
      ? `Checkpoint active task '${state.active_task_id}'.`
      : 'No eligible task remains.'
  const handoff = {
    schema_version: 1,
    session_id: state.session_id,
    sequence,
    transition,
    last_task_id: lastTaskId,
    queue: state.tasks.map((task) => ({
      id: task.id,
      status: task.status,
      depends_on: task.depends_on,
      run_id: task.run_id,
    })),
    open_deferrals: openDeferrals,
    next_action: nextAction,
    recorded_at: now(),
  }

  writeJsonAtomic(absolute, handoff)
  writeTextAtomic(
    absolute.replace(/\.json$/u, '.md'),
    `# Horizon handoff ${sequence}\n\n` +
      `**Transition:** ${transition}\n\n` +
      `**Last task:** ${lastTaskId ?? 'none'}\n\n` +
      `**Open deferrals:** ${openDeferrals.join(', ') || 'none'}\n\n` +
      `**Next action:** ${nextAction}\n`,
  )

  return { ...state, handoff_sequence: sequence, latest_handoff: relative }
}
