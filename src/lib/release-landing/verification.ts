/**
 * The candidate tree build, the landing verification decision, tip
 * integration, and the landing check.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { executingSourceRoot } from '../build-identity.js'
import { PanError } from '../errors.js'
import { INTEGRATION_BRANCH, gitIsAncestor } from '../git/branches.js'
import {
  gitCommonDir,
  gitHead,
  gitSourceContentFingerprint,
} from '../git/core.js'
import { fileExists, readText } from '../io.js'
import { BUILD_READY_ENV } from '../repository-checks/runner.js'
import { shipRepairLaneProfiles } from '../ship-repair.js'
import { loadState } from '../state.js'
import { RELEASE_LANDING_METADATA_PATHS } from '../versioning.js'
import { resolveWorktreeWorkspace } from '../worktree/create.js'
import {
  BUILD_TIMEOUT_MS,
  GIT_MAX_BUFFER,
  GIT_TIMEOUT_MS,
  VERIFIED_TREE_LAND_PROFILES,
  integrateCandidate,
  type LandingVerification,
  type TipIntegration,
} from './steps.js'

/** Why the executing build may not run a land, or null when it may. */
export interface LandingBuildCurrency {
  executing_root: string
  executing_head: string | null
  candidate_has_tip: boolean
  reason: string
}

/**
 * Refuse a land whose executing build lacks the `pan-dev` tip.
 *
 * The land's own decisions (the verify profile, the integrate, the check)
 * run from the executing build, not from the candidate. A build older than
 * the tip runs landing code older than the tip it lands onto, so a landed
 * change to the landing itself silently never applies. The check covers a
 * build that is a checkout of this repository; a build consumed from outside
 * any checkout of it has no history to compare and is not refused.
 */
export function landingBuildCurrency(
  repositoryRoot: string,
  tipCommit: string,
  worktreePath: string,
  worktreeRelative: string,
  worktreeName: string,
  executingRoot: string | null = executingSourceRoot(),
): LandingBuildCurrency | null {
  if (executingRoot === null) {
    return null
  }

  try {
    if (gitCommonDir(executingRoot) !== gitCommonDir(repositoryRoot)) {
      return null
    }
  } catch {
    return null
  }

  const executingHead = gitHead(executingRoot)

  if (
    executingHead !== null &&
    gitIsAncestor(repositoryRoot, tipCommit, executingHead)
  ) {
    return null
  }

  const candidateHead = gitHead(worktreePath)
  const candidateHasTip =
    candidateHead !== null &&
    gitIsAncestor(repositoryRoot, tipCommit, candidateHead)
  const short = (commit: string | null): string =>
    commit === null ? 'an unreadable head' : commit.slice(0, 8)
  const rerun =
    `PANCREATOR_EXEC_ROOT=${worktreeRelative} ./bin/pan release land ` +
    `--worktree ${worktreeName} with the same flags`

  return {
    executing_root: executingRoot,
    executing_head: executingHead,
    candidate_has_tip: candidateHasTip,
    reason:
      `LANDING_BUILD_BEHIND_TIP: the executing pan build (${executingRoot} ` +
      `at ${short(executingHead)}) does not contain the ${INTEGRATION_BRANCH} ` +
      `tip ${short(tipCommit)}, so the land would run landing code older ` +
      'than the tip it lands onto. ' +
      (candidateHasTip
        ? `Run the candidate's own build: ${rerun}.`
        : `The candidate branch does not contain the tip either. Merge ` +
          `${INTEGRATION_BRANCH} into it first ` +
          `(git -C ${worktreeRelative} merge ${INTEGRATION_BRANCH}), then ` +
          `run ${rerun}.`),
  }
}

interface LandingBuild {
  outcome: 'built' | 'failed' | 'not_applicable'
  build_stamp?: string
  output?: string
}

function readBuildStamp(worktreePath: string): string | undefined {
  const stampPath = path.join(worktreePath, 'dist', '.build-stamp')

  return fileExists(stampPath)
    ? readText(stampPath).trim() || undefined
    : undefined
}

/**
 * Compile the candidate worktree's tree through its own `bin/run-built`.
 *
 * `bin/pan` exports `PANCREATOR_BUILD_READY` for the process tree, and this
 * command then merges and finalizes the release, so the inherited value
 * describes an earlier tree. The build runs without it, and `bin/build` swaps
 * `dist/` wholesale when the source fingerprint moved. A worktree without
 * the wrapper (a target installation) has no compiled tree to refresh.
 */
export function buildLandingTree(worktreePath: string): LandingBuild {
  const runBuilt = path.join(worktreePath, 'bin', 'run-built')

  if (!fileExists(runBuilt)) {
    return { outcome: 'not_applicable' }
  }

  const env = { ...process.env }

  delete env[BUILD_READY_ENV]

  const result = spawnSync(runBuilt, ['--build-only'], {
    cwd: worktreePath,
    env,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
    timeout: BUILD_TIMEOUT_MS,
  })

  if (result.status !== 0) {
    return {
      outcome: 'failed',
      output:
        result.stderr ||
        result.stdout ||
        result.error?.message ||
        'The build of the integrated tree failed.',
    }
  }

  const buildStamp = readBuildStamp(worktreePath)

  return {
    outcome: 'built',
    ...(buildStamp ? { build_stamp: buildStamp } : {}),
  }
}

