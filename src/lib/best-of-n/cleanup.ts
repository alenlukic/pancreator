/** Session cleanup and the prune of finished sessions and orphan worktrees. */

import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import { errorMessage, invariant } from '../errors.js'
import { gitWorktreePaths, gitWorktreeRemove } from '../git.js'
import { fileExists, resolveInside } from '../io.js'
import {
  CURRENT_MANAGED_WORKTREES_ROOT,
  LEGACY_MANAGED_WORKTREES_ROOT,
} from '../project-config.js'
import { removePersonaVariants } from '../projection.js'
import {
  cleanTreeRefusal,
  workspaceCleanliness,
} from '../workspace-attribution.js'
import {
  BEST_OF_N_ID_PATTERN,
  type BestOfNPendingCandidate,
  type BestOfNState,
  type BestOfNStatus,
  candidateRunState,
  isEmptyDirectory,
  sessionKey,
  TERMINAL_STATUSES,
} from './state.js'
import { bestOfNStatus, withBestOfNSession } from './session.js'

export interface CleanBestOfNResult {
  bon_id: string
  removed_worktrees: string[]
  removed_agents: string[]
}

export interface PruneBestOfNSkip {
  resource: string
  reason: string
}

export interface PruneBestOfNResult {
  cleaned_sessions: CleanBestOfNResult[]
  removed_orphan_worktrees: string[]
  removed_orphan_agents: string[]
  skipped: PruneBestOfNSkip[]
}

/**
 * Remove a session's worktrees and run-scoped agent variants.
 *
 * Candidate work is never committed, so removing a dirty worktree discards it.
 * That makes this operator-owned and refused by default.
 */
export function cleanBestOfN(
  root: string,
  bonId: string,
  options: { force?: boolean } = {},
): CleanBestOfNResult {
  return withBestOfNSession(root, bonId, (state) =>
    removeSessionResources(root, state, options),
  )
}

/** The caller holds the session mutex. */
function removeSessionResources(
  root: string,
  state: BestOfNState,
  options: { force?: boolean },
): CleanBestOfNResult {
  const bonId = state.bon_id
  // A slot a failed initialization claimed owns the same resources as a
  // candidate run, so cleanup covers both.
  const claimed: BestOfNPendingCandidate[] = [
    ...state.candidates,
    ...state.pending,
  ]
  const registered = new Set(gitWorktreePaths(root))

  const removedWorktrees: string[] = []
  const removedAgents: string[] = []
  const forcedRemovals = new Set<string>()

  // Liveness is checked before dirtiness: a run at intake or plan has a clean
  // worktree, so a dirtiness-only preflight would remove the workspace from
  // under it. The consolidation run blocks every removal, because the
  // candidate worktrees are its declared evaluation inputs and its agent
  // variants are what the engine's pipeline-drift check verifies on every
  // subsequent operation — removing either strands the run unrecoverably.
  const consolidationRun = state.consolidation
    ? candidateRunState(root, state.consolidation.run_id)
    : null

  invariant(
    options.force ||
      !consolidationRun ||
      TERMINAL_STATUSES.has(consolidationRun.status),
    `WARNING: consolidation run '${state.consolidation?.run_id}' is still ` +
      `'${consolidationRun?.status}'. Cleaning now removes its inputs and its ` +
      'agent variants and the run cannot proceed. Finish or abort the run ' +
      'first, or pass --force to discard it.',
    { code: 'BEST_OF_N_RUN_ACTIVE' },
  )

  for (const candidate of state.candidates) {
    if (candidate.abandoned) {
      continue
    }

    const run = candidateRunState(root, candidate.run_id)

    invariant(
      options.force || !run || TERMINAL_STATUSES.has(run.status),
      `WARNING: candidate '${candidate.slot}' run '${candidate.run_id}' is ` +
        `still '${run?.status}'. Cleaning now removes its workspace mid-run. ` +
        'Finish or abort the run first, or pass --force to discard it.',
      { code: 'BEST_OF_N_RUN_ACTIVE' },
    )
  }

  for (const candidate of claimed) {
    const worktreePath = resolveInside(root, candidate.worktree_path)

    if (!registered.has(worktreePath)) {
      continue
    }

    const cleanliness = workspaceCleanliness(root, worktreePath)

    if (!cleanliness.clean && !options.force) {
      invariant(
        false,
        cleanTreeRefusal(cleanliness, {
          action: `WARNING: candidate '${candidate.slot}' cannot be cleaned`,
          remedy:
            'Removing it discards that work. Pass --force to remove it ' +
            'anyway.',
        }),
        { code: 'BEST_OF_N_WORKTREE_DIRTY' },
      )
    }

    // Git refuses to remove a worktree that still holds changes, so an
    // exempt read-only input carries the force its exemption granted.
    if (cleanliness.exempt.length > 0) {
      forcedRemovals.add(worktreePath)
    }
  }

  for (const candidate of claimed) {
    const worktreePath = resolveInside(root, candidate.worktree_path)

    if (registered.has(worktreePath)) {
      gitWorktreeRemove(
        root,
        worktreePath,
        options.force === true || forcedRemovals.has(worktreePath),
      )
      removedWorktrees.push(candidate.worktree_path)
    }

    removedAgents.push(...removePersonaVariants(root, candidate.agent_suffix))
  }

  if (state.consolidation) {
    removedAgents.push(
      ...removePersonaVariants(root, state.consolidation.agent_suffix),
    )
  }

  for (const sessionRoot of sessionWorktreeDirectoryRoots(
    root,
    bonId,
    claimed,
  )) {
    if (fileExists(sessionRoot) && isEmptyDirectory(sessionRoot)) {
      rmSync(sessionRoot, { recursive: true, force: true })
    }
  }

  return {
    bon_id: bonId,
    removed_worktrees: removedWorktrees.sort(),
    removed_agents: removedAgents.sort(),
  }
}

