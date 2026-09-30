/**
 * Pausing, quarantining, and resuming a run.
 */

import { randomUUID } from 'node:crypto'

import { invariant } from '../errors.js'
import { resolveInside, withOperationMutex, writeTextAtomic } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { panCommand } from '../project-config.js'
import { operationMutexPath, loadState, now, writeDecision } from '../state.js'
import type {
  PauseActor,
  OperatorPauseContext,
  OperatorWorkspaceRatification,
  RunActionActor,
  RunState,
} from '../types.js'
import { stageBySlug } from '../workflow.js'
import { workspaceChangedPathsFromSnapshots } from '../git.js'

import { loadRunWorkflow, persistRun, workspaceSnapshotForRun } from './core.js'
import { clearEntryGateRoutes } from './entry-gate.js'
import { recordOperatorFeedback, recoveryRouteFor } from './recovery.js'

function ratifyPausedWorkspaceChanges(
  root: string,
  state: RunState,
  pause: OperatorPauseContext,
  note: string,
): OperatorWorkspaceRatification | null {
  const before = pause.workspace_before

  if (!before) {
    return null
  }

  const current = workspaceSnapshotForRun(root, state)

  if (current.fingerprint === before.fingerprint) {
    return null
  }

  const ratificationId = `pause-${randomUUID()}`
  const changedPaths = workspaceChangedPathsFromSnapshots(before, current)

  const beforePaths = new Set(before.entries.map((entry) => entry.slice(3)))
  const afterPaths = new Set(current.entries.map((entry) => entry.slice(3)))
  const deletedPaths = [...beforePaths]
    .filter((relativePath) => !afterPaths.has(relativePath))
    .sort()

  const ratifications = state.operator_workspace_ratifications ?? []
  const relativePath = resolveRunLayout(root, state.run_id).decision(
    `operator-pause-ratification-${ratifications.length + 1}.md`,
  ).relative
  const actor = pause.actor ?? 'operator'

  const body = [
    actor === 'supervisor'
      ? '# Supervisor-paused workspace ratification'
      : '# Operator-paused workspace ratification',
    '',
    `**Run** \`${state.run_id}\` · **Stage** \`${state.current_stage ?? 'none'}\` · ` +
      `**Acting agent** \`${actor}\``,
    '',
    actor === 'supervisor'
      ? 'The supervisor paused the workflow and made these Git-visible source changes itself, because the work could not be delegated. Pancreator recorded the resulting delta without scanning dependency, virtual-environment, cache, compiled, or generated directories.'
      : 'The operator explicitly paused the workflow before making these Git-visible source changes. Pancreator recorded the resulting delta without scanning dependency, virtual-environment, cache, compiled, or generated directories.',
    '',
    `**Accepted fingerprint:** \`${current.fingerprint}\``,
    '',
    '## Changed paths',
    '',
    ...(changedPaths.length > 0
      ? changedPaths.map((item) => `- \`${item}\``)
      : ['- None']),
    '',
    '## Deleted paths',
    '',
    ...(deletedPaths.length > 0
      ? deletedPaths.map((item) => `- \`${item}\``)
      : ['- None']),
    '',
    actor === 'supervisor' ? '## Supervisor note' : '## Operator note',
    '',
    note.trim().length > 0 ? note.trim() : 'No additional note supplied.',
    '',
  ].join('\n')

  writeTextAtomic(resolveInside(root, relativePath), `${body}\n`)

  const ratification: OperatorWorkspaceRatification = {
    ratification_id: ratificationId,
    actor,
    stage: state.current_stage ?? 'unknown',
    workspace_fingerprint: current.fingerprint,
    changed_paths: changedPaths,
    deleted_paths: deletedPaths,
    note,
    artifact_path: relativePath,
    timestamp: now(),
  }

  ratifications.push(ratification)
  state.operator_workspace_ratifications = ratifications
  state.accepted_workspace_fingerprint = current.fingerprint

  return ratification
}

function invalidatePausedInvocation(state: RunState): void {
  if (state.current_invocation && state.current_stage) {
    const wasSubmitted = state.stage_history.some(
      (item) => item.invocation_id === state.current_invocation?.id,
    )

    if (!wasSubmitted) {
      const attempts = state.attempts[state.current_stage] ?? 0

      if (attempts > 0) {
        state.attempts[state.current_stage] = attempts - 1
      }
    }
  }

  state.status = 'running'
  state.pending_action = { type: 'prepare_invocation' }
  state.current_invocation = null
}

export interface PauseRunOptions {
  /**
   * Who is acting under the pause. A supervisor that could not delegate and
   * is about to do the stage work itself names itself here, so the change it
   * makes is not recorded as the operator's.
   */
  actor?: PauseActor
}