/** Whether `dist/` still matches the sources and the stamp the land verified. */
export function landingBuildIsCurrent(
  worktreePath: string,
  buildStamp: string | undefined,
): boolean {
  const result = spawnSync(
    path.join(worktreePath, 'bin', 'build'),
    ['--stamp-fresh'],
    { cwd: worktreePath, timeout: GIT_TIMEOUT_MS },
  )

  return result.status === 0 && readBuildStamp(worktreePath) === buildStamp
}

/**
 * Decide the land's verify profiles.
 *
 * Operator directive (2026-10-01): a land verifies the touch set only. A
 * bounded ship repair of lane tests runs `static`, `configuration`, and the
 * lane profile of each repaired path. Every other land — one that merged
 * commits, names no run, or whose run has no executed `full` entry-gate pass
 * — runs `impacted-release`: every lane test whose static import closure
 * reaches a file the candidate changed against `pan-dev`. A no-op integrate
 * on a tree whose source content matches the one the entry gate verified on
 * `full` runs the lighter `static` and `configuration` instead, since nothing
 * past release metadata changed. An operator-named profile list (including
 * `full`, for the rare land that needs it) always wins.
 */
export function resolveLandingVerification(
  root: string,
  worktreePath: string,
  integration: TipIntegration['outcome'],
  runId: string | null,
  requested: string[] | undefined,
  readVerifiedSource: (
    runId: string,
  ) => { fingerprint: string; profile: string } | undefined = (id) =>
    Object.values(loadState(root, id).entry_gates ?? {}).find(
      (record) => record.verified_source?.profile === 'full',
    )?.verified_source,
  repairPaths?: string[],
): LandingVerification {
  if (requested && requested.length > 0) {
    return {
      profiles: requested,
      basis: 'operator',
      reason: 'the caller named the profiles with --verify-profile',
    }
  }

  if (
    repairPaths &&
    repairPaths.length > 0 &&
    integration === 'already_current'
  ) {
    return {
      profiles: [
        ...VERIFIED_TREE_LAND_PROFILES,
        ...shipRepairLaneProfiles(repairPaths),
      ],
      basis: 'bounded_repair',
      reason:
        `a bounded ship repair changed ${repairPaths.join(', ')} above a ` +
        'finalized release, so the land runs static, configuration, and the lanes of those paths',
    }
  }

  // The touch-set rule (operator directive, 2026-10-01): a land verifies
  // only the lane tests the candidate's own changes reach, not the full
  // suite. `full` stays available, but only on explicit operator request.
  const touchSetOnly = (reason: string): LandingVerification => ({
    profiles: ['impacted-release'],
    basis: 'default',
    reason,
  })

  if (integration !== 'already_current') {
    return touchSetOnly(
      'integration merged commits, so the landing tree is new',
    )
  }

  if (!runId) {
    return touchSetOnly('no --run names an entry gate that verified this tree')
  }

  let verified: { fingerprint: string; profile: string } | undefined

  try {
    verified = readVerifiedSource(runId)
  } catch {
    return touchSetOnly(`run ${runId} could not be read`)
  }

  if (verified?.profile !== 'full') {
    return touchSetOnly(`run ${runId} records no executed full entry-gate pass`)
  }

  const current = gitSourceContentFingerprint(
    worktreePath,
    RELEASE_LANDING_METADATA_PATHS,
  )

  if (current !== verified.fingerprint) {
    return touchSetOnly(
      'the worktree source differs from the tree the entry gate verified',
    )
  }

  return {
    profiles: VERIFIED_TREE_LAND_PROFILES,
    basis: 'entry_gate_fingerprint',
    reason:
      'integration merged nothing and the source matches the tree the ' +
      'entry gate verified on full; only release metadata changed',
    source_fingerprint: current,
  }
}

/**
 * Integrate the current pan-dev tip into the candidate worktree.
 * Returns the merge commit hash, or null when already current, and throws
 * `LANDING_SOURCE_CONFLICT` naming the source paths otherwise.
 */
export function integrateTip(
  root: string,
  worktreeName: string,
  repositoryRoot: string,
  tipCommit: string,
): string | null {
  const worktreePath = path.resolve(
    root,
    resolveWorktreeWorkspace(root, worktreeName),
  )
  const integration = integrateCandidate(
    repositoryRoot,
    worktreePath,
    tipCommit,
  )

  if (integration.outcome === 'conflict') {
    throw new PanError(
      `Integration has source conflicts: ${integration.source_conflicts.join(', ')}`,
      {
        code: 'LANDING_SOURCE_CONFLICT',
        details: { source_conflicts: integration.source_conflicts },
      },
    )
  }

  return integration.outcome === 'merged' ? integration.merge_commit : null
}

/**
 * Run `bin/check-landing branch <head> <base>` and return whether it passed.
 */
export function runLandingCheck(
  root: string,
  repositoryRoot: string,
  candidateHead: string,
  baseRef: string = INTEGRATION_BRANCH,
): { passed: boolean; output: string } {
  const checkLandingPath = path.join(root, 'bin', 'check-landing')
  const result = spawnSync(
    checkLandingPath,
    ['branch', candidateHead, baseRef],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
    },
  )

  return {
    passed: result.status === 0,
    output: result.stderr || result.stdout || result.error?.message || '',
  }
}
