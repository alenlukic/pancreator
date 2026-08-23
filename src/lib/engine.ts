import { randomUUID } from 'node:crypto'
import { copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { buildInvocationInputs, summarizePriorFailure } from './context.js'
import {
  renderBrief,
  resolveBriefVocabulary,
  scaffoldOperatorBrief,
  validateBriefSystem,
} from './briefs.js'
import { errorMessage, invariant, PanError } from './errors.js'
import { canonicalPersonaMapping } from './executors/mapping.js'
import {
  expectedCursorModelForSpec,
  probeCursorModelSpec,
} from './executors/cursor-probe.js'
import {
  ensureDir,
  fileExists,
  isDirectory,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  toRepoRelative,
  withOperationMutex,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import { applyJsonMergePatch } from './json-merge-patch.js'
import { keywordRunSuffixFrom, makeStageArtifactId } from './naming.js'
import { resolveRunLayout } from './run-layout.js'
import {
  OPERATOR_ARTIFACT_PROFILE_HEADINGS,
  operatorArtifactProfileForStage,
} from './operator-artifact-profiles.js'
import {
  operatorArtifactsRequested,
  requestStageOperatorArtifacts,
} from './operator-artifacts.js'
import {
  DEFAULT_REVIEW_MODE,
  configuredWorkspaceRoot,
  harnessPathPrefix,
  isDetachedInstallation,
  isSelfDevelopmentInstallation,
  isTargetInstallation,
  loadProjectConfig,
  panCommand,
  resolveReviewMode,
} from './project-config.js'
import { resolvePolicies } from './policies.js'
import {
  artifactJsonPath,
  finalizeWorkflowArtifacts,
  isClosedRunStatus,
} from './workflow-artifacts.js'
import { resolveRequirements } from './requirements/resolve.js'
import {
  inferTargetKind,
  isPassingResult,
  registryStageSlug,
  resolveRequirementTargetPath,
  runRequirement,
} from './requirements/run.js'
import { loadRegistry } from './requirements/registry.js'
import {
  loadPipelineConfig,
  loadPipelineConfigSnapshot,
  makePipelineConfigSnapshot,
  resolvePersonaMapping,
  type LoadedPipelineConfig,
} from './pipeline-config.js'
import {
  claudeCodeCredentialPreflight,
  claudeCodeVersionPreflight,
  runClaudeCode,
  type ClaudeCodeInvocationResult,
} from './executors/claude-code.js'
import {
  applyOperatorInvolvement,
  loadOperatorInvolvementFile,
  runHasContract,
  selectInvolvementProfile,
} from './operator-involvement.js'
import {
  effectiveRepositoryCheckProfile,
  loadVerificationFile,
  resolveVerification,
} from './verification.js'
import {
  loadRepositoryChecks,
  runRepositoryCheck,
  runRepositorySetup,
  summarizeRepositoryCheckResult,
} from './repository-checks.js'
import {
  cursorAgentTarget,
  projectPersonaVariants,
  syncCursorProjection,
} from './projection.js'
import {
  buildInvocationContractManifest,
  renderInvocationDeliveryPrompt,
  renderInvocationMarkdown,
  renderStatus,
} from './render.js'
import {
  invocationLiveness,
  operationMutexPath,
  loadState,
  makeUniqueRunId,
  nextStageSequence,
  now,
  persist,
  runDir,
  writeDecision,
} from './state.js'
import type {
  BestOfNRunRole,
  CriterionEvaluation,
  DeterministicResult,
  ExternalDelegationRecord,
  GovernanceArtifactIssue,
  Invocation,
  OperatorFeedbackItem,
  OperatorGateWaiver,
  OperatorPauseContext,
  OperatorWorkspaceRatification,
  RunModelEvidence,
  RunState,
  SameReasonFailureTrackers,
  StageDefinition,
  StageFailureTracker,
  StageHistoryItem,
  StageOutcome,
  StageOutput,
  RequirementFailureRoute,
  SupervisorAssessment,
  TaskRecord,
  WorkflowDefinition,
} from './types.js'
import {
  attestationValidationPath,
  buildValidationArtifact,
  delegationExecutionPath,
  delegationPath,
  delegationValidationPath,
  deliveryPromptPath,
  evaluateDeterministicCriteria,
  expectedDelegationSource,
  invocationValidationPath,
  loadInvocationValidationStatus,
  loadRepositoryCheckBaseline,
  relocateMisplacedDelegationArtifact,
  repositoryCheckBaselinesCaptured,
  sessionRecordPath,
  validateDelegationMarkdown,
  validateInvocationAttestation,
  validateInvocationMarkdown,
  validateStageOutput,
} from './validation.js'
import {
  loadStagePrompt,
  loadWorkflow,
  loadWorkflowFile,
  stageBySlug,
  workflowPersonaNames,
} from './workflow.js'
import {
  gitWorkspaceSnapshot,
  workspaceChangedPathsFromSnapshots,
} from './git.js'
import { resolveRoots } from './workspace/roots.js'
import { PROTECTED_PATH_RULE } from './workspace/protected-paths.js'

/**
 * Persona-to-model map that replaces the active pipeline config for one run.
 * A best-of-N session runs several candidates at once under different models,
 * which the single active config cannot express.
 */
export interface PipelineOverride {
  label: string
  personas: Record<string, string>
  source_path: string
  source_sha256: string
  summary?: string
}

interface CreateRunOptions {
  workflowSlug?: string
  requestPath: string | null
  title?: string | null
  workspace?: string | null
  gatesPath?: string | null
  involvement?: string | null
  verification?: string | null
  reviewMode?: string | null
  operatorArtifacts?: boolean
  pipelineOverride?: PipelineOverride | null
  cursorAgentSuffix?: string | null
  /**
   * Keep the gates the workflow declares, ignoring the involvement profile. A
   * best-of-N candidate must stay autonomous whatever profile is configured.
   */
  useWorkflowDeclaredGates?: boolean
  bestOfN?: BestOfNRunRole | null
}

interface StatusOptions {
  json?: boolean
}

function recordGovernanceArtifactIssues(
  root: string,
  state: RunState,
  stage: string,
  invocationId: string,
  source: GovernanceArtifactIssue['source'],
  messages: string[],
  artifactPath?: string,
): string[] {
  if (messages.length === 0) {
    return []
  }

  const recordedAt = now()
  const issues = (state.governance_artifact_issues ??= [])

  for (const message of messages) {
    issues.push({
      issue_id: `GA-${String(issues.length + 1).padStart(4, '0')}`,
      stage,
      invocation_id: invocationId,
      source,
      message,
      ...(artifactPath ? { artifact_path: artifactPath } : {}),
      recorded_at: recordedAt,
    })
  }

  const relativePath = resolveRunLayout(root, state.run_id).artifactJson(
    'governance-artifact-issues.json',
  ).relative
  state.governance_artifact_issues_path = relativePath
  writeJsonAtomic(resolveInside(root, relativePath), {
    schema_version: 1,
    run_id: state.run_id,
    updated_at: recordedAt,
    issues,
  })

  return messages
}

export interface PrepareInvocationResult {
  state: RunState
  invocation: Invocation | null
}

interface OperationProgressOptions {
  onProgress?: (message: string) => void
}

interface PrepareInvocationOptions extends OperationProgressOptions {
  operatorArtifacts?: boolean
}

function persistRun(
  root: string,
  state: RunState,
  eventType: string,
  payload: Record<string, unknown> = {},
): void {
  persist(root, state, eventType, payload)

  if (!isClosedRunStatus(state.status)) {
    return
  }

  const summary = finalizeWorkflowArtifacts(root, state.run_id, state)

  persist(root, state, 'workflow_artifacts_finalized', { ...summary })
}

function loadRunWorkflow(root: string, state: RunState): WorkflowDefinition {
  return loadWorkflowFile(
    root,
    resolveInside(root, state.workflow_snapshot.path),
  )
}

function loadRunPipelineConfig(root: string, state: RunState) {
  if (state.pipeline_config) {
    return loadPipelineConfigSnapshot(root, state.pipeline_config.path)
  }

  return makePipelineConfigSnapshot(loadPipelineConfig(root))
}

/**
 * A run must keep resolving the models it snapshotted, but a mapping it never
 * resolves is not drift. Adding a persona would otherwise strand every run in
 * flight, including the self-development run that introduces that persona.
 */
function assertRunPipelineConfigCurrent(
  root: string,
  state: RunState,
  snapshot: ReturnType<typeof loadRunPipelineConfig>,
): void {
  if (!state.pipeline_config) {
    return
  }

  // A best-of-N run pins its own persona map, so the active config is not its
  // authority. Its run-scoped agent variants are what must still match.
  if (state.cursor_agent_suffix) {
    const variantDrift = projectPersonaVariants(
      root,
      state.cursor_agent_suffix,
      personaSubset(snapshot.personas, loadRunWorkflow(root, state)),
    ).filter((entry) => entry.changed)

    invariant(
      variantDrift.length === 0,
      `Run '${state.run_id}' delegates to run-scoped Cursor agent variants ` +
        `that no longer match its pipeline snapshot.`,
      {
        code: 'PIPELINE_CONFIG_NOT_SYNCED',
        details: { agents: variantDrift.map((entry) => entry.path) },
      },
    )

    return
  }

  const live = loadPipelineConfig(root)
  const driftedPersonas = Object.entries(snapshot.personas)
    .filter(([persona, model]) => {
      const livePersona = live.config.personas[persona]

      return (
        livePersona === undefined ||
        canonicalPersonaMapping(livePersona) !== canonicalPersonaMapping(model)
      )
    })
    .map(([persona]) => persona)

  invariant(
    live.name === snapshot.name && driftedPersonas.length === 0,
    `Run '${state.run_id}' uses pipeline config '${snapshot.name}', but the ` +
      `live active mapping has changed. Restore that mapping and run ` +
      `${panCommand(root)} models --sync before resuming this run.`,
    { code: 'PIPELINE_CONFIG_DRIFT', details: { personas: driftedPersonas } },
  )

  const agentModelDrift = syncCursorProjection(root).filter(
    (entry) => entry.id === 'cursor-agents' && entry.changed,
  )

  invariant(
    agentModelDrift.length === 0,
    `Cursor agent models do not match the run pipeline config. Run ${panCommand(root)} models --sync.`,
    {
      code: 'PIPELINE_CONFIG_NOT_SYNCED',
      details: { agents: agentModelDrift.map((entry) => entry.path) },
    },
  )
}

/** Absolute path of the deliverable workspace this run fingerprints and gates. */
function workspaceDirectory(root: string, state: RunState): string {
  return path.resolve(root, state.workspace_root || '.')
}

function rootsForRun(root: string, state: RunState) {
  return resolveRoots({
    installation_root: root,
    workspace_root: workspaceDirectory(root, state),
    state_root: state.state_root,
  })
}

function initializeRunWorkspaceTracking(root: string, state: RunState) {
  const roots = rootsForRun(root, state)

  state.workspace_id = roots.workspace_id
  state.installation_root = roots.installation_root
  state.state_root = roots.state_root
  state.scope_hash = roots.scope_hash

  return roots
}

function ensureMutatingWorkflowInitialized(
  root: string,
  state: RunState,
  stage: StageDefinition,
): void {
  if (stage.workspace_policy === 'source_allowed') {
    initializeRunWorkspaceTracking(root, state)
  }
}

function workspaceSnapshotForRun(root: string, state: RunState) {
  const roots = rootsForRun(root, state)

  state.workspace_id = roots.workspace_id
  state.installation_root = roots.installation_root
  state.state_root = roots.state_root
  state.scope_hash = roots.scope_hash

  return gitWorkspaceSnapshot(roots.workspace_root)
}

/**
 * Resolve an operator-supplied workspace relative to the Pancreator installation.
 * Embedded installations intentionally target a parent directory, so the stored
 * path MAY contain `..` while every file operation remains bounded by resolveRoots.
 *
 * A detached installation has no stable relative path to its target — the two
 * trees are unrelated, and relativizing would break the moment either moved —
 * so its workspace is stored absolute. `workspaceDirectory` resolves both forms
 * through `path.resolve`, which already tolerates an absolute value.
 */
function normalizeWorkspaceRoot(
  root: string,
  workspace: string | null | undefined,
): string {
  const requested = workspace ?? configuredWorkspaceRoot(root)
  const absolute = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(root, requested)

  invariant(
    isDirectory(absolute),
    `--workspace must be an existing directory: ${requested}`,
    { code: 'WORKSPACE_NOT_FOUND' },
  )

  if (isDetachedInstallation(root)) {
    return absolute
  }

  const relative = path.relative(root, absolute)

  return relative.length === 0 ? '.' : relative.split(path.sep).join('/')
}

/**
 * Read an optional gate-override file mapping deterministic shell criterion ids
 * to a replacement command (string) or `false` to disable that gate. Overrides
 * let a run apply gates appropriate to its deliverable instead of inheriting
 * commands that assume a different project shape.
 */
function readGateOverrides(
  root: string,
  gatesPath: string | null | undefined,
): Record<string, string | false> | undefined {
  if (!gatesPath) {
    return undefined
  }

  const value = readJson(resolveInside(root, gatesPath))

  invariant(
    isRecord(value),
    `--gates file MUST contain an object: ${gatesPath}`,
    {
      code: 'INVALID_GATES',
    },
  )

  const overrides: Record<string, string | false> = {}

  for (const [criterionId, command] of Object.entries(value)) {
    invariant(
      command === false || (typeof command === 'string' && command.length > 0),
      `--gates['${criterionId}'] MUST be a non-empty command string or false.`,
      { code: 'INVALID_GATES' },
    )

    overrides[criterionId] = command
  }

  return overrides
}

function collectStageRepositoryCheckProfiles(
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

      if (profile && !profiles.has(profile)) {
        profiles.set(profile, criterion.timeout_ms)
      }
    }
  }

  return [...profiles.entries()]
    .map(([name, timeout_ms]) => ({ name, timeout_ms }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Capture a baseline for the repository-check profiles the run's verification
 * level gates its source-mutating stages on, before the first mutating stage
 * edits anything.
 *
 * The expensive profiles (integration suites, end-to-end browsers) are never
 * captured here: a run's own regressions are visible in the fast profiles, the
 * team and CI own the rest, and a level that gates on a heavier profile judges
 * it on its own result instead of a delta.
 */
function ensureWorkflowRepositoryCheckBaselines(
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

  const profiles = collectStageRepositoryCheckProfiles(workflow.stages, state)
  const repositoryChecks = loadRepositoryChecks(root)

  // A workspace other than the configured default is a fresh worktree without
  // ignored build state (dependencies, compiled output), so every profile
  // command would fail against it. Run the target-declared setup commands
  // first and pause visibly when they fail, instead of capturing a doomed
  // baseline or hanging the prepare.
  const setupCommands = repositoryChecks.setup ?? []
  const workspaceAbsolute = path.resolve(root, state.workspace_root || '.')
  const defaultWorkspaceAbsolute = path.resolve(
    root,
    configuredWorkspaceRoot(root),
  )

  if (
    setupCommands.length > 0 &&
    workspaceAbsolute !== defaultWorkspaceAbsolute
  ) {
    onProgress?.(
      `running workspace setup in '${state.workspace_root}' (${setupCommands.length} command(s))`,
    )

    const setup = runRepositorySetup(root, {
      workspace: state.workspace_root || '.',
    })

    onProgress?.(
      `workspace setup ${setup.status} in ${(setup.total_duration_ms / 1000).toFixed(1)}s`,
    )

    if (setup.status === 'failed') {
      const failedCommand = setup.results.find((result) => !result.passed)
      const reason =
        `Workspace setup command failed before baseline capture: ` +
        `${failedCommand?.command ?? 'unknown'}.`

      state.status = 'paused'
      state.pause_reason = reason
      state.pending_action = { type: 'operator_decision' }
      writeDecision(root, state, 'Worktree environment needs repair', reason, [
        'Repair the declared setup commands or the workspace, then resume from the first source stage.',
      ])

      return true
    }
  }

  const baselines: NonNullable<RunState['repository_check_baselines']> = {}

  state.repository_check_baselines = baselines

  for (const profile of profiles) {
    onProgress?.(
      `capturing pre-implementation '${profile.name}' baseline (timeout ${profile.timeout_ms ?? 'default'}ms)`,
    )
    // The baseline must observe the workspace the run mutates. A run that
    // targets a worktree would otherwise baseline the main checkout and judge
    // the worktree's gates against unrelated evidence.
    const result = runRepositoryCheck(root, profile.name, {
      timeout_ms: profile.timeout_ms,
      workspace: state.workspace_root || '.',
    })
    onProgress?.(
      `pre-implementation '${profile.name}' baseline ${result.status} in ${(result.total_duration_ms / 1000).toFixed(1)}s`,
    )
    const workspace = workspaceSnapshotForRun(root, state)
    const layout = resolveRunLayout(root, state.run_id)
    const artifactPath = layout.evidence(
      `pre-implementation-${profile.name}.json`,
    ).relative
    const fullPath = layout.evidence(
      `pre-implementation-${profile.name}.full.json`,
    ).relative
    const recordedAt = now()
    const { summary, elided } = summarizeRepositoryCheckResult(result)
    const environmentProbes =
      repositoryChecks.profiles[profile.name]?.environment_probes ?? []
    const failedEnvironmentProbe = result.results
      .slice(0, environmentProbes.length)
      .find((entry) => !entry.passed)

    // The summarized artifact is what a coder is required to read; the complete
    // capture stays on disk for anyone who needs the untruncated transcript.
    if (elided) {
      writeJsonAtomic(resolveInside(root, fullPath), {
        schema_version: 1,
        run_id: state.run_id,
        stage: stage.slug,
        profile: profile.name,
        workspace_fingerprint: workspace.fingerprint,
        recorded_at: recordedAt,
        result,
      })
    }

    writeJsonAtomic(resolveInside(root, artifactPath), {
      schema_version: 1,
      run_id: state.run_id,
      stage: stage.slug,
      profile: profile.name,
      workspace_fingerprint: workspace.fingerprint,
      recorded_at: recordedAt,
      result: summary,
      ...(elided ? { full_result_path: fullPath } : {}),
    })

    baselines[profile.name] = {
      profile: profile.name,
      status: result.status,
      artifact_path: artifactPath,
      workspace_fingerprint: workspace.fingerprint,
      recorded_at: recordedAt,
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
function repositoryCheckBaselineGaps(
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

interface VerificationRecommendation {
  stage: string
  invocation_id: string
  level: string
  reason: string
}

/**
 * The newest un-surfaced verification-level recommendation from a successful
 * intake or plan attempt. Workers MAY recommend a different level when the
 * change warrants it; the operator decides, once per recommendation.
 */
function pendingVerificationRecommendation(
  root: string,
  state: RunState,
): VerificationRecommendation | null {
  const verification = state.verification

  if (!verification) {
    return null
  }

  const surfaced = new Set(state.verification_recommendations_surfaced ?? [])

  for (const item of [...state.stage_history].reverse()) {
    if (
      (item.stage !== 'intake' && item.stage !== 'plan') ||
      item.outcome !== 'success' ||
      surfaced.has(item.invocation_id)
    ) {
      continue
    }

    let value: unknown

    try {
      value = readJson(resolveInside(root, item.output_path))
    } catch {
      continue
    }

    if (!isRecord(value) || !isRecord(value.data)) {
      continue
    }

    const recommendation = value.data.verification_recommendation

    if (
      !isRecord(recommendation) ||
      typeof recommendation.level !== 'string' ||
      typeof recommendation.reason !== 'string' ||
      recommendation.level === verification.level
    ) {
      continue
    }

    let knownLevels: string[]

    try {
      knownLevels = Object.keys(loadVerificationFile(root).levels)
    } catch {
      return null
    }

    if (!knownLevels.includes(recommendation.level)) {
      continue
    }

    return {
      stage: item.stage,
      invocation_id: item.invocation_id,
      level: recommendation.level,
      reason: recommendation.reason,
    }
  }

  return null
}

function pauseForVerificationRecommendation(
  root: string,
  state: RunState,
  recommendation: VerificationRecommendation,
): void {
  const reason =
    `The ${recommendation.stage} worker recommends verification level ` +
    `'${recommendation.level}' instead of this run's ` +
    `'${state.verification?.level}': ${recommendation.reason}`

  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }
  ;(state.verification_recommendations_surfaced ??= []).push(
    recommendation.invocation_id,
  )

  writeDecision(root, state, 'Verification level recommendation', reason, [
    `Apply it with: ${panCommand(root)} verification ${state.run_id} set ${recommendation.level}`,
    `Or keep '${state.verification?.level}' and continue: ${panCommand(root)} resume ${state.run_id}`,
  ])
}

function pauseForRepositoryCheckBaselineGaps(
  root: string,
  state: RunState,
  stage: StageDefinition,
  gaps: string[],
): void {
  const reason =
    `Stage '${stage.slug}' cannot be delegated because a repository-check ` +
    `baseline does not support its gate. ${gaps.join(' ')}`

  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }

  writeDecision(
    root,
    state,
    'Workflow paused by a repository-check baseline gap',
    reason,
    [
      'Inspect the named baseline evidence under ' +
        `${resolveRunLayout(root, state.run_id).evidence('.').relative}`,
      `Recapture the baselines by resuming this run from the first source stage: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
      `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
    ],
  )
}

function failAutonomousCandidate(
  root: string,
  state: RunState,
  reason: string,
): boolean {
  if (state.best_of_n?.role !== 'candidate') {
    return false
  }

  state.status = 'failed'
  state.current_stage = null
  state.pause_reason = null
  state.pending_action = { type: 'none' }

  writeDecision(root, state, 'Autonomous candidate failed', reason, [])

  return true
}

function pauseForLimit(root: string, state: RunState, reason: string): boolean {
  if (failAutonomousCandidate(root, state, reason)) {
    return true
  }

  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }

  writeDecision(root, state, 'Workflow paused by circuit breaker', reason, [
    `Resume from a chosen stage with: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
    `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
  ])

  return false
}

const SAME_REASON_TRACKED_STAGES = new Set(['review', 'test'])
const VALIDATION_ONLY_SIGNATURE = ['__validation__']

function isSameReasonTrackedStage(
  state: RunState,
  stage: StageDefinition,
): boolean {
  return (
    ((state.workflow_slug === 'dev' ||
      state.workflow_slug === 'dev-candidate') &&
      SAME_REASON_TRACKED_STAGES.has(stage.slug)) ||
    stage.transitions.failure === stage.slug
  )
}

function sameReasonTrackers(state: RunState): SameReasonFailureTrackers {
  return (state.same_reason_failures ??= {})
}

function clearSameReasonTracker(state: RunState, stageSlug: string): void {
  const trackers = state.same_reason_failures
  if (!trackers?.[stageSlug]) {
    return
  }

  delete trackers[stageSlug]
  if (Object.keys(trackers).length === 0) {
    delete state.same_reason_failures
  }
}

function clearAllSameReasonTrackers(state: RunState): void {
  if (!state.same_reason_failures) {
    return
  }

  delete state.same_reason_failures
}

function collectHardFailureSignature(
  stage: StageDefinition,
  selfCriteria: CriterionEvaluation[],
  deterministic: DeterministicResult[],
  validationErrors: string[],
): string[] {
  const self = new Map(selfCriteria.map((item) => [item.id, item]))
  const det = new Map(deterministic.map((item) => [item.id, item]))
  const failed = stage.criteria
    .filter((criterion) => {
      if (!criterion.hard) {
        return false
      }

      if (criterion.type === 'judgment') {
        return self.get(criterion.id)?.result === 'fail'
      }

      const result = det.get(criterion.id)

      return result?.passed === false && !result.disabled
    })
    .map((criterion) => criterion.id)
    .sort()

  if (failed.length === 0 && validationErrors.length > 0) {
    return [...VALIDATION_ONLY_SIGNATURE]
  }

  return failed
}

function isSameReasonSignature(current: string[], prior: string[]): boolean {
  if (prior.length === 0) {
    return false
  }

  const currentSet = new Set(current)

  return prior.every((criterionId) => currentSet.has(criterionId))
}

function recordSameReasonFailure(
  state: RunState,
  stageSlug: string,
  signature: string[],
): boolean {
  const trackers = sameReasonTrackers(state)
  const existing = trackers[stageSlug]

  if (existing && isSameReasonSignature(signature, existing.last_signature)) {
    const updated: StageFailureTracker = {
      last_signature: signature,
      repeat_count: existing.repeat_count + 1,
    }

    trackers[stageSlug] = updated

    return updated.repeat_count >= 2
  }

  trackers[stageSlug] = {
    last_signature: signature,
    repeat_count: 1,
  }

  return false
}

function pauseForSameReasonFailure(
  root: string,
  state: RunState,
  stage: StageDefinition,
): void {
  const tracker = isSameReasonTrackedStage(state, stage)
    ? state.same_reason_failures?.[stage.slug]
    : undefined
  const signature = tracker?.last_signature.join(', ') ?? 'unknown'
  const reason =
    `Stage '${stage.slug}' failed twice consecutively for the same ` +
    `deterministic reason (${signature}).`

  if (failAutonomousCandidate(root, state, reason)) {
    return
  }

  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }

  writeDecision(root, state, 'Same-reason retry limit reached', reason, [
    `Resume from a chosen stage with: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
    `Waive or redirect the gate with: ${panCommand(root)} waive-gate ${state.run_id} --note "<directive>" [--to <stage>]`,
    `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
  ])
}

interface TransitionOptions {
  overrideTarget?: string
  operatorDirected?: boolean
}

function applyTransition(
  root: string,
  state: RunState,
  stage: StageDefinition,
  outcome: StageOutcome,
  options: TransitionOptions = {},
): void {
  state.transition_count += 1
  state.consecutive_failures = options.operatorDirected
    ? 0
    : outcome === 'failure'
      ? state.consecutive_failures + 1
      : 0

  const target = options.overrideTarget ?? stage.transitions[outcome]

  invariant(target, `Stage '${stage.slug}' has no '${outcome}' transition.`, {
    code: 'INVALID_TRANSITION',
  })

  if (
    !options.operatorDirected &&
    state.transition_count > state.limits.max_total_transitions
  ) {
    pauseForLimit(root, state, 'Maximum workflow transitions exceeded.')
    return
  }

  if (
    !options.operatorDirected &&
    state.consecutive_failures > state.limits.max_consecutive_failures
  ) {
    pauseForLimit(root, state, 'Maximum consecutive failures exceeded.')
    return
  }

  if (target === 'succeeded' || target === 'failed' || target === 'canceled') {
    state.status = target
    state.current_stage = null
    state.pending_action = { type: 'none' }
    return
  }

  if (target === 'paused') {
    state.status = 'paused'
    state.pause_reason = `Stage '${stage.slug}' reported ${outcome}.`
    state.pending_action = { type: 'operator_decision' }

    writeDecision(
      root,
      state,
      'Workflow needs operator input',
      state.pause_reason,
      [`Resume with: ${panCommand(root)} resume ${state.run_id}`],
    )
    return
  }

  // `max_stage_attempts` bounds retries of a stage, not how many times a run
  // legitimately visits it. Leaving a stage for a different one closes that
  // stage's retry sequence, so a later return starts fresh instead of inheriting
  // a budget already spent on attempts that succeeded. Run-wide looping stays
  // bounded by max_total_transitions, max_consecutive_failures, and same-reason
  // tracking.
  if (target !== stage.slug) {
    delete state.attempts[stage.slug]
    delete state.operator_revisions?.[stage.slug]
  }

  state.status = 'running'
  state.current_stage = target
  state.pending_action = { type: 'prepare_invocation' }
  state.current_invocation = null
}

function readInvocation(root: string, relativePath: string): Invocation {
  const value = readJson(resolveInside(root, relativePath))

  invariant(isRecord(value), `${relativePath} MUST contain an object.`, {
    code: 'INVALID_INVOCATION',
  })
  invariant(
    value.schema_version === 1 && typeof value.invocation_id === 'string',
    `${relativePath} MUST contain a valid invocation.`,
    { code: 'INVALID_INVOCATION' },
  )

  return value as unknown as Invocation
}

function persistModelEvidence(
  root: string,
  state: RunState,
  item: Omit<RunModelEvidence, 'evidence_path' | 'timestamp'>,
): RunModelEvidence {
  const index = (state.model_evidence ?? []).findIndex(
    (existing) =>
      existing.role === item.role &&
      existing.invocation_id === item.invocation_id,
  )
  const filename =
    item.role === 'supervisor'
      ? 'model-evidence-supervisor.json'
      : `model-evidence-${item.invocation_id}.json`
  const evidencePath = resolveRunLayout(root, state.run_id).evidence(
    filename,
  ).relative
  const evidence: RunModelEvidence = {
    ...item,
    evidence_path: evidencePath,
    timestamp: now(),
  }
  const items = [...(state.model_evidence ?? [])]

  if (index === -1) {
    items.push(evidence)
  } else {
    items[index] = evidence
  }

  state.model_evidence = items
  writeJsonAtomic(resolveInside(root, evidencePath), {
    schema_version: 1,
    run_id: state.run_id,
    ...evidence,
  })
  persistRun(root, state, 'model_evidence_recorded', {
    role: evidence.role,
    invocation_id: evidence.invocation_id ?? null,
    result: evidence.result,
    evidence_path: evidence.evidence_path,
  })

  return evidence
}

/** Record the unpinned supervisor model that Cursor exposes for this session. */
export function recordSupervisorModelEvidence(
  root: string,
  runId: string,
  effectiveModel: string,
  source: string,
): RunModelEvidence {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    invariant(
      effectiveModel.trim().length > 0,
      '--effective-model is required.',
      {
        code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE',
      },
    )
    invariant(source.trim().length > 0, '--source is required.', {
      code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE',
    })

    const state = loadState(root, runId)
    const existing = state.model_evidence?.find(
      (item) => item.role === 'supervisor',
    )

    if (existing) {
      if (
        normalizedModelName(existing.effective_model ?? '') ===
        normalizedModelName(effectiveModel)
      ) {
        return existing
      }

      throw new PanError(
        `Run '${runId}' already records supervisor model '${existing.effective_model}'.`,
        {
          code: 'CURSOR_MODEL_MISMATCH',
          details: { evidence_path: existing.evidence_path },
        },
      )
    }

    return persistModelEvidence(root, state, {
      role: 'supervisor',
      persona: 'orchestrator',
      declared_spec: null,
      effective_model: effectiveModel.trim(),
      source: source.trim(),
      result: 'recorded',
    })
  })
}

function normalizedModelName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '')
}

