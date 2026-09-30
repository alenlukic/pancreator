/**
 * The session mutex, reconciliation of the session record with the runs it
 * started, and the session status view.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  withOperationMutex,
} from '../io.js'
import {
  bestOfNCandidatePath,
  legacyBestOfNCandidatePath,
} from '../project-config.js'
import { statePath } from '../state.js'
import type { RunStatus } from '../types.js'
import {
  agentSuffix,
  type BestOfNConfigsFile,
  bestOfNDir,
  bestOfNMutexPath,
  type BestOfNPendingCandidate,
  type BestOfNState,
  bestOfNStatePath,
  type BestOfNStatus,
  candidateRunState,
  loadBestOfNState,
  parseBestOfNConfigs,
  persistBestOfNState,
  TERMINAL_STATUSES,
} from './state.js'

/**
 * Run one mutating session operation with exclusive access to its record.
 *
 * The record is read inside the mutex, so a concurrent command can neither base
 * a mutation on a record another command already replaced nor create a second
 * consolidation run. A mutex whose owner died is recovered deterministically.
 */
export function withBestOfNSession<T>(
  root: string,
  bonId: string,
  operation: (state: BestOfNState) => T,
): T {
  // Checked before the mutex, so an unknown session id never materializes a
  // session directory.
  invariant(
    fileExists(bestOfNStatePath(root, bonId)),
    `Unknown best-of-N session: ${bonId}`,
    { code: 'BEST_OF_N_NOT_FOUND' },
  )

  return withOperationMutex(bestOfNMutexPath(root, bonId), () => {
    const reconciled = reconcileSessionState(
      root,
      loadBestOfNState(root, bonId),
    )

    return operation(
      reconciled.adopted.length > 0 || reconciled.promoted
        ? persistBestOfNState(root, reconciled.state)
        : reconciled.state,
    )
  })
}

/** A child run this session created, as its own durable state records it. */
interface DiscoveredSessionRun {
  run_id: string
  role: 'candidate' | 'consolidation'
  slot: string
}

/**
 * Find every workflow run whose durable state names this session.
 *
 * `createRun` persists the child run — including its `best_of_n` role — before
 * the session record learns the run id, so the child states are the authority
 * when the two disagree. A state file that cannot be read is skipped: discovery
 * repairs the session record, and a malformed run surfaces through the run's
 * own commands rather than by blocking every session operation.
 */
function discoverSessionRuns(
  root: string,
  bonId: string,
): DiscoveredSessionRun[] {
  const base = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(base)) {
    return []
  }

  const discovered: DiscoveredSessionRun[] = []

  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const runStatePath = statePath(root, entry.name)

    if (!fileExists(runStatePath)) {
      continue
    }

    let value: unknown

    try {
      value = readJson(runStatePath)
    } catch {
      continue
    }

    if (!isRecord(value) || !isRecord(value.best_of_n)) {
      continue
    }

    const role = value.best_of_n.role

    if (
      value.best_of_n.bon_id !== bonId ||
      typeof value.run_id !== 'string' ||
      typeof value.best_of_n.slot !== 'string' ||
      (role !== 'candidate' && role !== 'consolidation')
    ) {
      continue
    }

    discovered.push({
      run_id: value.run_id,
      role,
      slot: value.best_of_n.slot,
    })
  }

  return discovered
}

/**
 * Adopt child runs the session record does not know about.
 *
 * The handoff between `createRun` and the session-record write is not atomic:
 * a process killed between the two leaves a run that exists durably while the
 * session still shows a pending slot — or, for consolidation, no record at
 * all, which would let a retry create a second consolidation run against the
 * same workspace. Reconciliation reads the child runs back and repairs the
 * record instead of trusting it, and promotes an `initializing` session to
 * `ready` when every configured candidate slot has an adopted run.
 */
