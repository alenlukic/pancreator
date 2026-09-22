import { randomUUID } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { errorMessage, PanError } from './errors.js'
import { buildGovernanceCard } from './governance-card.js'
import { driveRun, type HeadlessDriverResult } from './headless-driver.js'
import {
  ensureDir,
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  withOperationMutex,
  writeJsonAtomic,
  writeTextAtomic,
  appendJsonLine,
} from './io.js'
import {
  loadOperatorInvolvementFile,
  selectInvolvementProfile,
} from './operator-involvement.js'
import {
  createRun,
  getRunState,
  pauseRun,
  recordHorizonReplan,
} from './engine.js'
import { loadPipelineConfig, resolvePersonaMapping } from './pipeline-config.js'
import { panCommand } from './project-config.js'
import { runCursorAgentSession } from './executors/cursor-agent.js'
import {
  awayBlockerCanBeCleared,
  awayModeTrigger,
  OPERATOR_QUESTION_REFUSAL,
  recordAwayApplyResult,
  selectAwayOption,
  type AwayDecisionRecord,
  type AwayOption,
} from './away-mode.js'
import { applyAwayDecision, evaluateAwayState } from './away-orchestration.js'
import {
  appendArbiterRecord,
  applyArbiterAction,
  arbitrateHorizonStop,
  type ArbiterAction,
  type ArbitrateOptions,
  type HorizonHardBlock,
} from './horizon-arbiter.js'
import { resolveOrCreateWorktree } from './worktrees.js'
import { isProtectedWorkspacePath } from './workspace/protected-paths.js'
import { resolveWriteSandbox } from './executors/write-sandbox.js'
import {
  cohortSessionForPlanRun,
  cohortStatus,
  integrateCohort,
  releaseCohort,
  startCohort,
  type CohortStatusView,
} from './cohorts.js'
import {
  supervisorBootstrap,
  type SupervisorBootstrap,
} from './governance/supervisor-card.js'
import type { RunContract, RunState } from './types.js'

const HORIZON_ROOT = path.join('runtime', 'logs', 'horizon')
const HORIZON_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

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

function now(): string {
  return new Date().toISOString()
}

function fail(message: string): never {
  throw new PanError(message, { code: 'INVALID_HORIZON_STATE' })
}

function horizonDir(root: string, sessionId: string): string {
  if (!HORIZON_ID.test(sessionId)) {
    fail(`Invalid horizon session id: ${sessionId}`)
  }

  return path.join(root, HORIZON_ROOT, sessionId)
}

function sessionPath(root: string, sessionId: string): string {
  return path.join(horizonDir(root, sessionId), 'session.json')
}

function mutexPath(root: string, sessionId: string): string {
  return path.join(horizonDir(root, sessionId), '.operation-mutex')
}