/** Probe one active Cursor worker invocation and persist its effective model. */
export function probeRunInvocationModel(
  root: string,
  runId: string,
  invocationId: string,
): RunModelEvidence {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.current_invocation?.id === invocationId,
      `Invocation '${invocationId}' is not active for run '${runId}'.`,
      { code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE' },
    )

    const invocation = readInvocation(root, state.current_invocation.json_path)

    invariant(
      (invocation.stage.persona_executor ?? 'cursor') === 'cursor',
      `Invocation '${invocationId}' does not use the Cursor executor.`,
      { code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE' },
    )

    const declaredSpec = invocation.stage.model
    const expected =
      expectedCursorModelForSpec(root, declaredSpec) ??
      (declaredSpec.includes('[') ? null : declaredSpec)
    const probe = probeCursorModelSpec(declaredSpec)
    const unavailable =
      probe.resolved === null || expected === null || probe.error !== undefined
    const matches =
      !unavailable &&
      normalizedModelName(probe.resolved ?? '') ===
        normalizedModelName(expected ?? '')
    const result = unavailable
      ? ('unavailable' as const)
      : matches
        ? ('match' as const)
        : ('mismatch' as const)
    const error = unavailable
      ? (probe.error ??
        `No catalog prediction exists for model spec '${declaredSpec}'.`)
      : matches
        ? undefined
        : `Cursor resolved '${probe.resolved}', but the run snapshot expects '${expected}'.`
    const evidence = persistModelEvidence(root, state, {
      role: 'worker',
      invocation_id: invocationId,
      persona: invocation.stage.persona,
      declared_spec: declaredSpec,
      effective_model: probe.resolved,
      source: 'cursor-agent system/init event',
      result,
      ...(error ? { error } : {}),
    })

    if (result === 'unavailable') {
      throw new PanError(error ?? 'Cursor model evidence is unavailable.', {
        code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE',
        details: { evidence_path: evidence.evidence_path },
      })
    }

    if (result === 'mismatch') {
      throw new PanError(error ?? 'Cursor worker model does not match.', {
        code: 'CURSOR_MODEL_MISMATCH',
        details: { evidence_path: evidence.evidence_path },
      })
    }

    return evidence
  })
}

