/**
 * Repository-check profiles a workflow's stages declare, and the workspace
 * provenance a captured baseline records.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { effectiveRepositoryCheckProfile } from '../verification.js'
import type { RunState, StageDefinition } from '../types.js'
import { gitWorkspaceSnapshot, snapshotEntryPath } from '../git.js'

export const FULL_PROFILE = 'full'

/**
 * Returns the repository-check profiles the workflow's shell criteria gate on,
 * sorted by name and deduplicated with the first declared timeout, which are
 * the profiles a run baselines before its first mutating stage. Under a
 * verification level only source-allowed stages count, and the `full` release
 * profile is never included.
 */
export function collectStageRepositoryCheckProfiles(
  stages: StageDefinition[],
  state: RunState,
): Array<{ name: string; timeout_ms: number | undefined }> {
  const profiles = new Map<string, number | undefined>()

  for (const stage of stages) {
    // Under a verification level, baselines exist to answer one question: did
    // this run's own edits break a check? Only source-mutating stages can, so
    // only their gate profiles are captured. Gates at later read-only stages
    // reuse these baselines when they run the same profile and are judged on
    // their own result otherwise. Runs created before levels existed keep the
    // old capture-everything behavior their gates fail closed against.
    if (state.verification && stage.workspace_policy !== 'source_allowed') {
      continue
    }

    for (const criterion of stage.criteria) {
      if (criterion.type !== 'shell') {
        continue
      }

      const { profile } = effectiveRepositoryCheckProfile(
        state.verification,
        criterion,
      )

      // DEV-001: the full profile is the ship release gate, judged on its own
      // result, never an interior gate, so it is never baselined even when a
      // workflow gates a source-allowed stage on it.
      if (profile === FULL_PROFILE) {
        continue
      }

      if (profile && !profiles.has(profile)) {
        profiles.set(profile, criterion.timeout_ms)
      }
    }
  }

  return [...profiles.entries()]
    .map(([name, timeout_ms]) => ({ name, timeout_ms }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Cap on the dirty paths a baseline artifact lists verbatim. */
const BASELINE_DIRTY_PATH_LIMIT = 200

interface BaselineWorkspaceProvenance {
  dirty_paths: string[]
  dirty_path_count: number
  predecessor_run_id?: string
}

/**
 * Describe the uncommitted state a baseline is about to be captured over.
 *
 * A dirty worktree means the baseline observes someone else's unfinished
 * changes — typically a predecessor run in the same worktree — so the record
 * MUST disclose which paths were already modified and, when another run's
 * final workspace fingerprint matches this starting state, which run left
 * them. Without this, an inherited failure reads as "the repository was
 * always broken" and masks what the baseline never truly observed.
 */
export function baselineWorkspaceProvenance(
  root: string,
  state: RunState,
  workspace: ReturnType<typeof gitWorkspaceSnapshot>,
): BaselineWorkspaceProvenance {
  const dirtyPaths = [
    ...new Set(workspace.entries.map((entry) => snapshotEntryPath(entry))),
  ].sort()
  const provenance: BaselineWorkspaceProvenance = {
    dirty_paths: dirtyPaths.slice(0, BASELINE_DIRTY_PATH_LIMIT),
    dirty_path_count: dirtyPaths.length,
  }

  if (dirtyPaths.length === 0) {
    return provenance
  }

  const workflows = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(workflows)) {
    return provenance
  }

  let latestSubmittedAt = ''

  for (const entry of readdirSync(workflows, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === state.run_id) {
      continue
    }

    const stateFile = resolveRunLayout(root, entry.name).state.absolute

    if (!fileExists(stateFile)) {
      continue
    }

    let value: unknown

    try {
      value = readJson(stateFile)
    } catch {
      continue
    }

    if (!isRecord(value)) {
      continue
    }

    const other = value as unknown as RunState

    if ((other.workspace_root || '.') !== (state.workspace_root || '.')) {
      continue
    }

    const last = other.stage_history?.at(-1)

    if (
      last?.workspace_fingerprint === workspace.fingerprint &&
      (last.submitted_at ?? '') >= latestSubmittedAt
    ) {
      latestSubmittedAt = last.submitted_at ?? ''
      provenance.predecessor_run_id = other.run_id
    }
  }

  return provenance
}