function requireString(value: unknown, source: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${source} MUST be a non-empty string.`)
  }

  return value
}

function parseStringArray(value: unknown, source: string): string[] {
  if (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  ) {
    return (value ?? []) as string[]
  }

  fail(`${source} MUST be a string array.`)
}

/** Parse and validate a queue before any session state is written. */
export function parseHorizonQueue(
  value: unknown,
  source = 'horizon queue',
): HorizonQueueInput {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0
  ) {
    fail(`${source}.tasks MUST contain at least one task.`)
  }

  const tasks = value.tasks.map((task, index): HorizonQueueTaskInput => {
    const item = `${source}.tasks[${index}]`

    if (!isRecord(task)) {
      fail(`${item} MUST be an object.`)
    }

    const kind = task.kind

    if (kind !== 'workflow' && kind !== 'prompt') {
      fail(`${item}.kind MUST be 'workflow' or 'prompt'.`)
    }

    const parsed: HorizonQueueTaskInput = {
      id: requireString(task.id, `${item}.id`),
      title: requireString(task.title, `${item}.title`),
      kind,
      depends_on: parseStringArray(task.depends_on, `${item}.depends_on`),
      ...(typeof task.workflow === 'string' ? { workflow: task.workflow } : {}),
      ...(typeof task.request_path === 'string'
        ? { request_path: task.request_path }
        : {}),
      ...(typeof task.prompt === 'string' ? { prompt: task.prompt } : {}),
      ...(typeof task.workspace === 'string'
        ? { workspace: task.workspace }
        : {}),
      ...(typeof task.worktree === 'string' ? { worktree: task.worktree } : {}),
      ...(Array.isArray(task.grants)
        ? {
            grants: task.grants.map((grant, grantIndex) => {
              if (!isRecord(grant)) {
                fail(`${item}.grants[${grantIndex}] MUST be an object.`)
              }

              return {
                name: requireString(
                  grant.name,
                  `${item}.grants[${grantIndex}].name`,
                ),
                path: requireString(
                  grant.path,
                  `${item}.grants[${grantIndex}].path`,
                ),
              }
            }),
          }
        : {}),
    }

    // A task id names an inbox file, a prompt card, and a deferral record,
    // so it is refused at parse time under the session-id pattern rather
    // than at the first write that interpolates it.
    if (!HORIZON_ID.test(parsed.id)) {
      fail(`${item}.id MUST match ${HORIZON_ID.source}.`)
    }

    if (kind === 'workflow' && !parsed.request_path) {
      fail(`${item}.request_path is required for a workflow task.`)
    }

    if (kind === 'prompt' && !parsed.prompt) {
      fail(`${item}.prompt is required for a prompt task.`)
    }

    if (parsed.workspace && parsed.worktree) {
      fail(`${item} MUST NOT set both workspace and worktree.`)
    }

    return parsed
  })
  const ids = tasks.map((task) => task.id)

  if (new Set(ids).size !== ids.length) {
    fail(`${source}.tasks contains a duplicate task id.`)
  }

  const edges = Array.isArray(value.edges)
    ? value.edges.map((edge, index) => {
        if (!isRecord(edge)) {
          fail(`${source}.edges[${index}] MUST be an object.`)
        }

        return {
          from: requireString(edge.from, `${source}.edges[${index}].from`),
          to: requireString(edge.to, `${source}.edges[${index}].to`),
        }
      })
    : []
  const known = new Set(ids)

  for (const task of tasks) {
    for (const dependency of task.depends_on ?? []) {
      if (!known.has(dependency)) {
        fail(`Task '${task.id}' depends on unknown task '${dependency}'.`)
      }
    }
  }

  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) {
      fail(
        `Dependency edge '${edge.from} -> ${edge.to}' names an unknown task.`,
      )
    }
  }

  const merged = tasks.map((task) => ({
    ...task,
    depends_on: [
      ...new Set([
        ...(task.depends_on ?? []),
        ...edges.filter((edge) => edge.to === task.id).map((edge) => edge.from),
      ]),
    ],
  }))
  const cycle = horizonCycle(merged)

  if (cycle) {
    fail(`Horizon queue contains a dependency cycle: ${cycle.join(' -> ')}.`)
  }

  return {
    schema_version: 1,
    ...(typeof value.involvement_profile === 'string'
      ? { involvement_profile: value.involvement_profile }
      : {}),
    tasks: merged,
    edges: merged.flatMap((task) =>
      (task.depends_on ?? []).map((dependency) => ({
        from: dependency,
        to: task.id,
      })),
    ),
  }
}

/** Return one named dependency cycle, including the repeated closing node. */
export function horizonCycle(
  tasks: ReadonlyArray<Pick<HorizonQueueTaskInput, 'id' | 'depends_on'>>,
): string[] | null {
  const dependencies = new Map(
    tasks.map((task) => [task.id, task.depends_on ?? []]),
  )
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []

  const visit = (taskId: string): string[] | null => {
    if (visiting.has(taskId)) {
      const start = stack.indexOf(taskId)
      return [...stack.slice(start), taskId]
    }

    if (visited.has(taskId)) {
      return null
    }

    visiting.add(taskId)
    stack.push(taskId)

    for (const dependency of dependencies.get(taskId) ?? []) {
      const found = visit(dependency)

      if (found) {
        return found
      }
    }

    stack.pop()
    visiting.delete(taskId)
    visited.add(taskId)
    return null
  }

  for (const task of tasks) {
    const found = visit(task.id)

    if (found) {
      return found
    }
  }

  return null
}

export function transitiveHorizonDependents(
  state: Pick<HorizonSessionState, 'tasks'>,
  taskId: string,
): string[] {
  const found = new Set<string>()
  const pending = [taskId]

  while (pending.length > 0) {
    const dependency = pending.shift() as string

    for (const task of state.tasks) {
      if (found.has(task.id) || !task.depends_on.includes(dependency)) {
        continue
      }

      found.add(task.id)
      pending.push(task.id)
    }
  }

  return state.tasks.filter((task) => found.has(task.id)).map((task) => task.id)
}

/** Select the first eligible task in declared order. */
export function eligibleHorizonTask(
  state: Pick<HorizonSessionState, 'tasks'>,
): HorizonTask | null {
  const byId = new Map(state.tasks.map((task) => [task.id, task]))

  for (const task of state.tasks) {
    if (task.status !== 'pending') {
      continue
    }

    if (
      task.depends_on.every(
        (dependency) => byId.get(dependency)?.status === 'succeeded',
      )
    ) {
      return task
    }
  }

  return null
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

function persistHorizonSession(
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

function writeHandoff(
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

function newTask(task: HorizonQueueTaskInput): HorizonTask {
  return {
    ...task,
    depends_on: task.depends_on ?? [],
    status: 'pending',
    request_stored_path: null,
    run_id: null,
    replan_run_id: null,
    result_path: null,
    route: null,
    ladder: {
      retries_spent: 0,
      strategy_switches_spent: 0,
      replans_spent: 0,
      last_failure_signature: [],
    },
  }
}

export function initHorizonSession(
  root: string,
  queuePath: string,
  options: {
    sessionId?: string
    involvement?: string
    workspace?: string
    worktree?: string
  } = {},
): HorizonSessionState {
  const queue = parseHorizonQueue(
    readJson(resolveInside(root, queuePath)),
    queuePath,
  )
  const sessionId =
    options.sessionId ??
    `horizon-${new Date()
      .toISOString()
      .replaceAll(/[^0-9]/gu, '')
      .slice(0, 14)}-${randomUUID().slice(0, 8)}`
  const directory = horizonDir(root, sessionId)

  if (fileExists(directory)) {
    fail(`Horizon session already exists: ${sessionId}`)
  }

  const selected = selectInvolvementProfile(
    loadOperatorInvolvementFile(root),
    options.involvement ?? queue.involvement_profile ?? 'long-horizon',
  )

  if (!(selected.profile.contracts ?? []).includes('long_horizon')) {
    fail(
      `Involvement profile '${selected.name}' does not carry the long_horizon contract.`,
    )
  }

  ensureDir(path.join(directory, 'handoffs'))
  const created = now()
  const state: HorizonSessionState = {
    schema_version: 1,
    session_id: sessionId,
    created_at: created,
    updated_at: created,
    involvement_profile: selected.name,
    contracts: selected.profile.contracts ?? [],
    status: 'created',
    preflight: {
      selected_mode: selected.name,
      away_mode_armed: false,
      away_mode_override: {
        setting: 'away_mode.enabled',
        applied_value: true,
        reason: 'Long-horizon sessions require unattended continuation.',
      },
      card_attestation_authorized: false,
      armed_at: null,
    },
    tasks: queue.tasks.map((task) =>
      newTask(
        options.worktree && !task.workspace && !task.worktree
          ? { ...task, worktree: options.worktree }
          : options.workspace && !task.workspace && !task.worktree
            ? { ...task, workspace: options.workspace }
            : task,
      ),
    ),
    edges: queue.edges ?? [],
    active_task_id: null,
    handoff_sequence: 0,
    latest_handoff: null,
    boundaries: [],
  }

  writeJsonAtomic(sessionPath(root, sessionId), state)
  return persistHorizonSession(root, state, 'session_created', {
    queue_path: queuePath,
  })
}

export function addHorizonTask(
  root: string,
  sessionId: string,
  input: HorizonQueueTaskInput,
): HorizonSessionState {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    const state = loadHorizonSession(root, sessionId)

    if (state.tasks.some((task) => task.id === input.id)) {
      fail(`Horizon task already exists: ${input.id}`)
    }

    const parsed = parseHorizonQueue({ tasks: [...state.tasks, input] })
    const added = parsed.tasks.find(
      (task) => task.id === input.id,
    ) as HorizonQueueTaskInput
    const next = { ...state, tasks: [...state.tasks, newTask(added)] }
    return persistHorizonSession(root, next, 'task_added', {
      task_id: input.id,
    })
  })
}

export function startHorizonSession(
  root: string,
  sessionId: string,
  options: { attestSupervisorCard: boolean },
): HorizonSessionState {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    const state = loadHorizonSession(root, sessionId)

    if (!options.attestSupervisorCard) {
      fail(
        `Horizon preflight requires --attest-supervisor-card for session '${sessionId}'.`,
      )
    }

    if (state.status !== 'created') {
      return state
    }

    const armed = writeHandoff(
      root,
      {
        ...state,
        status: 'running',
        preflight: {
          ...state.preflight,
          away_mode_armed: true,
          card_attestation_authorized: true,
          armed_at: now(),
        },
      },
      'started',
      null,
    )
    return persistHorizonSession(root, armed, 'session_started', {
      involvement_profile: armed.involvement_profile,
      away_mode_armed: true,
      card_attestation_authorized: true,
    })
  })
}

function writePromptRequest(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
): string {
  const relative = path.posix.join(
    'runtime',
    'inbox',
    'queue',
    `horizon-${state.session_id}-${task.id}.md`,
  )
  writeTextAtomic(
    resolveInside(root, relative),
    `${task.prompt?.trim() ?? ''}\n`,
  )
  return relative
}

function pathInside(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate)

  return (
    relative.length === 0 ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..')
  )
}

/**
 * Classes the fallback observation skips, named in its own evidence.
 *
 * A Git internal directory records the repository's own bookkeeping rather
 * than a file the task authored, and a protected class is outside agent
 * remit by policy. Neither is a tree the check can quietly drop: a reader
 * of the result sees exactly what was and was not looked at.
 */
const PROMPT_TASK_SKIPPED_CLASSES = ['.git', 'protected-paths'] as const

/**
 * Fingerprint every path a prompt task could change outside its granted
 * roots, for the hosts where the write boundary cannot be enforced.
 *
 * This walk is the fallback, not the primary control. It observes the whole
 * harness root with no tree excluded, because an excluded tree is a change
 * that can happen while the result reports a clean pass. That completeness
 * costs a full stat of the root and cannot tell this agent's write from a
 * concurrent run's, which is why an enforced boundary is preferred wherever
 * the platform offers one.
 */
function promptTaskScopeSnapshot(
  root: string,
  grantedRoots: string[],
): Map<string, string> {
  const observed = new Map<string, string>()
  const pending = [root]

  for (
    let directory = pending.pop();
    directory !== undefined;
    directory = pending.pop()
  ) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')

      if (
        entry.name === '.git' ||
        isProtectedWorkspacePath(relative) ||
        grantedRoots.some((granted) => pathInside(absolute, granted))
      ) {
        continue
      }

      // A symbolic link is neither followed nor fingerprinted: following one
      // can leave the root or cycle, and the target itself is observed where
      // it actually lives.
      if (entry.isDirectory()) {
        pending.push(absolute)
      } else if (entry.isFile()) {
        const stats = statSync(absolute)

        observed.set(relative, `${String(stats.size)}:${String(stats.mtimeMs)}`)
      }
    }
  }

  return observed
}

function promptTaskChangedPaths(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const changed = new Set<string>()

  for (const [relative, fingerprint] of before) {
    if (after.get(relative) !== fingerprint) {
      changed.add(relative)
    }
  }

  for (const relative of after.keys()) {
    if (!before.has(relative)) {
      changed.add(relative)
    }
  }

  return [...changed].sort()
}

/**
 * Where one prompt task runs, and the widest root it is granted by default.
 *
 * A task that declares neither a worktree nor a workspace runs in its own
 * session runtime directory. The harness root was the earlier default, and it
 * handed an unattended launch write reach over the whole installation;
 * `HORIZON-001` now requires an explicit named grant for anything that wide.
 */
function promptTaskWorkspace(
  root: string,
  task: HorizonTask,
  sessionRuntime: string,
): string {
  if (task.worktree) {
    return path.resolve(
      root,
      resolveOrCreateWorktree(root, task.worktree, task.title).path,
    )
  }

  const declared = task.workspace?.trim() ?? ''

  if (declared === '') {
    return sessionRuntime
  }

  const resolved = path.resolve(root, declared)

  // A workspace of `.` reaches the harness root without naming it, which is
  // the default this rule replaced wearing a different spelling.
  if (resolved === path.resolve(root)) {
    fail(
      `Prompt task '${task.id}' declares the harness root as its workspace. ` +
        'Name the roots it needs in `grants` instead, because a whole-root ' +
        'grant must be explicit.',
    )
  }

  return resolved
}

function executePromptTask(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
): { task: HorizonTask; ok: boolean; artifact_path: string; error?: string } {
  const requestPath = writePromptRequest(root, state, task)
  const cardPath = path.posix.join(
    HORIZON_ROOT,
    state.session_id,
    'prompt-tasks',
    `${task.id}.card.md`,
  )
  const card = buildGovernanceCard(root, {
    mode: 'unbound',
    requestPath,
    outputPath: cardPath,
    worktreeName: task.worktree,
    contracts: state.contracts,
  })

  const pipeline = loadPipelineConfig(root)
  // `unbound` is a governance mode rather than a persona, so no pipeline
  // configuration maps it to a model. A prompt task is the session's own
  // top-level agent, which is the persona the configuration does map.
  const mapping = resolvePersonaMapping(pipeline.config, 'orchestrator')

  const sessionRuntime = path.resolve(root, HORIZON_ROOT, state.session_id)
  const workspace = promptTaskWorkspace(root, task, sessionRuntime)
  const namedGrants = (task.grants ?? []).map((grant) => ({
    name: grant.name,
    path: path.resolve(root, grant.path),
  }))
  const grantedRoots = [
    ...new Set([
      workspace,
      sessionRuntime,
      ...namedGrants.map((grant) => grant.path),
    ]),
  ]

  ensureDir(workspace)

  // Enforcement decides the shape of the check. When the boundary holds at
  // the operating system, a write outside the grant cannot happen and no
  // observation is needed. When it does not, the fallback observes the whole
  // root and fails closed on anything it finds.
  const sandbox = resolveWriteSandbox(grantedRoots)
  const enforced = sandbox.mode !== 'none'
  const beforeHarness = enforced
    ? new Map<string, string>()
    : promptTaskScopeSnapshot(root, grantedRoots)

  const result = runCursorAgentSession({
    prompt: `${card.markdown}\n\n## Task\n\n${task.prompt ?? ''}`,
    cwd: workspace,
    workspaceRoot: workspace,
    addDirs: grantedRoots.filter((directory) => directory !== workspace),
    requireTrust: true,
    installationRoot: root,
    model: mapping.model_spec,
    writeRoots: grantedRoots,
  })

  const afterHarness = enforced
    ? new Map<string, string>()
    : promptTaskScopeSnapshot(root, grantedRoots)
  // The snapshot already excludes every granted root, so each observed change
  // is outside the grant by construction.
  const unapprovedChanges = promptTaskChangedPaths(beforeHarness, afterHarness)

  const effectiveError =
    unapprovedChanges.length > 0
      ? `Prompt task changed paths outside its granted roots: ${unapprovedChanges.join(', ')}`
      : result.error
  const effectiveOk = result.ok && unapprovedChanges.length === 0

  const artifactPath = path.posix.join(
    HORIZON_ROOT,
    state.session_id,
    'prompt-tasks',
    `${task.id}.result.json`,
  )
  writeJsonAtomic(resolveInside(root, artifactPath), {
    schema_version: 1,
    task_id: task.id,
    request_path: requestPath,
    card_path: card.path,
    ok: effectiveOk,
    exit_code: result.exit_code,
    timed_out: result.timed_out,
    session_id: result.session_id ?? null,
    reported_model: result.reported_model ?? null,
    error: effectiveError ?? null,
    granted_roots: grantedRoots,
    tool_policy: {
      granted_roots: grantedRoots,
      named_grants: namedGrants,
      per_path_write_policy: false,
      scope_gate: 'scope.no_unapproved_changes',
    },
    scope_check: {
      passed: unapprovedChanges.length === 0,
      enforcement: sandbox.mode,
      enforcement_reason: sandbox.reason,
      observation: enforced ? 'prevented' : 'filesystem',
      // The fallback observes the whole root and excludes no tree. It cannot
      // separate this task's write from a concurrent one, so the basis is
      // recorded beside the result rather than left for a reader to assume.
      ...(enforced
        ? {}
        : {
            attribution: 'observation-window',
            skipped_classes: [...PROMPT_TASK_SKIPPED_CLASSES],
          }),
      unapproved_changes: unapprovedChanges,
    },
    recorded_at: now(),
  })

  return {
    task: {
      ...task,
      status: effectiveOk ? 'succeeded' : 'failed',
      result_path: artifactPath,
    },
    ok: effectiveOk,
    artifact_path: artifactPath,
    ...(effectiveError ? { error: effectiveError } : {}),
  }
}

