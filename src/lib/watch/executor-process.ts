/**
 * Process-backed activity for a worker the harness dispatched through an
 * external executor whose session the agent index never sees.
 */

import type { AgentActivity } from '../agent-index/activity.js'
import type { Invocation } from '../types.js'
import {
  delegationExecutionPath,
  loadDelegationExecutionRecord,
} from '../validation/artifacts.js'

/**
 * Executors whose process exit, recorded with its JSONL `result` event,
 * stands in for an agent-index stop. `pan delegate` writes the execution
 * record only after the process exits, so an absent record means the
 * process is still open.
 */
const PROCESS_BACKED_EXECUTORS = new Set(['copilot'])

export function processBackedExecutor(invocation: Invocation): boolean {
  return PROCESS_BACKED_EXECUTORS.has(
    invocation.stage.persona_executor ?? 'cursor',
  )
}

/** The worker's activity from its execution record, or null while it runs. */
export function executorProcessActivity(
  root: string,
  invocation: Invocation,
  nowMs: number,
): AgentActivity | null {
  if (!processBackedExecutor(invocation)) {
    return null
  }

  const record = loadDelegationExecutionRecord(
    root,
    invocation.run_id,
    invocation.invocation_id,
  )

  if (record === null || record.invocation_id !== invocation.invocation_id) {
    return null
  }

  const completed =
    record.exit_code === 0 &&
    !record.timed_out &&
    record.session_id !== undefined &&
    record.is_error !== true
  const recordedMs = Date.parse(record.recorded_at)

  return {
    agent_id: `${record.executor}:${record.session_id ?? record.invocation_id}`,
    aliases: [],
    event_file: delegationExecutionPath(
      invocation.run_id,
      invocation.invocation_id,
      root,
    ),
    event_count: 0,
    last_event_kind: null,
    last_event_tool: null,
    last_event_at: record.recorded_at,
    last_event_age_seconds: Number.isFinite(recordedMs)
      ? Math.max(0, (nowMs - recordedMs) / 1000)
      : null,
    open_call: null,
    stall_suppressed: false,
    stop: {
      status: completed ? 'completed' : 'error',
      recorded_at: record.recorded_at,
      transcript_path: null,
      source: 'process',
      terminal_output_present: completed,
    },
    transcript: null,
    signature: `${record.executor}:${record.recorded_at}:${record.exit_code}`,
  }
}
