/**
 * `landRelease`, the mutex-held landing sequence, and the bounded ship-repair
 * preparation it runs for a repair landing.
 */

import path from 'node:path'

import { invariant, errorMessage } from '../errors.js'
import { INTEGRATION_BRANCH, gitIsAncestor } from '../git/branches.js'
import { gitRevParse, gitHead, gitShowFile } from '../git/core.js'
import { gitWorktreeIsDirty } from '../git/worktree-merge.js'
import { latestFailedSession } from '../landing-log.js'
import {
  type LandingMutexHolder,
  acquireLandingMutex,
} from '../landing-mutex.js'
import { allocateLandingVersion } from '../release-allocation.js'
import { finalizeLocalRelease } from '../release-preparation.js'
import { runRepositoryCheck } from '../repository-checks/runner.js'
import { judgeShipRepair, shipRepairPaths } from '../ship-repair.js'
import { resolveWorktreeWorkspace } from '../worktree/create.js'
import { workspaceRepositoryRoot } from '../worktree/registry.js'
import {
  appendLandingEvent,
  candidateReleaseNotes,
  fastForwardPanDev,
  headIsReleasePair,
  integrateCandidate,
  regenerateMetadata,
  resolveBump,
  tipVersion,
  type LandReleaseOptions,
  type LandingRepair,
  type LandingResult,
  type LandingStep,
  type LandingStepName,
  type TipIntegration,
} from './steps.js'
import {
  buildLandingTree,
  landingBuildIsCurrent,
  resolveLandingVerification,
  runLandingCheck,
} from './verification.js'

/**
 * Integrate a candidate worktree branch with the current `pan-dev` tip,
 * allocate a version, verify, check, and fast-forward `pan-dev`.
 *
 * All steps run while holding the landing mutex.
 */