function skipBlockedDependents(
  state: HorizonSessionState,
): HorizonSessionState {
  const blocking = new Set(
    state.tasks
      .filter((task) =>
        ['deferred', 'excluded', 'blocked'].includes(task.status),
      )
      .map((task) => task.id),
  )
  let changed = true
  let tasks = state.tasks

  while (changed) {
    changed = false
    tasks = tasks.map((task) => {
      if (
        task.status === 'pending' &&
        task.depends_on.some((dependency) => blocking.has(dependency))
      ) {
        changed = true
        blocking.add(task.id)
        return { ...task, status: 'blocked' }
      }
      return task
    })
  }

  return { ...state, tasks }
}

function sessionTerminalState(state: HorizonSessionState): HorizonSessionState {
  const open = state.tasks.some((task) =>
    ['pending', 'running', 'replanning'].includes(task.status),
  )

  if (open) {
    return state
  }

  return {
    ...state,
    status: state.tasks.every((task) => task.status === 'succeeded')
      ? 'succeeded'
      : 'empty',
  }
}

function startWorkflowTask(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  role: 'task' | 'replan' = 'task',
): RunState {
  const worktree = task.worktree
    ? resolveOrCreateWorktree(root, task.worktree, task.title)
    : null
  return createRun(root, {
    workflowSlug:
      role === 'replan' ? 'planning' : (task.workflow ?? 'planning'),
    requestPath:
      role === 'replan'
        ? task.result_path
        : (task.request_stored_path ?? (task.request_path as string)),
    title: role === 'replan' ? `Re-plan ${task.title}` : task.title,
    workspace: worktree ? worktree.path : (task.workspace ?? null),
    worktree,
    involvement: state.involvement_profile,
    horizon: { session_id: state.session_id, task_id: task.id, role },
    horizonLadder: {
      retries_spent: task.ladder.retries_spent,
      strategy_switches_spent: task.ladder.strategy_switches_spent,
      replans_spent: task.ladder.replans_spent,
      last_failure_signature: task.ladder.last_failure_signature,
      approaches_tried: [],
    },
    autostartDelivery: role === 'replan' ? false : undefined,
  })
}

export function nextHorizonTask(
  root: string,
  sessionId: string,
  options: ArbitrateOptions = {},
): HorizonNextResult {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = skipBlockedDependents(loadHorizonSession(root, sessionId))

    if (state.status !== 'running') {
      fail(`Horizon session '${sessionId}' is '${state.status}', not running.`)
    }

    if (state.active_task_id) {
      fail(
        `Horizon session '${sessionId}' already runs task '${state.active_task_id}'.`,
      )
    }

    // The slot records which task the session holds, not whether that task's
    // run stopped, so the refusal reads run state directly. A run still in
    // flight beside a newly opened one is two mutating workflows in one
    // workspace.
    const advancing = advancingHorizonRun(root, state)

    if (advancing) {
      fail(
        `Horizon session '${sessionId}' cannot open a task: run '${advancing.run_id}' for task '${advancing.task_id}' is still running.`,
      )
    }

    const selected = eligibleHorizonTask(state)

    if (!selected) {
      state = sessionTerminalState(state)
      state = writeHandoff(root, state, 'no_eligible_task', null)
      return {
        session: persistHorizonSession(root, state, 'session_quiescent'),
        task: null,
        run: null,
      }
    }

    if (selected.kind === 'prompt') {
      const consumed = state.latest_handoff
      const running: HorizonTask = { ...selected, status: 'running' }
      state = {
        ...state,
        active_task_id: selected.id,
        tasks: state.tasks.map((task) =>
          task.id === selected.id ? running : task,
        ),
        boundaries: [
          ...state.boundaries,
          {
            sequence: state.boundaries.length + 1,
            handoff_consumed: consumed,
            task_opened: selected.id,
            process_id: process.pid,
            recorded_at: now(),
          },
        ],
      }
      state = persistHorizonSession(
        root,
        writeHandoff(root, state, 'started', selected.id),
        'task_started',
        { task_id: selected.id, handoff_consumed: consumed },
      )
      const executed = executePromptTask(root, state, running)
      state = {
        ...state,
        active_task_id: null,
        tasks: state.tasks.map((task) =>
          task.id === selected.id ? executed.task : task,
        ),
      }

      if (!executed.ok) {
        state = arbitrateTaskStop(
          root,
          state,
          executed.task,
          null,
          executed.error ?? 'The prompt task executor failed.',
          [executed.artifact_path],
          options,
        )
      }
      const settled = state.tasks.find((task) => task.id === selected.id)
      state = writeHandoff(
        root,
        sessionTerminalState(state),
        executed.ok
          ? 'finished'
          : settled?.status === 'pending'
            ? 'restarted'
            : 'deferred',
        selected.id,
      )
      return {
        session: persistHorizonSession(root, state, 'prompt_task_finished', {
          task_id: selected.id,
          result: executed.ok ? 'succeeded' : 'failed',
        }),
        task: executed.task,
        run: null,
        prompt_result: {
          ok: executed.ok,
          artifact_path: executed.artifact_path,
          ...(executed.error ? { error: executed.error } : {}),
        },
      }
    }

    const run = startWorkflowTask(root, state, selected)
    const opened: HorizonTask = {
      ...selected,
      status: 'running',
      request_stored_path: run.request.stored_path,
      run_id: run.run_id,
    }
    const consumed = state.latest_handoff
    state = {
      ...state,
      active_task_id: selected.id,
      tasks: state.tasks.map((task) =>
        task.id === selected.id ? opened : task,
      ),
      boundaries: [
        ...state.boundaries,
        {
          sequence: state.boundaries.length + 1,
          handoff_consumed: consumed,
          task_opened: selected.id,
          process_id: process.pid,
          recorded_at: now(),
        },
      ],
    }
    state = writeHandoff(root, state, 'started', selected.id)

    return {
      session: persistHorizonSession(root, state, 'task_started', {
        task_id: selected.id,
        run_id: run.run_id,
        handoff_consumed: consumed,
      }),
      task: opened,
      run,
    }
  })
}

