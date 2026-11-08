import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { invariant, errorMessage } from '../errors.js'
import { INTEGRATION_BRANCH } from '../git/branches.js'
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
  type LandingResult,
  type LandingStep,
  type LandingStepName,
} from './steps.js'

/** Coordinate integration, allocate, finalize once, and land under the mutex. */
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
    if (options.verifyProfiles?.length || options.repairNote) {
      appendLandingEvent(root, {
        event: 'deprecated_verification_options_ignored',
        worktree: name,
      })
    }
    invariant(
      !gitWorktreeIsDirty(workspace),
      'Checkpoint the candidate before release coordination.',
      { code: 'RELEASE_WORKTREE_DIRTY' },
    )
    assertReleaseWorkspaceAvailable(root, name, runId ?? undefined)
    const target = gitWorktreeForBranch(repository, INTEGRATION_BRANCH)
    invariant(
      target === null || !gitWorktreeIsDirty(target),
      'The pan-dev checkout has uncommitted changes.',
      { code: 'LANDING_TARGET_DIRTY' },
    )
    const notes = candidateReleaseNotes(workspace, tip)
    const integration = integrateCandidate(repository, workspace, tip)
    record('integrate', { outcome: integration.outcome })

    if (integration.outcome === 'conflict') {
      return finish({
        status: 'conflict',
        tip_before: tip,
        source_conflicts: integration.source_conflicts,
      })
    }

    assertOverrideActiveConfig(workspace)
    const bump = resolveBump(root, workspace, options.bump)
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
      verification_basis: 'not_applicable',
    })
  } catch (error) {
    appendLandingEvent(root, { event: 'error', message: errorMessage(error) })
    throw error
  } finally {
    mutex.release()
  }
}

/**
 * Refuse a landing whose `config_overrides.json` selects a different
 * `active_config` than `config.json`. A missing override, or one that omits
 * the key, passes. This mirrors `bin/check-landing active-config` in process,
 * so a target that replaces that script cannot skip or break the check.
 */
function assertOverrideActiveConfig(workspace: string): void {
  const overridePath = path.join(workspace, 'config_overrides.json')

  if (!existsSync(overridePath)) return

  const override = JSON.parse(readFileSync(overridePath, 'utf8')) as Record<
    string,
    unknown
  >

  if (!Object.hasOwn(override, 'active_config')) return

  const config = JSON.parse(
    readFileSync(path.join(workspace, 'config.json'), 'utf8'),
  ) as Record<string, unknown>

  invariant(
    override.active_config === config.active_config,
    `config_overrides.json active_config is '${String(override.active_config)}' but config.json active_config is '${String(config.active_config)}'. The override must use the same active_config before merging to pan-dev or main.`,
    { code: 'OVERRIDE_ACTIVE_CONFIG_MISMATCH' },
  )
}