function assertRequiredModelEvidence(
  state: RunState,
  invocation: Invocation,
): void {
  if (invocation.model_evidence_required !== true) {
    return
  }

  const supervisor = state.model_evidence?.find(
    (item) => item.role === 'supervisor' && item.result === 'recorded',
  )

  if (!supervisor?.effective_model) {
    throw new PanError(
      `Run '${state.run_id}' has no sourced supervisor model evidence.`,
      { code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE' },
    )
  }

  const worker = state.model_evidence?.find(
    (item) =>
      item.role === 'worker' && item.invocation_id === invocation.invocation_id,
  )

  if (!worker || worker.result === 'unavailable') {
    throw new PanError(
      `Invocation '${invocation.invocation_id}' has no usable worker model evidence.`,
      {
        code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE',
        details: { evidence_path: worker?.evidence_path ?? null },
      },
    )
  }

  if (
    worker.result !== 'match' ||
    worker.persona !== invocation.stage.persona ||
    worker.declared_spec !== invocation.stage.model
  ) {
    throw new PanError(
      `Invocation '${invocation.invocation_id}' worker model evidence does not match its run snapshot.`,
      {
        code: 'CURSOR_MODEL_MISMATCH',
        details: { evidence_path: worker.evidence_path },
      },
    )
  }
}

function runUsesModelEvidenceContract(state: RunState): boolean {
  const supervisor = state.model_evidence?.find(
    (item) => item.role === 'supervisor' && item.result === 'recorded',
  )
  const firstSubmission = state.stage_history[0]?.submitted_at

  return Boolean(
    supervisor && (!firstSubmission || supervisor.timestamp <= firstSubmission),
  )
}

function readTaskRecord(root: string, relativePath: string): TaskRecord {
  const value = readJson(resolveInside(root, relativePath))

  invariant(isRecord(value), `${relativePath} MUST contain a task record.`, {
    code: 'INVALID_TASK_RECORD',
  })

  return value as unknown as TaskRecord
}

function parseSupervisorAssessment(
  value: unknown,
  source: string,
): SupervisorAssessment {
  invariant(isRecord(value), `${source} MUST contain an object.`, {
    code: 'INVALID_ASSESSMENT',
  })
  invariant(
    value.schema_version === 1,
    'Assessment schema_version MUST be 1.',
    {
      code: 'INVALID_ASSESSMENT',
    },
  )
  invariant(
    typeof value.assessment_id === 'string' && value.assessment_id.length > 0,
    'Assessment assessment_id MUST be a non-empty string.',
    { code: 'INVALID_ASSESSMENT' },
  )
  invariant(
    typeof value.invocation_id === 'string' && value.invocation_id.length > 0,
    'Assessment invocation_id MUST be a non-empty string.',
    { code: 'INVALID_ASSESSMENT' },
  )
  invariant(
    value.verdict === 'pass' ||
      value.verdict === 'fail' ||
      value.verdict === 'escalate',
    'Assessment verdict MUST be pass, fail, or escalate.',
    { code: 'INVALID_ASSESSMENT' },
  )
  invariant(
    Array.isArray(value.criteria),
    'Assessment criteria MUST be an array.',
    { code: 'INVALID_ASSESSMENT' },
  )
  invariant(
    typeof value.summary === 'string' && value.summary.length > 0,
    'Assessment summary MUST be a non-empty string.',
    { code: 'INVALID_ASSESSMENT' },
  )

  return value as unknown as SupervisorAssessment
}

function submittedInvocationId(value: unknown): string | null {
  return isRecord(value) && typeof value.invocation_id === 'string'
    ? value.invocation_id
    : null
}

/**
 * Replace the persona map of a loaded pipeline config with an override, merged
 * over `config.json` defaults exactly as a named config resolves.
 */
function overriddenPipelineConfig(
  loaded: LoadedPipelineConfig,
  override: PipelineOverride,
): LoadedPipelineConfig {
  return {
    name: override.label,
    config: {
      ...(override.summary ? { summary: override.summary } : {}),
      personas: { ...loaded.file.defaults, ...override.personas },
    },
    file: loaded.file,
    path: override.source_path,
    sha256: override.source_sha256,
  }
}

function personaSubset(
  personas: Record<string, string>,
  workflow: WorkflowDefinition,
): Record<string, string> {
  const subset: Record<string, string> = {}

  for (const persona of workflowPersonaNames(workflow)) {
    const model = personas[persona]

    invariant(
      typeof model === 'string' && model.length > 0,
      `Pipeline config does not map persona '${persona}' to a model.`,
      { code: 'INVALID_PIPELINE_CONFIG' },
    )

    subset[persona] = model
  }

  return subset
}

export function createRun(root: string, options: CreateRunOptions): RunState {
  const workflowSlug = options.workflowSlug ?? 'dev'
  const requestPath = options.requestPath

  invariant(requestPath, '--request is required.', {
    code: 'REQUEST_REQUIRED',
  })

  const workflow = loadWorkflow(root, workflowSlug)
  const pipelineOverride = options.pipelineOverride ?? null
  const agentSuffix = options.cursorAgentSuffix ?? null

  invariant(
    !pipelineOverride || agentSuffix,
    'A pipeline override MUST name a Cursor agent suffix.',
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  const pipelineConfig = pipelineOverride
    ? overriddenPipelineConfig(loadPipelineConfig(root), pipelineOverride)
    : loadPipelineConfig(root)
  let workflowUsesClaudeCode = false

  // The orchestrator persona is the supervisor running in the Cursor chat, so it
  // cannot be handed to an external process. Every run has a supervisor, whether
  // or not this workflow also delegates a stage to that persona, so the check
  // does not belong inside the stage loop.
  const supervisor = resolvePersonaMapping(
    pipelineConfig.config,
    'orchestrator',
  )

  invariant(
    supervisor.executor === 'cursor',
    `Persona 'orchestrator' MUST use the cursor executor; ` +
      `'${supervisor.raw}' routes it to '${supervisor.executor}'.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  for (const stage of workflow.stages) {
    const mapping = resolvePersonaMapping(pipelineConfig.config, stage.persona)

    if (mapping.executor === 'cursor') {
      invariant(
        fileExists(
          path.join(
            root,
            cursorAgentTarget(root, stage.persona, agentSuffix ?? undefined),
          ),
        ),
        `Missing Cursor agent for persona '${stage.persona}'.`,
        { code: 'MISSING_CURSOR_AGENT' },
      )
    } else {
      workflowUsesClaudeCode = true
    }
  }

  // Fail closed before any run state exists: an external persona whose
  // executor binary is absent or too old could never be delegated, and
  // substituting Cursor would falsify the model snapshot. The credential probe
  // spends a real invocation, so it runs at first delegation instead.
  if (workflowUsesClaudeCode) {
    const preflight = claudeCodeVersionPreflight()

    invariant(preflight.ok, `Executor preflight failed: ${preflight.error}`, {
      code: 'EXECUTOR_PREFLIGHT_FAILED',
      details: preflight,
    })
  }

  // An overridden run delegates to run-scoped agent variants, so the active
  // config's own projection says nothing about the models this run will use.
  if (agentSuffix) {
    const variantDrift = projectPersonaVariants(
      root,
      agentSuffix,
      personaSubset(pipelineConfig.config.personas, workflow),
    ).filter((entry) => entry.changed)

    invariant(
      variantDrift.length === 0,
      `Run-scoped Cursor agent variants do not match the pipeline override ` +
        `'${pipelineConfig.name}'.`,
      {
        code: 'PIPELINE_CONFIG_NOT_SYNCED',
        details: { agents: variantDrift.map((entry) => entry.path) },
      },
    )
  } else {
    const agentModelDrift = syncCursorProjection(root).filter(
      (entry) => entry.id === 'cursor-agents' && entry.changed,
    )

    invariant(
      agentModelDrift.length === 0,
      `Cursor agent models do not match the active pipeline config. Run ${panCommand(root)} models --sync.`,
      {
        code: 'PIPELINE_CONFIG_NOT_SYNCED',
        details: { agents: agentModelDrift.map((entry) => entry.path) },
      },
    )
  }

  const source = resolveInside(root, requestPath)

  invariant(fileExists(source), `Request file does not exist: ${requestPath}`, {
    code: 'REQUEST_NOT_FOUND',
  })

  const briefSystem = validateBriefSystem(root)

  invariant(
    briefSystem.status === 'passed',
    `${briefSystem.errors.join(' ')} Run ${panCommand(root)} briefs build or /pan-build-briefs before starting a workflow.`,
    { code: 'INVALID_BRIEF_SYSTEM', details: briefSystem },
  )

  const id = makeUniqueRunId(
    path.join(root, 'runtime', 'logs', 'workflows'),
    keywordRunSuffixFrom(path.basename(source), readText(source)),
  )
  const layout = resolveRunLayout(root, id)
  const directory = layout.agent.absolute

  for (const child of [
    'invocations',
    'outputs',
    'assessments',
    'evidence',
    'decisions',
    'validations',
    'artifacts/json',
  ]) {
    ensureDir(path.join(directory, child))
  }
  ensureDir(layout.operator.absolute)

  const requestExtension = path.extname(source) || '.md'
  const storedRequest = layout.request(requestExtension).relative
  copyFileSync(source, resolveInside(root, storedRequest))

  const workspaceRoot = normalizeWorkspaceRoot(root, options.workspace)
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: path.resolve(root, workspaceRoot),
  })
  const gateOverrides = readGateOverrides(root, options.gatesPath)

  const workflowSnapshot = layout.workflowSnapshot.relative
  const workflowSnapshotValue = structuredClone(workflow)

  for (const stage of workflowSnapshotValue.stages) {
    stage.prompt = loadStagePrompt(root, stage)
    stage.prompt_sha256 = sha256(stage.prompt)
  }

  // The snapshot is authoritative for this run's gates, so the involvement
  // profile is resolved once here rather than re-derived on every transition.
  // A later edit to config.json cannot change a run already in flight.
  const involvementSelection = selectInvolvementProfile(
    loadOperatorInvolvementFile(root),
    options.involvement,
  )
  const involvement = options.useWorkflowDeclaredGates
    ? {
        profile: involvementSelection.name,
        summary: involvementSelection.profile.summary,
        contracts: [],
        applied_gates: {},
      }
    : applyOperatorInvolvement(workflowSnapshotValue, involvementSelection)

  // Snapshotted for the same reason as the involvement profile: the review
  // method a run started under governs it to the end.
  const reviewMode = resolveReviewMode(root, options.reviewMode)
  // Snapshotted likewise. The level decides which repository-check profiles
  // gate this run and which baselines the first mutating stage captures.
  const verification = resolveVerification(root, options.verification)

  writeJsonAtomic(resolveInside(root, workflowSnapshot), workflowSnapshotValue)

  const pipelineConfigSnapshot = layout.pipelineConfigSnapshot.relative
  const pipelineConfigSnapshotValue = makePipelineConfigSnapshot(pipelineConfig)

  writeJsonAtomic(
    resolveInside(root, pipelineConfigSnapshot),
    pipelineConfigSnapshotValue,
  )

  const state: RunState = {
    schema_version: 2,
    run_id: id,
    workflow_slug: workflow.slug,
    workflow_snapshot: {
      path: workflowSnapshot,
      sha256: sha256(workflowSnapshotValue),
    },
    pipeline_config: {
      name: pipelineConfig.name,
      path: pipelineConfigSnapshot,
      sha256: sha256(pipelineConfigSnapshotValue),
    },
    workspace_root: workspaceRoot,
    workspace_id: roots.workspace_id,
    installation_root: roots.installation_root,
    state_root: roots.state_root,
    scope_hash: roots.scope_hash,
    ...(gateOverrides ? { gate_overrides: gateOverrides } : {}),
    operator_involvement: involvement,
    verification,
    review_mode: reviewMode,
    operator_artifacts: {
      mode: options.operatorArtifacts ? 'requested' : 'suppressed',
      requested_stages: [],
    },
    ...(agentSuffix ? { cursor_agent_suffix: agentSuffix } : {}),
    ...(options.bestOfN ? { best_of_n: options.bestOfN } : {}),
    title: options.title ?? path.basename(requestPath),
    status: 'running',
    current_stage: workflow.start_stage,
    pending_action: { type: 'prepare_invocation' },
    current_invocation: null,
    request: {
      source_path: toRepoRelative(root, source),
      stored_path: storedRequest,
      sha256: sha256(readText(source)),
    },
    limits: workflow.limits,
    attempts: {},
    transition_count: 0,
    consecutive_failures: 0,
    stage_history: [],
    revision: 0,
    created_at: now(),
    updated_at: now(),
  }

  persistRun(root, state, 'run_created', {
    workflow: workflow.slug,
    pipeline_config: pipelineConfig.name,
    workspace_root: workspaceRoot,
    state_root: roots.state_root,
    involvement_profile: involvement.profile,
    run_contracts: involvement.contracts,
    applied_gates: involvement.applied_gates,
    verification_level: verification.level,
    review_mode: reviewMode,
    operator_artifacts: state.operator_artifacts,
  })

  return state
}

const INLINE_SUBMIT_VALIDATORS = new Set([
  'INVOCATION-VALIDATE-001',
  'DELEGATION-VALIDATE-001',
  'INVOCATION-ATTEST-VALIDATE-001',
  'STAGE-OUTPUT-VALIDATE-002',
])

function outcomeFromFailureRoutes(
  routes: RequirementFailureRoute[],
): StageOutcome | null {
  if (routes.length === 0) {
    return null
  }

  if (
    routes.some((route) => route === 'blocked' || route === 'operator_decision')
  ) {
    return 'blocked'
  }

  return 'failure'
}

function runHarnessAuthoritativeValidators(
  root: string,
  runId: string,
  invocation: Invocation,
  workspaceFingerprint: string,
  submittedValue: Record<string, unknown>,
  runState?: Record<string, unknown>,
): {
  errors: string[]
  blocking_errors: string[]
  validatorOutcome: StageOutcome | null
} {
  const errors: string[] = []
  const blockingErrors: string[] = []
  const failedRoutes: RequirementFailureRoute[] = []

  if (!invocation.requirements) {
    return { errors, blocking_errors: blockingErrors, validatorOutcome: null }
  }

  const catalog = loadRegistry(root)

  for (const requirement of invocation.requirements.validation_requirements) {
    if (INLINE_SUBMIT_VALIDATORS.has(requirement.registry_id)) {
      continue
    }

    if (
      requirement.target === 'repository' ||
      requirement.resolved_target === '.'
    ) {
      continue
    }

    if (requirement.executor === 'agent') {
      continue
    }

    if (
      requirement.phase !== 'pre_submit' &&
      requirement.phase !== 'submit' &&
      requirement.phase !== 'gate'
    ) {
      continue
    }

    const entry = catalog.entries.get(requirement.registry_id)

    if (!entry) {
      continue
    }

    if (requirement.registry_id.includes('ASSESSMENT')) {
      continue
    }

    const requiredStage = registryStageSlug(requirement.registry_id)

    if (requiredStage && requiredStage !== invocation.stage.slug) {
      continue
    }

    const targetPath =
      resolveRequirementTargetPath(
        requirement,
        invocation.output.path,
        submittedValue as Record<string, unknown>,
      ) ?? invocation.output.path
    const targetKind = inferTargetKind(targetPath)

    if (!entry.target_types.includes(targetKind)) {
      continue
    }

    const result = runRequirement({
      root,
      runId,
      requirement,
      targetPath,
      executor: 'harness',
      workspaceFingerprint,
      invocation: invocation as unknown as Record<string, unknown>,
      runState,
      catalog,
      persist: true,
    })

    if (!isPassingResult(result)) {
      const message =
        `harness validator ${requirement.registry_id} failed: ` +
        result.issues.map((issue) => issue.message).join('; ')

      errors.push(message)

      if (requirement.enforcement !== 'advisory') {
        blockingErrors.push(message)
        failedRoutes.push(requirement.failure_route)
      }
    }
  }

  return {
    errors,
    blocking_errors: blockingErrors,
    validatorOutcome: outcomeFromFailureRoutes(failedRoutes),
  }
}

function stageFieldContract(
  root: string,
  stageSlug: string,
  requirements: NonNullable<
    Invocation['requirements']
  >['validation_requirements'],
): Invocation['output']['field_contract'] {
  const source = readJson(
    path.join(root, 'library', 'schemas', 'stage-output-requirements.json'),
  )

  invariant(
    isRecord(source) && source.schema_version === 1 && isRecord(source.stages),
    'stage-output-requirements.json MUST contain a schema_version 1 stage map.',
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  const stage = source.stages[stageSlug]

  if (stage === undefined) {
    return undefined
  }

  invariant(
    isRecord(stage) &&
      Array.isArray(stage.validators) &&
      Array.isArray(stage.fields),
    `stage-output-requirements.json stages.${stageSlug} MUST declare validators and fields.`,
    { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
  )

  const requirementByRegistryId = new Map(
    requirements.map((requirement) => [requirement.registry_id, requirement]),
  )
  const validators = stage.validators.map((validator) => {
    invariant(
      isRecord(validator) &&
        typeof validator.registry_id === 'string' &&
        (validator.enforcement === 'blocks' ||
          validator.enforcement === 'advises'),
      `stage-output-requirements.json stages.${stageSlug} contains an invalid validator.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    const requirement = requirementByRegistryId.get(validator.registry_id)

    invariant(
      requirement,
      `Stage ${stageSlug} does not resolve ${validator.registry_id}.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    const enforcement =
      requirement.enforcement === 'advisory'
        ? ('advises' as const)
        : ('blocks' as const)

    invariant(
      validator.enforcement === enforcement,
      `Stage ${stageSlug} declares ${validator.registry_id} as ` +
        `${validator.enforcement}, but resolved registry metadata says ${enforcement}.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    return { registry_id: validator.registry_id, enforcement }
  })

  return {
    validators,
    fields: stage.fields as NonNullable<
      Invocation['output']['field_contract']
    >['fields'],
  }
}

export function prepareInvocation(
  root: string,
  runId: string,
  options: PrepareInvocationOptions = {},
): PrepareInvocationResult {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'running',
      `Run is not running: ${state.status}`,
      {
        code: 'RUN_NOT_RUNNING',
      },
    )

    if (options.operatorArtifacts) {
      const stageSlug = state.current_stage

      invariant(
        stageSlug,
        'Run has no current stage to request artifacts for.',
        {
          code: 'INVALID_RUN_ACTION',
        },
      )

      if (requestStageOperatorArtifacts(state, stageSlug)) {
        persistRun(root, state, 'operator_artifacts_requested', {
          scope: 'stage',
          stage: stageSlug,
        })
      }
    }

    if (
      state.pending_action.type === 'invoke_agent' &&
      state.current_invocation
    ) {
      return {
        state,
        invocation: readInvocation(root, state.current_invocation.json_path),
      }
    }

    invariant(
      state.pending_action.type === 'prepare_invocation',
      'Run is not ready to prepare an invocation.',
      {
        code: 'INVALID_RUN_ACTION',
        details: { pending: state.pending_action },
      },
    )

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)
    const pipelineConfig = loadRunPipelineConfig(root, state)

    assertRunPipelineConfigCurrent(root, state, pipelineConfig)

    const mapping = resolvePersonaMapping(pipelineConfig, stage.persona)
    const model = mapping.model_spec
    const externalExecutor =
      mapping.executor !== 'cursor' ? mapping.executor : undefined
    // An invocation that was prepared but never submitted did no work, so it
    // must not spend an attempt. This happens whenever a card is superseded —
    // most often after an operator pause — and previously the discarded card
    // permanently consumed one of the stage's retries.
    const recordedAttempt = state.attempts[stage.slug] ?? 0
    const lastAttemptSubmitted =
      recordedAttempt === 0 ||
      state.stage_history.some(
        (item) => item.stage === stage.slug && item.attempt === recordedAttempt,
      )
    const attempt = lastAttemptSubmitted ? recordedAttempt + 1 : recordedAttempt
    // An operator refinement round is not a failed attempt. It raises the
    // ceiling instead of consuming budget reserved for failures, so directing a
    // plan through several revisions cannot exhaust the retry allowance the
    // stage still needs if it later fails on its own.
    const grantedRevisions = state.operator_revisions?.[stage.slug] ?? 0
    const attemptCeiling = state.limits.max_stage_attempts + grantedRevisions

    if (attempt > attemptCeiling) {
      const reason =
        `Stage '${stage.slug}' exceeded ${attemptCeiling} attempts ` +
        `(${state.limits.max_stage_attempts} configured` +
        (grantedRevisions > 0
          ? ` plus ${grantedRevisions} operator revision${grantedRevisions === 1 ? '' : 's'}`
          : '') +
        ').'

      const candidateFailed = pauseForLimit(root, state, reason)

      persistRun(
        root,
        state,
        candidateFailed ? 'candidate_failed' : 'run_paused',
        { reason },
      )

      return { state, invocation: null }
    }

    state.attempts[stage.slug] = attempt

    const recommendation = pendingVerificationRecommendation(root, state)

    if (recommendation) {
      pauseForVerificationRecommendation(root, state, recommendation)
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null }
    }

    ensureMutatingWorkflowInitialized(root, state, stage)
    const environmentBlocked = ensureWorkflowRepositoryCheckBaselines(
      root,
      state,
      workflow,
      stage,
      options.onProgress,
    )

    if (environmentBlocked) {
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null }
    }

    const baselineGaps = repositoryCheckBaselineGaps(root, state, stage)

    if (baselineGaps.length > 0) {
      pauseForRepositoryCheckBaselineGaps(root, state, stage, baselineGaps)
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null }
    }

    const invocationId = makeStageArtifactId(
      nextStageSequence(root, runId),
      stage.slug,
      attempt,
    )
    const layout = resolveRunLayout(root, runId)
    const outputPath = layout.output(invocationId).relative
    const briefSourcePath = layout.artifactJson(
      `${invocationId}.brief.json`,
    ).relative
    const briefRenderedPath = layout.operatorHtml(invocationId).relative
    const jsonPath = layout.invocation(invocationId, '.json').relative
    const markdownPath = layout.invocation(invocationId, '.md').relative
    const delegationArtifactPath = delegationPath(runId, invocationId, root)
    const artifactsRequested = operatorArtifactsRequested(state, stage.slug)

    const workspace = workspaceSnapshotForRun(root, state)
    const contracts = state.operator_involvement?.contracts ?? []
    const reviewMode = state.review_mode ?? DEFAULT_REVIEW_MODE
    const policies = resolvePolicies(root, {
      persona: stage.persona,
      workflow: workflow.slug,
      stage: stage.slug,
      contracts,
      review_mode: reviewMode,
      operator_artifacts: artifactsRequested ? 'requested' : 'suppressed',
    })
    const requirements = resolveRequirements(root, {
      persona: stage.persona,
      workflow: workflow.slug,
      stage: stage.slug,
      contracts,
      review_mode: reviewMode,
      invocation: {
        output_path: outputPath,
        artifact_paths: artifactsRequested ? [briefRenderedPath] : [],
      },
      operator_artifacts: artifactsRequested ? 'requested' : 'suppressed',
    })
    const nextAction =
      stage.persona === 'orchestrator'
        ? `Complete this stage in the current chat with model '${model}' ` +
          `when available, write ${outputPath}, then submit it.`
        : externalExecutor
          ? `Run '${panCommand(root)} delegate ${runId}' to execute the ` +
            `'${stage.persona}' stage under the '${externalExecutor}' ` +
            `executor with model '${model}', then submit ${outputPath}.`
          : `Launch the named Cursor agent for persona '${stage.persona}' ` +
            `(never an ad-hoc subagent; only the named definition runs ` +
            `'${model}') with this card, write delegation evidence to ` +
            `${delegationArtifactPath}, then submit ${outputPath}.`
    // The supervisor delegates from the continuation loop, where it holds no
    // card of its own. Resolving its policies here puts the delivery contract
    // on the artifact it must already read to perform the delegation. For an
    // external executor the harness moves the bytes itself, so delivery is
    // `verbatim` by construction and no compact delivery prompt is generated.
    const delegation =
      stage.persona === 'orchestrator'
        ? undefined
        : externalExecutor
          ? {
              persona: stage.persona,
              executor: externalExecutor,
              delegate_command: `${panCommand(root)} delegate ${runId}`,
              canonical_markdown_path: markdownPath,
              invocation_validation_path: invocationValidationPath(
                runId,
                invocationId,
                root,
              ),
              delegation_artifact_path: delegationArtifactPath,
              submit_command: `${panCommand(root)} submit ${runId} ${outputPath}`,
              mode: 'verbatim' as const,
              policies: resolvePolicies(root, {
                persona: 'orchestrator',
                workflow: workflow.slug,
                stage: stage.slug,
              }).filter(
                (policy) =>
                  policy.id === 'INVOCATION-001' ||
                  policy.id === 'EXECUTOR-001',
              ),
            }
          : {
              persona: stage.persona,
              cursor_agent_path: cursorAgentTarget(
                root,
                stage.persona,
                state.cursor_agent_suffix,
              ),
              canonical_markdown_path: markdownPath,
              invocation_validation_path: invocationValidationPath(
                runId,
                invocationId,
                root,
              ),
              delegation_artifact_path: delegationArtifactPath,
              submit_command: `${panCommand(root)} submit ${runId} ${outputPath}`,
              mode: 'referenced' as const,
              delivery_prompt_path: deliveryPromptPath(
                runId,
                invocationId,
                root,
              ),
              policies: resolvePolicies(root, {
                persona: 'orchestrator',
                workflow: workflow.slug,
                stage: stage.slug,
              }).filter((policy) => policy.id === 'INVOCATION-001'),
            }

    const artifactProfile = operatorArtifactProfileForStage(
      stage.slug,
      workflow.slug,
    )
    const priorFailure = summarizePriorFailure(state, stage, root)
    const briefVocabulary = artifactsRequested
      ? resolveBriefVocabulary(root)
      : undefined
    const requiredData = { ...(stage.required_data ?? {}) }
    const fieldContract = stageFieldContract(
      root,
      stage.slug,
      requirements.validation_requirements,
    )

    if (stage.persona === 'coder' && attempt > 1) {
      requiredData['implementation.remediation'] = 'array'
    }

    if (
      stage.persona === 'release-steward' &&
      stage.slug === 'ship' &&
      isSelfDevelopmentInstallation(root)
    ) {
      Object.assign(requiredData, {
        'release.versioning': 'object',
        'release.versioning.current_version': 'string',
        'release.versioning.recommendation': 'string',
        'release.versioning.proposed_version': 'string',
        'release.versioning.baseline_commit': 'string',
        'release.versioning.rationale': 'string',
        'release.versioning.compatibility': 'string',
        'release.versioning.updated_files': 'array',
        'release.versioning.release_index_action': 'string',
      })
    }

    const invocation: Invocation = {
      $operator: {
        headline: `${stage.title} is ready`,
        summary:
          `The harness prepared attempt ${attempt} with model '${model}'` +
          (externalExecutor
            ? ` under the '${externalExecutor}' executor`
            : '') +
          `, ${policies.length} scoped policies, and a workspace fingerprint.`,
        next_action: nextAction,
      },
      schema_version: 1,
      invocation_id: invocationId,
      run_id: runId,
      attempt,
      created_at: now(),
      workspace_root: state.workspace_root || '.',
      ...(state.gate_overrides ? { gate_overrides: state.gate_overrides } : {}),
      ...(state.operator_involvement
        ? { operator_involvement: state.operator_involvement }
        : {}),
      ...(state.verification ? { verification: state.verification } : {}),
      review_mode: reviewMode,
      workflow: {
        slug: workflow.slug,
        snapshot_path: state.workflow_snapshot.path,
        snapshot_sha256: state.workflow_snapshot.sha256,
      },
      stage: {
        slug: stage.slug,
        title: stage.title,
        persona: stage.persona,
        ...(stage.executor ? { executor: stage.executor } : {}),
        ...(externalExecutor ? { persona_executor: externalExecutor } : {}),
        model,
        model_config: pipelineConfig.name,
        workspace_policy: stage.workspace_policy,
        gate: stage.gate,
      },
      prompt: loadStagePrompt(root, stage),
      ...(priorFailure ? { prior_failure: priorFailure } : {}),
      inputs: buildInvocationInputs({
        root,
        state,
        stage,
        attempt,
        invocationId,
        workspaceFingerprint: workspace.fingerprint,
        workspace,
      }),
      policies,
      requirements,
      rubric: stage.criteria,
      output: {
        path: outputPath,
        template: 'library/templates/stage-output.example.json',
        schema: 'library/schemas/stage-output.schema.json',
        required_data: requiredData,
        ...(fieldContract ? { field_contract: fieldContract } : {}),
        ...(artifactsRequested && briefVocabulary
          ? {
              operator_brief: {
                source_path: briefSourcePath,
                rendered_path: briefRenderedPath,
                ...(layout.version === 'v2'
                  ? {
                      source_lifecycle: 'transient' as const,
                      source_transient: true,
                    }
                  : {}),
                schema: 'library/schemas/operator-brief.schema.json',
                renderer: 'pan briefs render',
                profile: artifactProfile,
                required_headings: [
                  ...OPERATOR_ARTIFACT_PROFILE_HEADINGS[artifactProfile],
                ],
                allowed_card_types: briefVocabulary.card_types,
                allowed_section_semantics: briefVocabulary.section_semantics,
              },
            }
          : {}),
      },
      boundaries: [
        'You MUST read this invocation card before broader repository context.',
        ...(isTargetInstallation(root)
          ? [
              `Harness-relative paths beginning runtime/, library/, or governance/ are rooted at ${harnessPathPrefix(root)}/ when accessed from the target repository in Cursor.`,
            ]
          : []),
        `You MUST respect workspace policy '${stage.workspace_policy}'.`,
        PROTECTED_PATH_RULE,
        ...(stage.workspace_policy === 'release_metadata_only'
          ? [
              ...(isSelfDevelopmentInstallation(root)
                ? [
                    'You MAY also edit only CHANGELOG.md, VERSION, package.json, package-lock.json, README.md, and version-bearing Markdown under docs/ as required by VERSION-001.',
                  ]
                : []),
              'You MAY repair Pancreator runtime governance and artifact files for this run. You MUST NOT modify target source during ship.',
            ]
          : ['You MUST write only the declared output and evidence.']),
        ...(stage.persona === 'orchestrator'
          ? []
          : externalExecutor
            ? [
                `The harness authors delegation evidence at ${delegationArtifactPath} itself. You MUST NOT write that artifact or workspace-root .delegation.md.`,
              ]
            : [
                `You MUST persist delegation evidence to ${delegationArtifactPath} and MUST NOT write workspace-root .delegation.md.`,
              ]),
        'You MUST NOT alter workflow state directly.',
        'While a mutating workflow is active, external edits to tracked files SHOULD be avoided because they make stage attribution ambiguous; pause the run before operator-authored changes.',
        'You MUST NOT commit, push, merge, publish, deploy, or perform destructive source-control actions.',
      ],
      ...(delegation ? { delegation } : {}),
      ...(!externalExecutor &&
      stage.persona !== 'orchestrator' &&
      runUsesModelEvidenceContract(state)
        ? { model_evidence_required: true }
        : {}),
      workspace_before: workspace,
    }

    if (artifactsRequested) {
      scaffoldOperatorBrief(root, {
        source_path: briefSourcePath,
        profile: artifactProfile,
        title: `${stage.title} brief`,
        source: `${runId}/${invocationId}`,
      })
    }

    const renderedMarkdown = renderInvocationMarkdown(invocation)

    // The manifest describes the rendered bytes, so it can only be attached
    // after rendering. The card therefore never contains its own digest, and the
    // compact delivery prompt is where the digest and section index live.
    // External-executor delegations skip both: the harness pipes the card bytes
    // to the executor itself, so referenced delivery — and the read attestation
    // that polices it — has nothing to defend against.
    if (delegation?.mode === 'referenced' && delegation.delivery_prompt_path) {
      invocation.contract_manifest = buildInvocationContractManifest(
        markdownPath,
        renderedMarkdown,
        invocation.policies,
      )
      writeTextAtomic(
        resolveInside(root, delegation.delivery_prompt_path),
        renderInvocationDeliveryPrompt(
          invocation,
          invocation.contract_manifest,
        ),
      )
    }

    const invocationValidation = validateInvocationMarkdown(
      invocation,
      renderedMarkdown,
    )
    const invocationValidationArtifactPath = invocationValidationPath(
      runId,
      invocationId,
      root,
    )
    const invocationValidationArtifact = buildValidationArtifact({
      run_id: runId,
      invocation_id: invocationId,
      kind: 'invocation',
      status: invocationValidation.passed ? 'pass' : 'fail',
      checks: invocationValidation.checks,
      artifact_path: markdownPath,
    })

    writeJsonAtomic(
      resolveInside(root, invocationValidationArtifactPath),
      invocationValidationArtifact,
    )

    if (!invocationValidation.passed) {
      recordGovernanceArtifactIssues(
        root,
        state,
        stage.slug,
        invocationId,
        'invocation',
        [
          `Invocation validation failed: ${invocationValidationArtifact.summary}`,
        ],
        invocationValidationArtifactPath,
      )
    }

    writeJsonAtomic(resolveInside(root, jsonPath), invocation)
    writeTextAtomic(resolveInside(root, markdownPath), renderedMarkdown)

    const preparedAt = now()

    state.current_invocation = {
      id: invocationId,
      json_path: jsonPath,
      markdown_path: markdownPath,
      output_path: outputPath,
      prepared_at: preparedAt,
      last_activity_at: preparedAt,
    }
    state.pending_action = {
      type: 'invoke_agent',
      persona: stage.persona,
      path: markdownPath,
    }

    persistRun(root, state, 'invocation_prepared', {
      invocation_id: invocationId,
      stage: stage.slug,
      attempt,
    })

    return { state, invocation }
  })
}

