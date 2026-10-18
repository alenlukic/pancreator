/**
 * Process-backed activity for a worker the harness dispatched through an
 * external executor whose session the agent index never sees.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import type { AgentActivity } from '../agent-index/activity.js'
import {
  readShellRecord,
  sampleProcessTable,
  validatedParentRecord,
  type ProcessTable,
  type ShellRecordState,
} from '../agent-index/shell-records.js'
import {
  delegationLivePaths,
  loadDelegationLiveRecord,
  type DelegationLiveRecord,
} from '../executors/delegation-live.js'
import { resolveRunLayout } from '../run-layout.js'
import type { Invocation } from '../types.js'
import { readLaunchRecord, recordInvocationLaunch } from './launch.js'
import {
  delegationExecutionPath,
  loadDelegationExecutionRecord,
} from '../validation/artifacts.js'

/**
 * Executors whose process exit, recorded with its JSONL `result` event,
 * stands in for an agent-index stop. `pan delegate` writes the execution
 * record only after the process exits. Before then, a validated live record
 * and its wrapper can establish activity, but never completion.
 */
const PROCESS_BACKED_EXECUTORS = new Set(['copilot'])

export function processBackedExecutor(invocation: Invocation): boolean {
  return PROCESS_BACKED_EXECUTORS.has(
    invocation.stage.persona_executor ?? 'cursor',
  )
}

function latestLiveRecord(
  root: string,
  invocation: Invocation,
): {
  record: DelegationLiveRecord | null
  latestLaunchMs: number | null
} {
  const directory = resolveRunLayout(root, invocation.run_id).evidence(
    '',
  ).absolute
  let names: string[]

  try {
    names = readdirSync(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { record: null, latestLaunchMs: null }
    }
    throw error
  }

  const prefix = `${invocation.invocation_id}.copilot.stage.attempt-${invocation.attempt}.`
  const launch = readLaunchRecord(
    root,
    invocation.run_id,
    invocation.invocation_id,
  )
  const pinned =
    launch?.executor_launch_id ??
    (launch?.worker_handle?.startsWith('copilot:')
      ? launch.worker_handle.slice('copilot:'.length)
      : undefined)
  const records = names
    .filter((name) => name.startsWith(prefix) && name.endsWith('.live.json'))
    .map((name) =>
      loadDelegationLiveRecord(root, {
        run_id: invocation.run_id,
        invocation_id: invocation.invocation_id,
        role: 'stage',
        attempt: invocation.attempt,
        launch_id: name.slice(prefix.length, -'.live.json'.length),
      }),
    )
    .filter(
      (record): record is DelegationLiveRecord =>
        record !== null &&
        (!pinned || pinned === record.launch_id) &&
        Date.parse(record.launched_at) >= Date.parse(invocation.created_at),
    )
    .sort((a, b) => Date.parse(b.launched_at) - Date.parse(a.launched_at))

  const latest = records[0]
  const latestLaunchMs = latest ? Date.parse(latest.launched_at) : null
  // Ambiguity prevents activity selection, but must not erase audit freshness.
  const ambiguous =
    records[1] !== undefined &&
    Date.parse(records[1].launched_at) === latestLaunchMs

  return {
    record: latest && !ambiguous ? latest : null,
    latestLaunchMs,
  }
}

function descendsFrom(
  table: ProcessTable,
  pid: number,
  ancestor: number,
): boolean {
  const seen = new Set<number>()
  let current = pid

  while (!seen.has(current)) {
    if (current === ancestor) return true
    seen.add(current)
    const row = table.get(current)
    if (!row) return false
    current = row.ppid
  }
  return false
}

