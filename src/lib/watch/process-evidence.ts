/**
 * Process identity and liveness, supervisor agent-state evidence, and wake
 * spans.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { PanError, invariant } from '../errors.js'
import {
  fileExists,
  isRecord,
  processIsAlive,
  readJson,
  readText,
  resolveInside,
  sha256,
} from '../io.js'

import { WATCH_EVIDENCE_INVALID, type WatchAgentState } from './types.js'
import { readWatchRecord } from './record.js'

/**
 * A process's start identity, so a reused PID cannot impersonate the watched
 * process. `ps -o lstart=` answers on macOS and Linux; an unavailable answer
 * degrades to null, which callers treat as "identity unknown" rather than as
 * a match.
 */
export function processStartIdentity(pid: number): string | null {
  if (!processIsAlive(pid)) {
    return null
  }

  try {
    const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    })

    if (result.error || result.status !== 0) {
      return null
    }

    const identity = result.stdout.trim()

    return identity.length > 0 ? identity : null
  } catch {
    return null
  }
}

/**
 * Whether the process is a zombie: exited but not yet reaped. `kill(pid, 0)`
 * still succeeds for one, so liveness without this check reads a dead child
 * as alive until its parent collects it.
 */
export function processIsZombie(pid: number): boolean {
  try {
    const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    })

    if (result.error || result.status !== 0) {
      return false
    }

    return result.stdout.trim().toUpperCase().startsWith('Z')
  } catch {
    return false
  }
}

/** Liveness for watch purposes: present in the process table and not a zombie. */
export function processRunning(pid: number): boolean {
  return processIsAlive(pid) && !processIsZombie(pid)
}

/** The validated content of a `--agent-state-evidence` record. */
export interface AgentStateEvidence {
  path: string
  digest: string
  run_id: string
  invocation_id: string
  observed_state: WatchAgentState
  observed_at: string
  record_source: string
  evidence_reference: string
}

/**
 * Load and validate the recorded supervisor inspection behind an agent-state
 * report. The record is a supervisor assertion: it is checked for shape,
 * identity, and clock sanity, then labeled rather than trusted blindly.
 */
export function loadAgentStateEvidence(
  root: string,
  runId: string,
  invocationId: string,
  evidencePath: string,
  nowMs: number = Date.now(),
): AgentStateEvidence {
  const absolute = resolveInside(root, evidencePath)
  const logsRoot = resolveInside(root, 'runtime/logs')

  invariant(
    absolute === logsRoot || absolute.startsWith(`${logsRoot}${path.sep}`),
    `--agent-state-evidence MUST resolve inside the runtime evidence tree ` +
      `(runtime/logs): ${evidencePath}`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    fileExists(absolute),
    `--agent-state-evidence record not found: ${evidencePath}`,
    { code: WATCH_EVIDENCE_INVALID },
  )

  let value: unknown

  try {
    value = readJson(absolute)
  } catch {
    throw new PanError(
      `--agent-state-evidence record is not readable JSON: ${evidencePath}`,
      { code: WATCH_EVIDENCE_INVALID },
    )
  }

  const record = isRecord(value) ? value : {}
  const observedState = record.observed_state
  const observedAt = record.observed_at

  invariant(
    record.run_id === runId && record.invocation_id === invocationId,
    `--agent-state-evidence record ${evidencePath} names run ` +
      `${String(record.run_id)} invocation ${String(record.invocation_id)}, ` +
      `not ${runId} ${invocationId}.`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    observedState === 'running' || observedState === 'completed',
    `--agent-state-evidence record ${evidencePath} MUST carry ` +
      `observed_state 'running' or 'completed'.`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    typeof observedAt === 'string' && Number.isFinite(Date.parse(observedAt)),
    `--agent-state-evidence record ${evidencePath} MUST carry an ISO-8601 ` +
      `observed_at.`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    Date.parse(observedAt) <= nowMs + 60_000,
    `--agent-state-evidence record ${evidencePath} is future-dated ` +
      `(${observedAt}).`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    typeof record.source === 'string' && record.source.trim().length > 0,
    `--agent-state-evidence record ${evidencePath} MUST name its source.`,
    { code: WATCH_EVIDENCE_INVALID },
  )
  invariant(
    typeof record.evidence === 'string' && record.evidence.trim().length > 0,
    `--agent-state-evidence record ${evidencePath} MUST name the evidence ` +
      `reference the inspection rests on.`,
    { code: WATCH_EVIDENCE_INVALID },
  )

  return {
    path: evidencePath,
    digest: sha256(readText(absolute)),
    run_id: runId,
    invocation_id: invocationId,
    observed_state: observedState,
    observed_at: observedAt,
    record_source: record.source.trim(),
    evidence_reference: record.evidence.trim(),
  }
}

/**
 * Seconds between the first and the last wake the invocation's watch record
 * holds, or null when it holds fewer than two wakes.
 *
 * The watch observed the worker across that whole span, so no honest
 * launch-to-return elapsed time can be shorter than it. It is the
 * independent lower bound a foreground-return attestation is checked against.
 */
export function watchWakeSpanSeconds(
  root: string,
  runId: string,
  invocationId: string,
): number | null {
  const wakes = readWatchRecord(root, runId, invocationId).filter(
    (entry) => entry.event === 'wake',
  )

  if (wakes.length < 2) {
    return null
  }

  const first = Date.parse(wakes[0].recorded_at)
  const last = Date.parse(wakes[wakes.length - 1].recorded_at)

  return Number.isFinite(first) && Number.isFinite(last)
    ? (last - first) / 1000
    : null
}