/**
 * Verify the claude-code executor is available and authenticated, caching the
 * result on the run so the credential probe (a real, tiny invocation) is spent
 * once per run rather than once per delegation.
 */
function ensureClaudeCodeReady(
  state: RunState,
): { ok: true } | { ok: false; error: string } {
  const version = claudeCodeVersionPreflight()

  if (!version.ok) {
    return { ok: false, error: version.error ?? 'version preflight failed' }
  }

  if (
    state.claude_code_preflight &&
    state.claude_code_preflight.binary === version.binary &&
    state.claude_code_preflight.version === version.version
  ) {
    return { ok: true }
  }

  const credentials = claudeCodeCredentialPreflight()

  if (!credentials.ok) {
    return {
      ok: false,
      error: credentials.error ?? 'credential preflight failed',
    }
  }

  state.claude_code_preflight = {
    binary: version.binary,
    version: version.version ?? 'unknown',
    verified_at: now(),
  }

  return { ok: true }
}

function pauseForExecutorPreflight(
  root: string,
  state: RunState,
  stage: StageDefinition,
  executor: string,
  error: string,
): void {
  const reason =
    `Stage '${stage.slug}' resolves to the '${executor}' executor, but its ` +
    `preflight failed: ${error} Substituting another executor would falsify ` +
    `the run's model snapshot, so the run is paused instead.`

  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }

  writeDecision(root, state, 'External executor preflight failed', reason, [
    'Install and authenticate the Claude Code CLI on this machine, then ' +
      `resume with: ${panCommand(root)} resume ${state.run_id}`,
    'Or change the persona mapping in config.json, run ' +
      `${panCommand(root)} models --sync, and start a new run.`,
    `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
  ])
}

/**
 * Write rules for a non-source stage: the executor may write only inside the
 * harness runtime tree (its declared output, evidence, and brief artifacts all
 * live there). Expressed relative to the executor's working directory when the
 * runtime tree is reachable that way, and absolute (`//`) otherwise, which is
 * the detached-installation case.
 */
function claudeCodeWriteRules(root: string, workspaceDir: string): string[] {
  const runtimeAbsolute = path.join(root, 'runtime')
  const relative = path.relative(workspaceDir, runtimeAbsolute)
  const prefix =
    relative.length === 0 || relative.startsWith('..')
      ? `//${runtimeAbsolute}`
      : relative.split(path.sep).join('/')

  return [`Write(${prefix}/**)`, `Edit(${prefix}/**)`]
}

/**
 * Stage-derived tool policy for a claude-code invocation. Mutating stages get
 * unrestricted file tools; every other stage may write only inside the harness
 * runtime tree. This is defense in depth — `scope.no_unapproved_changes`
 * remains the gate of record for workspace mutation.
 */
function claudeCodeToolPolicy(
  root: string,
  workspaceDir: string,
  stage: StageDefinition,
): { allowedTools: string[]; addDirs: string[] } {
  const sourceMutating =
    stage.workspace_policy === 'source_allowed' ||
    stage.workspace_policy === 'release_metadata_only'
  const allowedTools = [
    'Read',
    'Grep',
    'Glob',
    'Bash',
    ...(sourceMutating
      ? ['Write', 'Edit']
      : claudeCodeWriteRules(root, workspaceDir)),
  ]
  const relative = path.relative(workspaceDir, root)
  const addDirs = relative.startsWith('..') ? [root] : []

  return { allowedTools, addDirs }
}

export interface DelegateInvocationOptions extends OperationProgressOptions {
  timeoutMs?: number
}

export interface DelegateInvocationResult {
  state: RunState
  invocation: Invocation | null
  execution: ExternalDelegationRecord | null
}

/**
 * Execute the active invocation's stage under its resolved external executor.
 *
 * The harness — not a model — moves the bytes: the canonical card is piped to
 * the spawned CLI verbatim, so delivery fidelity is a property of code and the
 * supervisor output ceiling does not apply. The harness also authors the
 * delegation audit itself: the delivered prompt byte for byte in the
 * delegation Markdown artifact, and executor identity, argument vector, exit
 * status, and session in the execution record beside it.
 */
export function delegateInvocation(
  root: string,
  runId: string,
  options: DelegateInvocationOptions = {},
): DelegateInvocationResult {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'running',
      `Run is not running: ${state.status}`,
      { code: 'RUN_NOT_RUNNING' },
    )
    invariant(
      state.pending_action.type === 'invoke_agent' && state.current_invocation,
      'Run is not awaiting delegation. Run prepare first.',
      {
        code: 'INVALID_RUN_ACTION',
        details: { pending: state.pending_action },
      },
    )

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)
    const invocation = readInvocation(root, state.current_invocation.json_path)
    const invocationId = invocation.invocation_id
    const pipelineConfig = loadRunPipelineConfig(root, state)
    const mapping = resolvePersonaMapping(pipelineConfig, stage.persona)

    invariant(
      mapping.executor === 'claude-code',
      `Stage '${stage.slug}' resolves to the '${mapping.executor}' executor. ` +
        `'pan delegate' dispatches only external executors; cursor personas ` +
        `are delegated by the supervisor per INVOCATION-001.`,
      { code: 'EXECUTOR_UNSUPPORTED' },
    )
    invariant(
      invocation.stage.persona_executor === 'claude-code',
      `Invocation ${invocationId} was prepared without executor routing. ` +
        `Re-prepare the invocation before delegating.`,
      { code: 'EXECUTOR_UNSUPPORTED' },
    )

    // The supervisor's first delivery step applies to the harness too: a card
    // whose validation failed MUST NOT be delegated.
    const validationArtifact = readJson(
      resolveInside(root, invocationValidationPath(runId, invocationId, root)),
    )
    invariant(
      isRecord(validationArtifact) && validationArtifact.status === 'pass',
      `Invocation validation for ${invocationId} did not pass; the card ` +
        'MUST NOT be delegated.',
      { code: 'INVOCATION_VALIDATION_FAILED' },
    )

    const preflight = ensureClaudeCodeReady(state)

    if (!preflight.ok) {
      pauseForExecutorPreflight(
        root,
        state,
        stage,
        mapping.executor,
        preflight.error,
      )
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation, execution: null }
    }

    const workspaceDir = workspaceDirectory(root, state)
    const policy = claudeCodeToolPolicy(root, workspaceDir, stage)
    const configuredTimeout = mapping.options['timeout-ms']
    const timeoutMs =
      options.timeoutMs ??
      (configuredTimeout ? Number(configuredTimeout) : undefined)
    const evidenceDir = resolveRunLayout(root, runId).evidence('').relative
    const runExecutor = (
      prompt: string,
      resumeSessionId?: string,
    ): ClaudeCodeInvocationResult =>
      runClaudeCode({
        prompt,
        cwd: workspaceDir,
        model: mapping.model,
        permissionMode: mapping.options['permission-mode'] ?? 'default',
        allowedTools: policy.allowedTools,
        addDirs: policy.addDirs,
        ...(resumeSessionId ? { resumeSessionId } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      })
    const writeExecutorLogs = (
      label: string,
      result: ClaudeCodeInvocationResult,
    ): { stdout_path: string; stderr_path: string } => {
      const stdoutPath = `${evidenceDir}/${invocationId}.claude-code${label}.stdout.json`
      const stderrPath = `${evidenceDir}/${invocationId}.claude-code${label}.stderr.log`

      writeTextAtomic(resolveInside(root, stdoutPath), result.stdout)
      writeTextAtomic(resolveInside(root, stderrPath), result.stderr)

      return { stdout_path: stdoutPath, stderr_path: stderrPath }
    }

    // An operator revision round resumes the recorded session so the author
    // keeps its full context (R6). A retry after a *failed* attempt never
    // resumes: the retry contract requires confronting the recorded failure,
    // and `prior_failure` inlining serves that on a fresh invocation.
    const sessionResumeEnabled = mapping.options['session-resume'] !== 'false'
    const lastForStage = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === stage.slug)
    const session = state.external_executor_sessions?.[stage.slug]
    const lastFeedback = [...(state.operator_feedback ?? [])]
      .reverse()
      .find((item) => item.to_stage === stage.slug)
    const revisionRound =
      lastFeedback?.decision === 'revise' &&
      lastForStage !== undefined &&
      lastForStage.outcome === 'success' &&
      lastFeedback.timestamp >= lastForStage.submitted_at
    const resumeSession =
      sessionResumeEnabled &&
      revisionRound &&
      session !== undefined &&
      session.invocation_id === lastForStage.invocation_id
        ? session
        : undefined

    const cardMarkdown = readText(
      resolveInside(root, state.current_invocation.markdown_path),
    )
    const delegationArtifactPath = delegationPath(runId, invocationId, root)
    let delegationKind: ExternalDelegationRecord['delegation_kind'] = 'fresh'
    let deliveredPrompt = cardMarkdown
    let result: ClaudeCodeInvocationResult
    let resumeAttempt: ExternalDelegationRecord['resume_attempt']

    if (resumeSession) {
      const directive = (lastFeedback?.note ?? '').trim()
      const resumePrompt = [
        `# Operator revision directive — invocation \`${invocationId}\``,
        '',
        'You completed the previous round of this stage in this session. The ' +
          'operator directed a revision rather than accepting the work as final.',
        '',
        `This is a new invocation \`${invocationId}\` (attempt ` +
          `${invocation.attempt}) for run \`${runId}\`. The full canonical ` +
          `contract for this round is at ` +
          `\`${state.current_invocation.markdown_path}\`; its policies, ` +
          'rubric, and boundaries are unchanged from your previous round ' +
          'except where the directive below amends the work.',
        '',
        `Write your revised stage output JSON to \`${invocation.output.path}\` ` +
          `with \`invocation_id\` set to \`${invocationId}\`.`,
        ...(invocation.output.operator_brief
          ? [
              '',
              `Edit the operator brief source at ` +
                `\`${invocation.output.operator_brief.source_path}\` in place.`,
            ]
          : [
              '',
              'This invocation does not request an operator brief. Do not create one.',
            ]),
        '',
        '## Directive',
        '',
        directive.length > 0
          ? directive
          : 'The operator requested a revision without written feedback. ' +
            'Re-derive the weakest parts of your previous round.',
        '',
      ].join('\n')

      options.onProgress?.(
        `resuming claude-code session ${resumeSession.session_id} with the operator directive`,
      )

      const resumed = runExecutor(resumePrompt, resumeSession.session_id)

      if (resumed.ok) {
        delegationKind = 'resumed'
        deliveredPrompt = resumePrompt
        result = resumed
      } else {
        // A failed resume falls back to a fresh invocation carrying the
        // standard operator-feedback input (already inlined on the card).
        options.onProgress?.(
          `session resume failed (${resumed.error ?? 'unknown error'}); ` +
            'falling back to a fresh delegation',
        )

        const attemptLogs = writeExecutorLogs('.resume-attempt', resumed)

        resumeAttempt = {
          exit_code: resumed.exit_code,
          timed_out: resumed.timed_out,
          ...attemptLogs,
        }
        delegationKind = 'resume_fallback'
        options.onProgress?.(
          `delegating '${stage.persona}' to claude-code (${mapping.model})`,
        )
        result = runExecutor(cardMarkdown)
      }
    } else {
      options.onProgress?.(
        `delegating '${stage.persona}' to claude-code (${mapping.model})`,
      )
      result = runExecutor(cardMarkdown)
    }

    const logs = writeExecutorLogs('', result)

    // The delegation Markdown artifact is the delivered prompt byte for byte.
    // A resumed round also persists it at the delivery-prompt path, which is
    // where delegation validation looks for a referenced body.
    writeTextAtomic(
      resolveInside(root, delegationArtifactPath),
      deliveredPrompt,
    )

    if (delegationKind === 'resumed') {
      writeTextAtomic(
        resolveInside(root, deliveryPromptPath(runId, invocationId, root)),
        deliveredPrompt,
      )
    }

    const execution: ExternalDelegationRecord = {
      schema_version: 1,
      run_id: runId,
      invocation_id: invocationId,
      stage: stage.slug,
      executor: 'claude-code',
      delegation_kind: delegationKind,
      binary: result.binary,
      argv: result.argv,
      exit_code: result.exit_code,
      timed_out: result.timed_out,
      duration_ms: result.duration_ms,
      ...(result.session_id ? { session_id: result.session_id } : {}),
      ...(resumeSession
        ? { resumed_from_session_id: resumeSession.session_id }
        : {}),
      ...(result.parsed?.subtype
        ? { result_subtype: result.parsed.subtype }
        : {}),
      ...(result.parsed?.is_error !== undefined
        ? { is_error: result.parsed.is_error }
        : {}),
      ...logs,
      ...(resumeAttempt ? { resume_attempt: resumeAttempt } : {}),
      delegation_artifact_path: delegationArtifactPath,
      recorded_at: now(),
    }

    writeJsonAtomic(
      resolveInside(root, delegationExecutionPath(runId, invocationId, root)),
      execution,
    )

    if (result.session_id) {
      const sessionRecord = {
        executor: 'claude-code' as const,
        session_id: result.session_id,
        invocation_id: invocationId,
        stage: stage.slug,
        recorded_at: execution.recorded_at,
      }

      state.external_executor_sessions = {
        ...(state.external_executor_sessions ?? {}),
        [stage.slug]: sessionRecord,
      }
      writeJsonAtomic(
        resolveInside(root, sessionRecordPath(runId, invocationId, root)),
        sessionRecord,
      )
    }

    if (!result.ok) {
      persistRun(root, state, 'external_delegation_failed', {
        invocation_id: invocationId,
        stage: stage.slug,
        executor: 'claude-code',
        delegation_kind: delegationKind,
        exit_code: result.exit_code,
        timed_out: result.timed_out,
      })

      invariant(false, `External delegation failed: ${result.error}`, {
        code: 'EXTERNAL_EXECUTOR_FAILED',
        details: {
          execution_record: delegationExecutionPath(runId, invocationId, root),
          stderr_path: logs.stderr_path,
          exit_code: result.exit_code,
        },
      })
    }

    persistRun(root, state, 'external_delegation_recorded', {
      invocation_id: invocationId,
      stage: stage.slug,
      executor: 'claude-code',
      delegation_kind: delegationKind,
      session_id: result.session_id ?? null,
    })

    return { state, invocation, execution }
  })
}