function liveActivity(
  root: string,
  live: DelegationLiveRecord,
  nowMs: number,
  table: ProcessTable | null,
): AgentActivity | null {
  const wrapperPath = validatedParentRecord(live.wrapper_record_path)

  if (
    Date.parse(live.launched_at) > nowMs ||
    Date.parse(live.heartbeat_at) > nowMs ||
    Date.parse(live.heartbeat_at) < Date.parse(live.launched_at) ||
    !wrapperPath ||
    !table ||
    !live.relay_start_identity ||
    (live.child_pid !== undefined && !live.child_start_identity)
  ) {
    return null
  }

  const wrapper = readShellRecord(root, wrapperPath, nowMs, table)
  if (
    !wrapper?.wrapper_process_identity ||
    wrapper.wrapper_pid === null ||
    wrapper.started_at === null ||
    !Number.isFinite(Date.parse(wrapper.started_at)) ||
    Date.parse(wrapper.started_at) > Date.parse(live.launched_at)
  ) {
    return null
  }

  let state: ShellRecordState = wrapper.process_state
  const relay = table.get(live.relay_pid)
  const child =
    live.child_pid === undefined ? undefined : table.get(live.child_pid)
  const wrapperRow = table.get(wrapper.wrapper_pid)
  const identityFault =
    !relay ||
    relay.lstart !== live.relay_start_identity ||
    /^Z/iu.test(relay.stat) ||
    !wrapperRow ||
    wrapperRow.lstart !== wrapper.wrapper_process_identity ||
    (live.child_pid !== undefined &&
      (!child ||
        child.lstart !== live.child_start_identity ||
        /^Z/iu.test(child.stat)))

  if (identityFault) {
    state = 'dead'
  } else if (
    !descendsFrom(table, live.relay_pid, wrapper.wrapper_pid) ||
    (child && !descendsFrom(table, child.pid, live.relay_pid))
  ) {
    return null
  } else if (
    /^T/iu.test(wrapperRow.stat) ||
    /^T/iu.test(relay.stat) ||
    (child && /^T/iu.test(child.stat))
  ) {
    state = 'stopped'
  }

  // A relay end or wrapper exit is not the executor's validated result audit.
  if (live.ended_at !== undefined || state === 'exited') {
    return null
  }

  const fresh =
    wrapper.heartbeat_age_seconds !== null &&
    wrapper.heartbeat_age_seconds <= 2 * (wrapper.heartbeat_seconds ?? 60)
  const running =
    !['dead', 'stopped', 'heartbeat_stale'].includes(state) && fresh
  const activity: AgentActivity = {
    agent_id: `copilot:${live.launch_id}`,
    aliases: [],
    event_file: path.relative(root, delegationLivePaths(root, live).record),
    event_count: live.sequence,
    last_event_kind: null,
    last_event_tool: null,
    last_event_at: null,
    last_event_age_seconds: null,
    open_call: {
      tool: 'Shell',
      tool_use_id: `copilot:${live.launch_id}`,
      started_at: live.launched_at,
      summary: 'Copilot executor process',
      shell_record_state: state,
      shell_heartbeat:
        wrapper.heartbeat_age_seconds === null
          ? null
          : {
              record_path: wrapper.record_path,
              heartbeat_at: new Date(
                nowMs - wrapper.heartbeat_age_seconds * 1000,
              ).toISOString(),
              age_seconds: wrapper.heartbeat_age_seconds,
              label: wrapper.label,
              pid: live.child_pid ?? live.relay_pid,
              elapsed_seconds: (nowMs - Date.parse(live.launched_at)) / 1000,
              log_bytes: wrapper.log_bytes,
              last_output_at: wrapper.last_output_at,
              recent_lines: [],
            },
    },
    shell_records: [wrapper],
    stall_suppressed: running,
    stop: null,
    transcript: null,
    // Heartbeat and relay snapshot rewrites are liveness, not model progress.
    signature: `copilot:${live.launch_id}:${live.sequence}`,
    liveness: {
      state: running ? 'in_shell' : 'unknown',
      basis: 'process',
      turn_open: false,
      open_call_tool: 'Shell',
      open_call_age_seconds: (nowMs - Date.parse(live.launched_at)) / 1000,
      shell_fault: null,
    },
  }
  return activity
}

/** Final execution audits take precedence over validated live process evidence. */
export function executorProcessActivity(
  root: string,
  invocation: Invocation,
  nowMs: number,
  table?: ProcessTable | null,
): AgentActivity | null {
  if (!processBackedExecutor(invocation)) {
    return null
  }

  const record = loadDelegationExecutionRecord(
    root,
    invocation.run_id,
    invocation.invocation_id,
  )

  const { record: live, latestLaunchMs } = latestLiveRecord(root, invocation)
  const launch = readLaunchRecord(
    root,
    invocation.run_id,
    invocation.invocation_id,
  )
  if (live && !launch?.executor_launch_id) {
    recordInvocationLaunch(root, invocation.run_id, invocation.invocation_id, {
      defaultLaunchedAtMs: Date.parse(live.launched_at),
      defaultSource: 'watch_arm',
      ...(!launch?.worker_handle
        ? { workerHandle: `copilot:${live.launch_id}` }
        : {}),
      executorLaunchId: live.launch_id,
    })
  }
  const recordedMs = record ? Date.parse(record.recorded_at) : NaN
  if (
    record === null ||
    record.invocation_id !== invocation.invocation_id ||
    record.run_id !== invocation.run_id ||
    record.executor !== 'copilot' ||
    record.stage !== invocation.stage.slug ||
    !Number.isFinite(recordedMs) ||
    !Number.isFinite(Date.parse(invocation.created_at)) ||
    recordedMs > nowMs ||
    recordedMs < Date.parse(invocation.created_at) ||
    (latestLaunchMs !== null && recordedMs < latestLaunchMs) ||
    (latestLaunchMs !== null && live === null) ||
    ((launch?.executor_launch_id ||
      launch?.worker_handle?.startsWith('copilot:')) &&
      live === null) ||
    (live !== null &&
      (live.child_ended_at === undefined ||
        recordedMs < Date.parse(live.child_ended_at) ||
        !live.session_id ||
        record.session_id !== live.session_id)) ||
    (!Number.isSafeInteger(record.exit_code) && record.timed_out !== true)
  ) {
    return live
      ? liveActivity(
          root,
          live,
          nowMs,
          table === undefined ? sampleProcessTable() : table,
        )
      : null
  }

  const completed =
    record.exit_code === 0 &&
    record.timed_out === false &&
    typeof record.session_id === 'string' &&
    record.session_id.length > 0 &&
    record.is_error !== true &&
    !record.failure_reason

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
    liveness: {
      state: completed ? 'finished' : 'failed',
      basis: 'process',
      turn_open: false,
      open_call_tool: null,
      open_call_age_seconds: null,
      shell_fault: null,
    },
  }
}