function synchronizeLadder(task: HorizonTask, run: RunState): HorizonTask {
  const ladder = run.horizon_ladder

  if (!ladder) {
    return task
  }

  return {
    ...task,
    ladder: {
      retries_spent: ladder.retries_spent,
      strategy_switches_spent: ladder.strategy_switches_spent,
      replans_spent: Math.max(task.ladder.replans_spent, ladder.replans_spent),
      last_failure_signature: ladder.last_failure_signature,
    },
  }
}

/**
 * The run statuses the harness itself advances. A run resting in `paused` or
 * `awaiting_operator` waits for a decision only a human takes, so it mutates
 * nothing while the session moves on; every other non-terminal status is work
 * still in flight.
 */
const ADVANCING_RUN_STATUSES: ReadonlySet<RunState['status']> = new Set([
  'running',
  'awaiting_supervisor',
])

/** Read a task's run, treating an unreadable record as no run at all. */
function taskRunState(root: string, task: HorizonTask): RunState | null {
  if (!task.run_id) {
    return null
  }

  try {
    return getRunState(root, task.run_id)
  } catch {
    return null
  }
}

const TERMINAL_RUN_STATUSES: ReadonlySet<RunState['status']> = new Set([
  'succeeded',
  'failed',
  'canceled',
])

function readRun(
  root: string,
  runId: string | null | undefined,
): RunState | null {
  if (!runId) {
    return null
  }

  try {
    return getRunState(root, runId)
  } catch {
    return null
  }
}

const HORIZON_REDLINE_OCCASION = 'pan-horizon'

function liveRunView(
  root: string,
  run: RunState,
  role: HorizonLiveRunRole,
  chunk: string | null = null,
): HorizonLiveRun {
  return {
    ...supervisorBootstrap(root, run, HORIZON_REDLINE_OCCASION),
    role,
    chunk,
    status: run.status,
    current_stage: run.current_stage,
    pending_action: run.pending_action,
    pause_reason: run.pause_reason ?? null,
    worktree: run.managed_worktree?.name ?? null,
    horizon_ladder: run.horizon_ladder ?? null,
  }
}

const NO_ROUTE_COMMANDS: HorizonRouteCommands = {
  start_command: null,
  integrate_command: null,
  record_abandoned_cohort_command: null,
  release_command: null,
  manual_commands: [],
}

/**
 * Where a task's own run sent its work.
 *
 * Approving a ratified plan starts one delivery run or cohort 1 of a cohort
 * session, and `maybeStartDelivery` records that on the planning run as
 * `delivery_handoff`. A run whose handoff was never recorded may still own a
 * cohort session (an older record, or a route the operator completed by
 * hand), so the cohort index is the fallback. A run that routed nowhere has
 * no route and finishes the task by itself.
 */
export function resolveTaskRoute(
  root: string,
  run: RunState,
): HorizonTaskRoute | null {
  const handoff = run.delivery_handoff

  if (handoff?.kind === 'delivery') {
    return {
      kind: 'delivery',
      run_id: handoff.run_id,
      cohort_id: null,
      release_run_id: null,
      failed: null,
    }
  }

  if (handoff?.kind === 'cohort') {
    return refreshTaskRoute(root, {
      kind: 'cohort',
      run_id: null,
      cohort_id: handoff.cohort_id,
      release_run_id: null,
      failed: null,
    })
  }

  if (handoff?.kind === 'failed') {
    return {
      kind: handoff.route ?? 'delivery',
      run_id: null,
      cohort_id: null,
      release_run_id: null,
      failed: {
        error: handoff.error,
        manual_commands: handoff.manual_commands,
      },
    }
  }

  let cohort = null

  try {
    cohort = cohortSessionForPlanRun(root, run.run_id)
  } catch {
    cohort = null
  }

  if (cohort) {
    return refreshTaskRoute(root, {
      kind: 'cohort',
      run_id: null,
      cohort_id: cohort.cohort_id,
      release_run_id: cohort.release_run_id ?? null,
      failed: null,
    })
  }

  return null
}

/** Re-read the parts of a route the harness advances on its own. */
function refreshTaskRoute(
  root: string,
  route: HorizonTaskRoute,
): HorizonTaskRoute {
  if (route.kind !== 'cohort' || !route.cohort_id) {
    return route
  }

  try {
    const view = cohortStatus(root, route.cohort_id)

    return { ...route, release_run_id: view.release_run_id }
  } catch {
    return route
  }
}

function cohortRouteProgress(
  root: string,
  route: HorizonTaskRoute,
  view: CohortStatusView,
): HorizonRouteProgress {
  const liveRuns: HorizonLiveRun[] = []

  for (const chunk of view.chunks) {
    const run = readRun(root, chunk.run_id)

    if (run && !chunk.abandoned && !TERMINAL_RUN_STATUSES.has(run.status)) {
      liveRuns.push(liveRunView(root, run, 'chunk', chunk.id))
    }
  }

  const release = readRun(root, view.release_run_id)

  if (release && !TERMINAL_RUN_STATUSES.has(release.status)) {
    liveRuns.push(liveRunView(root, release, 'release'))
  }

  const failedChunks = view.chunks.filter((chunk) => {
    const run = readRun(root, chunk.run_id)

    return (
      run !== null &&
      !chunk.abandoned &&
      (run.status === 'failed' || run.status === 'canceled')
    )
  })
  let stopped: string | null = null

  if (
    release &&
    (release.status === 'failed' || release.status === 'canceled')
  ) {
    stopped = `The release run ${release.run_id} is '${release.status}'.`
  } else if (
    liveRuns.length === 0 &&
    failedChunks.length > 0 &&
    view.integrate_command === null &&
    view.record_abandoned_cohort_command === null
  ) {
    stopped =
      `Chunk run${failedChunks.length === 1 ? '' : 's'} ` +
      failedChunks
        .map((chunk) => `${chunk.id} (${chunk.run_id ?? 'no run'})`)
        .join(', ') +
      ` ended without success and the cohort cannot integrate.`
  }

  return {
    route: { ...route, release_run_id: view.release_run_id },
    finished: release?.status === 'succeeded',
    stopped,
    live_runs: liveRuns,
    commands: {
      start_command: view.start_command,
      integrate_command: view.integrate_command,
      record_abandoned_cohort_command: view.record_abandoned_cohort_command,
      release_command: view.release_command,
      manual_commands: [],
    },
  }
}

/**
 * Whether a task's route has finished, what still runs on it, and which
 * cohort commands apply right now. This is the one place that says when a
 * routed task is done, on the chat path and the headless path alike.
 */