function bestOfNSessionIds(root: string): string[] {
  const directory = path.join(root, 'runtime', 'logs', 'best-of-n')

  if (!fileExists(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && BEST_OF_N_ID_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
}

function sessionIsPrunable(status: BestOfNStatus): boolean {
  if (status.session_status === 'initializing') {
    return true
  }

  if (status.unresolved.length > 0) {
    return false
  }

  if (!status.consolidation) {
    return status.successes === 0
  }

  return TERMINAL_STATUSES.has(status.consolidation.status)
}

function orphanVariantSuffixes(root: string, sessionIds: string[]): string[] {
  const directory = path.join(root, '.cursor', 'agents')

  if (!fileExists(directory)) {
    return []
  }

  const protectedKeys = new Set(sessionIds.map((bonId) => sessionKey(bonId)))
  const suffixes = new Set<string>()

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue
    }

    const match = /--(bon[0-9a-f]{8}-.+)\.md$/u.exec(entry.name)

    if (!match) {
      continue
    }

    const suffix = match[1]
    const key = suffix.split('-', 1)[0]

    if (!protectedKeys.has(key)) {
      suffixes.add(suffix)
    }
  }

  return [...suffixes].sort()
}

function sessionWorktreeDirectoryRoots(
  root: string,
  bonId: string,
  claimed: BestOfNPendingCandidate[],
): string[] {
  const roots = new Set<string>()

  for (const candidate of claimed) {
    roots.add(path.dirname(resolveInside(root, candidate.worktree_path)))
  }

  for (const relative of [
    path.posix.join(CURRENT_MANAGED_WORKTREES_ROOT, bonId),
    path.posix.join(LEGACY_MANAGED_WORKTREES_ROOT, bonId),
  ]) {
    const absolute = resolveInside(root, relative)

    if (fileExists(absolute)) {
      roots.add(absolute)
    }
  }

  return [...roots]
}

function managedBestOfNWorktreeRoots(root: string): string[] {
  return [
    path.join(root, CURRENT_MANAGED_WORKTREES_ROOT),
    path.join(root, LEGACY_MANAGED_WORKTREES_ROOT),
  ].filter((directory) => fileExists(directory))
}

