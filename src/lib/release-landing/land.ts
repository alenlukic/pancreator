import path from 'node:path'

import { invariant, errorMessage } from '../errors.js'
import { INTEGRATION_BRANCH, gitIsAncestor } from '../git/branches.js'
import { gitRevParse, gitHead, gitShowFile } from '../git/core.js'
import {
  gitWorktreeIsDirty,
  gitWorktreeForBranch,
} from '../git/worktree-merge.js'
import { acquireLandingMutex } from '../landing-mutex.js'
import { allocateLandingVersion } from '../release-allocation.js'
import {
  finalizeLocalRelease,
  assertReleaseWorkspaceAvailable,
} from '../release-preparation.js'
import { resolveWorktreeWorkspace } from '../worktree/create.js'
import { workspaceRepositoryRoot } from '../worktree/registry.js'
import { readReleaseEvidence } from './evidence.js'
import {
  appendLandingEvent,
  candidateReleaseNotes,
  fastForwardPanDev,
  headIsReleasePair,
  regenerateMetadata,
  resolveBump,
  tipVersion,
  type LandReleaseOptions,
  type LandingResult,
  type LandingStep,
  type LandingStepName,
} from './steps.js'
import { landingBuildCurrency, runLandingCheck } from './verification.js'

/** Consume verified evidence, then allocate, finalize once, and land under the mutex. */
export function landRelease(
  root: string,
  options: LandReleaseOptions,
): LandingResult {
  const { worktree: name, runId = null, waitSeconds } = options
  const relative = resolveWorktreeWorkspace(root, name)
  const workspace = path.resolve(root, relative)
  const repository = workspaceRepositoryRoot(root)
  const started = Date.now()
  const mutex = acquireLandingMutex(
    root,
    { worktree: name, command: `pan release land --worktree ${name}`, runId },
    { waitSeconds },
  )
  const acquired = Date.now()
  const steps: LandingStep[] = []
  const record = (
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
  const finish = (result: Omit<LandingResult, 'steps'>): LandingResult => ({
    ...result,
    steps,
    lock_wait_seconds: (acquired - started) / 1000,
    lock_hold_seconds: (Date.now() - acquired) / 1000,
  })
  try {
    const tip = gitRevParse(repository, INTEGRATION_BRANCH)
    const currentVersion = tipVersion(repository, tip)
    record('tip_read', { tip_commit: tip, tip_version: currentVersion })
    const stale = landingBuildCurrency(
      repository,
      tip,
      workspace,
      relative,
      name,
    )
    if (stale)
      return finish({
        status: 'landing_refused',
        tip_before: tip,
        refused_reason: stale.reason,
      })
    invariant(
      !options.verifyProfiles?.length && !options.repairNote,
      'Release never executes tests or repair checks. Complete verify and collect its evidence before landing.',
      { code: 'LANDING_VERIFY_STAGE_REQUIRED' },
    )
    invariant(
      !gitWorktreeIsDirty(workspace),
      'Checkpoint the candidate before collecting release evidence.',
      { code: 'RELEASE_WORKTREE_DIRTY' },
    )
    invariant(
      gitIsAncestor(workspace, tip),
      'The candidate lacks pan-dev. Synchronize and verify it before release; landing does not merge unverified source.',
      { code: 'LANDING_VERIFICATION_REQUIRED' },
    )
    assertReleaseWorkspaceAvailable(root, name, runId ?? undefined)
    const target = gitWorktreeForBranch(repository, INTEGRATION_BRANCH)
    invariant(
      target === null || !gitWorktreeIsDirty(target),
      'The pan-dev checkout has uncommitted changes.',
      { code: 'LANDING_TARGET_DIRTY' },
    )
    const evidence = readReleaseEvidence(root, name)
    invariant(
      runId === null || evidence.run_id === runId,
      'The release bundle belongs to another run.',
      { code: 'LANDING_EVIDENCE_INVALID' },
    )
    record('verify', {
      outcome: 'reused',
      basis: 'verify_fingerprint',
      source_fingerprint: evidence.source_fingerprint,
      evidence_path: evidence.evidence_path,
    })
    const notes = candidateReleaseNotes(workspace, tip)
    const bump = resolveBump(root, workspace, options.bump)
    // Everything that can be checked without assigning the release number is complete.
    const allocation = allocateLandingVersion(
      root,
      name,
      currentVersion,
      bump,
      { runId, repositoryRoot: repository },
    )
    const version = allocation.version
    record('allocate', { version, bump })
    if (!headIsReleasePair(workspace, version)) {
      regenerateMetadata(
        repository,
        workspace,
        tip,
        version,
        notes,
        gitShowFile(repository, tip, 'CHANGELOG.md') ?? '',
      )
      record('metadata_regenerated', { version })
    }
    const finalized = finalizeLocalRelease(root, name, tip, runId ?? undefined)
    record('finalize', {
      release_commit: finalized.release_commit,
      index_commit: finalized.index_commit,
    })
    const head = gitHead(workspace)
    invariant(head, 'The finalized release has no HEAD.', {
      code: 'LANDING_NO_HEAD',
    })
    const check = runLandingCheck(root, repository, head)
    if (!check.passed) {
      record('check', { outcome: 'refused', reason: check.output })
      return finish({
        status: 'landing_refused',
        tip_before: tip,
        version,
        release_commit: finalized.release_commit,
        index_commit: finalized.index_commit,
        refused_reason: check.output,
      })
    }
    record('check', { outcome: 'accepted' })
    fastForwardPanDev(repository, head, tip)
    record('fast_forward', { tip_before: tip, tip_after: head, version })
    return finish({
      status: 'landed',
      tip_before: tip,
      tip_after: head,
      version,
      release_commit: finalized.release_commit,
      index_commit: finalized.index_commit,
      verified_profiles: [],
      verification_basis: 'verify_fingerprint',
    })
  } catch (error) {
    appendLandingEvent(root, { event: 'error', message: errorMessage(error) })
    throw error
  } finally {
    mutex.release()
  }
}
