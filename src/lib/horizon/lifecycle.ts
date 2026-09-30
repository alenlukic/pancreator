/** Session initialization, task addition, and session start. */

import { randomUUID } from 'node:crypto'
import path from 'node:path'

import {
  readJson,
  resolveInside,
  fileExists,
  ensureDir,
  writeJsonAtomic,
  withOperationMutex,
} from '../io.js'
import {
  selectInvolvementProfile,
  loadOperatorInvolvementFile,
} from '../operator-involvement.js'
import {
  fail,
  horizonDir,
  loadHorizonSession,
  mutexPath,
  now,
  persistHorizonSession,
  sessionPath,
  writeHandoff,
  type HorizonQueueTaskInput,
  type HorizonSessionState,
  type HorizonTask,
} from './session.js'
import { parseHorizonQueue } from './queue.js'

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

/**
 * Creates a horizon session from a task queue file: validates the queue,
 * requires an involvement profile that carries the `long_horizon` contract,
 * applies a default workspace or worktree to tasks that name none, and writes
 * the session record with a `session_created` event. The session starts
 * `created` and is not armed. Throws `INVALID_HORIZON_STATE` when the queue is
 * invalid, the profile lacks the contract, or the session id already exists.
 */
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

/**
 * Appends one task to an existing horizon session under the session mutex,
 * revalidating the whole queue with the new task, and persists a `task_added`
 * event. Throws `INVALID_HORIZON_STATE` when the id already exists or the
 * extended queue is invalid.
 */
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

/**
 * Arms a created horizon session under the session mutex: sets it running with
 * away mode armed and supervisor card attestation authorized, writes a
 * `started` handoff, and persists `session_started`. Returns the session
 * unchanged when it already left `created`. Throws `INVALID_HORIZON_STATE`
 * unless `attestSupervisorCard` is set.
 */
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