function materializeOperatorBrief(
  root: string,
  invocation: Invocation,
): string[] {
  const contract = invocation.output.operator_brief

  if (!contract) {
    return []
  }

  const source = resolveInside(root, contract.source_path)

  if (!fileExists(source)) {
    return [`operator brief source does not exist: ${contract.source_path}`]
  }

  try {
    renderBrief(root, contract.source_path, contract.rendered_path)
    return []
  } catch (error) {
    return [`operator brief render failed: ${errorMessage(error)}`]
  }
}

function effectiveOutcome(
  stage: StageDefinition,
  output: StageOutput,
  validationErrors: string[],
  deterministic: DeterministicResult[],
  validatorOutcome: StageOutcome | null = null,
): StageOutcome {
  if (validationErrors.length > 0) {
    return validatorOutcome === 'blocked' ? 'blocked' : 'failure'
  }

  if (validatorOutcome) {
    return validatorOutcome
  }

  if (output.result === 'blocked') {
    return 'blocked'
  }

  if (output.result === 'failure') {
    return 'failure'
  }

  const selfEvaluations = new Map(
    output.criteria.map((item) => [item.id, item]),
  )
  const failedHardCriterion = stage.criteria.some(
    (criterion) =>
      criterion.hard && selfEvaluations.get(criterion.id)?.result === 'fail',
  )

  if (failedHardCriterion) {
    return 'failure'
  }

  if (
    deterministic.some((item) => item.hard && !item.passed && !item.disabled)
  ) {
    return 'failure'
  }

  return 'success'
}