export function routeProgress(
  root: string,
  route: HorizonTaskRoute,
): HorizonRouteProgress {
  if (route.failed) {
    return {
      route,
      finished: false,
      stopped: `The plan route did not start: ${route.failed.error}`,
      live_runs: [],
      commands: {
        ...NO_ROUTE_COMMANDS,
        manual_commands: route.failed.manual_commands,
      },
    }
  }

  if (route.kind === 'delivery') {
    const run = readRun(root, route.run_id)

    if (!run) {
      return {
        route,
        finished: false,
        stopped: `The delivery run ${route.run_id ?? '(unknown)'} cannot be read.`,
        live_runs: [],
        commands: NO_ROUTE_COMMANDS,
      }
    }

    return {
      route,
      finished: run.status === 'succeeded',
      stopped:
        run.status === 'failed' || run.status === 'canceled'
          ? `The delivery run ${run.run_id} is '${run.status}'.`
          : null,
      live_runs: TERMINAL_RUN_STATUSES.has(run.status)
        ? []
        : [liveRunView(root, run, 'delivery')],
      commands: NO_ROUTE_COMMANDS,
    }
  }

  if (!route.cohort_id) {
    return {
      route,
      finished: false,
      stopped: 'The cohort route names no cohort session.',
      live_runs: [],
      commands: NO_ROUTE_COMMANDS,
    }
  }

  try {
    return cohortRouteProgress(root, route, cohortStatus(root, route.cohort_id))
  } catch (error) {
    return {
      route,
      finished: false,
      stopped: `The cohort session ${route.cohort_id} cannot be read: ${errorMessage(error)}`,
      live_runs: [],
      commands: NO_ROUTE_COMMANDS,
    }
  }
}

/**
 * Every run the active task holds the supervisor's attention on: its own run
 * while that run is live, then every live run on its route.
 */
export function horizonLiveRuns(
  root: string,
  task: HorizonTask,
): { live_runs: HorizonLiveRun[]; commands: HorizonRouteCommands } {
  const liveRuns: HorizonLiveRun[] = []
  const own = readRun(root, task.run_id)

  if (own && !TERMINAL_RUN_STATUSES.has(own.status)) {
    liveRuns.push(
      liveRunView(root, own, task.status === 'replanning' ? 'replan' : 'task'),
    )
  }

  if (!task.route) {
    return { live_runs: liveRuns, commands: NO_ROUTE_COMMANDS }
  }

  const progress = routeProgress(root, task.route)

  return {
    live_runs: [...liveRuns, ...progress.live_runs],
    commands: progress.commands,
  }
}

/**
 * Take the cohort step the route offers before any run is driven: start the
 * chunks a freed slot allows, or start the release run once every cohort is
 * integrated. Integration itself fires from the lifecycle command that closes
 * the last chunk run, so it is never taken here.
 */
function advanceRouteCommands(
  root: string,
  progress: HorizonRouteProgress,
): void {
  const route = progress.route

  if (route.kind !== 'cohort' || !route.cohort_id) {
    return
  }

  if (progress.commands.start_command) {
    startCohort(root, route.cohort_id)
  } else if (
    progress.commands.integrate_command ||
    progress.commands.record_abandoned_cohort_command
  ) {
    // The lifecycle command that closed the last chunk normally integrates.
    // When the proof is still missing here, the automatic advance did not
    // fire, and this is the idempotent retry the cohort surface names.
    integrateCohort(root, route.cohort_id)
  } else if (progress.commands.release_command) {
    releaseCohort(root, route.cohort_id)
  }
}

/** Name the first task whose run the harness would still advance. */
function advancingHorizonRun(
  root: string,
  state: HorizonSessionState,
): { task_id: string; run_id: string } | null {
  for (const task of state.tasks) {
    const run = taskRunState(root, task)

    if (run && ADVANCING_RUN_STATUSES.has(run.status)) {
      return { task_id: task.id, run_id: run.run_id }
    }

    if (task.route && task.status === 'running') {
      const routed = routeProgress(root, task.route).live_runs.find((live) =>
        ADVANCING_RUN_STATUSES.has(live.status),
      )

      if (routed) {
        return { task_id: task.id, run_id: routed.run_id }
      }
    }
  }

  return null
}

/**
 * Stop a deferred task's run before the session releases its slot.
 *
 * Rung four is reachable from the operator's `defer` escape hatch, where the
 * run is still in flight. Clearing `active_task_id` without stopping it would
 * let the next task open a second run against the same workspace. A run that
 * already rests in a pause keeps it, because its pending action still carries
 * the decision the operator owns.
 */
function stopRunForDeferral(
  root: string,
  task: HorizonTask,
  reason: string,
): void {
  const run = taskRunState(root, task)

  if (!run || !ADVANCING_RUN_STATUSES.has(run.status)) {
    return
  }

  pauseRun(
    root,
    run.run_id,
    `The horizon session deferred this task: ${reason}`,
    {
      actor: 'supervisor',
    },
  )
}

/**
 * Why a task left the session. Only three writers exist: the arbiter naming
 * one of the four hard blocks, the arbiter and its fallback both failing to
 * act (a harness condition, never an operator-owned block), and the
 * operator's own `defer` command. A deferral with no classification is not
 * possible, so a post-run review always knows which authority ended the task.
 */
export type HorizonDeferralClassification =
  | { kind: 'hard_block'; hard_block: HorizonHardBlock; reasoning: string }
  | { kind: 'harness_unrecoverable' }
  | { kind: 'operator' }

function writeDeferral(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  reason: string,
  evidence: string[],
  classification: HorizonDeferralClassification,
): HorizonSessionState {
  stopRunForDeferral(root, task, reason)
  const dependentIds = transitiveHorizonDependents(state, task.id)
  const record = {
    schema_version: 1,
    task: task.id,
    reason,
    classification,
    rung_history: task.ladder,
    evidence_paths: evidence,
    dependents: dependentIds,
    recorded_at: now(),
  }
  appendJsonLine(
    path.join(horizonDir(root, state.session_id), 'deferred.jsonl'),
    record,
  )
  const inboxPath = path.posix.join(
    'runtime',
    'inbox',
    'queue',
    `horizon-${state.session_id}-${task.id}-deferred.md`,
  )
  writeTextAtomic(
    resolveInside(root, inboxPath),
    `# Deferred horizon task ${task.id}\n\n` +
      `Reason: ${reason}\n\n` +
      `Classification: ${classification.kind}` +
      (classification.kind === 'hard_block'
        ? ` (${classification.hard_block})\n\nArbiter reasoning: ${classification.reasoning}\n\n`
        : '\n\n') +
      `Dependents: ${dependentIds.join(', ') || 'none'}\n\n` +
      `Evidence:\n${evidence.map((item) => `- ${item}`).join('\n')}\n`,
  )

  return {
    ...state,
    // Only the deferred task releases the session. Clearing the slot for a
    // task that is not the active one would let a second run start beside
    // the one still running.
    active_task_id:
      state.active_task_id === task.id ? null : state.active_task_id,
    tasks: state.tasks.map((candidate) => {
      if (candidate.id === task.id) {
        return { ...task, status: 'deferred' }
      }

      if (
        dependentIds.includes(candidate.id) &&
        candidate.status === 'pending'
      ) {
        return { ...candidate, status: 'blocked' }
      }

      return candidate
    }),
  }
}

/**
 * Rung three: start the one scoped planning run for a task whose ladder the
 * engine exhausted, and hold the task on it.
 */
function startScopedReplan(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  run: RunState,
): HorizonSessionState {
  const failureRecord = run.horizon_ladder?.failure_record_path as string
  const recorded = recordHorizonReplan(root, run.run_id)
  const replanning = {
    ...synchronizeLadder(task, recorded),
    status: 'replanning' as const,
    result_path: failureRecord,
  }
  const replan = startWorkflowTask(root, state, replanning, 'replan')

  return {
    ...state,
    active_task_id: task.id,
    tasks: state.tasks.map((candidate) =>
      candidate.id === task.id
        ? {
            ...replanning,
            replan_run_id: replan.run_id,
            run_id: replan.run_id,
          }
        : candidate,
    ),
  }
}

/**
 * Apply one run's terminal success to its task.
 *
 * A re-plan that succeeded returns the task to `pending` so the session
 * reopens it. The task's own run that succeeded finishes the task only when
 * it routed nowhere; when approving its plan started a delivery run or a
 * cohort, the route is recorded and the task stays `running` until the route
 * finishes. A routed run that succeeded finishes the task only when the whole
 * route has. Before routes were tracked, the planning run's success ended the
 * task and orphaned every run it had started.
 */