function pruneOrphanWorktrees(
  root: string,
  sessionIds: string[],
  options: { force?: boolean },
  skipped: PruneBestOfNSkip[],
): string[] {
  const protectedIds = new Set(sessionIds)
  const registered = new Set(gitWorktreePaths(root))
  const removed: string[] = []

  for (const directory of managedBestOfNWorktreeRoots(root)) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !BEST_OF_N_ID_PATTERN.test(entry.name) ||
        protectedIds.has(entry.name)
      ) {
        continue
      }

      const sessionRoot = path.join(directory, entry.name)
      const managedPrefix =
        directory === path.join(root, CURRENT_MANAGED_WORKTREES_ROOT)
          ? CURRENT_MANAGED_WORKTREES_ROOT
          : LEGACY_MANAGED_WORKTREES_ROOT

      for (const slot of readdirSync(sessionRoot, { withFileTypes: true })) {
        if (!slot.isDirectory()) {
          continue
        }

        const relativeWorktree = path.posix.join(
          managedPrefix,
          entry.name,
          slot.name,
        )
        const worktreePath = resolveInside(root, relativeWorktree)

        if (!registered.has(worktreePath)) {
          skipped.push({
            resource: relativeWorktree,
            reason: 'Directory is not a registered Git worktree.',
          })
          continue
        }

        const cleanliness = workspaceCleanliness(root, worktreePath)

        if (!options.force && !cleanliness.clean) {
          skipped.push({
            resource: relativeWorktree,
            reason: cleanTreeRefusal(cleanliness, {
              action: 'Worktree is dirty',
              remedy: 'Re-run with --force to discard it.',
            }),
          })
          continue
        }

        gitWorktreeRemove(
          root,
          worktreePath,
          options.force === true || cleanliness.exempt.length > 0,
        )
        removed.push(relativeWorktree)
      }

      if (isEmptyDirectory(sessionRoot)) {
        rmSync(sessionRoot, { recursive: true, force: true })
      }
    }
  }

  return removed.sort()
}

/**
 * Remove resources left by terminal sessions and resources with no session.
 *
 * Live sessions and dirty worktrees remain untouched unless force explicitly
 * authorizes discarding dirty candidate work.
 */
export function pruneBestOfN(
  root: string,
  options: { force?: boolean } = {},
): PruneBestOfNResult {
  const cleanedSessions: CleanBestOfNResult[] = []
  const skipped: PruneBestOfNSkip[] = []

  for (const bonId of bestOfNSessionIds(root)) {
    let status: BestOfNStatus

    try {
      status = bestOfNStatus(root, bonId)
    } catch (error) {
      skipped.push({
        resource: `session:${bonId}`,
        reason: errorMessage(error),
      })
      continue
    }

    if (!sessionIsPrunable(status)) {
      skipped.push({
        resource: `session:${bonId}`,
        reason: 'Session still has active work or awaits consolidation.',
      })
      continue
    }

    try {
      cleanedSessions.push(cleanBestOfN(root, bonId, options))
    } catch (error) {
      skipped.push({
        resource: `session:${bonId}`,
        reason: errorMessage(error),
      })
    }
  }

  // Initialization writes session state before worktrees and projections. A
  // second scan therefore protects resources from a concurrently starting run.
  const currentSessionIds = bestOfNSessionIds(root)
  const removedOrphanAgents: string[] = []

  for (const suffix of orphanVariantSuffixes(root, currentSessionIds)) {
    removedOrphanAgents.push(...removePersonaVariants(root, suffix))
  }

  return {
    cleaned_sessions: cleanedSessions.sort((left, right) =>
      left.bon_id.localeCompare(right.bon_id),
    ),
    removed_orphan_worktrees: pruneOrphanWorktrees(
      root,
      currentSessionIds,
      options,
      skipped,
    ),
    removed_orphan_agents: removedOrphanAgents.sort(),
    skipped: skipped.sort((left, right) =>
      left.resource.localeCompare(right.resource),
    ),
  }
}