export function submitOutput(
  root: string,
  runId: string,
  submittedPath: string,
  options: OperationProgressOptions = {},
): { state: RunState; record: TaskRecord; idempotent?: boolean } {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const submittedRaw = readJson(resolveInside(root, submittedPath))
    // A revision submission patches the prior attempt's document instead of
    // re-emitting it: `{ revises: <prior invocation id>, patch: <RFC 7386
    // merge patch> }`. The merged document flows through every check a full
    // submission would.
    const revision =
      isRecord(submittedRaw) && typeof submittedRaw.revises === 'string'
        ? { revises: submittedRaw.revises, patch: submittedRaw.patch }
        : null
    let priorForRevision: StageHistoryItem | undefined
    let submittedValue = submittedRaw

    if (revision) {
      invariant(
        isRecord(revision.patch),
        'A revision submission MUST carry an object merge patch in patch.',
        { code: 'INVALID_REVISION' },
      )
      invariant(
        typeof revision.patch.invocation_id === 'string' &&
          revision.patch.invocation_id.length > 0 &&
          revision.patch.invocation_id !== revision.revises,
        `A revision patch MUST set invocation_id to the current card's ` +
          `invocation id, not the revised attempt's.`,
        { code: 'INVALID_REVISION' },
      )

      priorForRevision = state.stage_history.find(
        (item) => item.invocation_id === revision.revises,
      )

      invariant(
        priorForRevision,
        `Revision names invocation '${revision.revises}', which this run ` +
          `has no submitted attempt for.`,
        { code: 'INVALID_REVISION' },
      )

      submittedValue = applyJsonMergePatch(
        readJson(resolveInside(root, priorForRevision.output_path)),
        revision.patch,
      )
    }

    const invocationId = submittedInvocationId(submittedValue)
    const existing = invocationId
      ? state.stage_history.find((item) => item.invocation_id === invocationId)
      : undefined

    if (existing?.record_path) {
      const recordPath = artifactJsonPath(runId, existing.invocation_id, root)

      return {
        state,
        record: readTaskRecord(root, recordPath),
        idempotent: true,
      }
    }

    invariant(
      state.status === 'running',
      `Run is not running: ${state.status}`,
      {
        code: 'RUN_NOT_RUNNING',
      },
    )
    invariant(
      state.pending_action.type === 'invoke_agent',
      'Run is not awaiting stage output.',
      { code: 'INVALID_RUN_ACTION' },
    )
    invariant(state.current_invocation, 'Run has no active invocation.', {
      code: 'INVALID_RUN_ACTION',
    })

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)
    const invocation = readInvocation(root, state.current_invocation.json_path)

    assertRequiredModelEvidence(state, invocation)

    if (priorForRevision) {
      invariant(
        priorForRevision.stage === stage.slug,
        `Revision targets a '${priorForRevision.stage}' attempt, but the ` +
          `active stage is '${stage.slug}'.`,
        { code: 'INVALID_REVISION' },
      )
    }

    const governanceArtifactWarnings: string[] = []
    const attestationErrors: string[] = []

    const personaExecutor = invocation.stage.persona_executor ?? 'cursor'

    if (stage.persona !== 'orchestrator') {
      if (personaExecutor === 'cursor') {
        relocateMisplacedDelegationArtifact(
          root,
          runId,
          invocation.invocation_id,
        )
      }

      const delegationArtifactPath = delegationPath(
        runId,
        invocation.invocation_id,
        root,
      )
      const delegationAbsolute = resolveInside(root, delegationArtifactPath)

      if (!fileExists(delegationAbsolute)) {
        governanceArtifactWarnings.push(
          `Delegation artifact is missing: ${delegationArtifactPath}`,
        )
      } else {
        // Referenced delivery compares evidence with the compact prompt the
        // supervisor was given; verbatim delivery with the whole card; a
        // resumed external delegation with the persisted revision directive.
        // An invocation prepared before referenced mode existed carries no
        // delivery prompt, so it keeps full-card equality.
        const deliveredSource = expectedDelegationSource(root, invocation)
        const mode = deliveredSource.mode
        const deliveredSourcePath = deliveredSource.path
        const deliveredAbsolute = resolveInside(root, deliveredSourcePath)
        const delegationMarkdown = readText(delegationAbsolute)
        const delegationValidation = fileExists(deliveredAbsolute)
          ? validateDelegationMarkdown(
              readText(deliveredAbsolute),
              delegationMarkdown,
              mode,
            )
          : {
              passed: false,
              checks: [
                {
                  id: 'delegation.delivered_body_present',
                  passed: false,
                  message: `Delivered body is missing: ${deliveredSourcePath}`,
                },
              ],
            }
        const delegationValidationArtifactPath = delegationValidationPath(
          runId,
          invocation.invocation_id,
          root,
        )
        const delegationValidationArtifact = buildValidationArtifact({
          run_id: runId,
          invocation_id: invocation.invocation_id,
          kind: 'delegation',
          status: delegationValidation.passed ? 'pass' : 'fail',
          checks: delegationValidation.checks,
          artifact_path: delegationArtifactPath,
        })

        writeJsonAtomic(
          resolveInside(root, delegationValidationArtifactPath),
          delegationValidationArtifact,
        )

        if (!delegationValidation.passed) {
          governanceArtifactWarnings.push(
            `Delegation validation failed: ${delegationValidationArtifact.summary}`,
          )
        }
      }

      // Referenced delivery gives the harness no way to observe the read itself,
      // so the declared attestation is the observable and it is checked exactly.
      const attestation = validateInvocationAttestation(
        invocation,
        submittedValue,
      )
      const attestationArtifactPath = attestationValidationPath(
        runId,
        invocation.invocation_id,
        root,
      )
      const attestationArtifact = buildValidationArtifact({
        run_id: runId,
        invocation_id: invocation.invocation_id,
        kind: 'attestation',
        status: attestation.passed ? 'pass' : 'fail',
        checks: attestation.checks,
        artifact_path: state.current_invocation.output_path,
      })

      writeJsonAtomic(
        resolveInside(root, attestationArtifactPath),
        attestationArtifact,
      )

      if (!attestation.passed) {
        attestationErrors.push(
          `Invocation read attestation failed: ${attestationArtifact.summary}`,
        )
      }
    }

    const briefErrors = materializeOperatorBrief(root, invocation)
    // A failed render leaves the HTML absent, which would otherwise raise a
    // second "artifact does not exist" error and a third validator target-missing
    // error, both blaming the worker for one harness-side render failure. Keep
    // the root diagnostic and drop the derivatives.
    const briefRenderFailed = briefErrors.length > 0
    const briefRenderedPath = invocation.output.operator_brief?.rendered_path
    const validation = validateStageOutput(
      root,
      stage,
      invocation,
      submittedValue,
    )

    if (briefRenderFailed && briefRenderedPath) {
      validation.errors = validation.errors.filter(
        (message) => !message.includes(briefRenderedPath),
      )
    }
    writeJsonAtomic(
      resolveInside(root, state.current_invocation.output_path),
      submittedValue,
    )

    const evaluated = evaluateDeterministicCriteria(
      root,
      runDir(root, runId),
      state,
      stage,
      invocation.workspace_before,
      workspaceDirectory(root, state),
      state.gate_overrides ?? {},
      invocation.invocation_id,
      validation.output,
      options.onProgress,
    )
    const harnessValidation = runHarnessAuthoritativeValidators(
      root,
      runId,
      invocation,
      evaluated.workspace.fingerprint,
      submittedValue as Record<string, unknown>,
      state as unknown as Record<string, unknown>,
    )
    governanceArtifactWarnings.push(
      ...attestationErrors,
      ...briefErrors.map((message) => `Operator brief: ${message}`),
      ...validation.errors.map((message) => `Stage output: ${message}`),
      ...(briefRenderFailed && briefRenderedPath
        ? harnessValidation.errors.filter(
            (message) => !message.includes(briefRenderedPath),
          )
        : harnessValidation.errors
      ).map((message) => `Validator: ${message}`),
    )
    recordGovernanceArtifactIssues(
      root,
      state,
      stage.slug,
      invocation.invocation_id,
      'validator',
      governanceArtifactWarnings,
    )

    // A missing or mismatched attestation blocks every stage, because it means
    // the harness cannot show that the worker held the contract it acted on.
    // Ship blocks on every non-advisory diagnostic; an advisory validator
    // failure is recorded as a governance issue but must not fail the stage,
    // or the advisory enforcement declared on the card would be false.
    const blockingValidationErrors =
      stage.slug === 'ship'
        ? [
            ...attestationErrors,
            ...briefErrors.map((message) => `Operator brief: ${message}`),
            ...validation.errors.map((message) => `Stage output: ${message}`),
            ...(briefRenderFailed && briefRenderedPath
              ? harnessValidation.blocking_errors.filter(
                  (message) => !message.includes(briefRenderedPath),
                )
              : harnessValidation.blocking_errors
            ).map((message) => `Validator: ${message}`),
          ]
        : [...attestationErrors]
    const explicitlyDeclaredProductFailure =
      isRecord(submittedValue) &&
      (submittedValue.result === 'failure' ||
        submittedValue.result === 'blocked')
    const outcomeOutput =
      stage.slug !== 'ship' &&
      validation.errors.length > 0 &&
      !explicitlyDeclaredProductFailure
        ? { ...validation.output, result: 'success' as const }
        : validation.output
    const outcome = effectiveOutcome(
      stage,
      outcomeOutput,
      blockingValidationErrors,
      evaluated.results,
      stage.slug === 'ship' ? harnessValidation.validatorOutcome : null,
    )
    const allValidationErrors = [
      ...validation.errors,
      ...harnessValidation.errors,
    ]
    const briefContract = invocation.output.operator_brief

    let briefSourceRecord: StageHistoryItem['operator_brief_source']

    if (
      (briefContract?.source_lifecycle === 'transient' ||
        briefContract?.source_transient === true) &&
      briefErrors.length === 0 &&
      allValidationErrors.length === 0
    ) {
      // The checksum lives in stage history rather than a separate evidence
      // file, so deleting the source is a net file-count reduction.
      const sourceAbsolute = resolveInside(root, briefContract.source_path)

      briefSourceRecord = {
        source_path: briefContract.source_path,
        source_sha256: sha256(readText(sourceAbsolute)),
        rendered_path: briefContract.rendered_path,
        status: 'rendered_and_validated',
      }
      rmSync(sourceAbsolute, { force: true })
    }

    const historyItem: StageHistoryItem = {
      stage: stage.slug,
      attempt: invocation.attempt,
      invocation_id: invocation.invocation_id,
      ...(invocation.stage.persona_executor
        ? { executor: invocation.stage.persona_executor }
        : {}),
      output_path: state.current_invocation.output_path,
      outcome,
      submitted_at: now(),
      ...(priorForRevision
        ? { revised_from: priorForRevision.invocation_id }
        : {}),
      workspace_fingerprint: evaluated.workspace.fingerprint,
      workspace_before_fingerprint: invocation.workspace_before.fingerprint,
      validation_errors: allValidationErrors,
      governance_artifact_warnings: governanceArtifactWarnings,
      deterministic: evaluated.results,
      self_criteria: validation.output.criteria,
      ...(briefSourceRecord
        ? { operator_brief_source: briefSourceRecord }
        : {}),
    }

    state.stage_history.push(historyItem)

    let nextState: string | null
    const environmentBlocked = evaluated.results.some(
      (result) => result.environment_blocked,
    )

    // A successful outcome needs no environment pause: with a soft repository
    // gate the stage can pass while infrastructure evidence remains, and
    // pausing a passing stage would contradict its own record.
    if (environmentBlocked && outcome !== 'success') {
      const reason =
        `Stage '${stage.slug}' encountered only timeout or collection artifacts ` +
        'on infrastructure that already failed before implementation.'

      state.status = 'paused'
      state.pause_reason = reason
      state.pending_action = { type: 'operator_decision' }
      writeDecision(
        root,
        state,
        'QA environment needs an operator decision',
        reason,
        [
          'Repair the environment, then resume the QA stage.',
          `Or redirect the run with: ${panCommand(root)} set-stage ${state.run_id} <stage> --note "<directive>"`,
        ],
      )
      nextState = 'paused'
    } else if (outcome === 'success' && stage.gate === 'supervisor') {
      const assessmentId = `assessment-${invocation.invocation_id}`
      const layout = resolveRunLayout(root, runId)
      const assessmentPath = layout.assessment(
        `${invocation.invocation_id}.assessment.json`,
      ).relative
      const cardPath = layout.assessment(
        `${invocation.invocation_id}.assessment-request.json`,
      ).relative

      writeJsonAtomic(resolveInside(root, cardPath), {
        $operator: {
          headline: `${stage.title} needs supervisor evaluation`,
          status: 'awaiting_evaluation',
          next_action: `Write ${assessmentPath} and run pan assess.`,
        },
        schema_version: 1,
        assessment_id: assessmentId,
        invocation_id: invocation.invocation_id,
        run_id: runId,
        stage: stage.slug,
        output_path: state.current_invocation.output_path,
        criteria: stage.criteria.filter(
          (criterion) => criterion.type === 'judgment',
        ),
        deterministic_results: evaluated.results,
        required_output_path: assessmentPath,
      })

      state.pending_action = {
        type: 'supervisor_assessment',
        path: cardPath,
        output_path: assessmentPath,
      }
      state.status = 'awaiting_supervisor'
      nextState = 'awaiting supervisor evaluation'
    } else {
      if (outcome === 'success' && isSameReasonTrackedStage(state, stage)) {
        clearSameReasonTracker(state, stage.slug)
      }

      let sameReasonPauseTriggered = false

      if (outcome === 'failure' && isSameReasonTrackedStage(state, stage)) {
        const signature = collectHardFailureSignature(
          stage,
          validation.output.criteria,
          evaluated.results,
          allValidationErrors,
        )

        sameReasonPauseTriggered = recordSameReasonFailure(
          state,
          stage.slug,
          signature,
        )
      }

      if (sameReasonPauseTriggered) {
        pauseForSameReasonFailure(root, state, stage)
        nextState = 'paused'
      } else if (stage.gate === 'operator') {
        // An operator gate owns the transition, not only the happy path. A failed
        // review that routes straight back to implementation would spend the
        // operator's decision without ever asking for it.
        const directorCheckpoint =
          stage.checkpoint &&
          runHasContract(state.operator_involvement, 'technical_director')
            ? stage.checkpoint
            : undefined

        state.pending_action = {
          type: 'operator_approval',
          stage: stage.slug,
          outcome,
          proposed_transition: stage.transitions[outcome],
          ...(directorCheckpoint ? { checkpoint: directorCheckpoint } : {}),
        }
        state.status = 'awaiting_operator'
        nextState = directorCheckpoint
          ? `awaiting operator decision at the ${directorCheckpoint} checkpoint`
          : 'awaiting operator approval'
      } else {
        applyTransition(root, state, stage, outcome)
        nextState =
          state.status === 'running' ? state.current_stage : state.status
      }
    }

    const record: TaskRecord = {
      schema_version: 1,
      run_id: runId,
      invocation_id: invocation.invocation_id,
      stage: {
        slug: stage.slug,
        title: stage.title,
        persona: stage.persona,
      },
      outcome,
      summary: validation.output.summary,
      artifacts: validation.output.artifacts,
      risks: validation.output.risks,
      unknowns: validation.output.unknowns,
      evaluation: {
        validation_errors: validation.errors,
        governance_artifact_warnings: governanceArtifactWarnings,
        deterministic: evaluated.results,
        self: validation.output.criteria,
      },
      workspace_fingerprint: evaluated.workspace.fingerprint,
      next_state: nextState,
      timestamp: now(),
    }
    const recordJsonPath = artifactJsonPath(
      runId,
      invocation.invocation_id,
      root,
    )

    writeJsonAtomic(resolveInside(root, recordJsonPath), record)

    historyItem.record_path = recordJsonPath

    persistRun(root, state, 'stage_output_submitted', {
      stage: stage.slug,
      invocation_id: invocation.invocation_id,
      outcome,
      next_state: nextState,
    })

    return { state, record }
  })
}

