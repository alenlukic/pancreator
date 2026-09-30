/**
 * Workspace provisioning and repository-check baselines: adopting a recorded
 * baseline, sharing one across a cohort, capturing a missing one, and naming the
 * gaps a stage still has.
 */

import { readdirSync } from 'node:fs'
import { availableParallelism, loadavg } from 'node:os'
import path from 'node:path'

import {
  type CohortBaselineClaim,
  claimCohortBaselineCapture,
  cohortBaselineDirectory,
  recordCohortBaselines,
  releaseCohortBaselineClaim,
} from '../cohorts/baselines.js'
import {
  fileExists,
  isDirectory,
  isRecord,
  readJson,
  resolveInside,
  toRepoRelative,
  writeJsonAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import {
  appendTargetFastWallRun,
  calibrateFastWallCeiling,
  FAST_WALL_BASELINE_PHASE,
  FAST_WALL_CALIBRATION_CUSHION,
  FAST_WALL_CALLER_CLASS_ENV,
  FAST_WALL_PHASE_ENV,
  FAST_WALL_RUN_ID_ENV,
  FAST_WALL_SERIES_ROOT_ENV,
} from '../fast-wall-series.js'
import { configuredWorkspaceRoot } from '../project-config.js'
import { effectiveRepositoryCheckProfile } from '../verification.js'
import {
  adoptedBaselineWorkspaceDivergence,
  loadRepositoryChecks,
  runRepositoryCheck,
  runRepositorySetup,
  summarizeRepositoryCheckResult,
} from '../repository-checks.js'
import { repositoryChecksConfigDigest } from '../gate-cache.js'
import { now, writeDecision } from '../state.js'
import type {
  RepositoryCheckBaselinePointer,
  RunState,
  StageDefinition,
  WorkflowDefinition,
} from '../types.js'
import {
  loadRepositoryCheckBaseline,
  repositoryCheckBaselinesCaptured,
} from '../validation.js'
import { worktreeReadiness } from '../worktrees.js'

import { recordRunAdvisories, workspaceSnapshotForRun } from './core.js'
import {
  baselineWorkspaceProvenance,
  collectStageRepositoryCheckProfiles,
} from './profiles.js'

/** A recorded baseline artifact another unit of work may adopt as its own. */
export interface AdoptableRepositoryCheckBaseline {
  /** Installation-relative path of the summary artifact. */
  artifact_path: string
  recorded_at: string
  /**
   * Workspace the recorded capture executed in, when the artifact names one.
   * Artifacts written before the field existed name nothing.
   */
  capture_workspace_path?: string
}

/**
 * Every recorded location of a profile's pre-implementation baseline artifact:
 * the per-cohort shared baselines and each run's own evidence directory.
 */
function recordedBaselineArtifactPaths(
  root: string,
  profileName: string,
): string[] {
  const filename = `pre-implementation-${profileName}.json`
  const paths: string[] = []
  const cohorts = path.join(root, 'runtime', 'logs', 'cohorts')

  if (isDirectory(cohorts)) {
    for (const entry of readdirSync(cohorts, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        paths.push(path.join(cohorts, entry.name, 'baselines', filename))
      }
    }
  }

  const workflows = path.join(root, 'runtime', 'logs', 'workflows')

  if (isDirectory(workflows)) {
    for (const entry of readdirSync(workflows, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Layout v1 keeps a flat tree and v2 splits `agent/`, so the run's own
        // layout resolves the path rather than a fixed literal.
        paths.push(
          resolveRunLayout(root, entry.name).evidence(filename).absolute,
        )
      }
    }
  }

  return paths
}

/**
 * Find a recorded passing baseline another unit of work may adopt for this
 * profile.
 *
 * A recorded result answers the same question a fresh capture would when it
 * observed the identical workspace fingerprint under the identical
 * verification configuration. Anything else — a differing fingerprint, a
 * differing or absent configuration digest, a non-passing status, an
 * unreadable or malformed artifact, a dangling full-result companion — is a
 * miss, and a miss captures exactly as before. The most recent candidate wins
 * because archival is likeliest to have moved the oldest.
 */
export function findAdoptableRepositoryCheckBaseline(
  root: string,
  profileName: string,
  workspaceFingerprint: string,
  checksConfigDigest: string,
): AdoptableRepositoryCheckBaseline | null {
  let best: AdoptableRepositoryCheckBaseline | null = null

  for (const absolute of recordedBaselineArtifactPaths(root, profileName)) {
    if (!fileExists(absolute)) {
      continue
    }

    let artifact: unknown

    try {
      artifact = readJson(absolute)
    } catch {
      continue
    }

    if (
      !isRecord(artifact) ||
      artifact.schema_version !== 1 ||
      artifact.profile !== profileName ||
      artifact.workspace_fingerprint !== workspaceFingerprint ||
      artifact.checks_config_sha256 !== checksConfigDigest ||
      typeof artifact.recorded_at !== 'string' ||
      !isRecord(artifact.result) ||
      artifact.result.status !== 'passed' ||
      !Array.isArray(artifact.result.results)
    ) {
      continue
    }

    // The gate reads the untruncated companion when the summary elides output,
    // so a summary whose companion is gone cannot support a later gate.
    if (
      typeof artifact.full_result_path === 'string' &&
      !fileExists(path.join(root, artifact.full_result_path))
    ) {
      continue
    }

    const candidate: AdoptableRepositoryCheckBaseline = {
      artifact_path: toRepoRelative(root, absolute),
      recorded_at: artifact.recorded_at,
      ...(typeof artifact.capture_workspace_path === 'string'
        ? { capture_workspace_path: artifact.capture_workspace_path }
        : {}),
    }

    if (!best || candidate.recorded_at > best.recorded_at) {
      best = candidate
    }
  }

  return best
}

/**
 * Whether any stage of the workflow works in a provisioned tree: one that
 * edits source or release metadata, runs a shell gate, or launches evidence
 * workers that test the workspace. A planning or design run does none of
 * these, so its worktree needs no dependencies or compiled output.
 */
function workflowNeedsProvisionedWorkspace(
  workflow: WorkflowDefinition,
): boolean {
  return workflow.stages.some(
    (stage) =>
      stage.workspace_policy === 'source_allowed' ||
      stage.workspace_policy === 'release_metadata_only' ||
      stage.criteria.some((criterion) => criterion.type === 'shell') ||
      (stage.evidence_workers?.length ?? 0) > 0,
  )
}

/**
 * Provision a run's workspace once, before any stage works in it.
 *
 * A workspace other than the configured default is a fresh worktree without
 * ignored build state (dependencies, compiled output), so every worker and
 * gate command would fail against it. The target-declared setup commands run
 * once per run and are recorded on the run state, whatever stage the run
 * starts at: a release run begins at `verify`, and its verifiers and gates
 * need the same provisioned tree an implementer does. A failure pauses the run
 * visibly instead of spending a stage attempt on an unprovisioned worktree,
 * and the record it leaves is not a pass, so the next prepare runs setup
 * again once the operator repaired the cause.
 *
 * A run whose workflow never works in the tree, or whose target declares no
 * setup command, records `not_configured` so later prepares skip the check.
 * A run that already captured its repository-check baselines proved its tree
 * was provisioned before this record existed, so it records `passed` instead
 * of running setup again on a tree the baselines already passed.
 *
 * Returns true when the run was paused.
 */
export function ensureWorkspaceProvisioned(
  root: string,
  state: RunState,
  workflow: WorkflowDefinition,
  onProgress?: (message: string) => void,
): boolean {
  const recorded = state.workspace_setup?.status

  if (recorded === 'passed' || recorded === 'not_configured') {
    return false
  }

  const workspaceAbsolute = path.resolve(root, state.workspace_root || '.')
  const defaultWorkspaceAbsolute = path.resolve(
    root,
    configuredWorkspaceRoot(root),
  )

  if (workspaceAbsolute === defaultWorkspaceAbsolute) {
    return false
  }

  if (recorded === undefined && repositoryCheckBaselinesCaptured(state)) {
    state.workspace_setup = {
      status: 'passed',
      recorded_at: now(),
      inferred_from: 'repository_check_baselines',
    }

    return false
  }

  if (!workflowNeedsProvisionedWorkspace(workflow)) {
    state.workspace_setup = { status: 'not_configured', recorded_at: now() }

    return false
  }

  // Worktree creation provisions the tree from the configured setup commands,
  // so a ready worktree would otherwise install its dependencies a second
  // time here. Readiness is asserted rather than assumed, so a worktree the
  // harness did not provision still runs setup before the first stage.
  const readiness = worktreeReadiness(root, workspaceAbsolute)

  if (readiness.ready && readiness.declared_setup_paths.length > 0) {
    state.workspace_setup = {
      status: 'passed',
      recorded_at: now(),
      inferred_from: 'worktree_readiness',
    }

    return false
  }

  if (readiness.gaps.length > 0) {
    onProgress?.(
      `workspace '${state.workspace_root}' is missing ` +
        `${readiness.gaps.map((gap) => gap.path).join(', ')}`,
    )
  }

  const setupCommands = loadRepositoryChecks(root).setup ?? []

  if (setupCommands.length === 0) {
    state.workspace_setup = { status: 'not_configured', recorded_at: now() }

    return false
  }

  onProgress?.(
    `running workspace setup in '${state.workspace_root}' (${setupCommands.length} command(s))`,
  )

  const setup = runRepositorySetup(root, {
    workspace: state.workspace_root || '.',
  })

  onProgress?.(
    `workspace setup ${setup.status} in ${(setup.total_duration_ms / 1000).toFixed(1)}s`,
  )
  state.workspace_setup = { status: setup.status, recorded_at: now() }

  if (setup.status === 'failed') {
    const failedCommand = setup.results.find((result) => !result.passed)
    const reason =
      `Workspace setup command failed before stage '${state.current_stage}' ` +
      `could prepare: ${failedCommand?.command ?? 'unknown'}.`

    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision' }
    writeDecision(root, state, 'Worktree environment needs repair', reason, [
      'Repair the declared setup commands or the workspace, then resume the run.',
    ])

    return true
  }

  return false
}

/**
 * Record, as run advisories, every shared baseline this run adopts from a
 * workspace other than its own, and return the messages for the caller's
 * progress stream.
 *
 * `DEV-001` gives a cohort session exactly one baseline per interior gate
 * profile, while `COHORT-001` gives every chunk run its own worktree, so an
 * adopting run is normally judged against evidence captured somewhere else.
 * That is sound until a gate reports a diagnostic the baseline does not
 * carry, at which point the reader needs to know a second workspace is in
 * play before spending the next stage hunting a regression. Naming it at
 * adoption puts the fact in the record ahead of the failure it explains.
 *
 * A pointer recorded before the capture path existed asserts nothing about
 * where it ran, so it produces no diagnosis and the run adopts as it did
 * before.
 */
function adoptedBaselinePathDiagnoses(
  state: RunState,
  claim: Extract<CohortBaselineClaim, { status: 'adopted' }>,
): string[] {
  const workspace = state.workspace_root || '.'
  const messages = Object.values(claim.baselines)
    .sort((left, right) => left.profile.localeCompare(right.profile))
    .flatMap((pointer) => {
      const divergence = adoptedBaselineWorkspaceDivergence(pointer, workspace)

      return divergence
        ? [
            `the shared '${pointer.profile}' baseline was captured in ` +
              `'${divergence.baseline_workspace}' and this run executes in ` +
              `'${divergence.current_workspace}', so a diagnostic this ` +
              `baseline does not carry may belong to either workspace; ` +
              `reproduce it in the capturing workspace before treating it ` +
              `as introduced`,
          ]
        : []
    })

  if (messages.length === 0) {
    return []
  }

  recordRunAdvisories(
    state,
    { kind: 'baseline_adoption', source: 'prepare' },
    messages,
  )

  return messages
}

/**
 * Establish the run's pre-implementation baselines before the first
 * source-allowed stage edits anything: one baseline per interior gate profile
 * of the run's verification level (DEV-001). A run outside a cohort captures
 * its own; a cohort run shares the session's one baseline.
 *
 * The full profile is never captured here. It runs only as the ship release
 * gate, judged on its own result instead of a delta.
 *
 * Returns true when a failed environment probe paused the run instead.
 */
export function ensureWorkflowRepositoryCheckBaselines(
  root: string,
  state: RunState,
  workflow: WorkflowDefinition,
  stage: StageDefinition,
  onProgress?: (message: string) => void,
): boolean {
  if (stage.workspace_policy !== 'source_allowed') {
    return false
  }

  if (repositoryCheckBaselinesCaptured(state)) {
    return false
  }

  // DEV-001: a cohort session holds exactly one shared baseline per interior
  // gate profile. The first run of the session to reach this point captures
  // it into the cohort record; every other chunk run and the release run
  // adopts it instead of capturing its own.
  const cohortId = state.cohort?.cohort_id ?? null

  if (cohortId) {
    const claim = claimCohortBaselineCapture(root, cohortId, state.run_id)

    if (claim.status === 'adopted') {
      state.repository_check_baselines = claim.baselines
      onProgress?.(
        `adopted the shared pre-implementation baseline of cohort ${cohortId} ` +
          `(${Object.keys(claim.baselines).sort().join(', ') || 'no profiles'})`,
      )

      for (const message of adoptedBaselinePathDiagnoses(state, claim)) {
        onProgress?.(message)
      }

      return false
    }
  }

  const layout = resolveRunLayout(root, state.run_id)
  const artifactPath = (name: string): string =>
    cohortId
      ? `${cohortBaselineDirectory(root, cohortId)}/${name}`
      : layout.evidence(name).relative

  let blocked: boolean

  try {
    blocked = captureRepositoryCheckBaselines(
      root,
      state,
      workflow,
      stage,
      artifactPath,
      onProgress,
    )
  } catch (error) {
    if (cohortId) {
      releaseCohortBaselineClaim(root, cohortId, state.run_id)
    }

    throw error
  }

  if (cohortId) {
    if (blocked || !state.repository_check_baselines) {
      releaseCohortBaselineClaim(root, cohortId, state.run_id)
    } else {
      recordCohortBaselines(
        root,
        cohortId,
        state.run_id,
        state.repository_check_baselines as Record<
          string,
          RepositoryCheckBaselinePointer
        >,
      )
      onProgress?.(
        `recorded the shared pre-implementation baseline on cohort ${cohortId}`,
      )
    }
  }

  return blocked
}

/**
 * Run and persist one baseline per interior gate profile of the workflow's
 * source-allowed stages, writing each artifact where `artifactPath` places it.
 * Returns true when a failed environment probe paused the run instead.
 */
function captureRepositoryCheckBaselines(
  root: string,
  state: RunState,
  workflow: WorkflowDefinition,
  stage: StageDefinition,
  artifactPath: (name: string) => string,
  onProgress?: (message: string) => void,
): boolean {
  const profiles = collectStageRepositoryCheckProfiles(workflow.stages, state)
  const repositoryChecks = loadRepositoryChecks(root)
  const preCaptureWorkspace = workspaceSnapshotForRun(root, state)
  const provenance = baselineWorkspaceProvenance(
    root,
    state,
    preCaptureWorkspace,
  )

  if (provenance.dirty_path_count > 0) {
    onProgress?.(
      `WARNING: baseline capture starts from a dirty worktree ` +
        `(${provenance.dirty_path_count} uncommitted path(s)` +
        (provenance.predecessor_run_id
          ? `, matching the final state of run ${provenance.predecessor_run_id}`
          : '') +
        `); baseline evidence discloses the inherited paths`,
    )
  }

  const baselines: NonNullable<RunState['repository_check_baselines']> = {}
  const checksConfigDigest = repositoryChecksConfigDigest(root)
  // A cohort shares this pointer with runs that own a different worktree, so
  // the pointer has to say where the evidence was produced. Without it a host
  // failure of the capturing tree is indistinguishable from a regression.
  const captureWorkspacePath = state.workspace_root || '.'

  state.repository_check_baselines = baselines

  for (const profile of profiles) {
    // DEV-001 asks for one baseline per interior gate profile per unit of
    // work, not one execution. A recorded passing artifact taken at this
    // fingerprint under this configuration already answers the question, so
    // adopt its pointer and spend no time recomputing it.
    const adopted = findAdoptableRepositoryCheckBaseline(
      root,
      profile.name,
      preCaptureWorkspace.fingerprint,
      checksConfigDigest,
    )

    if (adopted) {
      baselines[profile.name] = {
        profile: profile.name,
        status: 'passed',
        artifact_path: adopted.artifact_path,
        workspace_fingerprint: preCaptureWorkspace.fingerprint,
        recorded_at: adopted.recorded_at,
        // An artifact recorded before this field existed names no tree, and
        // this run is not the tree it ran in. The pointer stays silent rather
        // than naming the adopting workspace: a cohort shares this pointer,
        // so a guess here sends every sibling run to reproduce a failure in a
        // workspace the capture never touched.
        ...(adopted.capture_workspace_path
          ? { capture_workspace_path: adopted.capture_workspace_path }
          : {}),
      }
      onProgress?.(
        `adopted the recorded pre-implementation '${profile.name}' baseline ` +
          `at ${adopted.artifact_path} (recorded ${adopted.recorded_at})`,
      )

      continue
    }

    onProgress?.(
      `capturing pre-implementation '${profile.name}' baseline (timeout ${profile.timeout_ms ?? 'default'}ms)`,
    )
    // The baseline must observe the workspace the run mutates. A run that
    // targets a worktree would otherwise baseline the main checkout and judge
    // the worktree's gates against unrelated evidence.
    const loadAverage = loadavg()[0] ?? 0
    const result = runRepositoryCheck(root, profile.name, {
      timeout_ms: profile.timeout_ms,
      workspace: state.workspace_root || '.',
      env: {
        [FAST_WALL_SERIES_ROOT_ENV]: root,
        [FAST_WALL_RUN_ID_ENV]: state.run_id,
        [FAST_WALL_PHASE_ENV]: FAST_WALL_BASELINE_PHASE,
        [FAST_WALL_CALLER_CLASS_ENV]: 'harness_gate',
      },
    })
    onProgress?.(
      `pre-implementation '${profile.name}' baseline ${result.status} in ${(result.total_duration_ms / 1000).toFixed(1)}s`,
    )
    const workspace = workspaceSnapshotForRun(root, state)

    // A target owns its test runner, so the harness records the profile's
    // own wall. The first passing baseline is the benchmark an uncalibrated
    // target sets its ceiling from.
    if (
      appendTargetFastWallRun({
        root,
        profile: profile.name,
        status: result.status,
        wall_clock_ms: result.total_duration_ms,
        load_average: loadAverage,
        cpu_count: availableParallelism(),
        workspace_fingerprint: workspace.fingerprint,
        run_id: state.run_id,
        phase: FAST_WALL_BASELINE_PHASE,
      }) &&
      result.status === 'passed'
    ) {
      const calibration = calibrateFastWallCeiling(
        root,
        result.total_duration_ms,
      )

      if (calibration) {
        onProgress?.(
          `set the fast-wall ceiling to ${calibration.ceiling_ms}ms from this ` +
            `baseline's ${calibration.measured_wall_ms}ms wall ` +
            `(${FAST_WALL_CALIBRATION_CUSHION}x cushion)`,
        )
      }
    }

    const summaryPath = artifactPath(`pre-implementation-${profile.name}.json`)
    const fullPath = artifactPath(
      `pre-implementation-${profile.name}.full.json`,
    )
    const recordedAt = now()

    const { summary, elided } = summarizeRepositoryCheckResult(result)
    const environmentProbes =
      repositoryChecks.profiles[profile.name]?.environment_probes ?? []
    const failedEnvironmentProbe = result.results
      .slice(0, environmentProbes.length)
      .find((entry) => !entry.passed)

    // The summarized artifact is what a coder is required to read; the complete
    // capture stays on disk for anyone who needs the untruncated transcript.
    const provenanceFields = {
      capture_workspace_path: captureWorkspacePath,
      workspace_dirty_paths: provenance.dirty_paths,
      workspace_dirty_path_count: provenance.dirty_path_count,
      ...(provenance.predecessor_run_id
        ? { predecessor_run_id: provenance.predecessor_run_id }
        : {}),
    }

    if (elided) {
      writeJsonAtomic(resolveInside(root, fullPath), {
        schema_version: 1,
        run_id: state.run_id,
        stage: stage.slug,
        profile: profile.name,
        workspace_fingerprint: workspace.fingerprint,
        recorded_at: recordedAt,
        checks_config_sha256: checksConfigDigest,
        ...provenanceFields,
        result,
      })
    }

    writeJsonAtomic(resolveInside(root, summaryPath), {
      schema_version: 1,
      run_id: state.run_id,
      stage: stage.slug,
      profile: profile.name,
      workspace_fingerprint: workspace.fingerprint,
      recorded_at: recordedAt,
      checks_config_sha256: checksConfigDigest,
      ...provenanceFields,
      result: summary,
      ...(elided ? { full_result_path: fullPath } : {}),
    })

    baselines[profile.name] = {
      profile: profile.name,
      status: result.status,
      artifact_path: summaryPath,
      workspace_fingerprint: workspace.fingerprint,
      recorded_at: recordedAt,
      capture_workspace_path: captureWorkspacePath,
    }

    if (failedEnvironmentProbe) {
      const reason =
        `Pre-implementation environment probe failed for profile ` +
        `'${profile.name}': ${failedEnvironmentProbe.command}.`

      // Delete rather than assign undefined: an undefined-valued key changes
      // the canonical state digest recorded on the persisted event, while the
      // written JSON drops the key, so recovery would reject the referenced
      // state artifact as a checksum mismatch.
      delete state.repository_check_baselines
      state.status = 'paused'
      state.pause_reason = reason
      state.pending_action = { type: 'operator_decision' }
      writeDecision(root, state, 'Worktree environment needs repair', reason, [
        'Repair the declared environment, then resume from the first source stage.',
      ])

      return true
    }
  }

  return false
}

/**
 * Report every repository-check gate of one stage whose expected baseline cannot
 * support it.
 *
 * A gate that reruns `pan repository-check` is judged against the baseline the
 * run captured, so an absent or incompatible baseline must be repaired before the
 * worker starts. Finding it at submit would spend a whole stage attempt on a
 * harness fault the worker cannot influence.
 */
export function repositoryCheckBaselineGaps(
  root: string,
  state: RunState,
  stage: StageDefinition,
): string[] {
  if (!repositoryCheckBaselinesCaptured(state)) {
    return []
  }

  const gaps: string[] = []

  for (const criterion of stage.criteria) {
    if (criterion.type !== 'shell') {
      continue
    }

    const { profile } = effectiveRepositoryCheckProfile(
      state.verification,
      criterion,
    )

    if (!profile) {
      continue
    }

    const load = loadRepositoryCheckBaseline(root, state, profile)

    if (load.reason) {
      gaps.push(`Gate '${criterion.id}': ${load.reason}`)
    }
  }

  return gaps
}
