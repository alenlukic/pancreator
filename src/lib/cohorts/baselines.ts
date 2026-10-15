/**
 * The session-wide shared repository-check baseline: claim, record, and
 * release. The engine imports these helpers, so this module must not import
 * the engine.
 */

import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { PanError, invariant } from '../errors.js'
import { processIsAlive } from '../io.js'
import { now } from '../state.js'
import { panCommand } from '../project-config.js'
import type {
  RepositoryCheckBaselinePointer,
  CohortSessionState,
} from '../types.js'
import { cohortDir, persistCohortState, withCohortSession } from './state.js'

/**
 * Harness-relative directory that holds the session's shared
 * pre-implementation baseline artifacts.
 */
export function cohortBaselineDirectory(
  root: string,
  cohortId: string,
): string {
  return path
    .relative(root, path.join(cohortDir(root, cohortId), 'baselines'))
    .split(path.sep)
    .join('/')
}

export type CohortBaselineClaim =
  | {
      status: 'adopted'
      baselines: Record<string, RepositoryCheckBaselinePointer>
    }
  | { status: 'capture' }

/** Optional bounded joining of a live baseline capture and its progress reports. */
export interface CohortBaselineJoinOptions {
  /** Defaults to immediate refusal; the preparation engine joins for one hour. */
  waitForCaptureMs?: number
  /** Defaults to 5,000 ms for each short session-state operation. */
  waitForHolderMs?: number
  onProgress?: (message: string) => void
}

const BASELINE_MUTEX_WAIT_MS = 5_000
const BASELINE_POLL_MS = 100
const BASELINE_PROGRESS_MS = 60_000
const BASELINE_SLEEP_SIGNAL = new Int32Array(new SharedArrayBuffer(4))

/**
 * Resolve the session's shared baseline for one run (DEV-001).
 *
 * A session holds exactly one baseline per interior gate profile. When the
 * session already records it, the run adopts it. Otherwise the run claims the
 * capture and owes `recordCohortBaselines` or `releaseCohortBaselineClaim`.
 * A caller may join a live capture with a bounded wait outside the session
 * mutex. Without that option, a live foreign claim still refuses immediately.
 */
export function claimCohortBaselineCapture(
  root: string,
  cohortId: string,
  runId: string,
  options: CohortBaselineJoinOptions = {},
): CohortBaselineClaim {
  const started = performance.now()
  const budget = Math.max(options.waitForCaptureMs ?? 0, 0)
  let lastProgress = Number.NEGATIVE_INFINITY

  while (true) {
    const result = withCohortSession(
      root,
      cohortId,
      (state) => {
        if (state.repository_check_baselines) {
          const baselines: Record<string, RepositoryCheckBaselinePointer> = {}

          for (const [profile, pointer] of Object.entries(
            state.repository_check_baselines,
          )) {
            baselines[profile] = { ...pointer, shared_from_cohort: cohortId }
          }

          return { status: 'adopted' as const, baselines }
        }

        const claim = state.repository_check_baseline_capture

        if (
          claim &&
          (claim.run_id !== runId || claim.pid !== process.pid) &&
          processIsAlive(claim.pid)
        ) {
          return { status: 'waiting' as const, claim }
        }

        persistCohortState(root, {
          ...state,
          repository_check_baseline_capture: {
            run_id: runId,
            pid: process.pid,
            started_at: now(),
          },
        })

        return { status: 'capture' as const }
      },
      { waitForHolderMs: options.waitForHolderMs ?? BASELINE_MUTEX_WAIT_MS },
    )

    if (result.status !== 'waiting') {
      return result
    }

    const elapsed = performance.now() - started
    const holder = result.claim
    const retry = `${panCommand(root)} prepare ${runId}`

    if (elapsed >= budget) {
      throw new PanError(
        `Run ${holder.run_id} (pid ${holder.pid}, since ${holder.started_at}) ` +
          `is capturing the shared pre-implementation baseline of cohort ${cohortId}. ` +
          `Join expired after ${Math.floor(elapsed)}ms (bound ${budget}ms). Retry: ${retry}`,
        {
          code: 'COHORT_BASELINE_CAPTURE_IN_PROGRESS',
          details: {
            cohort_id: cohortId,
            capturing_run_id: holder.run_id,
            owner_pid: holder.pid,
            elapsed_ms: elapsed,
            wait_bound_ms: budget,
            retry_command: retry,
          },
        },
      )
    }

    if (elapsed - lastProgress >= BASELINE_PROGRESS_MS) {
      options.onProgress?.(
        `joining the shared pre-implementation baseline of cohort ${cohortId}; ` +
          `holder ${holder.run_id} (pid ${holder.pid}, since ${holder.started_at}), ` +
          `elapsed ${Math.floor(elapsed)}ms, bound ${budget}ms`,
      )
      lastProgress = elapsed
    }

    Atomics.wait(
      BASELINE_SLEEP_SIGNAL,
      0,
      0,
      Math.min(BASELINE_POLL_MS, budget - elapsed),
    )
  }
}

/** Record the shared baseline the claiming run captured and clear the claim. */
export function recordCohortBaselines(
  root: string,
  cohortId: string,
  runId: string,
  baselines: Record<string, RepositoryCheckBaselinePointer | undefined>,
): void {
  withCohortSession(
    root,
    cohortId,
    (state) => {
      invariant(
        state.repository_check_baselines === undefined,
        `Cohort ${cohortId} already records its shared baseline.`,
        { code: 'COHORT_BASELINE_ALREADY_RECORDED' },
      )
      invariant(
        state.repository_check_baseline_capture?.run_id === runId &&
          state.repository_check_baseline_capture.pid === process.pid,
        `Run ${runId} does not own the shared baseline capture of cohort ${cohortId}.`,
        { code: 'COHORT_BASELINE_CAPTURE_NOT_OWNER' },
      )

      const recorded: Record<string, RepositoryCheckBaselinePointer> = {}

      for (const [profile, pointer] of Object.entries(baselines)) {
        invariant(
          pointer !== undefined,
          `Cohort ${cohortId} cannot publish an empty baseline pointer for ${profile}.`,
          { code: 'COHORT_BASELINE_POINTER_MISSING' },
        )
        recorded[profile] = { ...pointer, captured_by_run_id: runId }
      }

      const next: CohortSessionState = {
        ...state,
        repository_check_baselines: recorded,
      }

      delete next.repository_check_baseline_capture
      persistCohortState(root, next)
    },
    { waitForHolderMs: BASELINE_MUTEX_WAIT_MS },
  )
}

/** Abandon a claimed capture so another run of the session can capture. */
export function releaseCohortBaselineClaim(
  root: string,
  cohortId: string,
  runId: string,
): void {
  withCohortSession(
    root,
    cohortId,
    (state) => {
      if (
        state.repository_check_baseline_capture?.run_id !== runId ||
        state.repository_check_baseline_capture.pid !== process.pid
      ) {
        return
      }

      const next: CohortSessionState = { ...state }

      delete next.repository_check_baseline_capture
      persistCohortState(root, next)
    },
    { waitForHolderMs: BASELINE_MUTEX_WAIT_MS },
  )
}