function settleSucceededRun(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  run: RunState,
): HorizonSessionState {
  const replace = (next: HorizonTask): HorizonSessionState => ({
    ...state,
    active_task_id: next.status === 'running' ? state.active_task_id : null,
    tasks: state.tasks.map((candidate) =>
      candidate.id === task.id ? next : candidate,
    ),
  })

  if (task.status === 'replanning' && run.run_id === task.run_id) {
    return replace({ ...task, status: 'pending', run_id: null })
  }

  const route =
    task.route ??
    (run.run_id === task.run_id ? resolveTaskRoute(root, run) : null)

  if (!route) {
    return replace({ ...task, status: 'succeeded' })
  }

  const progress = routeProgress(root, route)

  if (progress.finished) {
    return replace({ ...task, status: 'succeeded', route: progress.route })
  }

  return replace({ ...task, status: 'running', route: progress.route })
}

/**
 * Put one stop before the arbiter and apply its outcome to the session.
 *
 * This is the only path from a stop to the deferral ledger that the harness
 * itself takes. The arbiter overrides by default; a task defers only when the
 * arbiter names a hard block or when neither it nor its fallback could act.
 * `continued` leaves the task running so the next checkpoint drives the run
 * it just nudged; `restart` returns the task to `pending` so the session
 * reopens it from its stored request.
 */
function arbitrateTaskStop(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  run: RunState | null,
  stopReason: string,
  evidence: string[],
  options: ArbitrateOptions,
): HorizonSessionState {
  const outcome = arbitrateHorizonStop(
    root,
    {
      sessionId: state.session_id,
      taskId: task.id,
      taskTitle: task.title,
      run,
      stopReason,
    },
    options,
  )

  switch (outcome.outcome) {
    case 'continued':
      return persistHorizonSession(root, state, 'task_stop_overridden', {
        task_id: task.id,
        run_id: run?.run_id ?? null,
        stop_reason: stopReason,
        action: outcome.action,
        reasoning: outcome.reasoning,
      })
    case 'restart': {
      if (run) {
        stopRunForDeferral(
          root,
          task,
          `restarted by the arbiter: ${stopReason}`,
        )
      }

      const reopened: HorizonTask = {
        ...task,
        status: 'pending',
        run_id: null,
        replan_run_id: null,
      }

      return persistHorizonSession(
        root,
        {
          ...state,
          active_task_id:
            state.active_task_id === task.id ? null : state.active_task_id,
          tasks: state.tasks.map((candidate) =>
            candidate.id === task.id ? reopened : candidate,
          ),
        },
        'task_restarted',
        {
          task_id: task.id,
          run_id: run?.run_id ?? null,
          stop_reason: stopReason,
          reasoning: outcome.reasoning,
        },
      )
    }
    case 'hard_block':
      return writeDeferral(
        root,
        state,
        task,
        `[${outcome.hard_block}] ${stopReason}`,
        evidence,
        {
          kind: 'hard_block',
          hard_block: outcome.hard_block,
          reasoning: outcome.reasoning,
        },
      )
    case 'harness_unrecoverable':
      return writeDeferral(root, state, task, outcome.reason, evidence, {
        kind: 'harness_unrecoverable',
      })
    default:
      return state
  }
}

function reconcileDrivenTask(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
  driven: HeadlessDriverResult,
  options: ArbitrateOptions = {},
): HorizonSessionState {
  const run = driven.state
  task = synchronizeLadder(task, run)

  if (driven.stop.type === 'terminal' && driven.stop.status === 'succeeded') {
    return settleSucceededRun(root, state, task, run)
  }

  const operatorOnly =
    driven.stop.type === 'operator_pause' && driven.stop.operator_only
  const ladderExhausted = run.horizon_ladder?.pause_kind === 'ladder_exhausted'

  if (ladderExhausted && task.ladder.replans_spent === 0) {
    if (!run.horizon_ladder?.failure_record_path) {
      return arbitrateTaskStop(
        root,
        state,
        task,
        run,
        driven.handoff_reason ?? 'ladder exhausted',
        [],
        options,
      )
    }

    return startScopedReplan(root, state, task, run)
  }

  if (operatorOnly || ladderExhausted || driven.stop.type === 'terminal') {
    return arbitrateTaskStop(
      root,
      state,
      task,
      run,
      driven.handoff_reason ?? run.pause_reason ?? 'task could not continue',
      [
        ...(run.horizon_ladder?.failure_record_path
          ? [run.horizon_ladder.failure_record_path]
          : []),
      ],
      options,
    )
  }

  return state
}

const AWAY_STEP_BOUND = 20

/**
 * Convert a pause the session cannot clear into the fourth rung.
 *
 * `reconcileDrivenTask` keys rung four on an operator-only stop, so a
 * guardrail refusal, an exhausted decision budget, and an inapplicable
 * decision all have to arrive there. Letting one escape the checkpoint ends
 * the whole session instead of the one task it belongs to.
 */
function operatorOnlyStop(
  driven: HeadlessDriverResult,
  reason: string,
): HeadlessDriverResult {
  return {
    ...driven,
    handoff_reason: reason,
    stop: {
      type: 'operator_pause',
      action: 'operator_decision',
      stage: driven.state.current_stage ?? 'unknown',
      operator_only: true,
      reason,
    },
  }
}

/**
 * How many evaluator failures one blocker absorbs before the task defers.
 *
 * Each `evaluateAwayState` call already retries an unparseable reply once. A
 * failure record is transient by definition (HORIZON-001), so the session
 * evaluates again rather than deferring a task over a reply that did not
 * parse. The run's own evaluator-failure ceiling still bounds the total.
 */
const AWAY_EVALUATION_ATTEMPTS = 3

/**
 * Apply the selected option, then fall through the remaining allowed ranks
 * when an apply fails. A ranking usually carries a second sound option, and
 * ending the task over the first one's apply error was the defect that
 * deferred a complete release over an inapplicable `resume` (HORIZON-001).
 */
function applyRankedAwayDecision(
  root: string,
  state: RunState,
  decision: AwayDecisionRecord,
): { applied: true } | { applied: false; reason: string } {
  const tried = new Set<number>()
  let candidate: AwayOption | null = decision.selected_action
  let lastError = 'The away decision selected no action.'

  while (candidate) {
    tried.add(candidate.rank)
    const attempt: AwayDecisionRecord = {
      ...decision,
      selected_action: candidate,
    }

    try {
      applyAwayDecision(root, state, attempt)
      recordAwayApplyResult(
        root,
        attempt,
        'applied',
        undefined,
        candidate.action,
      )

      return { applied: true }
    } catch (error) {
      lastError = errorMessage(error)
      recordAwayApplyResult(root, attempt, 'failed', lastError)
    }

    const remaining = decision.ranked_options.filter(
      (option) => !tried.has(option.rank),
    )
    candidate = selectAwayOption(remaining, {
      enabled: true,
      guardrails: decision.guardrails,
      source_sha256: state.away_mode?.source_sha256 ?? '',
    }).selected
  }

  return {
    applied: false,
    reason: `The away decision did not apply: ${lastError}`,
  }
}

/** Resolve one away-mode blocker, or state why no permitted action clears it. */
function advanceAwayBlocker(
  root: string,
  state: RunState,
): { advanced: true } | { advanced: false; reason: string } {
  const blocker = awayModeTrigger(state, undefined, root)

  if (!blocker) {
    return {
      advanced: false,
      reason: 'The pause is not a permitted away-mode blocker class.',
    }
  }

  let decision: AwayDecisionRecord | null = null
  let evaluatorError: string | null = null

  for (let attempt = 1; attempt <= AWAY_EVALUATION_ATTEMPTS; attempt++) {
    try {
      const evaluated = evaluateAwayState(root, state, blocker)

      if (evaluated.decision_kind === 'evaluator_failure') {
        evaluatorError = evaluated.error ?? 'The away evaluator failed.'
        continue
      }

      decision = evaluated
      break
    } catch (error) {
      evaluatorError = errorMessage(error)

      // A spent budget or failure ceiling will not change on another attempt.
      if (
        error instanceof PanError &&
        (error.code === 'AWAY_DECISION_LIMIT' ||
          error.code === 'AWAY_EVALUATOR_FAILURE_LIMIT')
      ) {
        break
      }
    }
  }

  if (!decision) {
    return {
      advanced: false,
      reason: `The away evaluator reached no usable decision: ${evaluatorError ?? 'no decision'}`,
    }
  }

  // The refusal is deterministic and its record already names the question,
  // rather than the generic exhausted-ranking reason the evaluated path
  // below reports.
  if (decision.decision_kind === 'operator_question_refusal') {
    return {
      advanced: false,
      reason: decision.error ?? OPERATOR_QUESTION_REFUSAL,
    }
  }

  if (
    !awayBlockerCanBeCleared({
      selected: decision.selected_action,
      rejected: decision.rejected_options,
    })
  ) {
    return {
      advanced: false,
      reason: 'No permitted autonomous action can clear the blocker.',
    }
  }

  const applied = applyRankedAwayDecision(root, state, decision)

  if (!applied.applied) {
    return { advanced: false, reason: applied.reason }
  }

  return { advanced: true }
}

