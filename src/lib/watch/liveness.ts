/**
 * Deterministic liveness, stall, and submission refusal helpers.
 */

import type { AgentActivity } from '../agent-index/activity.js'
import type { ShellRecordState } from '../agent-index/shell-records.js'
import type { WatchStallCause } from './types.js'

export type AgentLivenessState =
  | 'finished'
  | 'failed'
  | 'in_shell'
  | 'in_tool'
  | 'generating'
  | 'unknown'

export interface AgentLiveness {
  state: AgentLivenessState
  basis: 'transcript' | 'hook_stop' | 'hook_events' | null
  turn_open: boolean
  open_call_tool: string | null
  open_call_age_seconds: number | null
  shell_fault: WatchStallCause | null
}

function shellFaultFromState(state: ShellRecordState): WatchStallCause | null {
  if (state === 'dead') {
    return 'shell_dead'
  }

  if (state === 'stopped') {
    return 'shell_stopped'
  }

  if (state === 'heartbeat_stale') {
    return 'shell_heartbeat_stale'
  }

  return null
}

export function agentLiveness(activity: AgentActivity | null): AgentLiveness {
  if (!activity) {
    return {
      state: 'unknown',
      basis: null,
      turn_open: false,
      open_call_tool: null,
      open_call_age_seconds: null,
      shell_fault: null,
    }
  }

  if (activity.stop) {
    return {
      state: activity.stop.status === 'completed' ? 'finished' : 'failed',
      basis: activity.stop.source === 'transcript' ? 'transcript' : 'hook_stop',
      turn_open: false,
      open_call_tool: null,
      open_call_age_seconds: null,
      shell_fault: null,
    }
  }

  const turnOpen =
    activity.transcript?.readable === true &&
    activity.transcript.turn_ended === false

  if (activity.open_call) {
    const startedMs = Date.parse(activity.open_call.started_at)
    const ageSeconds = Number.isFinite(startedMs)
      ? Math.max(0, (Date.now() - startedMs) / 1000)
      : null
    const shellState = activity.open_call.shell_record_state ?? null
    const shellFault = shellState ? shellFaultFromState(shellState) : null

    return {
      state: activity.open_call.shell_heartbeat ? 'in_shell' : 'in_tool',
      basis: 'hook_events',
      turn_open: turnOpen,
      open_call_tool: activity.open_call.tool,
      open_call_age_seconds: ageSeconds,
      shell_fault: shellFault,
    }
  }

  if (turnOpen) {
    return {
      state: 'generating',
      basis: 'transcript',
      turn_open: true,
      open_call_tool: null,
      open_call_age_seconds: null,
      shell_fault: null,
    }
  }

  return {
    state: 'unknown',
    basis: 'hook_events',
    turn_open: false,
    open_call_tool: null,
    open_call_age_seconds: null,
    shell_fault: null,
  }
}

export function deterministicStallCause(
  current: AgentActivity | null,
  previous: AgentActivity | null,
): WatchStallCause | null {
  if (!current?.open_call || !previous?.open_call) {
    return null
  }

  const currentId = current.open_call.tool_use_id ?? null
  const previousId = previous.open_call.tool_use_id ?? null

  if (!currentId || currentId !== previousId) {
    return null
  }

  const fault = agentLiveness(current).shell_fault

  if (!fault) {
    return null
  }

  return agentLiveness(previous).shell_fault === fault ? fault : null
}

export function quietStallApplies(activity: AgentActivity | null): boolean {
  if (!activity) {
    return true
  }

  return activity.transcript === null || activity.transcript.readable !== true
}

export function workerActivityRefusal(
  activity: AgentActivity | null,
): string | null {
  if (!activity) {
    return null
  }

  if (
    activity.transcript?.readable === true &&
    activity.transcript.turn_ended === false
  ) {
    return (
      `Worker ${activity.agent_id} still has an open transcript turn. ` +
      `Rearm pan watch and resume the subagent if its turn was lost.`
    )
  }

  if (
    activity.transcript?.readable !== true &&
    activity.open_call &&
    !activity.stop
  ) {
    return (
      `Worker ${activity.agent_id} still has open call ` +
      `'${activity.open_call.tool}' since ${activity.open_call.started_at}. ` +
      `Rearm pan watch before submitting.`
    )
  }

  return null
}
