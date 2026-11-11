/** Observation rollover for explicitly recorded process-backed worker retries. */

import { mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

import {
  fileExists,
  isRecord,
  readJson,
  readText,
  withOperationMutex,
  writeJsonAtomic,
  writeTextAtomic,
} from '../io.js'
import {
  liveChildEndedAt,
  loadDelegationLiveRecord,
  delegationCustodyDirectory,
  delegationCustodyPreparationPath,
} from '../executors/delegation-live.js'
import { resolveRunLayout } from '../run-layout.js'
import { loadState } from '../state.js'
import type { LaunchRecord } from './launch.js'

/**
 * Retain the previous observation epoch before adopting a declared retry.
 * A new handle alone is insufficient: its previous executor must have exited,
 * the previous watch must be closed, and both handles must be recorded in order.
 */
export function recoverRecordedProcessRetry(
  root: string,
  runId: string,
  invocationId: string,
  requestedHandle?: string,
): void {
  const layout = resolveRunLayout(root, runId)
  const launchPath = layout.evidence(`${invocationId}-launch.json`).absolute

  if (!fileExists(launchPath) || !fileExists(layout.state.absolute)) {
    return
  }

  withOperationMutex(`${launchPath}.retry.mutex`, () => {
    if (!fileExists(launchPath)) {
      return
    }

    const existing = readJson(launchPath)

    if (
      !isRecord(existing) ||
      existing.schema_version !== 1 ||
      typeof existing.launched_at !== 'string' ||
      !Number.isFinite(Date.parse(existing.launched_at)) ||
      existing.run_id !== runId ||
      existing.invocation_id !== invocationId ||
      typeof existing.executor_launch_id !== 'string' ||
      typeof existing.worker_handle !== 'string'
    ) {
      return
    }

    const workers = (loadState(root, runId).delegated_workers ?? [])
      .filter(
        (worker) =>
          worker.invocation_id === invocationId &&
          worker.role === 'worker' &&
          Number.isSafeInteger(worker.attempt) &&
          worker.attempt > 0,
      )
      .sort((left, right) => left.attempt - right.attempt)
    const latest = workers.at(-1)
    const previous = workers.find(
      (worker) => worker.handle === existing.worker_handle,
    )

    if (
      !latest ||
      !previous ||
      latest.attempt <= previous.attempt ||
      latest.handle === previous.handle ||
      (requestedHandle !== undefined && requestedHandle !== latest.handle) ||
      !Number.isFinite(Date.parse(latest.launched_at))
    ) {
      return
    }

    const invocation = readJson(
      layout.invocation(invocationId, '.json').absolute,
    )

    if (
      !isRecord(invocation) ||
      typeof invocation.attempt !== 'number' ||
      !Number.isSafeInteger(invocation.attempt)
    ) {
      return
    }

    const identity = {
      run_id: runId,
      invocation_id: invocationId,
      role: 'stage',
      attempt: invocation.attempt,
      launch_id: existing.executor_launch_id,
    }
    const authority = loadDelegationLiveRecord(root, identity, true)

    if (
      !authority &&
      (fileExists(delegationCustodyDirectory(root, identity)) ||
        fileExists(delegationCustodyPreparationPath(root, identity)))
    ) {
      return
    }

    const priorLive = authority ?? loadDelegationLiveRecord(root, identity)
    const endedAt = priorLive ? liveChildEndedAt(priorLive) : undefined

    if (
      endedAt === undefined ||
      priorLive?.ended_at === undefined ||
      Date.parse(endedAt) > Date.parse(latest.launched_at) ||
      Date.parse(priorLive.ended_at) > Date.parse(latest.launched_at)
    ) {
      return
    }

    const ledgerPath = layout.evidence(`${invocationId}-watch.jsonl`).absolute

    if (fileExists(ledgerPath)) {
      const lines = readText(ledgerPath).trim().split('\n')
      let last: unknown

      try {
        last = JSON.parse(lines.at(-1) ?? '')
      } catch {
        return // Partial observation evidence cannot authorize a new epoch.
      }

      if (!isRecord(last) || typeof last.terminal_state !== 'string') {
        return
      }
    }

    const archive = layout.evidence(
      `${invocationId}-worker-attempt-${previous.attempt}`,
    ).absolute
    mkdirSync(archive, { recursive: true })
    const names = [
      `${invocationId}-watch.jsonl`,
      `${invocationId}-watch.jsonl.blocking.jsonl`,
      `${invocationId}-delegation-background.json`,
      `${invocationId}-foreground-return.json`,
      `${invocationId}-launch.json`,
    ]
    const retained: string[] = []

    for (const name of names) {
      const source = layout.evidence(name).absolute

      if (fileExists(source)) {
        const destination = path.join(archive, name)
        const text = readText(source)

        if (fileExists(destination) && readText(destination) !== text) {
          throw new Error(`Retry observation archive conflicts with ${name}`)
        }
        writeTextAtomic(destination, text)
        retained.push(source)
      }
    }

    // Keep the old launch until every companion was retained, so recovery can
    // finish safely after an interrupted copy or removal.
    for (const source of retained) {
      if (source !== launchPath) {
        unlinkSync(source)
      }
    }

    const launch: LaunchRecord = {
      schema_version: 1,
      run_id: runId,
      invocation_id: invocationId,
      launch_mode: latest.launch_mode,
      launched_at: latest.launched_at,
      launched_at_source: 'invocation_record',
      worker_handle: latest.handle,
      recorded_at: new Date().toISOString(),
    }
    writeJsonAtomic(launchPath, launch)
  })
}