export function assessStage(
  root: string,
  runId: string,
  assessmentPath: string,
): { state: RunState; assessment: SupervisorAssessment } {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'awaiting_supervisor' &&
        state.pending_action.type === 'supervisor_assessment',
      'Run is not awaiting supervisor assessment.',
      { code: 'INVALID_RUN_ACTION' },
    )
    invariant(state.current_invocation, 'Run has no active invocation.', {
      code: 'INVALID_RUN_ACTION',
    })

    const assessment = parseSupervisorAssessment(
      readJson(resolveInside(root, assessmentPath)),
      assessmentPath,
    )

    invariant(
      assessment.invocation_id === state.current_invocation.id,
      'Assessment invocation_id MUST match the active invocation.',
      { code: 'INVALID_ASSESSMENT' },
    )

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)

    writeJsonAtomic(
      resolveInside(root, state.pending_action.output_path),
      assessment,
    )

    if (
      assessment.verdict === 'escalate' &&
      state.best_of_n?.role === 'candidate'
    ) {
      state.status = 'running'
      applyTransition(root, state, stage, 'failure')
    } else if (assessment.verdict === 'escalate') {
      state.status = 'paused'
      state.pause_reason = assessment.summary
      state.pending_action = { type: 'operator_decision' }

      writeDecision(
        root,
        state,
        'Supervisor escalated a judgment',
        assessment.summary,
        assessment.action_items ?? [],
      )
    } else {
      state.status = 'running'
      applyTransition(
        root,
        state,
        stage,
        assessment.verdict === 'pass' ? 'success' : 'failure',
      )
    }

    persistRun(root, state, 'supervisor_assessment_recorded', {
      stage: stage.slug,
      verdict: assessment.verdict,
    })

    return { state, assessment }
  })
}

/**
 * Clear attempt counters for the remediation stage and every stage declared
 * after it, so an operator-directed rewind starts that pipeline segment fresh
 * instead of inheriting attempts from the run that was rejected.
 */
function resetAttemptsFrom(
  workflow: WorkflowDefinition,
  state: RunState,
  fromStage: string,
): void {
  const order = workflow.stages.map((candidate) => candidate.slug)
  const startIndex = order.indexOf(fromStage)

  if (startIndex === -1) {
    return
  }

  for (const slug of order.slice(startIndex)) {
    delete state.attempts[slug]
  }
}

/**
 * Persist operator remediation feedback as a durable artifact and register it on
 * the run so the remediation worker receives it as an input reference.
 */
function recordOperatorFeedback(
  root: string,
  state: RunState,
  fromStage: StageDefinition,
  toStage: string,
  decision: OperatorFeedbackItem['decision'],
  note: string,
): void {
  const feedback = state.operator_feedback ?? []
  const index = feedback.length + 1
  const attempt = state.attempts[fromStage.slug] ?? 1
  // Control records document operator decisions for workers and audit, so they
  // live beside the decision records rather than in the operator directory.
  const relativePath = resolveRunLayout(root, state.run_id).decision(
    `operator-feedback-${index}.md`,
  ).relative
  const heading =
    decision === 'approve'
      ? 'Operator directive attached to approval'
      : decision === 'reject'
        ? 'Operator rejection'
        : decision === 'revise'
          ? 'Operator revision directive'
          : 'Operator remediation note'
  const body = [
    `# ${heading}: ${fromStage.title} (\`${fromStage.slug}\`)`,
    '',
    `**Run** \`${state.run_id}\` · **Source attempt** ${attempt} · ` +
      `**${decision === 'approve' ? 'Directed stage' : 'Remediation stage'}** \`${toStage}\``,
    '',
    decision === 'approve' ? '## Operator directive' : '## Required changes',
    '',
    note.trim().length > 0
      ? note.trim()
      : 'The operator rejected this stage without written feedback. ' +
        'Treat the prior output as unacceptable and re-derive the work.',
    '',
    decision === 'approve'
      ? `The operator approved the '${fromStage.slug}' stage and attached ` +
        'this directive for your stage. Apply it as operator-supplied ' +
        'context; it adds no scope beyond your contract.'
      : decision === 'revise'
        ? 'This is a refinement directive, not a rejection. Keep everything the ' +
          'operator did not ask you to change, apply the changes above, and ' +
          'state in your summary what you changed and what you deliberately ' +
          'left alone.'
        : 'You MUST address this feedback before the run can reach the operator ' +
          'gate again.',
    '',
  ].join('\n')

  writeTextAtomic(resolveInside(root, relativePath), `${body}\n`)

  const item: OperatorFeedbackItem = {
    decision,
    from_stage: fromStage.slug,
    to_stage: toStage,
    attempt,
    note,
    path: relativePath,
    timestamp: now(),
  }

  feedback.push(item)
  state.operator_feedback = feedback
}

export function decideRun(
  root: string,
  runId: string,
  decision: string,
  note = '',
  targetStage: string | null = null,
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'awaiting_operator' &&
        state.pending_action.type === 'operator_approval',
      'Run is not awaiting operator approval.',
      { code: 'INVALID_RUN_ACTION' },
    )
    invariant(
      decision === 'approve' || decision === 'reject' || decision === 'revise',
      'Decision MUST be approve, reject, or revise.',
      { code: 'INVALID_DECISION' },
    )

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)
    // A pending action recorded before outcome-aware gates carries no outcome,
    // and only a successful stage could stop then, so success is the safe default.
    const approvedOutcome =
      state.pending_action.type === 'operator_approval'
        ? (state.pending_action.outcome ?? 'success')
        : 'success'

    invariant(
      decision !== 'revise' || note.trim().length > 0,
      'A revise decision MUST carry the operator directive in --note.',
      { code: 'REVISION_NOTE_REQUIRED' },
    )

    state.status = 'running'

    if (decision === 'approve') {
      applyTransition(root, state, stage, approvedOutcome)

      // A non-empty approval note is a directive to the routed stage, not
      // just audit text: recording it only in the event log silently dropped
      // it from every later invocation while the operator reasonably believed
      // the run received it (HR-001, run 63322_Aug-18-1287_box-poller-p). On
      // a terminal or paused route there is no next card, so the note stays
      // audit evidence in the decision event below.
      const routedStage = state.current_stage

      if (
        note.trim().length > 0 &&
        routedStage !== null &&
        state.status === 'running'
      ) {
        recordOperatorFeedback(root, state, stage, routedStage, 'approve', note)
      }
    } else if (decision === 'revise') {
      // Re-run the same stage with the operator's directive as required input.
      // The stage did not fail, so this must not consume its retry budget.
      const revisions = state.operator_revisions ?? {}

      revisions[stage.slug] = (revisions[stage.slug] ?? 0) + 1
      state.operator_revisions = revisions

      recordOperatorFeedback(root, state, stage, stage.slug, 'revise', note)
      clearSameReasonTracker(state, stage.slug)
      applyTransition(root, state, stage, 'failure', {
        overrideTarget: stage.slug,
        operatorDirected: true,
      })
    } else {
      let target = stage.transitions.failure

      if (targetStage) {
        stageBySlug(workflow, targetStage)
        target = targetStage
        resetAttemptsFrom(workflow, state, target)
      }

      recordOperatorFeedback(root, state, stage, target, 'reject', note)
      applyTransition(root, state, stage, 'failure', {
        overrideTarget: target,
        operatorDirected: Boolean(targetStage),
      })
    }

    persistRun(root, state, 'operator_decision_recorded', {
      stage: stage.slug,
      decision,
      note,
      target_stage: decision === 'approve' ? null : state.current_stage,
      ...(decision === 'revise'
        ? { operator_revision: state.operator_revisions?.[stage.slug] }
        : {}),
    })

    return state
  })
}

/**
 * Move a run to an operator-selected stage outside normal workflow transitions.
 * An obsolete worker may continue writing because durable state cannot observe
 * process lifetime, so stopping it first is prudent. That operational risk does
 * not constrain the operator's authority to redirect the run.
 */
export function setRunStage(
  root: string,
  runId: string,
  stageSlug: string,
  note: string,
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(note.trim().length > 0, 'Stage repair note MUST be non-empty.', {
      code: 'REPAIR_NOTE_REQUIRED',
    })

    const workflow = loadRunWorkflow(root, state)
    stageBySlug(workflow, stageSlug)

    const fromStage = state.current_stage ?? state.status
    const sourceAttempt = state.current_stage
      ? (state.attempts[state.current_stage] ?? 0)
      : 0
    const feedback = state.operator_feedback ?? []
    const index = feedback.length + 1
    const relativePath = resolveRunLayout(root, state.run_id).decision(
      `operator-feedback-${index}.md`,
    ).relative
    const body = [
      '# Operator stage repair',
      '',
      `**Run** \`${state.run_id}\` · **Previous state** \`${fromStage}\` · ` +
        `**Target stage** \`${stageSlug}\``,
      '',
      '## Repair reason',
      '',
      note.trim(),
      '',
      'This operator-directed repair bypassed normal workflow transitions. ' +
        'You MUST treat the reason above as required input for this stage.',
      '',
    ].join('\n')

    writeTextAtomic(resolveInside(root, relativePath), `${body}\n`)

    feedback.push({
      decision: 'set-stage',
      from_stage: fromStage,
      to_stage: stageSlug,
      attempt: sourceAttempt,
      note,
      path: relativePath,
      timestamp: now(),
    })
    state.operator_feedback = feedback

    resetAttemptsFrom(workflow, state, stageSlug)
    clearAllSameReasonTrackers(state)
    state.status = 'running'
    state.current_stage = stageSlug
    state.pending_action = { type: 'prepare_invocation' }
    state.current_invocation = null
    state.pause_reason = null
    state.operator_pause = null
    state.accepted_workspace_fingerprint = null
    state.transition_count = 0
    state.consecutive_failures = 0

    persistRun(root, state, 'operator_stage_set', {
      from_stage: fromStage,
      to_stage: stageSlug,
      note_path: relativePath,
    })

    return state
  })
}

function ratifyPausedWorkspaceChanges(
  root: string,
  state: RunState,
  pause: OperatorPauseContext,
  note: string,
): OperatorWorkspaceRatification | null {
  const before = pause.workspace_before

  if (!before) {
    return null
  }

  const current = workspaceSnapshotForRun(root, state)

  if (current.fingerprint === before.fingerprint) {
    return null
  }

  const ratificationId = `pause-${randomUUID()}`
  const changedPaths = workspaceChangedPathsFromSnapshots(before, current)
  const beforePaths = new Set(before.entries.map((entry) => entry.slice(3)))
  const afterPaths = new Set(current.entries.map((entry) => entry.slice(3)))
  const deletedPaths = [...beforePaths]
    .filter((relativePath) => !afterPaths.has(relativePath))
    .sort()
  const ratifications = state.operator_workspace_ratifications ?? []
  const relativePath = resolveRunLayout(root, state.run_id).decision(
    `operator-pause-ratification-${ratifications.length + 1}.md`,
  ).relative
  const body = [
    '# Operator-paused workspace ratification',
    '',
    `**Run** \`${state.run_id}\` · **Stage** \`${state.current_stage ?? 'none'}\``,
    '',
    'The operator explicitly paused the workflow before making these Git-visible source changes. Pancreator recorded the resulting delta without scanning dependency, virtual-environment, cache, compiled, or generated directories.',
    '',
    `**Accepted fingerprint:** \`${current.fingerprint}\``,
    '',
    '## Changed paths',
    '',
    ...(changedPaths.length > 0
      ? changedPaths.map((item) => `- \`${item}\``)
      : ['- None']),
    '',
    '## Deleted paths',
    '',
    ...(deletedPaths.length > 0
      ? deletedPaths.map((item) => `- \`${item}\``)
      : ['- None']),
    '',
    '## Operator note',
    '',
    note.trim().length > 0 ? note.trim() : 'No additional note supplied.',
    '',
  ].join('\n')

  writeTextAtomic(resolveInside(root, relativePath), `${body}\n`)

  const ratification: OperatorWorkspaceRatification = {
    ratification_id: ratificationId,
    stage: state.current_stage ?? 'unknown',
    workspace_fingerprint: current.fingerprint,
    changed_paths: changedPaths,
    deleted_paths: deletedPaths,
    note,
    artifact_path: relativePath,
    timestamp: now(),
  }

  ratifications.push(ratification)
  state.operator_workspace_ratifications = ratifications
  state.accepted_workspace_fingerprint = current.fingerprint

  return ratification
}

function invalidatePausedInvocation(state: RunState): void {
  if (state.current_invocation && state.current_stage) {
    const wasSubmitted = state.stage_history.some(
      (item) => item.invocation_id === state.current_invocation?.id,
    )

    if (!wasSubmitted) {
      const attempts = state.attempts[state.current_stage] ?? 0

      if (attempts > 0) {
        state.attempts[state.current_stage] = attempts - 1
      }
    }
  }

  state.status = 'running'
  state.pending_action = { type: 'prepare_invocation' }
  state.current_invocation = null
}

