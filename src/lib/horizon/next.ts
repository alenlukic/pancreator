/**
 * Task dispatch: dependent skipping, the session terminal state, workflow task
 * start, and `nextHorizonTask`.
 */

import { withOperationMutex } from '../io.js'
import { createRun } from '../engine/create-run.js'
import type { ArbitrateOptions } from '../horizon-arbiter.js'
import { resolveOrCreateWorktree } from '../worktrees.js'
import type { RunState } from '../types.js'
import {
  fail,
  loadHorizonSession,
  mutexPath,
  now,
  persistHorizonSession,
  writeHandoff,
  type HorizonNextResult,
  type HorizonSessionState,
  type HorizonTask,
} from './session.js'
import { eligibleHorizonTask } from './queue.js'
import { executePromptTask } from './prompt-task.js'
import { advancingHorizonRun } from './routes.js'
import { arbitrateTaskStop } from './driver.js'

export function skipBlockedDependents(
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

export function sessionTerminalState(
  state: HorizonSessionState,
): HorizonSessionState {
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

export function startWorkflowTask(
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

export function synchronizeLadder(
  task: HorizonTask,
  run: RunState,
): HorizonTask {
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