export function pauseRun(
  root: string,
  runId: string,
  note = '',
  options: PauseRunOptions = {},
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const actor = options.actor ?? 'operator'

    invariant(
      state.status !== 'succeeded' &&
        state.status !== 'failed' &&
        state.status !== 'canceled',
      'Run is already terminal.',
      { code: 'RUN_TERMINAL' },
    )

    const reason =
      note.trim().length > 0
        ? note.trim()
        : actor === 'supervisor'
          ? 'The supervisor paused the workflow.'
          : 'Operator paused the workflow.'

    if (state.status !== 'paused') {
      invariant(
        state.status === 'running' ||
          state.status === 'awaiting_supervisor' ||
          state.status === 'awaiting_operator',
        `Run cannot be paused from status '${state.status}'.`,
        { code: 'INVALID_RUN_ACTION' },
      )

      const workspace = workspaceSnapshotForRun(root, state)

      state.operator_pause = {
        prior_status: state.status,
        prior_pending_action: JSON.parse(
          JSON.stringify(state.pending_action),
        ) as OperatorPauseContext['prior_pending_action'],
        workspace_before: workspace,
        actor,
      }
    }

    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision' }

    writeDecision(
      root,
      state,
      actor === 'supervisor'
        ? 'The supervisor paused the workflow'
        : 'Operator paused the workflow',
      reason,
      [
        `Resume with: ${panCommand(root)} resume ${state.run_id}`,
        `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
        'While paused, you may modify tracked files in the workspace as needed.',
      ],
    )

    persistRun(root, state, 'operator_pause', { note: reason, actor })

    return state
  })
}

/** Pause a run after recovery quarantine and preserve its resumable state. */
export function quarantineRunForAgent(
  root: string,
  runId: string,
  agentId: string,
  reason: string,
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status !== 'succeeded' &&
        state.status !== 'failed' &&
        state.status !== 'canceled',
      'Run is already terminal.',
      { code: 'RUN_TERMINAL' },
    )

    if (state.status !== 'paused') {
      const workspace = workspaceSnapshotForRun(root, state)

      state.operator_pause = {
        prior_status: state.status,
        prior_pending_action: JSON.parse(
          JSON.stringify(state.pending_action),
        ) as OperatorPauseContext['prior_pending_action'],
        workspace_before: workspace,
      }
    }

    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision' }

    writeDecision(root, state, 'Hypervisor quarantined an agent', reason, [
      `Review agent '${agentId}' and its liveness evidence.`,
      `Resume with: ${panCommand(root)} resume ${state.run_id}`,
      `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
    ])
    persistRun(root, state, 'hypervisor_agent_quarantined', {
      agent_id: agentId,
      reason,
    })

    return state
  })
}

function resumeRunWithActor(
  root: string,
  runId: string,
  stageSlug: string | null = null,
  note = '',
  actor: RunActionActor,
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'paused',
      `Only paused runs can be resumed: this run's status is '${state.status}'. ` +
        recoveryRouteFor(root, state, 'resume'),
      { code: 'INVALID_RUN_ACTION', details: { status: state.status } },
    )
    // A pause marked operator-only records a decision only the human operator
    // may take; the release gate raises one after its repair loops run out.
    invariant(
      actor === 'operator' ||
        state.pending_action.type !== 'operator_decision' ||
        state.pending_action.operator_only !== true,
      'Away mode cannot resume a run paused for an operator-only decision.',
      { code: 'AWAY_ACTION_FORBIDDEN' },
    )

    const workflow = loadRunWorkflow(root, state)
    const savedPause = state.operator_pause
    const currentWorkspace =
      actor === 'away' && savedPause?.workspace_before
        ? workspaceSnapshotForRun(root, state)
        : null

    invariant(
      !currentWorkspace ||
        currentWorkspace.fingerprint ===
          savedPause?.workspace_before?.fingerprint,
      'Away mode cannot ratify workspace changes made while the run was paused.',
      { code: 'AWAY_WORKSPACE_RATIFICATION_REQUIRED' },
    )

    const ratification =
      actor === 'operator' && savedPause
        ? ratifyPausedWorkspaceChanges(root, state, savedPause, note)
        : null

    if (savedPause && !stageSlug) {
      if (actor === 'operator' && note.trim().length > 0) {
        invariant(
          savedPause.prior_pending_action.type === 'invoke_agent' &&
            state.current_invocation !== null,
          'A no-stage resume note has no active worker card to target. Pass --stage explicitly.',
          { code: 'RESUME_NOTE_TARGET_UNAVAILABLE' },
        )

        const source = stageBySlug(
          workflow,
          state.current_stage ?? workflow.start_stage,
        )

        recordOperatorFeedback(
          root,
          state,
          source,
          state.current_stage ?? workflow.start_stage,
          'resume',
          note,
        )
      }

      if (ratification || (actor === 'operator' && note.trim().length > 0)) {
        invalidatePausedInvocation(state)
      } else {
        state.status = savedPause.prior_status
        state.pending_action = savedPause.prior_pending_action
      }

      state.operator_pause = null
      state.pause_reason = null

      persistRun(
        root,
        state,
        actor === 'operator' ? 'run_resumed' : 'away_run_resumed',
        {
          restored_status: ratification ? 'running' : savedPause.prior_status,
          workspace_ratification: ratification?.ratification_id ?? null,
          actor,
        },
      )

      return state
    }

    if (ratification) {
      invalidatePausedInvocation(state)
    }

    const target = stageSlug ?? state.current_stage ?? workflow.start_stage

    stageBySlug(workflow, target)
    const source = stageBySlug(
      workflow,
      state.current_stage ?? workflow.start_stage,
    )

    if (note.trim().length > 0) {
      recordOperatorFeedback(root, state, source, target, 'resume', note, actor)
    }

    if (actor === 'operator' || stageSlug) {
      clearEntryGateRoutes(state)
    }

    state.status = 'running'
    state.current_stage = target
    state.pending_action = { type: 'prepare_invocation' }
    state.current_invocation = null
    state.pause_reason = null
    state.operator_pause = null
    state.consecutive_failures = 0

    persistRun(
      root,
      state,
      actor === 'operator' ? 'run_resumed' : 'away_run_resumed',
      {
        stage: target,
        workspace_ratification: ratification?.ratification_id ?? null,
        actor,
      },
    )

    return state
  })
}

export function resumeRun(
  root: string,
  runId: string,
  stageSlug: string | null = null,
  note = '',
): RunState {
  return resumeRunWithActor(root, runId, stageSlug, note, 'operator')
}

/** Resume a paused run without recording operator authorship. */
export function resumeRunAsAway(
  root: string,
  runId: string,
  stageSlug: string | null = null,
  note = '',
): RunState {
  return resumeRunWithActor(root, runId, stageSlug, note, 'away')
}