export function landRelease(
  root: string,
  options: LandReleaseOptions,
): LandingResult {
  const { worktree: worktreeName, runId = null, waitSeconds } = options

  const worktreeRelative = resolveWorktreeWorkspace(root, worktreeName)
  const worktreePath = path.resolve(root, worktreeRelative)
  const repositoryRoot = workspaceRepositoryRoot(root)

  const acquireStartAt = Date.now()

  const mutex: LandingMutexHolder = acquireLandingMutex(
    root,
    {
      worktree: worktreeName,
      command: `pan release land --worktree ${worktreeName}`,
      runId,
    },
    { waitSeconds },
  )

  const lockWaitSeconds = (Date.now() - acquireStartAt) / 1_000
  const holdStartAt = Date.now()
  const steps: LandingStep[] = []
  const recordStep = (
    step: LandingStepName,
    fields: Record<string, unknown> = {},
  ): void => {
    const at = new Date().toISOString()

    steps.push({ step, at })
    appendLandingEvent(root, {
      event: 'step',
      step,
      at,
      token: mutex.token,
      run_id: runId,
      ...fields,
    })
  }
  const finish = (
    result: Omit<
      LandingResult,
      'steps' | 'lock_wait_seconds' | 'lock_hold_seconds'
    >,
  ): LandingResult => {
    mutex.release()

    return {
      ...result,
      steps,
      lock_wait_seconds: lockWaitSeconds,
      lock_hold_seconds: (Date.now() - holdStartAt) / 1_000,
    }
  }

  try {
    // ── Step 1: Read the tip. ────────────────────────────────────────────────
    const tipCommit = gitRevParse(repositoryRoot, INTEGRATION_BRANCH)
    const tipVersionStr = tipVersion(repositoryRoot, tipCommit)

    recordStep('tip_read', {
      tip_commit: tipCommit,
      tip_version: tipVersionStr,
    })

    invariant(
      gitHead(worktreePath) !== null,
      `Candidate worktree '${worktreeName}' has no HEAD commit.`,
      { code: 'LANDING_NO_HEAD' },
    )

    const repair =
      options.repairNote !== undefined
        ? prepareRepair(root, worktreeName, worktreePath, runId, tipCommit)
        : null

    if (repair !== null && 'refused' in repair) {
      recordStep('repair', {
        outcome: 'refused',
        reason: repair.refused,
        ...(options.repairNote ? { note: options.repairNote } : {}),
      })

      return finish({
        status: 'landing_refused',
        tip_before: tipCommit,
        refused_reason: repair.refused,
      })
    }

    let integrationOutcome: TipIntegration['outcome']
    let version: string
    let released: {
      version: string
      tip_before: string
      release_commit: string
      index_commit: string
      merge_commit?: string
      repair?: LandingRepair
    }
    let finalHead: string

    if (repair !== null) {
      // The finalized release pair below the repair commits is reused as it
      // stands. A test-only change above the indexed release commit adds no
      // installable input, so `bin/check-landing` accepts it without a new
      // release pair.
      const head = gitHead(worktreePath)

      invariant(head !== null, 'Candidate worktree has no HEAD commit.', {
        code: 'LANDING_NO_HEAD',
      })
      integrationOutcome = 'already_current'
      version = repair.version
      finalHead = head
      released = {
        version,
        tip_before: tipCommit,
        release_commit: repair.release_commit,
        index_commit: repair.index_commit,
        repair: {
          note: options.repairNote ?? '',
          paths: repair.paths,
          repaired_from: repair.index_commit,
        },
      }
      recordStep('repair', {
        outcome: 'accepted',
        note: options.repairNote,
        paths: repair.paths,
        repaired_from: repair.index_commit,
        version,
      })
    } else {
      // Resolved before integration, so a candidate without notes fails with
      // no merge commit on its branch and no landing allocation in the ledger.
      const releaseNotes = candidateReleaseNotes(worktreePath, tipCommit)

      // ── Step 2: Integrate. ─────────────────────────────────────────────────
      const integration = integrateCandidate(
        repositoryRoot,
        worktreePath,
        tipCommit,
      )

      if (integration.outcome === 'conflict') {
        recordStep('integrate', {
          outcome: 'conflict',
          source_conflicts: integration.source_conflicts,
        })

        return finish({
          status: 'conflict',
          tip_before: tipCommit,
          source_conflicts: integration.source_conflicts,
        })
      }

      integrationOutcome = integration.outcome

      const mergeCommit =
        integration.outcome === 'merged' ? integration.merge_commit : undefined

      recordStep('integrate', {
        outcome: integration.outcome,
        ...(mergeCommit ? { merge_commit: mergeCommit } : {}),
      })

      // ── Step 4: Allocate. ──────────────────────────────────────────────────
      const bump = resolveBump(root, worktreePath, options.bump)
      const allocation = allocateLandingVersion(
        root,
        worktreeName,
        tipVersionStr,
        bump,
        { runId, repositoryRoot },
      )

      version = allocation.version
      recordStep('allocate', {
        version,
        bump,
        tip_version: tipVersionStr,
      })

      // ── Step 3: Regenerate metadata. ───────────────────────────────────────
      // Logical step 3 runs after allocation because it needs the new version.
      // A head that already is this version's release pair is a retry after
      // finalize, and finalize reuses that pair unchanged.
      if (!headIsReleasePair(worktreePath, version)) {
        const tipChangelogContent =
          gitShowFile(repositoryRoot, tipCommit, 'CHANGELOG.md') ?? ''

        regenerateMetadata(
          repositoryRoot,
          worktreePath,
          tipCommit,
          version,
          releaseNotes,
          tipChangelogContent,
        )
        recordStep('metadata_regenerated', { version })
      }

      // ── Step 5: Finalize. ──────────────────────────────────────────────────
      // The tip is the ancestry anchor (`fetchedMain` in finalizeLocalRelease).
      const finalizeResult = finalizeLocalRelease(
        root,
        worktreeName,
        tipCommit,
        runId ?? undefined,
      )

      recordStep('finalize', {
        release_commit: finalizeResult.release_commit,
        index_commit: finalizeResult.index_commit,
      })

      const head = gitHead(worktreePath)

      invariant(
        head !== null,
        'Candidate worktree has no HEAD after finalize.',
        { code: 'LANDING_NO_HEAD' },
      )
      finalHead = head
      released = {
        version,
        tip_before: tipCommit,
        release_commit: finalizeResult.release_commit,
        index_commit: finalizeResult.index_commit,
        ...(mergeCommit ? { merge_commit: mergeCommit } : {}),
      }
    }

    // ── Step 6: Verify. ──────────────────────────────────────────────────────
    // Resolved after finalize, so the fingerprint reads the tree the release
    // commit left, which is the tree that lands.
    const verification = resolveLandingVerification(
      root,
      worktreePath,
      integrationOutcome,
      runId,
      options.verifyProfiles,
      undefined,
      repair !== null ? repair.paths : undefined,
    )
    const verifyProfiles = verification.profiles
    const basisFields = {
      basis: verification.basis,
      reason: verification.reason,
      ...(released.repair ? { repair_note: released.repair.note } : {}),
      ...(verification.source_fingerprint
        ? { source_fingerprint: verification.source_fingerprint }
        : {}),
    }

    // The candidate's own `dist/` predates the merge and the release commit,
    // so every profile would test an earlier tree. Compile the tree that
    // lands first, and refuse a tree that does not compile.
    const build = buildLandingTree(worktreePath)

    if (build.outcome !== 'not_applicable') {
      recordStep('build', {
        outcome: build.outcome,
        ...(build.build_stamp ? { build_stamp: build.build_stamp } : {}),
      })
    }

    if (build.outcome === 'failed') {
      return finish({
        status: 'verification_failed',
        ...released,
        verified_profiles: [],
        verification_basis: verification.basis,
        verification_output: build.output,
      })
    }

    const stampFields = build.build_stamp
      ? { build_stamp: build.build_stamp }
      : {}

    for (const profile of verifyProfiles) {
      const checkResult = runRepositoryCheck(root, profile, {
        workspace: worktreePath,
      })

      if (checkResult.status !== 'passed') {
        recordStep('verify', {
          profile,
          outcome: 'failed',
          ...basisFields,
          ...stampFields,
        })

        return finish({
          status: 'verification_failed',
          ...released,
          verified_profiles: [],
          verification_basis: verification.basis,
          ...stampFields,
          verification_output: JSON.stringify(checkResult, null, 2),
        })
      }

      recordStep('verify', {
        profile,
        outcome: 'passed',
        ...basisFields,
        ...stampFields,
      })
    }

    if (
      build.outcome === 'built' &&
      !landingBuildIsCurrent(worktreePath, build.build_stamp)
    ) {
      recordStep('build', { outcome: 'changed_during_verify', ...stampFields })

      return finish({
        status: 'verification_failed',
        ...released,
        verified_profiles: [],
        verification_basis: verification.basis,
        ...stampFields,
        verification_output:
          'The candidate sources changed while the verify profiles ran, so the profiles did not test the tree that lands. Run the land again.',
      })
    }

    // ── Step 7: Check. ───────────────────────────────────────────────────────
    const landingCheck = runLandingCheck(root, repositoryRoot, finalHead)

    if (!landingCheck.passed) {
      recordStep('check', { outcome: 'refused', reason: landingCheck.output })

      return finish({
        status: 'landing_refused',
        ...released,
        refused_reason: landingCheck.output,
      })
    }

    recordStep('check', { outcome: 'accepted' })

    // ── Step 8: Fast-forward pan-dev. ────────────────────────────────────────
    fastForwardPanDev(repositoryRoot, finalHead, tipCommit)

    const tipAfter = gitRevParse(repositoryRoot, INTEGRATION_BRANCH)

    recordStep('fast_forward', {
      tip_before: tipCommit,
      tip_after: tipAfter,
      version,
    })

    return finish({
      status: 'landed',
      ...released,
      tip_after: tipAfter,
      verified_profiles: verifyProfiles,
      verification_basis: verification.basis,
      ...stampFields,
    })
  } catch (error) {
    mutex.release()
    appendLandingEvent(root, {
      event: 'error',
      message: errorMessage(error),
    })
    throw error
  }
}

