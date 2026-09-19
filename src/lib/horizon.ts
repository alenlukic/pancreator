import { randomUUID } from 'node:crypto'
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
import { runCursorAgentSession } from './executors/cursor-agent.js'
import {
  awayBlockerCanBeCleared,
  awayModeTrigger,
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
  ladder: {
    retries_spent: number
    strategy_switches_spent: number
    replans_spent: number
    last_failure_signature: string[]
  }
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

  const workspace = task.worktree
    ? path.resolve(
        root,
        resolveOrCreateWorktree(root, task.worktree, task.title).path,
      )
    : path.resolve(root, task.workspace ?? '.')
  const result = runCursorAgentSession({
    prompt: `${card.markdown}\n\n## Task\n\n${task.prompt ?? ''}`,
    cwd: workspace,
    workspaceRoot: workspace,
    addDirs: [root],
    requireTrust: true,
    installationRoot: root,
    model: mapping.model_spec,
  })
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
    ok: result.ok,
    exit_code: result.exit_code,
    timed_out: result.timed_out,
    session_id: result.session_id ?? null,
    reported_model: result.reported_model ?? null,
    error: result.error ?? null,
    recorded_at: now(),
  })

  return {
    task: {
      ...task,
      status: result.ok ? 'succeeded' : 'failed',
      result_path: artifactPath,
    },
    ok: result.ok,
    artifact_path: artifactPath,
    ...(result.error ? { error: result.error } : {}),
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
    const completed =
      task.status === 'replanning'
        ? { ...task, status: 'pending' as const, run_id: null }
        : { ...task, status: 'succeeded' as const }

    return {
      ...state,
      active_task_id: null,
      tasks: state.tasks.map((candidate) =>
        candidate.id === task.id ? completed : candidate,
      ),
    }
  }

  const operatorOnly =
    driven.stop.type === 'operator_pause' && driven.stop.operator_only
  const ladderExhausted = run.horizon_ladder?.pause_kind === 'ladder_exhausted'

  if (ladderExhausted && task.ladder.replans_spent === 0) {
    const failureRecord = run.horizon_ladder?.failure_record_path

    if (!failureRecord) {
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
  const blocker = awayModeTrigger(state)

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

    const attempt = driveRunUnderAwayMode(root, task.run_id, {
      attestSupervisorCard: state.preflight.card_attestation_authorized,
      attestedBy: `horizon:${sessionId}`,
    })
    const driven =
      attempt.blocked === null
        ? attempt.driven
        : operatorOnlyStop(attempt.driven, attempt.blocked)

    state = reconcileDrivenTask(root, state, task, driven, options)

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
        run_id: task.run_id,
        stop: driven.stop.type,
      }),
      driven,
    }
  })
}

export function deferHorizonTask(
  root: string,
  sessionId: string,
  taskId: string,
  reason: string,
  evidence: string[] = [],
): HorizonSessionState {
  return withOperationMutex(mutexPath(root, sessionId), () => {
    let state = loadHorizonSession(root, sessionId)
    const task = state.tasks.find((candidate) => candidate.id === taskId)

    if (!task) {
      fail(`Unknown horizon task: ${taskId}`)
    }

    state = writeDeferral(root, state, task, reason, evidence, {
      kind: 'operator',
    })
    state = writeHandoff(root, sessionTerminalState(state), 'deferred', taskId)
    return persistHorizonSession(root, state, 'task_deferred', {
      task_id: taskId,
      reason,
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

export function horizonStatus(
  root: string,
  sessionId: string,
): HorizonSessionState {
  const state = loadHorizonSession(root, sessionId)

  return {
    ...state,
    tasks: state.tasks.map((task) => {
      if (!task.run_id) {
        return task
      }

      try {
        return synchronizeLadder(task, getRunState(root, task.run_id))
      } catch {
        return task
      }
    }),
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