/**
 * Change a run's verification level. The new level is resolved fresh from
 * config plus built-ins and replaces the run's snapshot, so later gates run
 * under the new mapping. Baselines are not recaptured: a gate whose new
 * profile was never baselined is judged on its own result.
 */
export function setRunVerification(
  root: string,
  runId: string,
  levelName: string,
  note = '',
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status !== 'succeeded' &&
        state.status !== 'failed' &&
        state.status !== 'canceled',
      'Run is already terminal.',
      { code: 'RUN_TERMINAL' },
    )

    const resolved = resolveVerification(root, levelName)
    const previous = state.verification?.level ?? 'workflow-declared'
    const reason =
      `Operator set verification level '${resolved.level}' ` +
      `(was '${previous}').${note.trim().length > 0 ? ` ${note.trim()}` : ''}`

    state.verification = resolved
    state.updated_at = now()

    writeDecision(root, state, 'Verification level changed', reason, [
      `Continue with: ${panCommand(root)} resume ${state.run_id}`,
    ])

    persistRun(root, state, 'verification_level_changed', {
      from: previous,
      to: resolved.level,
      ...(note.trim().length > 0 ? { note: note.trim() } : {}),
    })

    return state
  })
}

export function pauseRun(root: string, runId: string, note = ''): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status !== 'succeeded' &&
        state.status !== 'failed' &&
        state.status !== 'canceled',
      'Run is already terminal.',
      { code: 'RUN_TERMINAL' },
    )

    const reason =
      note.trim().length > 0 ? note.trim() : 'Operator paused the workflow.'

    if (state.status !== 'paused') {
      invariant(
        state.status === 'running' ||
          state.status === 'awaiting_supervisor' ||
          state.status === 'awaiting_operator',
        `Run cannot be paused from status '${state.status}'.`,
        { code: 'INVALID_RUN_ACTION' },
      )

      const workspace = workspaceSnapshotForRun(root, state)

      state.operator_pause = {
        prior_status: state.status,
        prior_pending_action: JSON.parse(
          JSON.stringify(state.pending_action),
        ) as OperatorPauseContext['prior_pending_action'],
        workspace_before: workspace,
      }
    }

    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision' }

    writeDecision(root, state, 'Operator paused the workflow', reason, [
      `Resume with: ${panCommand(root)} resume ${state.run_id}`,
      `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
      'While paused, you may modify tracked files in the workspace as needed.',
    ])

    persistRun(root, state, 'operator_pause', { note: reason })

    return state
  })
}

export function resumeRun(
  root: string,
  runId: string,
  stageSlug: string | null = null,
  note = '',
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(state.status === 'paused', 'Only paused runs can be resumed.', {
      code: 'INVALID_RUN_ACTION',
    })

    const workflow = loadRunWorkflow(root, state)
    const savedPause = state.operator_pause
    const ratification = savedPause
      ? ratifyPausedWorkspaceChanges(root, state, savedPause, note)
      : null

    if (savedPause && !stageSlug) {
      if (note.trim().length > 0) {
        invariant(
          savedPause.prior_pending_action.type === 'invoke_agent' &&
            state.current_invocation !== null,
          'A no-stage resume note has no active worker card to target. Pass --stage explicitly.',
          { code: 'RESUME_NOTE_TARGET_UNAVAILABLE' },
        )

        const source = stageBySlug(
          workflow,
          state.current_stage ?? workflow.start_stage,
        )

        recordOperatorFeedback(
          root,
          state,
          source,
          state.current_stage ?? workflow.start_stage,
          'resume',
          note,
        )
      }

      if (ratification || note.trim().length > 0) {
        invalidatePausedInvocation(state)
      } else {
        state.status = savedPause.prior_status
        state.pending_action = savedPause.prior_pending_action
      }

      state.operator_pause = null
      state.pause_reason = null

      persistRun(root, state, 'run_resumed', {
        restored_status: ratification ? 'running' : savedPause.prior_status,
        workspace_ratification: ratification?.ratification_id ?? null,
      })

      return state
    }

    if (ratification) {
      invalidatePausedInvocation(state)
    }

    const target = stageSlug ?? state.current_stage ?? workflow.start_stage

    stageBySlug(workflow, target)
    const source = stageBySlug(
      workflow,
      state.current_stage ?? workflow.start_stage,
    )

    if (note.trim().length > 0) {
      recordOperatorFeedback(root, state, source, target, 'resume', note)
    }

    state.status = 'running'
    state.current_stage = target
    state.pending_action = { type: 'prepare_invocation' }
    state.current_invocation = null
    state.pause_reason = null
    state.operator_pause = null
    state.consecutive_failures = 0

    persistRun(root, state, 'run_resumed', {
      stage: target,
      workspace_ratification: ratification?.ratification_id ?? null,
    })

    return state
  })
}

export interface WaiveGateOptions {
  stageSlug?: string | null
  targetStage?: string | null
  criterionIds?: string[]
  note: string
  deferredAcceptanceCriteria?: string[]
  createSpotfixCase?: boolean
}

function normalizeIdentifiers(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort()
}

function failedHardCriteria(
  stage: StageDefinition,
  record: TaskRecord,
  assessment: SupervisorAssessment | null = null,
): string[] {
  const self = new Map(
    (assessment?.criteria ?? record.evaluation.self).map((item) => [
      item.id,
      item,
    ]),
  )
  const deterministic = new Map(
    record.evaluation.deterministic.map((item) => [item.id, item]),
  )

  return stage.criteria
    .filter((criterion) => {
      if (!criterion.hard) {
        return false
      }

      if (criterion.type === 'judgment') {
        return self.get(criterion.id)?.result === 'fail'
      }

      const result = deterministic.get(criterion.id)

      return result?.passed === false && !result.disabled
    })
    .map((criterion) => criterion.id)
    .sort()
}

function writeSpotfixCase(
  root: string,
  state: RunState,
  waiverId: string,
  stage: StageDefinition,
  history: StageHistoryItem,
  criterionIds: string[],
  acceptanceCriteria: string[],
  note: string,
  sourceEvidencePath: string,
): string {
  const timestamp = now().replaceAll(/[-:.]/gu, '')
  const relativePath =
    `runtime/inbox/spotfix-case-${timestamp}-${state.run_id.slice(-8)}-` +
    `${stage.slug}.md`
  const body = [
    '# Deferred spotfix case',
    '',
    `**Source run** \`${state.run_id}\` · **Waiver** \`${waiverId}\` · ` +
      `**Stage** \`${stage.slug}\` · **Attempt** ${history.attempt}`,
    '',
    '## Status',
    '',
    'open — lightweight eligibility MUST be re-verified under `WORK-001` before editing.',
    '',
    '## Deferred acceptance criteria',
    '',
    ...acceptanceCriteria.map((item) => `- \`${item}\``),
    '',
    '## Waived gate criteria',
    '',
    ...criterionIds.map((item) => `- \`${item}\``),
    '',
    '## Operator rationale and bounded scope',
    '',
    note.trim(),
    '',
    '## Evidence',
    '',
    `- Gate evidence: \`${sourceEvidencePath}\``,
    `- Stage output: \`${history.output_path}\``,
    ...(history.record_path
      ? [`- Execution record: \`${history.record_path}\``]
      : []),
    `- Workspace fingerprint: \`${history.workspace_fingerprint}\``,
    '',
    '## Required next action',
    '',
    'Run `/pan-spotfix` with this file as the preserved input only when the remaining work is still one coherent bounded change. Otherwise route it through the systematic workflow.',
    '',
  ].join('\n')

  writeTextAtomic(resolveInside(root, relativePath), `${body}\n`)

  return relativePath
}

/**
 * Record an explicit operator directive that bypasses a stage or gate and route
 * the run according to the operator's stated terms. The directive is audited,
 * but governance does not narrow the operator's authority.
 */
export function waiveGate(
  root: string,
  runId: string,
  options: WaiveGateOptions,
): { state: RunState; waiver: OperatorGateWaiver } {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      options.note.trim().length > 0,
      'Waiver note MUST be non-empty.',
      { code: 'WAIVER_NOTE_REQUIRED' },
    )

    const workflow = loadRunWorkflow(root, state)
    const stageSlug =
      options.stageSlug ??
      state.current_stage ??
      [...state.stage_history]
        .reverse()
        .find((item) => item.outcome !== 'success')?.stage

    invariant(stageSlug, 'Run has no stage to waive.', {
      code: 'INVALID_RUN_ACTION',
    })

    const stage = stageBySlug(workflow, stageSlug)
    const history = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === stageSlug)
    const assessmentPath = history
      ? resolveRunLayout(root, state.run_id).assessment(
          `${history.invocation_id}.assessment.json`,
        ).relative
      : null
    let assessment: SupervisorAssessment | null = null

    if (assessmentPath && fileExists(resolveInside(root, assessmentPath))) {
      try {
        assessment = parseSupervisorAssessment(
          readJson(resolveInside(root, assessmentPath)),
          assessmentPath,
        )
      } catch {
        assessment = null
      }
    }

    let record: TaskRecord | null = null
    if (
      history?.record_path &&
      fileExists(resolveInside(root, history.record_path))
    ) {
      try {
        record = readTaskRecord(root, history.record_path)
      } catch {
        record = null
      }
    }

    const inferredBlockers = record
      ? failedHardCriteria(stage, record, assessment)
      : []
    const requested = normalizeIdentifiers(options.criterionIds ?? [])
    const waivedCriteria =
      requested.length > 0
        ? requested
        : inferredBlockers.length > 0
          ? inferredBlockers
          : ['*']
    const bypassedBeyondRequest = inferredBlockers.filter(
      (blocker) => !waivedCriteria.includes(blocker),
    )
    const wholeStageBypass = bypassedBeyondRequest.length > 0
    const target = options.targetStage ?? stage.transitions.success

    invariant(target, `Stage '${stage.slug}' has no success transition.`, {
      code: 'INVALID_TRANSITION',
    })
    if (!['succeeded', 'failed', 'canceled', 'paused'].includes(target)) {
      stageBySlug(workflow, target)
    }

    const deferred = normalizeIdentifiers(
      options.deferredAcceptanceCriteria ?? [],
    )
    if (options.createSpotfixCase) {
      invariant(
        deferred.length > 0 && history,
        '--spotfix requires a prior stage attempt and at least one deferred acceptance criterion.',
        { code: 'INVALID_SPOTFIX_CASE' },
      )
    }

    const workspace = workspaceSnapshotForRun(root, state)
    const waivers = state.operator_gate_waivers ?? []
    const waiverId = `waiver-${randomUUID()}`
    const artifactPath = resolveRunLayout(root, state.run_id).decision(
      `gate-waiver-${waivers.length + 1}.md`,
    ).relative
    const sourceEvidencePath =
      assessment?.verdict === 'fail' && assessmentPath
        ? assessmentPath
        : (history?.record_path ?? history?.output_path ?? artifactPath)
    const spotfixCasePath = options.createSpotfixCase
      ? writeSpotfixCase(
          root,
          state,
          waiverId,
          stage,
          history!,
          waivedCriteria,
          deferred,
          options.note,
          sourceEvidencePath,
        )
      : undefined
    const body = [
      '# Operator waiver directive',
      '',
      `**Run** \`${state.run_id}\` · **Stage** \`${stage.slug}\` · ` +
        `**Source attempt** ${history?.attempt ?? 'none'} · **Route to** \`${target}\``,
      '',
      `**Directive-time workspace fingerprint:** \`${workspace.fingerprint}\``,
      ...(history
        ? [
            `**Source invocation:** \`${history.invocation_id}\``,
            `**Source-attempt workspace fingerprint:** \`${history.workspace_fingerprint}\``,
            `**Source evidence:** \`${sourceEvidencePath}\``,
          ]
        : [
            '**Source invocation:** none — the stage was bypassed before a completed attempt.',
          ]),
      '',
      '## Directive scope',
      '',
      ...waivedCriteria.map((item) => `- \`${item}\``),
      '',
      ...(wholeStageBypass
        ? [
            '## Whole-stage bypass disclosure',
            '',
            '**whole_stage_bypass:** true',
            '',
            'Additional failed hard criteria bypassed beyond the operator-named subset:',
            '',
            ...bypassedBeyondRequest.map((item) => `- \`${item}\``),
            '',
          ]
        : []),
      '## Operator terms',
      '',
      options.note.trim(),
      '',
      ...(history?.validation_errors.length
        ? [
            '## Known malformed or missing evidence',
            '',
            ...history.validation_errors.map((item) => `- ${item}`),
            '',
          ]
        : []),
      ...(deferred.length > 0
        ? [
            '## Deferred acceptance criteria',
            '',
            ...deferred.map((item) => `- \`${item}\``),
            '',
            ...(spotfixCasePath
              ? [`**Spotfix case:** \`${spotfixCasePath}\``, '']
              : []),
          ]
        : []),
      'This artifact records the operator directive; it does not constrain or reinterpret the directive beyond the terms written above.',
      '',
    ].join('\n')

    writeTextAtomic(resolveInside(root, artifactPath), `${body}\n`)

    const waiver: OperatorGateWaiver = {
      waiver_id: waiverId,
      stage: stage.slug,
      source_invocation_id:
        history?.invocation_id ?? `operator-bypass-${randomUUID()}`,
      source_attempt: history?.attempt ?? 0,
      source_evidence_path: sourceEvidencePath,
      criterion_ids: waivedCriteria,
      ...(wholeStageBypass ? { whole_stage_bypass: true } : {}),
      workspace_fingerprint: workspace.fingerprint,
      ...(history
        ? { source_workspace_fingerprint: history.workspace_fingerprint }
        : {}),
      directive_target: target,
      validation_errors: history?.validation_errors ?? [],
      note: options.note.trim(),
      artifact_path: artifactPath,
      deferred_acceptance_criteria: deferred,
      ...(spotfixCasePath ? { spotfix_case_path: spotfixCasePath } : {}),
      timestamp: now(),
    }

    waivers.push(waiver)
    state.operator_gate_waivers = waivers
    clearSameReasonTracker(state, stage.slug)
    state.status = 'running'
    state.pause_reason = null
    state.operator_pause = null
    state.current_invocation = null
    state.consecutive_failures = 0

    applyTransition(root, state, stage, 'success', {
      overrideTarget: target,
      operatorDirected: true,
    })

    state.last_decision_path = artifactPath

    persistRun(root, state, 'operator_gate_waived', {
      waiver_id: waiverId,
      stage: stage.slug,
      source_invocation_id: waiver.source_invocation_id,
      source_attempt: waiver.source_attempt,
      source_evidence_path: sourceEvidencePath,
      criterion_ids: waivedCriteria,
      workspace_fingerprint: workspace.fingerprint,
      source_workspace_fingerprint: waiver.source_workspace_fingerprint ?? null,
      directive_target: target,
      spotfix_case_path: spotfixCasePath ?? null,
    })

    return { state, waiver }
  })
}

export function abortRun(root: string, runId: string, note = ''): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status !== 'succeeded' &&
        state.status !== 'failed' &&
        state.status !== 'canceled',
      'Run is already terminal.',
      { code: 'RUN_TERMINAL' },
    )

    state.status = 'canceled'
    state.current_stage = null
    state.pending_action = { type: 'none' }
    state.current_invocation = null
    state.operator_pause = null

    persistRun(root, state, 'run_canceled', { note })

    return state
  })
}

export function getRunStatus(
  root: string,
  runId: string,
  options: StatusOptions = {},
): RunState | string {
  const state = loadState(root, runId)
  const liveness = invocationLiveness(
    state,
    Date.now(),
    loadProjectConfig(root).stage_liveness_ms,
  )
  const statusState = liveness
    ? { ...state, invocation_liveness: liveness }
    : state

  if (options.json) {
    return statusState
  }

  const validationStatus = state.current_invocation
    ? loadInvocationValidationStatus(root, runId, state.current_invocation.id)
    : null

  return renderStatus(statusState, validationStatus)
}

export function getRunState(root: string, runId: string): RunState {
  return loadState(root, runId)
}
