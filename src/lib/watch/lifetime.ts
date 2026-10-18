/** Worker clocks are process/stop receipts, never output file timestamps. */
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import {
  liveChildEndedAt,
  loadDelegationLiveRecord,
} from '../executors/delegation-live.js'
import { readAgentIndex } from '../agent-index/activity.js'
import { fileExists, isRecord, readJson } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { readLaunchRecord, type LaunchRecord } from './launch.js'
import { foregroundReturnRecordPath } from './paths.js'
import type { ForegroundReturnRecord } from './types.js'

/** One matching and chronology decision for every foreground consumer. */
export function validForegroundReturn(
  launch: LaunchRecord | null,
  receipt: unknown,
  nowMs = Date.now(),
): receipt is ForegroundReturnRecord {
  return (
    launch !== null &&
    isRecord(receipt) &&
    receipt.schema_version === 1 &&
    receipt.run_id === launch.run_id &&
    receipt.invocation_id === launch.invocation_id &&
    receipt.launch_mode === 'foreground' &&
    launch.launch_mode === 'foreground' &&
    receipt.launched_at === launch.launched_at &&
    typeof receipt.returned_at === 'string' &&
    Number.isFinite(Date.parse(launch.launched_at)) &&
    Date.parse(receipt.returned_at) >= Date.parse(launch.launched_at) &&
    Date.parse(receipt.returned_at) <= nowMs &&
    isRecord(receipt.observation) &&
    receipt.observation.output_present === true &&
    receipt.elapsed_implausible !== true
  )
}

export interface WorkerLifetime {
  started_ms: number | null
  ended_ms: number | null
  seconds: number | null
  basis: 'foreground_return' | 'worker_exit' | 'agent_stop' | 'unknown'
  diagnostics: string[]
}

export function workerLifetime(
  root: string,
  runId: string,
  invocationId: string,
): WorkerLifetime {
  const unknown = (diagnostic: string): WorkerLifetime => ({
    started_ms: null,
    ended_ms: null,
    seconds: null,
    basis: 'unknown',
    diagnostics: [diagnostic],
  })
  const finish = (
    start: string,
    end: string,
    basis: WorkerLifetime['basis'],
  ): WorkerLifetime => {
    const started = Date.parse(start)
    const ended = Date.parse(end)
    return Number.isFinite(started) &&
      Number.isFinite(ended) &&
      ended >= started &&
      ended <= Date.now()
      ? {
          started_ms: started,
          ended_ms: ended,
          seconds: (ended - started) / 1000,
          basis,
          diagnostics: [],
        }
      : unknown('Invalid launch/terminal chronology.')
  }
  const launch = readLaunchRecord(root, runId, invocationId)
  if (!launch) return unknown('No matching worker launch receipt.')
  const directory = resolveRunLayout(root, runId).evidence('').absolute
  const records = (fileExists(directory) ? readdirSync(directory) : [])
    .filter(
      (name) =>
        name.startsWith(`${invocationId}.copilot.stage.attempt-`) &&
        name.endsWith('.live.json'),
    )
    .flatMap((name) => {
      const match = /\.attempt-(\d+)\.([A-Za-z0-9_-]+)\.live\.json$/u.exec(name)
      if (!match) return []
      const record = loadDelegationLiveRecord(root, {
        run_id: runId,
        invocation_id: invocationId,
        role: 'stage',
        attempt: Number(match[1]),
        launch_id: match[2]!,
      })
      return record ? [record] : []
    })
  const executorLaunch =
    launch.executor_launch_id ??
    (launch.worker_handle?.startsWith('copilot:')
      ? launch.worker_handle.slice('copilot:'.length)
      : undefined)
  const pinned = executorLaunch
    ? records.filter((record) => record.launch_id === executorLaunch)
    : records
  const live = pinned.length === 1 ? pinned[0] : undefined
  const childEndedAt = live ? liveChildEndedAt(live) : undefined
  if (
    executorLaunch &&
    live &&
    childEndedAt &&
    live.child_pid &&
    live.child_start_identity
  ) {
    return finish(live.launched_at, childEndedAt, 'worker_exit')
  }
  if (executorLaunch && live && !childEndedAt) {
    return unknown('Pinned worker has no child exit receipt.')
  }
  if (launch.worker_handle && !launch.worker_handle.startsWith('copilot:')) {
    const handle = launch.worker_handle
    const agents = readAgentIndex(root).agents.filter(
      (agent) =>
        agent.run_id === runId &&
        agent.invocation_id === invocationId &&
        (agent.agent_id === handle || agent.aliases.includes(handle)),
    )
    const agent = agents.length === 1 ? agents[0] : undefined
    if (
      agent?.stop &&
      ['completed', 'error', 'aborted'].includes(agent.stop.status)
    ) {
      return finish(launch.launched_at, agent.stop.recorded_at, 'agent_stop')
    }
  }
  const foregroundPath = path.resolve(
    root,
    foregroundReturnRecordPath(root, runId, invocationId),
  )
  if (fileExists(foregroundPath)) {
    let receipt: unknown
    try {
      receipt = readJson(foregroundPath)
    } catch (error) {
      if (!(error instanceof PanError) || error.code !== 'INVALID_JSON')
        throw error
      return unknown('Malformed foreground return receipt.')
    }
    if (validForegroundReturn(launch, receipt)) {
      return finish(
        launch.launched_at,
        receipt.returned_at,
        'foreground_return',
      )
    }
    return unknown('Foreground return receipt does not match the launch.')
  }
  return unknown(
    launch.worker_handle
      ? 'No matching worker exit or indexed stop receipt with process identity.'
      : 'Worker identity was never pinned.',
  )
}