function reconcileSessionState(
  root: string,
  state: BestOfNState,
): { state: BestOfNState; adopted: string[]; promoted: boolean } {
  const discovered = discoverSessionRuns(root, state.bon_id)
  const adopted: string[] = []
  let next = state

  for (const run of discovered) {
    if (run.role === 'consolidation') {
      if (!next.consolidation) {
        next = {
          ...next,
          consolidation: {
            slot: run.slot,
            run_id: run.run_id,
            agent_suffix: agentSuffix(next.bon_id, run.slot),
            request_path: `runtime/logs/best-of-n/${next.bon_id}/consolidation-request.md`,
          },
        }
        adopted.push(run.run_id)
      }

      continue
    }

    if (next.candidates.some((entry) => entry.run_id === run.run_id)) {
      continue
    }

    // A candidate record for the slot with a different run id would be
    // ambiguous, but it cannot occur: a slot creates at most one run, and the
    // record is only ever written from that run's id.
    if (next.candidates.some((entry) => entry.slot === run.slot)) {
      continue
    }

    const pending = next.pending.find((entry) => entry.slot === run.slot)
    const claim: BestOfNPendingCandidate = pending ?? {
      slot: run.slot,
      worktree_path: resolveCandidateWorktreePath(root, next.bon_id, run.slot),
      agent_suffix: agentSuffix(next.bon_id, run.slot),
    }

    next = {
      ...next,
      candidates: [...next.candidates, { ...claim, run_id: run.run_id }],
      pending: next.pending.filter((entry) => entry.slot !== run.slot),
    }
    adopted.push(run.run_id)
  }

  const promoted =
    next.status === 'initializing' && everyConfiguredSlotHasRun(root, next)

  if (promoted) {
    next = { ...next, status: 'ready' }
  }

  return { state: next, adopted, promoted }
}

/**
 * Whether the session's stored configs are fully covered by adopted candidate
 * runs. The stored configs file is the durable statement of how many slots
 * initialization set out to claim, so it — not the possibly-stale session
 * record — decides when a recovered session is complete.
 */
function everyConfiguredSlotHasRun(root: string, state: BestOfNState): boolean {
  const storedConfigs = path.join(
    bestOfNDir(root, state.bon_id),
    'configs.json',
  )

  if (!fileExists(storedConfigs)) {
    return false
  }

  let configs: BestOfNConfigsFile

  try {
    configs = parseBestOfNConfigs(
      readJson(storedConfigs),
      `runtime/logs/best-of-n/${state.bon_id}/configs.json`,
    )
  } catch {
    return false
  }

  const claimed = new Set(state.candidates.map((entry) => entry.slot))

  return configs.candidates.every((candidate) => claimed.has(candidate.name))
}

/**
 * Reports a best-of-N session's status: each candidate's run status and resume
 * command, success and unresolved counts, whether consolidation may start, and
 * the clean command when initialization never finished. A candidate whose run
 * state is missing reports as `failed`.
 *
 * Read-only: it reconciles the session view in memory without taking the
 * session mutex or persisting the repair.
 */
export function bestOfNStatus(root: string, bonId: string): BestOfNStatus {
  // Status holds no mutex, so the adopted view is reported without being
  // persisted; the next mutating command durably repairs the record.
  const { state } = reconcileSessionState(root, loadBestOfNState(root, bonId))
  const candidates = state.candidates.map((candidate) => {
    const run = candidateRunState(root, candidate.run_id)
    // A run whose state is gone can never be repaired or resumed, so it is
    // reported as a terminal failure rather than as work still in flight.
    const status: RunStatus = run?.status ?? 'failed'

    return {
      ...candidate,
      status,
      current_stage: run?.current_stage ?? null,
      terminal: TERMINAL_STATUSES.has(status),
      resume_command: `/pan-resume ${candidate.run_id}`,
    }
  })
  const unresolved = candidates
    .filter((candidate) => !candidate.terminal && !candidate.abandoned)
    .map((candidate) => candidate.run_id)
  const successes = candidates.filter(
    (candidate) => candidate.status === 'succeeded' && !candidate.abandoned,
  ).length
  const consolidationRun = state.consolidation
    ? candidateRunState(root, state.consolidation.run_id)
    : null

  return {
    bon_id: bonId,
    session_status: state.status,
    candidates,
    successes,
    unresolved,
    incomplete: state.pending,
    consolidation_ready:
      state.status === 'ready' &&
      unresolved.length === 0 &&
      successes > 0 &&
      !state.consolidation,
    recovery_command:
      state.status === 'ready' ? null : `./bin/pan best-of-n clean ${bonId}`,
    ...(state.consolidation
      ? {
          consolidation: {
            ...state.consolidation,
            status: consolidationRun?.status ?? 'failed',
          },
        }
      : {}),
  }
}

function resolveCandidateWorktreePath(
  root: string,
  bonId: string,
  slot: string,
): string {
  const current = bestOfNCandidatePath(bonId, slot)
  const legacy = legacyBestOfNCandidatePath(bonId, slot)

  if (fileExists(resolveInside(root, current))) {
    return current
  }

  if (fileExists(resolveInside(root, legacy))) {
    return legacy
  }

  return current
}