interface PreparedRepair {
  version: string
  release_commit: string
  index_commit: string
  paths: string[]
}

/**
 * Check that the candidate can be relanded as a bounded repair, before any
 * merge, allocation, or commit: the run's last land failed after finalize, the
 * tip has not moved, the tree is clean, and the commits above the failed
 * release pair change at most three lane test files.
 */
function prepareRepair(
  root: string,
  worktreeName: string,
  worktreePath: string,
  runId: string | null,
  tipCommit: string,
): PreparedRepair | { refused: string } {
  if (!runId) {
    return {
      refused:
        'LANDING_REPAIR_REQUIRES_RUN: --repair needs --run, which names the failed land it repairs.',
    }
  }

  const failed = latestFailedSession(root, runId, worktreeName)

  if (!failed) {
    return {
      refused: `LANDING_REPAIR_NO_FAILURE: the landing log holds no failed land of run ${runId} on worktree '${worktreeName}'.`,
    }
  }

  if (!gitIsAncestor(worktreePath, tipCommit)) {
    return {
      refused:
        'LANDING_REPAIR_TIP_MOVED: pan-dev holds commits the candidate lacks, so the release pair is stale. Return failure for the remediate stage.',
    }
  }

  if (!gitIsAncestor(worktreePath, failed.index_commit)) {
    return {
      refused: `LANDING_REPAIR_PAIR_MISSING: the failed land's index commit ${failed.index_commit} is not on the candidate branch.`,
    }
  }

  if (gitWorktreeIsDirty(worktreePath)) {
    return {
      refused:
        'LANDING_REPAIR_DIRTY: commit the repair before relanding; the land reads the committed tree.',
    }
  }

  const bound = judgeShipRepair(
    shipRepairPaths(worktreePath, failed.index_commit),
  )

  if (!bound.within) {
    return {
      refused: `LANDING_REPAIR_OUT_OF_BOUND: ${bound.reason}. Return failure for the remediate stage.`,
    }
  }

  const version = gitShowFile(worktreePath, failed.index_commit, 'VERSION')

  if (version === null) {
    return {
      refused: `LANDING_REPAIR_PAIR_MISSING: ${failed.index_commit} has no VERSION file.`,
    }
  }

  return {
    version: version.trim(),
    release_commit: failed.release_commit,
    index_commit: failed.index_commit,
    paths: bound.paths,
  }
}
