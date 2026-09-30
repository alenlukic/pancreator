/**
 * The session-wide shared repository-check baseline: claim, record, and
 * release. The engine imports these helpers, so this module must not import
 * the engine.
 */

import path from 'node:path'

import { PanError, invariant } from '../errors.js'
import { processIsAlive } from '../io.js'
import { now } from '../state.js'
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

/**
 * Resolve the session's shared baseline for one run (DEV-001).
 *
 * A session holds exactly one baseline per interior gate profile. When the
 * session already records it, the run adopts it. Otherwise the run claims the
 * capture and owes `recordCohortBaselines` or `releaseCohortBaselineClaim`.
 * While another live run holds the claim, the caller cannot proceed: the
 * capture runs outside the session mutex because it takes minutes.
 */
export function claimCohortBaselineCapture(
  root: string,
  cohortId: string,
  runId: string,
): CohortBaselineClaim {
  return withCohortSession(root, cohortId, (state) => {
    if (state.repository_check_baselines) {
      const baselines: Record<string, RepositoryCheckBaselinePointer> = {}

      for (const [profile, pointer] of Object.entries(
        state.repository_check_baselines,
      )) {
        baselines[profile] = { ...pointer, shared_from_cohort: cohortId }
      }

      return { status: 'adopted', baselines }
    }

    const claim = state.repository_check_baseline_capture

    if (claim && claim.run_id !== runId && processIsAlive(claim.pid)) {
      throw new PanError(
        `Run ${claim.run_id} is capturing the shared pre-implementation ` +
          `baseline of cohort ${cohortId} (since ${claim.started_at}). ` +
          `Prepare this run again after that capture is recorded.`,
        {
          code: 'COHORT_BASELINE_CAPTURE_IN_PROGRESS',
          details: { cohort_id: cohortId, capturing_run_id: claim.run_id },
        },
      )
    }

    persistCohortState(root, {
      ...state,
      repository_check_baseline_capture: {
        run_id: runId,
        pid: process.pid,
        started_at: now(),
      },
    })

    return { status: 'capture' }
  })
}

/** Record the shared baseline the claiming run captured and clear the claim. */
export function recordCohortBaselines(
  root: string,
  cohortId: string,
  runId: string,
  baselines: Record<string, RepositoryCheckBaselinePointer>,
): void {
  withCohortSession(root, cohortId, (state) => {
    invariant(
      state.repository_check_baselines === undefined,
      `Cohort ${cohortId} already records its shared baseline.`,
      { code: 'COHORT_BASELINE_ALREADY_RECORDED' },
    )

    const recorded: Record<string, RepositoryCheckBaselinePointer> = {}

    for (const [profile, pointer] of Object.entries(baselines)) {
      recorded[profile] = { ...pointer, captured_by_run_id: runId }
    }

    const next: CohortSessionState = {
      ...state,
      repository_check_baselines: recorded,
    }

    delete next.repository_check_baseline_capture
    persistCohortState(root, next)
  })
}

/** Abandon a claimed capture so another run of the session can capture. */
export function releaseCohortBaselineClaim(
  root: string,
  cohortId: string,
  runId: string,
): void {
  withCohortSession(root, cohortId, (state) => {
    if (state.repository_check_baseline_capture?.run_id !== runId) {
      return
    }

    const next: CohortSessionState = { ...state }

    delete next.repository_check_baseline_capture
    persistCohortState(root, next)
  })
}