/**
 * Drive one run to a stop, applying away-mode decisions while the workflow
 * pauses on a blocker the evaluator owns. `blocked` names the reason the loop
 * gave up, so a caller renders the exhausted bound in its own vocabulary
 * instead of keeping a second copy of this loop and its bound.
 */
export function driveRunUnderAwayMode(
  root: string,
  runId: string,
  options: { attestSupervisorCard: boolean; attestedBy: string },
  drive: typeof driveRun = driveRun,
): { driven: HeadlessDriverResult; blocked: string | null } {
  let driven = drive(root, runId, options)
  let awaySteps = 0

  while (
    driven.stop.type === 'operator_pause' &&
    !driven.stop.operator_only &&
    // The session owns rungs three and four for its own typed pause, so the
    // away evaluator never sees a ladder exhaustion.
    driven.state.horizon_ladder?.pause_kind !== 'ladder_exhausted'
  ) {
    if (awaySteps >= AWAY_STEP_BOUND) {
      return {
        driven,
        blocked: `The task spent its ${AWAY_STEP_BOUND}-decision away-mode bound without clearing the blocker.`,
      }
    }

    const attempt = advanceAwayBlocker(root, driven.state)

    if (!attempt.advanced) {
      return { driven, blocked: attempt.reason }
    }

    driven = drive(root, runId, options)
    awaySteps += 1
  }

  return { driven, blocked: null }
}

/**
 * Which run the headless driver advances next for a task, after taking any
 * cohort step the route offers. A task without a route drives its own run.
 * A routed task drives the first live run on the route; when nothing is live
 * the route is either finished, stopped on a failed run the arbiter has to
 * reason about, or waiting on a step nothing here can take.
 */
function nextDrivableRun(
  root: string,
  task: HorizonTask,
):
  | { kind: 'run'; run_id: string }
  | { kind: 'finished'; route: HorizonTaskRoute }
  | {
      kind: 'stopped'
      route: HorizonTaskRoute
      reason: string
      run_id: string | null
    } {
  if (!task.route) {
    return { kind: 'run', run_id: task.run_id as string }
  }

  let progress = routeProgress(root, task.route)

  if (progress.finished) {
    return { kind: 'finished', route: progress.route }
  }

  if (progress.live_runs.length === 0 && !progress.stopped) {
    try {
      advanceRouteCommands(root, progress)
    } catch (error) {
      return {
        kind: 'stopped',
        route: progress.route,
        reason: `The cohort step did not apply: ${errorMessage(error)}`,
        run_id: null,
      }
    }

    progress = routeProgress(root, refreshTaskRoute(root, progress.route))

    if (progress.finished) {
      return { kind: 'finished', route: progress.route }
    }
  }

  const live = progress.live_runs[0]

  if (live) {
    return { kind: 'run', run_id: live.run_id }
  }

  const failing =
    progress.route.kind === 'delivery'
      ? progress.route.run_id
      : (readRun(root, progress.route.release_run_id)?.run_id ?? null)

  return {
    kind: 'stopped',
    route: progress.route,
    reason:
      progress.stopped ??
      'The route has no live run, is not finished, and offers no step.',
    run_id: failing,
  }
}

/** Drive the active workflow task and persist its resulting session transition. */
export function checkpointHorizonSession(
  root: string,
  sessionId: string,
  options: ArbitrateOptions = {},
): { session: HorizonSessionState; driven: HeadlessDriverResult } {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = loadHorizonSession(root, sessionId)
    const task = state.tasks.find(
      (candidate) => candidate.id === state.active_task_id,
    )

    if (!task?.run_id) {
      fail(`Horizon session '${sessionId}' has no active workflow task.`)
    }

    const target = nextDrivableRun(root, task)
    let driven: HeadlessDriverResult

    if (target.kind === 'finished') {
      const own = getRunState(root, task.run_id)

      state = settleSucceededRun(
        root,
        state,
        { ...task, route: target.route },
        own,
      )
      driven = {
        state: own,
        stop: { type: 'terminal', status: 'succeeded' },
        handoff_reason: 'the route finished',
        steps: 0,
        decisions_applied: [],
        last_autostart: null,
        supervisor_card_attested_by: null,
      }
    } else if (target.kind === 'stopped') {
      const failing =
        readRun(root, target.run_id) ?? getRunState(root, task.run_id)

      state = arbitrateTaskStop(
        root,
        state,
        { ...task, route: target.route },
        failing,
        target.reason,
        [],
        options,
      )
      driven = {
        state: failing,
        stop: {
          type: 'operator_pause',
          action: 'operator_decision',
          stage: failing.current_stage ?? 'unknown',
          operator_only: true,
          reason: target.reason,
        },
        handoff_reason: target.reason,
        steps: 0,
        decisions_applied: [],
        last_autostart: null,
        supervisor_card_attested_by: null,
      }
    } else {
      const attempt = driveRunUnderAwayMode(root, target.run_id, {
        attestSupervisorCard: state.preflight.card_attestation_authorized,
        attestedBy: `horizon:${sessionId}`,
      })

      driven =
        attempt.blocked === null
          ? attempt.driven
          : operatorOnlyStop(attempt.driven, attempt.blocked)
      state = reconcileDrivenTask(root, state, task, driven, options)
    }

    const transitioned = state.active_task_id === null

    if (transitioned) {
      state = writeHandoff(
        root,
        sessionTerminalState(skipBlockedDependents(state)),
        state.tasks.find((candidate) => candidate.id === task.id)?.status ??
          'finished',
        task.id,
      )
    }
    return {
      session: persistHorizonSession(root, state, 'task_checkpointed', {
        task_id: task.id,
        run_id: driven.state.run_id,
        stop: driven.stop.type,
      }),
      driven,
    }
  })
}

export interface HorizonReconcileResult {
  session: HorizonSessionState
  task: HorizonTask | null
  /** The task finished or left the session during this reconcile. */
  transitioned: boolean
  live_runs: HorizonLiveRun[]
  commands: HorizonRouteCommands
  /**
   * A route condition the supervisor has to reason about: a failed delivery
   * or release run, a route that never started, or a cohort that cannot
   * integrate. Null while runs are live or the route is progressing.
   */
  stopped: string | null
}

/**
 * Reconcile the active task for a live supervisor, without driving anything.
 *
 * The chat supervisor advances runs itself with the ordinary lifecycle
 * commands. After every wake it calls this to let the harness apply what is
 * mechanical: synchronize the ladder, start the one scoped re-plan when the
 * engine exhausted the ladder, record the route a plan approval opened, take
 * the cohort step a route offers, and finish the task when its route has
 * finished. Everything else is returned as the live runs and the stop the
 * supervisor reasons about. This function never writes a deferral: under
 * HORIZON-001 only the supervisor, naming a hard block, can.
 */
export function reconcileHorizonSession(
  root: string,
  sessionId: string,
): HorizonReconcileResult {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = loadHorizonSession(root, sessionId)
    const active = state.tasks.find(
      (candidate) => candidate.id === state.active_task_id,
    )

    if (!active?.run_id) {
      return {
        session: state,
        task: null,
        transitioned: false,
        live_runs: [],
        commands: NO_ROUTE_COMMANDS,
        stopped: null,
      }
    }

    const own = getRunState(root, active.run_id)
    let task = synchronizeLadder(active, own)
    let stopped: string | null = null

    if (own.status === 'succeeded') {
      state = settleSucceededRun(root, state, task, own)
    } else if (
      own.horizon_ladder?.pause_kind === 'ladder_exhausted' &&
      task.ladder.replans_spent === 0 &&
      own.horizon_ladder.failure_record_path &&
      task.status !== 'replanning'
    ) {
      state = startScopedReplan(root, state, task, own)
    }

    task = state.tasks.find((candidate) => candidate.id === active.id) ?? task

    if (task.status === 'running' && task.route) {
      let progress = routeProgress(root, task.route)

      if (
        !progress.finished &&
        progress.live_runs.length === 0 &&
        !progress.stopped
      ) {
        try {
          advanceRouteCommands(root, progress)
          progress = routeProgress(root, refreshTaskRoute(root, progress.route))
        } catch (error) {
          stopped = `The cohort step did not apply: ${errorMessage(error)}`
        }
      }

      if (progress.finished) {
        state = settleSucceededRun(
          root,
          state,
          { ...task, route: progress.route },
          own,
        )
      } else {
        stopped = stopped ?? progress.stopped
        state = {
          ...state,
          tasks: state.tasks.map((candidate) =>
            candidate.id === task.id
              ? { ...candidate, route: progress.route }
              : candidate,
          ),
        }
      }

      task = state.tasks.find((candidate) => candidate.id === active.id) ?? task
    }

    const transitioned = state.active_task_id === null

    if (transitioned) {
      state = writeHandoff(
        root,
        sessionTerminalState(skipBlockedDependents(state)),
        task.status,
        task.id,
      )
    }

    state = persistHorizonSession(root, state, 'task_reconciled', {
      task_id: task.id,
      run_id: task.run_id,
      status: task.status,
      route: task.route ?? null,
      transitioned,
    })

    const live = transitioned
      ? { live_runs: [], commands: NO_ROUTE_COMMANDS }
      : horizonLiveRuns(root, task)

    return {
      session: state,
      task,
      transitioned,
      live_runs: live.live_runs,
      commands: live.commands,
      stopped: transitioned ? null : stopped,
    }
  })
}

