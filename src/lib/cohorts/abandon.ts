/** Chunk abandonment and cohort session cleanup. */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, writeTextAtomic, resolveInside } from '../io.js'
import { runHasContract } from '../operator-involvement.js'
import { statePath, loadState, now } from '../state.js'
import type { CohortSessionState } from '../types.js'
import { readWorktreeIndex, removeWorktree } from '../worktrees.js'
import {
  workspaceCleanliness,
  cleanTreeRefusal,
} from '../workspace-attribution.js'
import {
  COHORT_ID_PATTERN,
  TERMINAL_STATUSES,
  persistCohortState,
  withCohortSession,
} from './state.js'
import { chunkRunState } from './chunks.js'
import { updateChunk } from './start.js'

/**
 * Record an operator-directed exclusion of one chunk.
 *
 * Exclusion is operator-owned, so the note is required evidence. An abandoned
 * chunk stops blocking its cohort, which is exactly why nobody but the operator
 * may record one.
 */
export function abandonChunk(
  root: string,
  cohortId: string,
  chunkId: string,
  note: string,
): CohortSessionState {
  invariant(note.trim().length > 0, '--note is required to abandon a chunk.', {
    code: 'INVALID_ARGUMENT',
  })

  return withCohortSession(root, cohortId, (state) => {
    invariant(
      state.chunks.some((chunk) => chunk.id === chunkId),
      `Cohort session ${cohortId} has no chunk '${chunkId}'.`,
      { code: 'COHORT_CHUNK_NOT_FOUND' },
    )

    const longHorizon =
      fileExists(statePath(root, state.plan_run_id)) &&
      runHasContract(
        loadState(root, state.plan_run_id).operator_involvement,
        'long_horizon',
      )

    if (!longHorizon) {
      return updateChunk(root, state, chunkId, {
        abandoned: { note, recorded_at: now() },
      })
    }

    // A plan may declare a dependency through `edges`, through a chunk's
    // `depends_on`, or through both: the cohort-plan validator builds its
    // graph from the union and requires no agreement between them. The
    // exclusion walk reads the same union, so a dependent declared only on
    // its own chunk is still carried out with the unit it depends on.
    const dependencies = [
      ...state.edges,
      ...state.chunks.flatMap((chunk) =>
        chunk.depends_on.map((dependency) => ({
          from: dependency,
          to: chunk.id,
        })),
      ),
    ]
    const excluded = new Set([chunkId])
    let changed = true

    while (changed) {
      changed = false

      for (const edge of dependencies) {
        if (excluded.has(edge.from) && !excluded.has(edge.to)) {
          excluded.add(edge.to)
          changed = true
        }
      }
    }

    const recordedAt = now()
    const next: CohortSessionState = {
      ...state,
      chunks: state.chunks.map((chunk) =>
        excluded.has(chunk.id)
          ? {
              ...chunk,
              abandoned: {
                note:
                  chunk.id === chunkId
                    ? note
                    : `Excluded because chunk '${chunkId}' was excluded: ${note}`,
                recorded_at: recordedAt,
              },
            }
          : chunk,
      ),
    }
    const followUpPath = path.posix.join(
      'runtime',
      'inbox',
      'queue',
      `cohort-${cohortId}-${chunkId}-excluded.md`,
    )

    writeTextAtomic(
      resolveInside(root, followUpPath),
      `# Excluded cohort unit ${chunkId}\n\n` +
        `Reason: ${note}\n\n` +
        `Excluded dependents: ${[...excluded].filter((id) => id !== chunkId).join(', ') || 'none'}\n`,
    )

    return persistCohortState(root, next)
  })
}

/** A worktree discarded with uncommitted work on a recorded abandonment. */
export interface AbandonedChunkDiscard {
  chunk: string
  worktree: string
  /** The note the operator gave when abandoning the chunk. */
  note: string
}

export interface CleanCohortResult {
  cohort_id: string
  removed_worktrees: string[]
  /**
   * Chunks whose uncommitted work was discarded because the operator had
   * already recorded the chunk as abandoned. Present so the result says why
   * a dirty worktree went without `--force`.
   */
  discarded_abandoned_chunks: AbandonedChunkDiscard[]
}

/**
 * Remove the chunk worktrees of one cohort session.
 *
 * Chunk work is committed on its own branch, and branch deletion stays
 * operator-owned, so removal keeps every branch. A live or dirty chunk is
 * refused unless the operator forces it. Every chunk is checked before any
 * worktree is removed, so a refusal on one chunk leaves the session intact
 * rather than half-cleaned.
 *
 * `HR3-011`: a recorded abandonment stands in for `--force` on the dirty
 * refusal alone. Abandoning a chunk is already the operator saying its work
 * is dropped, so demanding the flag again asks the same question twice. The
 * run-active refusal is untouched: abandoning a chunk does not stop the
 * agent still writing into its workspace.
 */
export function cleanCohortSession(
  root: string,
  cohortId: string,
  options: { force?: boolean } = {},
): CleanCohortResult {
  return withCohortSession(root, cohortId, (state) => {
    const index = readWorktreeIndex(root)
    const removable: string[] = []
    const forced = new Set<string>()
    const discardedAbandoned: AbandonedChunkDiscard[] = []

    for (const chunk of state.chunks) {
      const record = index.worktrees.find(
        (entry) => entry.name === chunk.worktree,
      )

      if (!record) {
        continue
      }

      const run = chunkRunState(root, chunk.run_id)

      invariant(
        options.force || !run || TERMINAL_STATUSES.has(run.status),
        `WARNING: chunk '${chunk.id}' run '${chunk.run_id}' is still ` +
          `'${run?.status}'. Cleaning now removes its workspace mid-run. ` +
          'Finish or abort the run first, or pass --force to discard it.',
        { code: 'COHORT_RUN_ACTIVE' },
      )

      const cleanliness = workspaceCleanliness(
        root,
        resolveInside(root, record.path),
      )

      if (!cleanliness.clean && !options.force && !chunk.abandoned) {
        invariant(
          false,
          cleanTreeRefusal(cleanliness, {
            action: `WARNING: chunk '${chunk.id}' cannot be cleaned`,
            remedy:
              'Removing it discards that work. Pass --force to remove it ' +
              'anyway.',
          }),
          { code: 'COHORT_WORKTREE_DIRTY' },
        )
      }

      // Git refuses to remove a worktree that still holds changes, so both a
      // discarded blocking path and an exempt read-only input need the flag.
      if (!cleanliness.clean || cleanliness.exempt.length > 0) {
        forced.add(record.name)
      }

      if (!cleanliness.clean && chunk.abandoned && !options.force) {
        discardedAbandoned.push({
          chunk: chunk.id,
          worktree: record.name,
          note: chunk.abandoned.note,
        })
      }

      removable.push(record.name)
    }

    for (const name of removable) {
      // Git refuses to remove a worktree that still holds changes, so an
      // exempted discard has to carry the force the exemption granted.
      removeWorktree(root, name, {
        force: options.force === true || forced.has(name),
      })
    }

    return {
      cohort_id: cohortId,
      removed_worktrees: removable.sort(),
      discarded_abandoned_chunks: discardedAbandoned,
    }
  })
}

/**
 * Lists the ids of every cohort session directory under `runtime/logs/cohorts`,
 * sorted. Returns an empty list when the directory does not exist and skips
 * entries that are not valid cohort ids.
 */
export function cohortSessionIds(root: string): string[] {
  const directory = path.join(root, 'runtime', 'logs', 'cohorts')

  if (!fileExists(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && COHORT_ID_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
}