/**
 * Who is deferring, and on what authority.
 *
 * A supervisor defers only by naming the hard block it confirmed; the reason
 * it gives becomes the arbiter reasoning on the record. The operator's own
 * directive needs no hard block, because the operator defines the objective
 * the hard blocks protect. A deferral with neither is refused: under
 * HORIZON-001 no one else may end a task.
 */
export type HorizonDeferralAuthority =
  | { kind: 'hard_block'; hard_block: HorizonHardBlock }
  | { kind: 'operator_directive' }

export function deferHorizonTask(
  root: string,
  sessionId: string,
  taskId: string,
  reason: string,
  evidence: string[] = [],
  authority: HorizonDeferralAuthority = { kind: 'operator_directive' },
): HorizonSessionState {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = loadHorizonSession(root, sessionId)
    const task = state.tasks.find((candidate) => candidate.id === taskId)

    if (!task) {
      fail(`Unknown horizon task: ${taskId}`)
    }

    if (reason.trim().length === 0) {
      fail('Deferring a task requires a non-empty reason.')
    }

    const classification: HorizonDeferralClassification =
      authority.kind === 'hard_block'
        ? {
            kind: 'hard_block',
            hard_block: authority.hard_block,
            reasoning: reason,
          }
        : { kind: 'operator' }
    const recordedReason =
      authority.kind === 'hard_block'
        ? `[${authority.hard_block}] ${reason}`
        : reason

    if (authority.kind === 'hard_block') {
      appendArbiterRecord(root, {
        session_id: sessionId,
        task_id: taskId,
        run_id: task.run_id,
        stop_reason: 'supervisor deferral',
        round: 0,
        verdict: {
          verdict: 'hard_block',
          hard_block: authority.hard_block,
          reasoning: reason,
        },
        result: 'hard_block',
        exchange_path: null,
        actor: 'supervisor',
      })
    }

    state = writeDeferral(
      root,
      state,
      task,
      recordedReason,
      evidence,
      classification,
    )
    state = writeHandoff(root, sessionTerminalState(state), 'deferred', taskId)
    return persistHorizonSession(root, state, 'task_deferred', {
      task_id: taskId,
      reason: recordedReason,
      classification,
    })
  })
}

/**
 * Reinstate a deferred task on the supervisor's own reasoning.
 *
 * A deferral record names which authority ended the task. When the
 * supervisor reading the post-run record does not confirm the hard block, or
 * finds a harness failure, this is the override: the action applies to the
 * task's run (or the task reopens from its request), its dependents come back
 * to `pending`, and the session returns to `running` so `horizon start`
 * drives it again. The decision and its reasoning join the arbiter ledger
 * under the `supervisor` actor.
 */
export function reinstateHorizonTask(
  root: string,
  sessionId: string,
  taskId: string,
  action: ArbiterAction,
  reasoning: string,
): HorizonSessionState {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = loadHorizonSession(root, sessionId)
    const task = state.tasks.find((candidate) => candidate.id === taskId)

    if (!task) {
      fail(`Unknown horizon task: ${taskId}`)
    }

    if (task.status !== 'deferred' && task.status !== 'failed') {
      fail(
        `Horizon task '${taskId}' is '${task.status}'; only a deferred or failed task can be reinstated.`,
      )
    }

    if (reasoning.trim().length === 0) {
      fail(
        'Reinstating a task requires --reason with the supervisor reasoning.',
      )
    }

    if (state.active_task_id && state.active_task_id !== taskId) {
      fail(
        `Horizon session '${sessionId}' already runs task '${state.active_task_id}'.`,
      )
    }

    const run = taskRunState(root, task)
    const runAcceptsAction =
      run !== null && run.status !== 'succeeded' && run.status !== 'failed'
    const restart = action.type === 'restart-task' || !runAcceptsAction

    if (!restart && run) {
      applyArbiterAction(root, run, action, reasoning)
    }

    appendArbiterRecord(root, {
      session_id: sessionId,
      task_id: taskId,
      run_id: run?.run_id ?? null,
      stop_reason: 'supervisor reinstatement of a deferred task',
      round: 0,
      verdict: { verdict: 'override', action, reasoning },
      result: 'applied',
      exchange_path: null,
      actor: 'supervisor',
    })

    const dependentIds = transitiveHorizonDependents(state, taskId)
    const reinstated: HorizonTask = restart
      ? { ...task, status: 'pending', run_id: null, replan_run_id: null }
      : { ...task, status: 'running' }

    state = {
      ...state,
      status: 'running',
      active_task_id: restart ? null : taskId,
      tasks: state.tasks.map((candidate) => {
        if (candidate.id === taskId) {
          return reinstated
        }

        if (
          dependentIds.includes(candidate.id) &&
          candidate.status === 'blocked'
        ) {
          return { ...candidate, status: 'pending' }
        }

        return candidate
      }),
    }
    // A dependent whose other dependency is still deferred goes back to
    // `blocked` here, so only the work this reinstatement actually frees
    // becomes eligible.
    state = skipBlockedDependents(state)
    state = writeHandoff(root, state, 'reinstated', taskId)

    return persistHorizonSession(root, state, 'task_reinstated', {
      task_id: taskId,
      run_id: run?.run_id ?? null,
      action,
      reasoning,
    })
  })
}

export function abandonHorizonSession(
  root: string,
  sessionId: string,
  reason: string,
): HorizonSessionState {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    const state = loadHorizonSession(root, sessionId)
    const abandoned = writeHandoff(
      root,
      { ...state, status: 'abandoned', active_task_id: null },
      'abandoned',
      state.active_task_id,
    )
    return persistHorizonSession(root, abandoned, 'session_abandoned', {
      reason,
    })
  })
}

export interface HorizonStatusView extends HorizonSessionState {
  /**
   * Every run the active task holds the supervisor's attention on, each with
   * its bootstrap command set, so the supervisor rebuilds nothing by hand.
   */
  live_runs: HorizonLiveRun[]
  /** Cohort commands the active task's route offers right now. */
  route_commands: HorizonRouteCommands
  /** The next session command a supervisor takes, in the harness's vocabulary. */
  next_command: string | null
}

export function horizonStatus(
  root: string,
  sessionId: string,
): HorizonStatusView {
  const state = loadHorizonSession(root, sessionId)
  const tasks = state.tasks.map((task) => {
    if (!task.run_id) {
      return task
    }

    try {
      return synchronizeLadder(task, getRunState(root, task.run_id))
    } catch {
      return task
    }
  })
  const active = tasks.find((task) => task.id === state.active_task_id)
  const live = active
    ? horizonLiveRuns(root, active)
    : { live_runs: [], commands: NO_ROUTE_COMMANDS }
  const pan = panCommand(root)
  const nextCommand =
    state.status !== 'running'
      ? null
      : active
        ? `${pan} horizon reconcile ${sessionId} --json`
        : eligibleHorizonTask({ ...state, tasks })
          ? `${pan} horizon next ${sessionId} --json`
          : null

  return {
    ...state,
    tasks,
    live_runs: live.live_runs,
    route_commands: live.commands,
    next_command: nextCommand,
  }
}

export function latestHorizonHandoff(
  root: string,
  sessionId: string,
): unknown | null {
  const state = loadHorizonSession(root, sessionId)
  return state.latest_handoff
    ? readJson(resolveInside(root, state.latest_handoff))
    : null
}
