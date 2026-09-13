import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, readdirSync, rmSync } from 'node:fs'
import { setPriority } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertCohortRunUnblocked,
  claimCohortBaselineCapture,
  COHORT_PLAN_WORKFLOW_SLUG,
  cohortBaselineDirectory,
  recordCohortBaselines,
  releaseCohortBaselineClaim,
} from './cohorts.js'
import {
  buildContextReference,
  buildInvocationInputs,
  summarizePriorFailure,
} from './context.js'
import {
  renderBrief,
  resolveBriefVocabulary,
  scaffoldOperatorBrief,
  validateBriefSystem,
} from './briefs.js'
import { errorMessage, invariant } from './errors.js'
import { canonicalPersonaMapping } from './executors/mapping.js'
import {
  expectedCursorModelForSpec,
  probeCursorModelSpec,
  probeEnvironment,
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
import {
  assertSupervisorCardAttested,
  renderSupervisorCard,
  supervisorAttestCommand,
} from './governance/supervisor-card.js'
import {
  assertClaimableInboxRequest,
  claimInboxRequest,
  finishInboxRequest,
  inboxStatusOf,
  isInboxRequestPath,
  queueInboxRelativePath,
  rollbackInboxClaim,
} from './inbox.js'
import { applyJsonMergePatch } from './json-merge-patch.js'
import { parseKnownFailingTests } from './known-failing.js'
import { keywordRunSuffixFrom, makeStageArtifactId } from './naming.js'
import { resolveRunLayout } from './run-layout.js'
import {
  buildSuiteProfileSummary,
  recordSuiteProfileIndexEntry,
} from './suite-profile.js'
import {
  DELEGATION_UNOBSERVED,
  DELEGATION_WATCH_LATE,
  DELEGATION_WATCH_LATE_SECONDS,
  delegationUnobservedMessage,
  redlineRecordPath,
  summarizeDelegationObservation,
  type DelegationObservation,
} from './watch.js'
import {
  OPERATOR_ARTIFACT_PROFILE_HEADINGS,
  operatorArtifactProfileForStage,
} from './operator-artifact-profiles.js'
import {
  operatorArtifactsRequested,
  requestStageOperatorArtifacts,
} from './operator-artifacts.js'
import {
  configuredWorkspaceRoot,
  harnessPathPrefix,
  isDetachedInstallation,
  isSelfDevelopmentInstallation,
  isTargetInstallation,
  panCommand,
  resolveAwayModeConfig,
} from './project-config.js'
import {
  completeInvocationAgent,
  registerPreparedInvocation,
  registryHealthForRun,
} from './hypervisor.js'
import { resolvePolicies } from './policies.js'
import { resolvePrDescriptionContext } from './pr-description.js'
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
  disabledEvidenceProducers,
  effectiveRepositoryCheckProfile,
  loadVerificationFile,
  resolveVerification,
} from './verification.js'
import type { RatifiedAcceptanceCriterion } from './verification.js'
import {
  loadRepositoryChecks,
  runRepositoryCheck,
  runRepositorySetup,
  summarizeRepositoryCheckResult,
} from './repository-checks.js'
import {
  gateCacheEnabled,
  gateCacheKey,
  gateCacheLookup,
  repositoryCheckGateCommand,
  repositoryChecksConfigDigest,
} from './gate-cache.js'
import {
  cursorAgentTarget,
  projectPersonaVariants,
  syncCursorProjection,
} from './projection.js'
import {
  buildInvocationContractManifest,
  renderEvidenceWorkerBrief,
  renderInvocationDeliveryPrompt,
  renderInvocationMarkdown,
  renderSupervisorProcedureMarkdown,
  renderStatus,
} from './render.js'
import {
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
  CohortRunBinding,
  CriterionEvaluation,
  DeterministicResult,
  EntryGateReach,
  ExternalDelegationRecord,
  GovernanceArtifactIssue,
  Invocation,
  ManagedWorktreeReference,
  OperatorFeedbackItem,
  OperatorGateWaiver,
  OperatorPauseContext,
  OperatorWorkspaceRatification,
  PersonaExecutorKind,
  RepositoryCheckBaselinePointer,
  RunActionActor,
  RunAdvisory,
  RunModelEvidence,
  RunState,
  SameReasonFailureTrackers,
  StageDefinition,
  StageFailureTracker,
  StageHistoryItem,
  StageOutcome,
  StageOutput,
  RequirementFailureRoute,
  ResolvedRequirement,
  SupervisorAssessment,
  TaskRecord,
  WorkflowDefinition,
  WorkspaceDirectiveRecord,
  WorkspaceSnapshot,
  WorktreeClaimTransfer,
} from './types.js'
import {
  attestationValidationPath,
  buildValidationArtifact,
  delegationExecutionPath,
  delegationPath,
  delegationValidationPath,
  deliveryPromptPath,
  evaluateDeterministicCriteria,
  FINGERPRINT_BOUND_STATE_CRITERIA,
  expectedDelegationSource,
  invocationValidationPath,
  loadInvocationValidationStatus,
  loadRepositoryCheckBaseline,
  relocateMisplacedDelegationArtifact,
  repositoryCheckBaselinesCaptured,
  runEntryGateCriterion,
  sessionRecordPath,
  validateDelegationMarkdown,
  validateInvocationAttestation,
  validateInvocationMarkdown,
  validateStageOutput,
  type StageOutputValidation,
  type ValidationCheck,
} from './validation.js'
import {
  loadStagePrompt,
  loadWorkflow,
  loadWorkflowFile,
  stageBySlug,
  stagePersonaCandidates,
  workflowPersonaNames,
} from './workflow.js'
import {
  gitStatusPaths,
  gitWorkspaceSnapshot,
  snapshotEntryPath,
  workspaceChangedPathsFromSnapshots,
} from './git.js'
import { entryGateWaiver, waiverCoversCriterion } from './waivers.js'
import { resolveRoots } from './workspace/roots.js'
import {
  isProtectedWorkspacePath,
  PROTECTED_PATH_RULE,
} from './workspace/protected-paths.js'
import { worktreeReadiness } from './worktrees.js'

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
  /** Managed worktree resolved by the CLI before run creation. */
  worktree?: ManagedWorktreeReference | null
  gatesPath?: string | null
  involvement?: string | null
  verification?: string | null
  operatorArtifacts?: boolean
  pipelineOverride?: PipelineOverride | null
  cursorAgentSuffix?: string | null
  /**
   * Keep the gates the workflow declares, ignoring the involvement profile. A
   * best-of-N candidate must stay autonomous whatever profile is configured.
   */
  useWorkflowDeclaredGates?: boolean
  bestOfN?: BestOfNRunRole | null
  /** Cohort membership recorded when a fan-out creates this chunk's run. */
  cohort?: CohortRunBinding | null
  /**
   * Harness-relative document this run reads by reference. A cohort chunk run
   * points at the parent specification, which it must never copy.
   */
  contextReferencePath?: string | null
  /**
   * Route the ratified plan into delivery when its gate is approved. Absent
   * means the workflow default: on for `planning`, which is the only workflow
   * that produces a plan to route. `false` records the operator's opt-out.
   */
  autostartDelivery?: boolean
  /** Parallelism limit the autostarted cohort session records. */
  autostartMaxParallel?: number | null
  /**
   * Stage the run starts at instead of the workflow's `start_stage`. The
   * release run of an integrated cohort starts `delivery` at `verify`, because
   * the chunk runs already implemented the work.
   */
  startStage?: string | null
  /**
   * Named pipeline config to snapshot instead of the active one. An eval run
   * uses it to route every worker persona to an external executor.
   */
  pipelineConfigName?: string | null
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
  /** Non-blocking observations about the run. None of them stops the run. */
  advisories: string[]
  /** What `--agent` had the harness write and start, when it was passed. */
  prepared_delegation?: PreparedDelegation
}

/** Delivery artifacts `pan prepare --agent <name>` owns for one invocation. */
export interface PreparedDelegation {
  /** The labeled delegation artifact, or null when none was written. */
  artifact_path: string | null
  /** Why no artifact was written, when none was. */
  skipped: string | null
  /** In-flight worker model evidence, or null when no probe started. */
  model_evidence: RunModelEvidence | null
  probe_pid: number | null
}

export interface OperationProgressOptions {
  onProgress?: (message: string) => void
}

interface PrepareInvocationOptions extends OperationProgressOptions {
  operatorArtifacts?: boolean
  /**
   * Named agent this invocation is delegated to. The harness then writes the
   * labeled delegation artifact and starts the worker model probe, which the
   * supervisor otherwise assembles and runs by hand.
   */
  agent?: string
}

export interface SubmitOutputResult {
  state: RunState
  record: TaskRecord
  /** Observations this submission recorded. None of them stops the run. */
  advisories: RunAdvisory[]
  idempotent?: boolean
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
function runPipelineConfigAdvisories(
  root: string,
  state: RunState,
  snapshot: ReturnType<typeof loadRunPipelineConfig>,
): string[] {
  if (!state.pipeline_config) {
    return []
  }

  const advisories: string[] = []

  // A best-of-N run pins its own persona map, so its run-scoped agent
  // variants are what drift.
  if (state.cursor_agent_suffix) {
    const variantDrift = projectPersonaVariants(
      root,
      state.cursor_agent_suffix,
      personaSubset(snapshot.personas, loadRunWorkflow(root, state)),
    ).filter((entry) => entry.changed)

    if (variantDrift.length > 0) {
      advisories.push(
        `Run-scoped Cursor agent variants no longer match this run's ` +
          `pipeline snapshot: ${variantDrift.map((entry) => entry.path).join(', ')}. ` +
          `Run ${panCommand(root)} models --sync to realign them.`,
      )
    }

    return advisories
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

  if (live.name !== snapshot.name) {
    advisories.push(
      `This run snapshotted pipeline config '${snapshot.name}'; ` +
        `'${live.name}' is now active. The run continues on its snapshot.`,
    )
  }

  if (driftedPersonas.length > 0) {
    advisories.push(
      `The live model mapping changed for ${driftedPersonas.join(', ')} ` +
        `since this run started. The run continues on its snapshot; run ` +
        `${panCommand(root)} models --sync to delegate on the live mapping.`,
    )
  }

  // The advisory reads one projection, so render only that one against the
  // live config.
  const agentModelDrift = syncCursorProjection(root, {
    only: ['cursor-agents'],
    pipeline: live,
  }).filter((entry) => entry.id === 'cursor-agents' && entry.changed)

  if (agentModelDrift.length > 0) {
    advisories.push(
      `Projected Cursor agent models do not match this run's pipeline ` +
        `config: ${agentModelDrift.map((entry) => entry.path).join(', ')}. ` +
        `Run ${panCommand(root)} models --sync to realign them.`,
    )
  }

  return advisories
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

/**
 * The harness root baseline an invocation carries when the run works
 * somewhere else. A worktree run and an eval run both leave the harness
 * checkout outside every workspace snapshot, so without this baseline no gate
 * can see a write into the one tree the run must not touch.
 */
function harnessBaseline(
  root: string,
  state: RunState,
): { harness_before?: WorkspaceSnapshot } {
  return path.resolve(workspaceDirectory(root, state)) === path.resolve(root)
    ? {}
    : { harness_before: gitWorkspaceSnapshot(root) }
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

const FULL_PROFILE = 'full'

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
function baselineWorkspaceProvenance(
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

/** Set to `0` to stop the speculative release-profile prefetch. */
export const PREFETCH_RELEASE_PROFILE_ENV = 'PAN_PREFETCH_FULL'

/** Lower scheduling priority for the prefetch child, on a nice-like scale. */
const PREFETCH_PROCESS_PRIORITY = 10

/** What the harness recorded about one speculative release-profile child. */
export interface ReleaseProfilePrefetchRecord {
  profile: string
  pid: number
  workspace_fingerprint: string
  started_at: string
  evidence_path: string
}

/**
 * The repository-check profile an entry gate of this workflow will run, under
 * the run's own verification level. A level that disables the gate maps it to
 * nothing, and a prefetch for that run would compute a result nobody reads.
 */
function entryGateRepositoryCheckProfile(
  workflow: WorkflowDefinition,
  state: RunState,
): string | null {
  for (const stage of workflow.stages) {
    const criterionId = stage.entry_gate?.criterion

    if (!criterionId) {
      continue
    }

    const criterion = stage.criteria.find((item) => item.id === criterionId)

    if (!criterion || criterion.type !== 'shell') {
      continue
    }

    const { profile } = effectiveRepositoryCheckProfile(
      state.verification,
      criterion,
    )

    if (profile) {
      return profile
    }
  }

  return null
}

/**
 * Start computing the release profile while the read-only evidence stage runs.
 *
 * The inputs of the entry gate stopped changing when the source stage passed,
 * so the answer can be computed during the stage that reads the work rather
 * than at the gate that waits for it. The child is detached and unreferenced
 * because nothing joins it: a clean result reaches the gate through the
 * recorded-pass store, and a killed, failed, or unfinished child simply
 * leaves no entry, which is today's behaviour.
 */
function startReleaseProfilePrefetch(
  root: string,
  state: RunState,
  profile: string,
  workspaceFingerprint: string,
): ReleaseProfilePrefetchRecord | null {
  const cliPath = fileURLToPath(new URL('../cli.js', import.meta.url))
  const startedAt = now()
  const child = spawn(
    process.execPath,
    [
      cliPath,
      'repository-check',
      profile,
      '--run',
      state.run_id,
      '--harness-initiated',
    ],
    { cwd: root, detached: true, stdio: 'ignore' },
  )

  if (child.pid === undefined) {
    return null
  }

  try {
    setPriority(child.pid, PREFETCH_PROCESS_PRIORITY)
  } catch {
    // Priority is an optimization; a platform that refuses it still prefetches.
  }

  child.unref()

  const evidence = resolveRunLayout(root, state.run_id).evidence(
    `prefetch-${profile}.json`,
  )

  writeJsonAtomic(evidence.absolute, {
    schema_version: 1,
    run_id: state.run_id,
    profile,
    pid: child.pid,
    workspace_fingerprint: workspaceFingerprint,
    started_at: startedAt,
  })

  return {
    profile,
    pid: child.pid,
    workspace_fingerprint: workspaceFingerprint,
    started_at: startedAt,
    evidence_path: evidence.relative,
  }
}

/** A recorded baseline artifact another unit of work may adopt as its own. */
export interface AdoptableRepositoryCheckBaseline {
  /** Installation-relative path of the summary artifact. */
  artifact_path: string
  recorded_at: string
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
function ensureWorkspaceProvisioned(
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
    const result = runRepositoryCheck(root, profile.name, {
      timeout_ms: profile.timeout_ms,
      workspace: state.workspace_root || '.',
    })
    onProgress?.(
      `pre-implementation '${profile.name}' baseline ${result.status} in ${(result.total_duration_ms / 1000).toFixed(1)}s`,
    )
    const workspace = workspaceSnapshotForRun(root, state)
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

/**
 * A gate result that lets the stage proceed: a pass, or a gate the run
 * configuration, verification level, or an unconfigured profile disabled. The
 * same reading `effectiveOutcome` applies to a submitted gate.
 */
function entryGateSatisfied(result: DeterministicResult): boolean {
  return result.passed || result.disabled === true
}

/**
 * The recorded entry-gate pass that still covers the current visit of a stage,
 * or null. A pass covers the visit while no other stage has submitted since it
 * was recorded: the ship worker's own attempts and operator pauses do not
 * close the visit, leaving the stage does.
 */
function currentEntryGatePass(
  state: RunState,
  stage: StageDefinition,
): DeterministicResult | null {
  const record = state.entry_gates?.[stage.slug]

  if (
    !record ||
    !entryGateSatisfied(record.last_result) ||
    record.passed_at_history_length === undefined ||
    record.passed_at_history_length > state.stage_history.length
  ) {
    return null
  }

  const sinceThen = state.stage_history.slice(record.passed_at_history_length)

  return sinceThen.every((item) => item.stage === stage.slug)
    ? record.last_result
    : null
}

/**
 * The stage a successful outcome of `stage` returns to when the stage was
 * entered from another stage's failed entry gate, or undefined when the stage
 * follows its own success transition. Answering the route closes it.
 */
function takeEntryGateReturn(
  state: RunState,
  stage: StageDefinition,
): string | undefined {
  for (const [gateStage, record] of Object.entries(state.entry_gates ?? {})) {
    if (record.routed_to === stage.slug) {
      delete record.routed_to

      return gateStage
    }
  }

  return undefined
}

/**
 * Forget open entry-gate routes, visit passes, and loop counts. An operator
 * who redirects or resumes the run decides its next step explicitly, so a
 * route or pass recorded for the prior path must not reroute a later success
 * or stand in for a gate the run has not run on its new path, and the repair
 * loops start over from the operator's decision.
 */
function clearEntryGateRoutes(state: RunState): void {
  for (const record of Object.values(state.entry_gates ?? {})) {
    delete record.routed_to
    delete record.repair_stage
    delete record.passed_at_history_length
    record.failures = 0
  }
}

/** How a failed entry gate's declared repair route must be taken. */
type EntryGateRepairRoute =
  | { kind: 'direct_return' }
  | { kind: 'through_success_path' }
  | { kind: 'unsatisfiable'; blocking: string[] }

/** Longest success chain the route check walks before giving up. */
const ROUTE_REACHABILITY_LIMIT = 16

/**
 * Decide how an entry-gate repair returns to the stage that ordered it.
 *
 * A repair that cannot change the workspace leaves every criterion of the
 * gate stage as it found them, so the run returns directly. A repair that can
 * change the workspace invalidates any fingerprint-bound criterion the gate
 * stage declares, and the direct return would then fail the very criterion
 * the repair was ordered to get past. That route runs through the repair
 * stage's own success path, which retakes the evidence. When that path cannot
 * reach the gate stage at all, the route is reported instead of taken.
 */
function entryGateRepairRoute(
  workflow: WorkflowDefinition,
  gateStage: StageDefinition,
  repairSlug: string,
): EntryGateRepairRoute {
  const repairStage = workflow.stages.find((item) => item.slug === repairSlug)

  if (!repairStage || repairStage.workspace_policy !== 'source_allowed') {
    return { kind: 'direct_return' }
  }

  const blocking = gateStage.criteria
    .filter(
      (criterion) =>
        criterion.hard === true &&
        FINGERPRINT_BOUND_STATE_CRITERIA.has(criterion.id),
    )
    .map((criterion) => criterion.id)

  if (blocking.length === 0) {
    return { kind: 'direct_return' }
  }

  return successPathReaches(workflow, repairStage, gateStage.slug)
    ? { kind: 'through_success_path' }
    : { kind: 'unsatisfiable', blocking }
}

function successPathReaches(
  workflow: WorkflowDefinition,
  from: StageDefinition,
  targetSlug: string,
): boolean {
  let current: StageDefinition | undefined = from

  for (let step = 0; step < ROUTE_REACHABILITY_LIMIT; step += 1) {
    const next: string | undefined = current?.transitions.success

    if (next === undefined) {
      return false
    }

    if (next === targetSlug) {
      return true
    }

    current = workflow.stages.find((item) => item.slug === next)

    if (!current) {
      return false
    }
  }

  return false
}

function boundedCriterionList(criterionIds: string[]): string {
  return criterionIds.map((id) => `'${id}'`).join(', ')
}

/**
 * Run the stage's entry gate, when it declares one, before the worker is
 * delegated.
 *
 * Returns `'pass'` when the stage may proceed (the gate passed now, passed
 * earlier on this visit, or is disabled), `'routed'` when the failure moved
 * the run to the declared repair stage, and `'paused'` when the failure count
 * exceeded `max_loops` and the run now waits for an operator decision that
 * away mode cannot take.
 */
function runStageEntryGate(
  root: string,
  state: RunState,
  stage: StageDefinition,
  onProgress?: (message: string) => void,
): 'pass' | 'routed' | 'paused' {
  const gate = stage.entry_gate

  if (!gate) {
    return 'pass'
  }

  if (currentEntryGatePass(state, stage)) {
    return 'pass'
  }

  const criterion = stage.criteria.find((item) => item.id === gate.criterion)

  invariant(
    criterion !== undefined,
    `Stage '${stage.slug}' entry gate names unknown criterion '${gate.criterion}'.`,
    { code: 'INVALID_WORKFLOW' },
  )

  const records = (state.entry_gates ??= {})
  const previous = records[stage.slug]
  const waiver = entryGateWaiver(state, stage.slug, criterion.id)

  if (waiver) {
    const waived: DeterministicResult = {
      id: criterion.id,
      type: 'shell',
      hard: Boolean(criterion.hard),
      passed: true,
      waived: true,
      waiver_id: waiver.waiver_id,
      explanation:
        `Entry gate waived by operator directive '${waiver.waiver_id}'; ` +
        `the criterion did not run. Directive: ${waiver.artifact_path}.`,
      ...(criterion.command ? { command: criterion.command } : {}),
      workspace_fingerprint: workspaceSnapshotForRun(root, state).fingerprint,
    }

    records[stage.slug] = {
      criterion_id: criterion.id,
      executions: previous?.executions ?? 0,
      failures: 0,
      last_result: waived,
      passed_at_history_length: state.stage_history.length,
    }
    onProgress?.(
      `entry gate ${criterion.id} for stage '${stage.slug}' is waived by ${waiver.waiver_id}`,
    )
    persistRun(root, state, 'entry_gate_waived', {
      stage: stage.slug,
      criterion: criterion.id,
      waiver_id: waiver.waiver_id,
      artifact_path: waiver.artifact_path,
    })

    return 'pass'
  }

  const executions = (previous?.executions ?? 0) + 1
  const artifactId = `${stage.slug}-entry-${executions}`

  onProgress?.(
    `running entry gate ${criterion.id} for stage '${stage.slug}' before delegation`,
  )

  const result = runEntryGateCriterion(
    root,
    runDir(root, state.run_id),
    state,
    stage,
    criterion,
    workspaceDirectory(root, state),
    artifactId,
    onProgress,
  )

  if (entryGateSatisfied(result)) {
    records[stage.slug] = {
      criterion_id: criterion.id,
      executions,
      failures: 0,
      last_result: result,
      passed_at_history_length: state.stage_history.length,
    }
    persistRun(root, state, 'entry_gate_passed', {
      stage: stage.slug,
      criterion: criterion.id,
      ...(result.evidence_path ? { evidence_path: result.evidence_path } : {}),
    })

    return 'pass'
  }

  const failures = (previous?.failures ?? 0) + 1
  const record: NonNullable<RunState['entry_gates']>[string] = {
    criterion_id: criterion.id,
    executions,
    failures,
    last_result: result,
  }

  records[stage.slug] = record

  const evidence = result.evidence_path
    ? ` Evidence: ${result.evidence_path}.`
    : ''

  if (failures > gate.max_loops) {
    const reason =
      `Entry gate '${criterion.id}' of stage '${stage.slug}' failed ` +
      `${failures} times; the workflow allows ${gate.max_loops} repair ` +
      `loop${gate.max_loops === 1 ? '' : 's'} through '${gate.failure}'. ` +
      `${result.explanation}${evidence}`

    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision', operator_only: true }
    writeDecision(
      root,
      state,
      `Release gate failed ${failures} times`,
      reason,
      [
        `Inspect the gate evidence${result.evidence_path ? ` at ${result.evidence_path}` : ''}.`,
        `Send the run back for repair with: ${panCommand(root)} resume ${state.run_id} --stage ${gate.failure}`,
        `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
        'Away mode cannot take this decision.',
      ],
    )
    persistRun(root, state, 'run_paused', {
      reason,
      stage: stage.slug,
      criterion: criterion.id,
      failures,
    })

    return 'paused'
  }

  const workflow = loadRunWorkflow(root, state)
  const route = entryGateRepairRoute(workflow, stage, gate.failure)

  if (route.kind === 'unsatisfiable') {
    const reason =
      `Entry gate '${criterion.id}' of stage '${stage.slug}' failed, and the ` +
      `declared repair route through '${gate.failure}' cannot return the run ` +
      `to a stage that satisfies ${boundedCriterionList(route.blocking)}. ` +
      `${result.explanation}${evidence}`

    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision', operator_only: true }
    writeDecision(
      root,
      state,
      `Entry gate repair route is unsatisfiable`,
      reason,
      [
        `Inspect the gate evidence${result.evidence_path ? ` at ${result.evidence_path}` : ''}.`,
        `Send the run to a stage that can restore the evidence with: ${panCommand(root)} resume ${state.run_id} --stage <stage>`,
        `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
      ],
    )
    persistRun(root, state, 'run_paused', {
      reason,
      stage: stage.slug,
      criterion: criterion.id,
      failures,
    })

    return 'paused'
  }

  onProgress?.(
    `entry gate ${criterion.id} failed (${failures}/${gate.max_loops} loops); routing to '${gate.failure}'`,
  )

  // A direct return skips the stages whose evidence the repair invalidates.
  // When the gate stage declares such a criterion, the repair stage follows
  // its own success transition instead, which retakes that evidence at the
  // post-repair workspace before the gate runs again.
  record.repair_stage = gate.failure

  if (route.kind === 'direct_return') {
    record.routed_to = gate.failure
  }

  applyTransition(root, state, stage, 'failure', {
    overrideTarget: gate.failure,
  })

  if (state.status !== 'running') {
    // A workflow limit intercepted the route. The route is closed because
    // the operator now chooses where the run continues.
    delete record.routed_to
    delete record.repair_stage
    persistRun(root, state, 'run_paused', { reason: state.pause_reason })

    return 'paused'
  }

  persistRun(root, state, 'entry_gate_failed', {
    stage: stage.slug,
    criterion: criterion.id,
    failures,
    routed_to: gate.failure,
    ...(result.evidence_path ? { evidence_path: result.evidence_path } : {}),
  })

  return 'routed'
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

const VALIDATION_ONLY_SIGNATURE = ['__validation__']

/**
 * Verification stages loop through remediation rather than themselves, so the
 * same-reason breaker tracks them explicitly alongside self-looping stages.
 */
function isSameReasonTrackedStage(stage: StageDefinition): boolean {
  return stage.slug === 'verify' || stage.transitions.failure === stage.slug
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
  const tracker = isSameReasonTrackedStage(stage)
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

  // A stage entered from another stage's failed entry gate returns there on
  // success instead of following its own success transition, so a repair the
  // release gate requested comes straight back to the release gate.
  const entryGateReturn =
    outcome === 'success' && options.overrideTarget === undefined
      ? takeEntryGateReturn(state, stage)
      : undefined
  const target =
    options.overrideTarget ?? entryGateReturn ?? stage.transitions[outcome]

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
    if (target === 'succeeded' || target === 'canceled') {
      const destination = target === 'succeeded' ? 'complete' : 'canceled'
      const moved = finishInboxRequest(
        root,
        state.request.source_path,
        destination,
        state.request.stored_path,
      )

      if (moved) {
        state.request.source_path = moved
      }
    }

    state.status = target
    state.current_stage = null
    state.pending_action = { type: 'none' }

    // The next run in this workspace compares its own profile against this
    // one. Recording the pointer here is what keeps that comparison from
    // rereading every retained run state.
    if (target === 'succeeded') {
      recordSuiteProfileIndexEntry(root, state)
    }

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
      [
        `Resume with: ${panCommand(root)} resume ${state.run_id}`,
        `Or resume with a directive the stage can act on: ${panCommand(root)} ` +
          `resume ${state.run_id} --stage ${stage.slug} --note "<directive>"`,
      ],
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

/**
 * Append advisories to run state so `pan status` recovers them after a resume.
 * The caller must persist the state.
 */
function recordRunAdvisories(
  state: RunState,
  context: Omit<RunAdvisory, 'message' | 'recorded_at'>,
  messages: string[],
): RunAdvisory[] {
  const recordedAt = now()
  const added = messages.map((message) => ({
    ...context,
    message,
    recorded_at: recordedAt,
  }))

  state.advisories = [...(state.advisories ?? []), ...added]

  return added
}

function persistModelEvidence(
  root: string,
  state: RunState,
  item: Omit<RunModelEvidence, 'evidence_path' | 'timestamp'>,
): RunModelEvidence {
  const index = (state.model_evidence ?? []).findIndex(
    (existing) =>
      existing.role === item.role &&
      existing.invocation_id === item.invocation_id &&
      existing.worker_role === item.worker_role,
  )
  const filename =
    item.role === 'supervisor'
      ? 'model-evidence-supervisor.json'
      : item.worker_role
        ? `model-evidence-${item.invocation_id}.${item.worker_role}.json`
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

export interface SupervisorModelEvidenceResult {
  evidence: RunModelEvidence
  advisories: RunAdvisory[]
}

/** Record the unpinned supervisor model that Cursor exposes for this session. */
export function recordSupervisorModelEvidence(
  root: string,
  runId: string,
  effectiveModel: string,
  source: string,
): SupervisorModelEvidenceResult {
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
    let advisories: RunAdvisory[] = []

    if (existing) {
      if (
        normalizedModelName(existing.effective_model ?? '') ===
        normalizedModelName(effectiveModel)
      ) {
        return { evidence: existing, advisories }
      }

      // A mid-run model change is legitimate, so record the new fact and
      // continue the run.
      advisories = recordRunAdvisories(
        state,
        { kind: 'model_evidence', source: 'supervisor_evidence' },
        [
          `The supervisor model changed from ` +
            `'${existing.effective_model}' to '${effectiveModel.trim()}' ` +
            `during this run.`,
        ],
      )
      persistRun(root, state, 'model_evidence_advisory', {
        role: 'supervisor',
        advisories: advisories.map((advisory) => advisory.message),
      })
    }

    const evidence = persistModelEvidence(root, state, {
      role: 'supervisor',
      persona: 'orchestrator',
      declared_spec: null,
      effective_model: effectiveModel.trim(),
      source: source.trim(),
      result: 'recorded',
    })

    return { evidence, advisories }
  })
}

function normalizedModelName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '')
}

/** One worker an invocation declares, with the spec the run snapshot projects. */
interface DeclaredWorkerSpec {
  role: 'worker' | 'evidence_worker'
  /** Present only for an evidence worker, whose records are keyed by role. */
  worker_role?: string
  persona: string
  spec: string
  /** How an advisory names this worker to the operator. */
  label: string
}

/**
 * Every worker a stage runs, not only the invocation persona.
 *
 * A verify stage declares parallel evidence workers that the supervisor
 * launches on their own specs. Keying model evidence to the invocation
 * persona alone left those workers unrecorded, so a stage verdict named one
 * model and three produced it.
 */
function declaredWorkerSpecs(invocation: Invocation): DeclaredWorkerSpec[] {
  return [
    {
      role: 'worker',
      persona: invocation.stage.persona,
      spec: invocation.stage.model,
      label: `stage worker '${invocation.stage.persona}'`,
    },
    ...(invocation.evidence_workers ?? []).map((worker) => ({
      role: 'evidence_worker' as const,
      worker_role: worker.role,
      persona: worker.persona,
      spec: worker.model,
      label: `evidence worker role '${worker.role}'`,
    })),
  ]
}

/** The labeled default evidence for one declared worker spec. */
function defaultModelEvidence(
  invocationId: string,
  declared: DeclaredWorkerSpec,
  source: string,
  error?: string,
): Omit<RunModelEvidence, 'evidence_path' | 'timestamp'> {
  return {
    role: declared.role,
    invocation_id: invocationId,
    ...(declared.worker_role ? { worker_role: declared.worker_role } : {}),
    persona: declared.persona,
    declared_spec: declared.spec,
    // The projected spec is what the harness launches the worker on, so it is
    // a true record of the declared model. `default` labels it so no reader
    // mistakes it for an observation of what Cursor actually ran.
    effective_model: declared.spec,
    source,
    result: 'default',
    ...(error ? { error } : {}),
  }
}

/**
 * Record the labeled default for every spec a prepared invocation declares.
 *
 * Model evidence used to arrive only from a manual probe, so a supervisor
 * that skipped it produced a submit advisory it could ignore. Prepare now
 * records what the run snapshot projects, and a probe that lands overwrites
 * it with the observed variant.
 */
function recordDefaultModelEvidence(
  root: string,
  state: RunState,
  invocation: Invocation,
): void {
  if (invocation.model_evidence_required !== true) {
    return
  }

  for (const declared of declaredWorkerSpecs(invocation)) {
    persistModelEvidence(
      root,
      state,
      defaultModelEvidence(
        invocation.invocation_id,
        declared,
        'run snapshot projected spec, recorded before any probe',
      ),
    )
  }
}

/** The active Cursor invocation a model probe may speak for. */
function probeableInvocation(
  root: string,
  state: RunState,
  invocationId: string,
): Invocation {
  invariant(
    state.current_invocation?.id === invocationId,
    `Invocation '${invocationId}' is not active for run '${state.run_id}'.`,
    { code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE' },
  )

  const invocation = readInvocation(root, state.current_invocation.json_path)

  invariant(
    (invocation.stage.persona_executor ?? 'cursor') === 'cursor',
    `Invocation '${invocationId}' does not use the Cursor executor.`,
    { code: 'CURSOR_MODEL_EVIDENCE_UNAVAILABLE' },
  )

  return invocation
}

/**
 * Mark a detached worker model probe as in flight.
 *
 * Only submission reads this evidence, so the launch that needs it does not
 * wait for Cursor to answer. The marker makes the in-flight probe visible to
 * `pan status`, and the detached child overwrites it when the answer lands.
 * A probe that never lands leaves the marker, which submission treats exactly
 * as it treats an unavailable probe.
 */
export function recordPendingWorkerModelProbe(
  root: string,
  runId: string,
  invocationId: string,
): RunModelEvidence {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const invocation = probeableInvocation(root, state, invocationId)
    const marked = declaredWorkerSpecs(invocation).map((declared) =>
      persistModelEvidence(root, state, {
        role: declared.role,
        invocation_id: invocationId,
        ...(declared.worker_role ? { worker_role: declared.worker_role } : {}),
        persona: declared.persona,
        declared_spec: declared.spec,
        effective_model: null,
        source: 'detached cursor-agent probe in flight',
        result: 'pending',
      }),
    )

    return marked[0] as RunModelEvidence
  })
}

/**
 * How long a probe waits for another command to release the run mutex.
 *
 * Every hold on that mutex is a state read and a state write, so a queue of
 * ordinary commands drains far inside this bound. It exists to refuse a
 * genuinely wedged holder rather than to pace normal contention.
 */
const PROBE_MUTEX_WAIT_MS = 10_000

/** What starting one detached worker model probe left behind. */
export interface StartedWorkerModelProbe {
  evidence: RunModelEvidence
  /** Process id of the detached child, or null when the spawn gave none. */
  probe_pid: number | null
}

/**
 * Record the in-flight marker and start the detached child that answers it.
 *
 * The live call belongs to a child because only submission reads the answer,
 * so neither the command that prepares a worker nor the one that probes it
 * waits for Cursor. A child that never lands leaves the marker, which
 * submission treats exactly as it treats an unavailable probe.
 */
export function startDetachedWorkerModelProbe(
  root: string,
  runId: string,
  invocationId: string,
): StartedWorkerModelProbe {
  const evidence = recordPendingWorkerModelProbe(root, runId, invocationId)
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../cli.js', import.meta.url)),
      'models',
      '--probe',
      '--await-probe',
      '--run',
      runId,
      '--invocation',
      invocationId,
    ],
    { cwd: root, detached: true, stdio: 'ignore' },
  )

  child.unref()

  return { evidence, probe_pid: child.pid ?? null }
}

/**
 * Probe one active Cursor worker invocation and persist its effective model.
 *
 * The run mutex covers the state read and the state write, never the live
 * call. A probe takes roughly two minutes, and the detached child that runs
 * it is not one the supervisor waits for, so holding the lock across the call
 * would fail every other command against the run with
 * `RUN_OPERATION_IN_PROGRESS` for that whole window. The second hold re-reads
 * the state so a concurrent probe's write is not lost.
 *
 * Both holds wait for a live holder instead of refusing. A probe runs
 * detached and nobody retries it, so a refused hold loses the answer the
 * live call already paid for; the holds themselves are a state read and a
 * state write, so the queue drains in milliseconds.
 */
export function probeRunInvocationModel(
  root: string,
  runId: string,
  invocationId: string,
): RunModelEvidence & {
  advisories: string[]
  /** One record per parallel evidence worker the invocation declares. */
  evidence_workers: RunModelEvidence[]
} {
  const contended = { waitForHolderMs: PROBE_MUTEX_WAIT_MS }
  const plan = withOperationMutex(
    operationMutexPath(root, runId),
    () => {
      const state = loadState(root, runId)
      const invocation = probeableInvocation(root, state, invocationId)

      return {
        declared: declaredWorkerSpecs(invocation),
        stageSlug: invocation.stage.slug,
      }
    },
    contended,
  )
  const { declared, stageSlug } = plan
  // Every worker the stage runs is probed, and two workers that share a spec
  // share one live call: the evidence is per role, but the answer is per
  // spec, and a live call costs about two minutes.
  const probed = new Map<string, ProbedModelSpec>()

  for (const spec of new Set(declared.map((item) => item.spec))) {
    probed.set(spec, probeModelSpec(root, spec))
  }

  return withOperationMutex(
    operationMutexPath(root, runId),
    () => {
      const state = loadState(root, runId)
      const errors: string[] = []
      const recorded = declared.map((item) => {
        const outcome = probed.get(item.spec) as ProbedModelSpec

        if (outcome.error) {
          errors.push(`${item.label}: ${outcome.error}`)
        }

        return persistModelEvidence(root, state, {
          role: item.role,
          invocation_id: invocationId,
          ...(item.worker_role ? { worker_role: item.worker_role } : {}),
          persona: item.persona,
          declared_spec: item.spec,
          effective_model: outcome.resolved,
          source: 'cursor-agent system/init event',
          result: outcome.result,
          ...(outcome.error ? { error: outcome.error } : {}),
        })
      })

      // A probe result never fails the run. Record it as an advisory so
      // `pan status` recovers it after an interruption.
      const advisories =
        errors.length > 0
          ? recordRunAdvisories(
              state,
              {
                kind: 'model_evidence',
                source: 'probe',
                stage: stageSlug,
                invocation_id: invocationId,
              },
              errors,
            )
          : []

      if (advisories.length > 0) {
        persistRun(root, state, 'model_evidence_advisory', {
          invocation_id: invocationId,
          stage: stageSlug,
          advisories: advisories.map((advisory) => advisory.message),
        })
      }

      return {
        ...(recorded[0] as RunModelEvidence),
        advisories: advisories.map((advisory) => advisory.message),
        evidence_workers: recorded.filter(
          (item) => item.role === 'evidence_worker',
        ),
      }
    },
    contended,
  )
}

interface ProbedModelSpec {
  resolved: string | null
  result: RunModelEvidence['result']
  error?: string
}

/** One live Cursor call, judged against the catalog prediction for the spec. */
function probeModelSpec(root: string, declaredSpec: string): ProbedModelSpec {
  // A bare (bracket-less) spec delegates the variant choice to Cursor, so
  // any successfully resolved variant is the declared behavior — the same
  // contract `probeCursorModels` applies. Only a bracketed spec carries a
  // catalog-predicted display name to compare against; a spec id is never
  // compared literally with a display name.
  const bareSpec = !declaredSpec.includes('[')
  const expected = expectedCursorModelForSpec(root, declaredSpec)
  const probe = probeCursorModelSpec(
    declaredSpec,
    undefined,
    probeEnvironment(root),
  )
  // Only a failed probe is unavailable. A bracketed spec with no catalog
  // prediction is `recorded`, because a target installation carries no
  // catalog.
  const result = ((): RunModelEvidence['result'] => {
    if (probe.resolved === null || probe.error !== undefined) {
      return 'unavailable'
    }

    if (bareSpec) {
      return 'match'
    }

    if (expected === null) {
      return 'recorded'
    }

    return normalizedModelName(probe.resolved) === normalizedModelName(expected)
      ? 'match'
      : 'mismatch'
  })()
  const error =
    result === 'unavailable'
      ? (probe.error ?? 'Cursor reported no resolvable model.')
      : result === 'mismatch'
        ? `Cursor resolved '${probe.resolved}', but the run snapshot expects '${expected}'.`
        : undefined

  return { resolved: probe.resolved, result, ...(error ? { error } : {}) }
}

/**
 * Settle the model evidence of one submission.
 *
 * The absence of a probe answer never stops a submission: the run snapshot
 * still names the spec each worker was launched on, so the record takes that
 * spec as a labeled default. Only a real mismatch between recorded evidence
 * and the run snapshot is a hard failure, because a stage verdict produced on
 * a model the run did not declare is not the verdict the run asked for.
 */
function settleSubmissionModelEvidence(
  root: string,
  state: RunState,
  invocation: Invocation,
): { advisories: string[]; mismatches: string[] } {
  const advisories: string[] = []
  const mismatches: string[] = []

  if (invocation.model_evidence_required !== true) {
    return { advisories, mismatches }
  }

  const supervisor = state.model_evidence?.find(
    (item) => item.role === 'supervisor' && item.result === 'recorded',
  )

  if (!supervisor?.effective_model) {
    advisories.push(
      `This run records no sourced supervisor model evidence. Cursor did not ` +
        `expose model metadata for the supervising session.`,
    )
  }

  for (const declared of declaredWorkerSpecs(invocation)) {
    const recorded = state.model_evidence?.find(
      (item) =>
        item.role === declared.role &&
        item.invocation_id === invocation.invocation_id &&
        item.worker_role === declared.worker_role,
    )

    if (!recorded) {
      advisories.push(
        `Invocation '${invocation.invocation_id}' records no model evidence ` +
          `for its ${declared.label}, so the model that produced that work ` +
          `is unrecorded.`,
      )
      continue
    }

    // A probe in flight and a probe that failed both produced no answer. The
    // projected spec is the honest record of what the harness launched, so it
    // replaces the marker as a labeled default rather than as a gap.
    if (recorded.result === 'pending' || recorded.result === 'unavailable') {
      persistModelEvidence(
        root,
        state,
        defaultModelEvidence(
          invocation.invocation_id,
          declared,
          recorded.result === 'pending'
            ? 'run snapshot projected spec; the detached probe did not land'
            : 'run snapshot projected spec; the probe produced no answer',
          recorded.error,
        ),
      )
      continue
    }

    // `recorded` means the probe resolved a model with no local catalog to
    // predict it, which is normal in a target installation.
    if (
      recorded.result === 'mismatch' ||
      recorded.persona !== declared.persona ||
      recorded.declared_spec !== declared.spec
    ) {
      mismatches.push(
        `the ${declared.label} declared '${declared.spec}' and the recorded ` +
          `evidence resolved '${recorded.effective_model ?? 'unknown'}' for ` +
          `${recorded.persona} (spec '${recorded.declared_spec ?? 'unknown'}')`,
      )
    }
  }

  return { advisories, mismatches }
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

/**
 * Workflow `pan init` runs when the operator names none. Planning is the
 * entry point for delivery work: its ratified gate routes the plan into one
 * delivery run or a cohort fan-out, so the supervisor never guesses the
 * workflow from prose. The literal repeats `COHORT_PLAN_WORKFLOW_SLUG` because
 * `cohorts.js` imports this module, and a top-level read of its export would
 * hit the temporal dead zone when that module loads first.
 */
export const DEFAULT_WORKFLOW_SLUG = 'planning'

export function createRun(root: string, options: CreateRunOptions): RunState {
  const workflowSlug = options.workflowSlug ?? DEFAULT_WORKFLOW_SLUG
  const requestPath = options.requestPath

  invariant(requestPath, '--request is required.', {
    code: 'REQUEST_REQUIRED',
  })

  // Autostart only means something behind the planning gate: the hook reads a
  // ratified cohort plan, and no other workflow produces one. Rejecting the
  // flag at creation keeps a silently inert flag off the run state.
  invariant(
    options.autostartDelivery === undefined ||
      workflowSlug === COHORT_PLAN_WORKFLOW_SLUG,
    `--autostart and --no-autostart are accepted only for the ` +
      `'${COHORT_PLAN_WORKFLOW_SLUG}' workflow.`,
    { code: 'INVALID_ARGUMENT', details: { workflow: workflowSlug } },
  )

  const autostartDelivery =
    workflowSlug === COHORT_PLAN_WORKFLOW_SLUG
      ? (options.autostartDelivery ?? true)
      : null
  const autostartMaxParallel = options.autostartMaxParallel ?? null

  invariant(
    autostartMaxParallel === null || autostartDelivery === true,
    '--max-parallel requires an autostarted planning run.',
    { code: 'INVALID_ARGUMENT' },
  )
  invariant(
    autostartMaxParallel === null ||
      (Number.isInteger(autostartMaxParallel) && autostartMaxParallel >= 1),
    '--max-parallel MUST be an integer of at least 1.',
    { code: 'INVALID_ARGUMENT' },
  )

  const workflow = loadWorkflow(root, workflowSlug)
  // A start-stage override must name a stage of this workflow, checked before
  // any run state exists so a typo cannot create a run that no stage owns.
  const startStage = options.startStage
    ? stageBySlug(workflow, options.startStage).slug
    : workflow.start_stage
  const pipelineOverride = options.pipelineOverride ?? null
  const agentSuffix = options.cursorAgentSuffix ?? null

  invariant(
    !pipelineOverride || agentSuffix,
    'A pipeline override MUST name a Cursor agent suffix.',
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  const pipelineConfig = pipelineOverride
    ? overriddenPipelineConfig(loadPipelineConfig(root), pipelineOverride)
    : loadPipelineConfig(root, options.pipelineConfigName ?? undefined)
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
    // A verdict-routed stage can run under any of its mapped personas, so the
    // run is only creatable when every candidate resolves and projects.
    for (const persona of stagePersonaCandidates(stage)) {
      const mapping = resolvePersonaMapping(pipelineConfig.config, persona)

      if (mapping.executor === 'cursor') {
        invariant(
          fileExists(
            path.join(
              root,
              cursorAgentTarget(root, persona, agentSuffix ?? undefined),
            ),
          ),
          `Missing Cursor agent for persona '${persona}'.`,
          { code: 'MISSING_CURSOR_AGENT' },
        )
      } else {
        workflowUsesClaudeCode = true
      }
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
    // The `.cursor/` projection renders the active config. A run pinned to
    // another named config is judged against the projection's own source, so
    // the check still proves the projection is current without demanding that
    // the checkout be re-projected for one run.
    const projectionSource =
      options.pipelineConfigName &&
      options.pipelineConfigName !== pipelineConfig.file.active_config
        ? loadPipelineConfig(root)
        : pipelineConfig
    const agentModelDrift = syncCursorProjection(root, {
      only: ['cursor-agents'],
      pipeline: projectionSource,
    }).filter((entry) => entry.id === 'cursor-agents' && entry.changed)

    invariant(
      agentModelDrift.length === 0,
      `Cursor agent models do not match the active pipeline config. Run ${panCommand(root)} models --sync.`,
      {
        code: 'PIPELINE_CONFIG_NOT_SYNCED',
        details: { agents: agentModelDrift.map((entry) => entry.path) },
      },
    )
  }

  const sourceAbsolute = resolveInside(root, requestPath)

  invariant(
    fileExists(sourceAbsolute),
    `Request file does not exist: ${requestPath}`,
    {
      code: 'REQUEST_NOT_FOUND',
    },
  )

  let source = sourceAbsolute
  let sourceRelative = toRepoRelative(root, source)
  let inboxClaim: {
    activePath: string
    originalPath: string
  } | null = null

  if (isInboxRequestPath(sourceRelative)) {
    assertClaimableInboxRequest(sourceRelative)
    const status = inboxStatusOf(sourceRelative)

    if (status === 'queue' || status === 'canceled' || status === 'legacy') {
      const activePath = claimInboxRequest(root, sourceRelative)

      inboxClaim = { activePath, originalPath: sourceRelative }
      sourceRelative = activePath
      source = resolveInside(root, activePath)
    }
  }

  try {
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

    const awayMode = resolveAwayModeConfig(root)
    // Snapshotted likewise. The level decides which repository-check profiles
    // gate this run and which baselines the first mutating stage captures.
    const verification = resolveVerification(root, options.verification)

    writeJsonAtomic(
      resolveInside(root, workflowSnapshot),
      workflowSnapshotValue,
    )

    const pipelineConfigSnapshot = layout.pipelineConfigSnapshot.relative
    const pipelineConfigSnapshotValue =
      makePipelineConfigSnapshot(pipelineConfig)

    writeJsonAtomic(
      resolveInside(root, pipelineConfigSnapshot),
      pipelineConfigSnapshotValue,
    )

    const managedWorktree = options.worktree
      ? {
          name: options.worktree.name,
          path: options.worktree.path,
          branch: options.worktree.branch,
        }
      : null
    // Parsed once, at creation, from the stored request. A declaration read
    // fresh at each gate would let an edit to the request retroactively excuse
    // a regression the run introduced.
    const knownFailingTests = parseKnownFailingTests(readText(source))

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
      ...(managedWorktree ? { managed_worktree: managedWorktree } : {}),
      workspace_id: roots.workspace_id,
      installation_root: roots.installation_root,
      state_root: roots.state_root,
      scope_hash: roots.scope_hash,
      ...(gateOverrides ? { gate_overrides: gateOverrides } : {}),
      operator_involvement: involvement,
      verification,
      away_mode: awayMode,
      operator_artifacts: {
        mode: options.operatorArtifacts ? 'requested' : 'suppressed',
        requested_stages: [],
      },
      ...(agentSuffix ? { cursor_agent_suffix: agentSuffix } : {}),
      ...(options.bestOfN ? { best_of_n: options.bestOfN } : {}),
      ...(options.cohort ? { cohort: options.cohort } : {}),
      ...(autostartDelivery !== null
        ? { autostart_delivery: autostartDelivery }
        : {}),
      ...(autostartMaxParallel !== null
        ? { autostart_max_parallel: autostartMaxParallel }
        : {}),
      title: options.title ?? path.basename(requestPath),
      status: 'running',
      current_stage: startStage,
      pending_action: { type: 'prepare_invocation' },
      current_invocation: null,
      request: {
        source_path: sourceRelative,
        stored_path: storedRequest,
        sha256: sha256(readText(source)),
        ...(knownFailingTests.length > 0
          ? { known_failing_tests: knownFailingTests }
          : {}),
        ...(options.contextReferencePath
          ? {
              context_reference: buildContextReference(
                root,
                options.contextReferencePath,
              ),
            }
          : {}),
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

    // The supervisor card is rendered with the run so `pan init` already
    // reports the digest the supervisor must attest before `pan prepare`.
    const supervisorCard = renderSupervisorCard(root, state, workflow)

    persistRun(root, state, 'run_created', {
      supervisor_card: {
        path: supervisorCard.state.path,
        sha256: supervisorCard.state.sha256,
        policies: supervisorCard.policies.map((policy) => policy.id),
      },
      workflow: workflow.slug,
      ...(startStage !== workflow.start_stage
        ? { start_stage: startStage }
        : {}),
      pipeline_config: pipelineConfig.name,
      workspace_root: workspaceRoot,
      ...(managedWorktree ? { managed_worktree: managedWorktree } : {}),
      state_root: roots.state_root,
      involvement_profile: involvement.profile,
      run_contracts: involvement.contracts,
      applied_gates: involvement.applied_gates,
      verification_level: verification.level,
      away_mode_enabled: awayMode.enabled,
      operator_artifacts: state.operator_artifacts,
    })

    return state
  } catch (error) {
    if (inboxClaim) {
      rollbackInboxClaim(root, inboxClaim.activePath, inboxClaim.originalPath)
    }

    throw error
  }
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

/** One harness-authoritative validator `pan submit` runs, with its target. */
export interface ResolvedSubmitValidator {
  requirement: ResolvedRequirement
  target_path: string
  /**
   * The selector a named `artifact:` target names when nothing supplied it.
   * The resolution once fell back to the stage output JSON, so a validator
   * written for the pull-request copy passed by judging a file it was never
   * pointed at. An unresolved selector now says so.
   */
  unresolved_target?: string
  /**
   * Whether the invocation owed a named artifact at all. An invocation that
   * declares named artifacts and omits this one is a defect. An invocation
   * that declares none never owed the artifact: PR-001 scopes the workflow
   * pull-request copy to a ship that produces operator artifacts.
   */
  named_artifacts_declared?: boolean
}

/**
 * Whether a target names an artifact by name rather than by index. An indexed
 * selector describes a position that may legitimately be empty; a named one
 * describes an artifact the invocation declared.
 */
function isNamedArtifactSelector(target: string): boolean {
  return (
    target.startsWith('artifact:') &&
    !/^\d+$/u.test(target.slice('artifact:'.length))
  )
}

/**
 * Resolve the harness-authoritative validators a submission runs for one
 * invocation. `pan submit` and `pan output validate` MUST resolve this same
 * set from the same requirements, so a mechanical defect surfaces before a
 * stage attempt is spent on it.
 */
export function resolveSubmitValidators(
  root: string,
  invocation: Invocation,
  submittedValue: Record<string, unknown>,
  catalog: ReturnType<typeof loadRegistry> = loadRegistry(root),
): ResolvedSubmitValidator[] {
  const resolved: ResolvedSubmitValidator[] = []

  if (!invocation.requirements) {
    return resolved
  }

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

    const resolvedTarget = resolveRequirementTargetPath(
      requirement,
      invocation.output.path,
      {
        ...submittedValue,
        ...(invocation.output.artifact_targets
          ? { artifact_targets: invocation.output.artifact_targets }
          : {}),
      },
    )

    if (
      resolvedTarget === null &&
      isNamedArtifactSelector(requirement.target)
    ) {
      resolved.push({
        requirement,
        target_path: requirement.target,
        unresolved_target: requirement.target,
        named_artifacts_declared:
          Object.keys(invocation.output.artifact_targets ?? {}).length > 0,
      })
      continue
    }

    const targetPath = resolvedTarget ?? invocation.output.path
    const targetKind = inferTargetKind(targetPath)

    if (!entry.target_types.includes(targetKind)) {
      continue
    }

    resolved.push({ requirement, target_path: targetPath })
  }

  return resolved
}

/**
 * Validators whose target a blocked result of the named stage never produces.
 */
const BLOCKED_OUTPUT_EXEMPT_VALIDATORS: Record<string, readonly string[]> = {
  ship: ['RELEASE-VALIDATE-001', 'PR-DESCRIPTION-VALIDATE-001'],
}

/**
 * Why this validator judges nothing on this submission, or null.
 *
 * A blocked stage reports a precondition it lacked, so the release packet and
 * the pull-request copy were never written. Failing every field of an
 * artifact the stage could not produce buries the one thing the operator
 * needs: the missing precondition and the command that supplies it.
 */
function blockedOutputExemption(
  stageSlug: string,
  submittedValue: Record<string, unknown>,
  registryId: string,
): string | null {
  if (submittedValue.result !== 'blocked') {
    return null
  }

  return BLOCKED_OUTPUT_EXEMPT_VALIDATORS[stageSlug]?.includes(registryId)
    ? `Stage '${stageSlug}' reported blocked, so it produced no target for ` +
        `${registryId} to judge.`
    : null
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
  const catalog = loadRegistry(root)

  for (const {
    requirement,
    target_path: targetPath,
    unresolved_target: unresolvedTarget,
    named_artifacts_declared: namedArtifactsDeclared,
  } of resolveSubmitValidators(root, invocation, submittedValue, catalog)) {
    if (unresolvedTarget) {
      const message = namedArtifactsDeclared
        ? `harness validator ${requirement.registry_id} could not resolve ` +
          `target ${unresolvedTarget}: the invocation declares named ` +
          `artifacts and none carries that name.`
        : `harness validator ${requirement.registry_id} judged nothing: ` +
          `the invocation declares no named artifact, so ${unresolvedTarget} ` +
          `names no target this stage owed.`

      errors.push(message)

      if (namedArtifactsDeclared && requirement.enforcement !== 'advisory') {
        blockingErrors.push(message)
        failedRoutes.push(requirement.failure_route)
      }

      continue
    }

    const notApplicable = blockedOutputExemption(
      invocation.stage.slug,
      submittedValue,
      requirement.registry_id,
    )
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
      ...(notApplicable ? { notApplicable } : {}),
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
  artifactsRequested: boolean,
): Invocation['output']['field_contract'] {
  const source = readJson(
    path.join(root, 'library', 'schemas', 'stage-output-requirements.json'),
  )

  invariant(
    isRecord(source) &&
      source.schema_version === 1 &&
      isRecord(source.criterion_results) &&
      Object.values(source.criterion_results).every(
        (value) => typeof value === 'string',
      ) &&
      isRecord(source.stages),
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
  const validators = stage.validators.flatMap((validator) => {
    invariant(
      isRecord(validator) &&
        typeof validator.registry_id === 'string' &&
        (validator.enforcement === 'blocks' ||
          validator.enforcement === 'advises'),
      `stage-output-requirements.json stages.${stageSlug} contains an invalid validator.`,
      { code: 'INVALID_STAGE_OUTPUT_REQUIREMENTS' },
    )

    if (
      validator.registry_id === 'PR-DESCRIPTION-VALIDATE-001' &&
      !artifactsRequested
    ) {
      return []
    }

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

    return [{ registry_id: validator.registry_id, enforcement }]
  })

  return {
    criterion_results: source.criterion_results as Record<string, string>,
    validators,
    fields: stage.fields as NonNullable<
      Invocation['output']['field_contract']
    >['fields'],
  }
}

/** Command that owns one output-validate scratch copy. */
export type OutputValidateCaller = 'output-validate' | 'submission-mirror'

/**
 * Scratch copy an output-targeted validator reads when the bytes under
 * validation are not at the declared output path.
 *
 * Validator handlers resolve a relative target against the harness root, so
 * the value needs a real file at a resolvable path. Each caller owns its own
 * subdirectory: two commands against one run would otherwise derive the same
 * name and then remove the directory the other one is still reading.
 */
export function outputValidateScratchPath(
  runId: string,
  outputBasename: string,
  caller: OutputValidateCaller,
): string {
  return path.posix.join(
    'runtime',
    'cache',
    'output-validate',
    runId,
    caller,
    path.basename(outputBasename),
  )
}

/** Longest agent label the delegation contract accepts ahead of the body. */
const DELEGATION_AGENT_NAME_MAX_LENGTH = 60

/**
 * Refuse an agent name the delegation contract would reject as a label.
 *
 * The artifact is compared against the delivered body after one permitted
 * leading label line, so a multi-line or Markdown-structured name would turn
 * a convenience into a submission failure the supervisor debugs later.
 */
export function assertDelegationAgentName(agent: string): void {
  invariant(
    agent.trim().length > 0 &&
      agent.length <= DELEGATION_AGENT_NAME_MAX_LENGTH &&
      !/[\n\r]/u.test(agent) &&
      !/^\s*(?:[#>*\-+]|\d+[.)]|```|\|)/u.test(agent),
    `--agent MUST be one short plain-text agent name of at most ` +
      `${DELEGATION_AGENT_NAME_MAX_LENGTH} characters that starts no ` +
      `Markdown structure; got '${agent}'.`,
    { code: 'INVALID_ARGUMENT' },
  )
}

/**
 * Write the delegation evidence the supervisor would otherwise assemble by
 * hand: the delivered prompt body under one `Agent:` label.
 *
 * Only referenced delivery is written here. An external-executor stage has
 * the harness author the artifact at `pan delegate`, and an orchestrator
 * stage delegates to nobody, so both keep today's behavior.
 */
function writeLabeledDelegationArtifact(
  root: string,
  invocation: Invocation,
  agent: string,
): { artifact_path: string | null; skipped: string | null } {
  const delegation = invocation.delegation

  if (!delegation) {
    return {
      artifact_path: null,
      skipped: `Stage '${invocation.stage.slug}' delegates to no worker.`,
    }
  }

  if (delegation.mode !== 'referenced' || !delegation.delivery_prompt_path) {
    return {
      artifact_path: null,
      skipped:
        `Stage '${invocation.stage.slug}' delivers its card through the ` +
        `'${delegation.executor ?? 'external'}' executor, which authors its ` +
        'own delegation evidence at `pan delegate`.',
    }
  }

  const body = readText(resolveInside(root, delegation.delivery_prompt_path))

  writeTextAtomic(
    resolveInside(root, delegation.delegation_artifact_path),
    `Agent: ${agent.trim()}\n\n${body}`,
  )

  return {
    artifact_path: delegation.delegation_artifact_path,
    skipped: null,
  }
}

/**
 * The stage definition for the current attempt, with verdict-conditional
 * persona routing applied. A stage with `persona_by_verdict` reads the latest
 * output of its source stage and swaps in the mapped persona when the recorded
 * verdict matches. An absent source output, an unreadable file, or an unmapped
 * verdict keeps the default persona, so verdict routing degrades to the
 * stage's own declaration instead of failing the run.
 */
function resolveStageForAttempt(
  root: string,
  state: RunState,
  stage: StageDefinition,
): StageDefinition {
  const byVerdict = stage.persona_by_verdict

  if (!byVerdict) {
    return stage
  }

  const item = [...state.stage_history]
    .reverse()
    .find((entry) => entry.stage === byVerdict.source_stage)

  if (!item) {
    return stage
  }

  let verdict: unknown

  try {
    const output = readJson(resolveInside(root, item.output_path))

    verdict =
      isRecord(output) && isRecord(output.data)
        ? byVerdict.path
            .split('.')
            .reduce<unknown>(
              (value, key) => (isRecord(value) ? value[key] : undefined),
              output.data,
            )
        : undefined
  } catch {
    return stage
  }

  const persona =
    typeof verdict === 'string' ? byVerdict.map[verdict] : undefined

  return persona ? { ...stage, persona } : stage
}

/** Agent-registry bookkeeping a lifecycle call owes once its state is durable. */
interface PreparedInvocationRegistration {
  run_id: string
  invocation_id: string
  persona: string
  executor: PersonaExecutorKind
  model: string | null
}

export function prepareInvocation(
  root: string,
  runId: string,
  options: PrepareInvocationOptions = {},
): PrepareInvocationResult {
  // The agent registry is bookkeeping, not run state, and the hypervisor
  // reconcile already tolerates a registry one event behind. Collect the write
  // here and perform it once the mutex is released, so the command returns as
  // soon as the run state is durable.
  const deferred: { registration: PreparedInvocationRegistration | null } = {
    registration: null,
  }
  const result = withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'running',
      `Run is not running: ${state.status}`,
      {
        code: 'RUN_NOT_RUNNING',
      },
    )

    // A cohort-bound run is blocked here, not only at `pan cohort start`, so
    // advancing the run directly cannot bypass the ordering blocker.
    assertCohortRunUnblocked(root, state)

    // Refresh the supervisor card first: a changed policy set re-binds the
    // supervisor before any stage work, and an unattested card stops here.
    const supervisorCard = renderSupervisorCard(
      root,
      state,
      loadRunWorkflow(root, state),
    )

    if (supervisorCard.changed) {
      persistRun(root, state, 'supervisor_card_rendered', {
        path: supervisorCard.state.path,
        sha256: supervisorCard.state.sha256,
        first: supervisorCard.first,
        policies: supervisorCard.policies.map((policy) => policy.id),
      })
    }

    // A run created before the card existed gains it on this prepare and is
    // bound from the next lifecycle action on.
    if (!supervisorCard.first) {
      assertSupervisorCardAttested(root, state, 'prepare')
    }

    // Load once, so the advisories and the persona mapping read one snapshot.
    const pipelineConfig = loadRunPipelineConfig(root, state)
    const advisories = runPipelineConfigAdvisories(root, state, pipelineConfig)

    if (advisories.length > 0) {
      recordRunAdvisories(
        state,
        {
          kind: 'pipeline_config',
          source: 'prepare',
          ...(state.current_stage ? { stage: state.current_stage } : {}),
        },
        advisories,
      )
      persistRun(root, state, 'pipeline_config_advisory', {
        stage: state.current_stage,
        advisories,
      })
    }

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
        advisories,
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
    const stage = resolveStageForAttempt(
      root,
      state,
      stageBySlug(workflow, state.current_stage),
    )

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

      return { state, invocation: null, advisories }
    }

    state.attempts[stage.slug] = attempt

    const recommendation = pendingVerificationRecommendation(root, state)

    if (recommendation) {
      pauseForVerificationRecommendation(root, state, recommendation)
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null, advisories }
    }

    ensureMutatingWorkflowInitialized(root, state, stage)
    const environmentBlocked =
      ensureWorkspaceProvisioned(root, state, workflow, options.onProgress) ||
      ensureWorkflowRepositoryCheckBaselines(
        root,
        state,
        workflow,
        stage,
        options.onProgress,
      )

    if (environmentBlocked) {
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null, advisories }
    }

    const baselineGaps = repositoryCheckBaselineGaps(root, state, stage)

    if (baselineGaps.length > 0) {
      pauseForRepositoryCheckBaselineGaps(root, state, stage, baselineGaps)
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null, advisories }
    }

    // The release gate runs here, on the workspace verify approved and before
    // the release steward commits anything, so a failure routes to repair
    // without a release commit to unwind. The gate records its result once
    // per visit; the ship submission reuses it.
    if (runStageEntryGate(root, state, stage, options.onProgress) !== 'pass') {
      return { state, invocation: null, advisories }
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
    const prDescriptionPath =
      layout.operatorMarkdown('pr-description.md').relative
    const jsonPath = layout.invocation(invocationId, '.json').relative
    const markdownPath = layout.invocation(invocationId, '.md').relative
    const supervisorProcedurePath = layout.invocation(
      invocationId,
      '.supervisor.md',
    ).relative
    const delegationArtifactPath = delegationPath(runId, invocationId, root)
    const artifactsRequested = operatorArtifactsRequested(state, stage.slug)
    // Parallel evidence workers run as top-level named agents so their
    // persona-model mappings hold. Resolving them at prepare time makes a
    // missing mapping fail here rather than silently downgrade at launch.
    const evidenceWorkers =
      stage.evidence_workers && stage.persona !== 'orchestrator'
        ? stage.evidence_workers.map((worker) => {
            const workerMapping = resolvePersonaMapping(
              pipelineConfig,
              worker.persona,
            )
            const agentTarget = cursorAgentTarget(
              root,
              worker.persona,
              state.cursor_agent_suffix,
            )

            return {
              persona: worker.persona,
              role: worker.role,
              scope: worker.scope,
              agent: (agentTarget.split('/').pop() ?? worker.persona).replace(
                /\.md$/u,
                '',
              ),
              model: workerMapping.model_spec,
              brief_path: layout.invocation(
                invocationId,
                `.${worker.role}-brief.md`,
              ).relative,
              evidence_path: layout.evidence(
                `${invocationId}.${worker.role}-evidence.md`,
              ).relative,
            }
          })
        : undefined

    const workspace = workspaceSnapshotForRun(root, state)
    const contracts = state.operator_involvement?.contracts ?? []
    const policies = resolvePolicies(root, {
      persona: stage.persona,
      workflow: workflow.slug,
      stage: stage.slug,
      contracts,
      operator_artifacts: artifactsRequested ? 'requested' : 'suppressed',
    })
    const prDescription =
      stage.persona === 'release-steward' &&
      stage.slug === 'ship' &&
      (artifactsRequested || isSelfDevelopmentInstallation(root))
        ? resolvePrDescriptionContext(workspaceDirectory(root, state), policies)
        : undefined
    const requirements = resolveRequirements(root, {
      persona: stage.persona,
      workflow: workflow.slug,
      stage: stage.slug,
      contracts,
      invocation: {
        output_path: outputPath,
        artifact_paths: artifactsRequested
          ? [briefRenderedPath, ...(prDescription ? [prDescriptionPath] : [])]
          : prDescription
            ? [prDescriptionPath]
            : [],
        ...(prDescription
          ? { artifact_targets: { pr_description: prDescriptionPath } }
          : {}),
      },
      operator_artifacts: artifactsRequested ? 'requested' : 'suppressed',
    })
    const nextAction =
      stage.persona === 'orchestrator'
        ? `Complete this stage in the current chat with model '${model}' ` +
          `when available, write ${outputPath}, then submit it.`
        : externalExecutor
          ? `Run the delegate command from the supervisor procedure to ` +
            `execute the '${stage.persona}' stage under the ` +
            `'${externalExecutor}' executor with model '${model}', then ` +
            `submit ${outputPath}.`
          : // The next action must name the first executable step in this
            // invocation's real dependency graph. Naming the consolidating
            // worker while its evidence workers are still unrun sends the
            // supervisor past a precondition the card only states further
            // down, and the worker then correctly reports `blocked`.
            ((evidenceWorkers ?? []).length > 0
              ? `Launch the ${(evidenceWorkers ?? []).length} parallel evidence ` +
                `worker(s) first — ` +
                (evidenceWorkers ?? [])
                  .map((worker) => `${worker.agent} -> ${worker.evidence_path}`)
                  .join(', ') +
                ` — and confirm every report exists and is non-empty. Only ` +
                `then launch `
              : 'Launch ') +
            `the named Cursor agent for persona '${stage.persona}' ` +
            `(never an ad-hoc subagent; only the named definition runs ` +
            `'${model}') with this card, write delegation evidence to ` +
            `${delegationArtifactPath}, then submit ${outputPath}.`
    // The supervisor delegates from the continuation loop, where it holds no
    // card of its own. Resolving its policies here puts the delivery contract
    // on the artifact it must already read to perform the delegation. For an
    // external executor the harness moves the bytes itself, so delivery is
    // `verbatim` by construction and no compact delivery prompt is generated.
    // Resolved here rather than in the procedure renderer, so the recorded
    // invocation carries the exact command the supervisor ran.
    const outputValidateCommand =
      `${panCommand(root)} output validate --run ${runId} ` +
      `--file ${outputPath} --invocation ${jsonPath}`
    const supervisorCardReference = state.supervisor_card
      ? {
          path: state.supervisor_card.path,
          sha256: state.supervisor_card.sha256,
          attest_command: supervisorAttestCommand(
            root,
            runId,
            state.supervisor_card.sha256,
          ),
          ...(state.supervisor_card.policy_sections
            ? { policy_sections: state.supervisor_card.policy_sections }
            : {}),
        }
      : null
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
              supervisor_procedure_path: supervisorProcedurePath,
              submit_command: `${panCommand(root)} submit ${runId} ${outputPath}`,
              output_validate_command: outputValidateCommand,
              mode: 'verbatim' as const,
              ...(supervisorCardReference
                ? { supervisor_card: supervisorCardReference }
                : {}),
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
              supervisor_procedure_path: supervisorProcedurePath,
              submit_command: `${panCommand(root)} submit ${runId} ${outputPath}`,
              output_validate_command: outputValidateCommand,
              watch_command: `${panCommand(root)} watch ${runId} --invocation ${invocationId}`,
              redline_record_path: redlineRecordPath(root, runId),
              mode: 'referenced' as const,
              ...(supervisorCardReference
                ? { supervisor_card: supervisorCardReference }
                : {}),
              delivery_prompt_path: deliveryPromptPath(
                runId,
                invocationId,
                root,
              ),
              // DELEGATE-001 governs the launch and the watch that follows
              // it, so it travels on the document that carries those steps.
              // The card alone put it 300 lines away from the moment the
              // platform says not to wait.
              policies: resolvePolicies(root, {
                persona: 'orchestrator',
                workflow: workflow.slug,
                stage: stage.slug,
              }).filter(
                (policy) =>
                  policy.id === 'INVOCATION-001' ||
                  policy.id === 'DELEGATE-001',
              ),
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
      artifactsRequested,
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

      if (state.managed_worktree) {
        Object.assign(requiredData, {
          'release.local_release': 'object',
          'release.local_release.fetched_main': 'string',
          'release.local_release.release_commit': 'string',
          'release.local_release.index_commit': 'string',
          'release.local_release.branch': 'string',
          'release.local_release.pr_description_path': 'string',
        })
      }
    }

    // Advisory: the profiled full run before ship, when the run recorded one.
    const suiteProfile = stage.context.suite_profile
      ? buildSuiteProfileSummary(root, state)
      : null

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
      ...(state.managed_worktree
        ? { managed_worktree: state.managed_worktree }
        : {}),
      ...(state.workspace_root && state.workspace_root !== '.'
        ? { harness_root: root }
        : {}),
      ...(state.gate_overrides ? { gate_overrides: state.gate_overrides } : {}),
      ...(state.operator_involvement
        ? { operator_involvement: state.operator_involvement }
        : {}),
      ...(state.verification ? { verification: state.verification } : {}),
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
        ...(prDescription ? { prDescription } : {}),
      }),
      ...(evidenceWorkers ? { evidence_workers: evidenceWorkers } : {}),
      ...(suiteProfile ? { suite_profile: suiteProfile } : {}),
      policies,
      requirements,
      rubric: stage.criteria,
      output: {
        path: outputPath,
        template: 'library/templates/stage-output.example.json',
        schema: 'library/schemas/stage-output.schema.json',
        // The exact command, with the JSON snapshot the scaffold interface
        // accepts, so a delegated worker never reconstructs it from the
        // requirement table and never reaches for the Markdown contract.
        ...(stage.persona === 'orchestrator'
          ? {}
          : {
              scaffold_command:
                `${panCommand(root)} output scaffold ${runId} ` +
                `--invocation ${jsonPath} --output ${outputPath}`,
            }),
        required_data: requiredData,
        ...(prDescription
          ? {
              artifacts: [
                ...(artifactsRequested
                  ? [
                      {
                        path: briefRenderedPath,
                        description:
                          'Primary self-contained HTML brief for the operator.',
                      },
                    ]
                  : []),
                {
                  path: prDescriptionPath,
                  description:
                    'Pull-request description validated against target authority.',
                },
              ],
            }
          : {}),
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
                    'You MAY run the declared local release commands to checkpoint eligible source, rebase, and create the release and index commits.',
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
                `The delegation artifact at ${delegationArtifactPath} is supervisor-owned delivery evidence. You MUST NOT write or modify it, and MUST NOT write workspace-root .delegation.md.`,
              ]),
        'You MUST NOT alter workflow state directly.',
        'While a mutating workflow is active, external edits to tracked files SHOULD be avoided because they make stage attribution ambiguous; pause the run before operator-authored changes.',
        ...(stage.workspace_policy === 'release_metadata_only' &&
        isSelfDevelopmentInstallation(root)
          ? [
              'You MUST NOT push, open or merge a pull request, publish, deploy, rewrite history, or perform other destructive source-control actions.',
            ]
          : [
              'You MUST NOT commit, push, merge, publish, deploy, or perform destructive source-control actions.',
            ]),
      ],
      ...(delegation ? { delegation } : {}),
      ...(!externalExecutor &&
      stage.persona !== 'orchestrator' &&
      runUsesModelEvidenceContract(state)
        ? { model_evidence_required: true }
        : {}),
      ...((state.workspace_directives ?? []).length > 0
        ? { attributed_changes: state.workspace_directives }
        : {}),
      workspace_before: workspace,
      ...harnessBaseline(root, state),
    }

    if (artifactsRequested) {
      scaffoldOperatorBrief(root, {
        source_path: briefSourcePath,
        profile: artifactProfile,
        title: `${stage.title} brief`,
        source: `${runId}/${invocationId}`,
      })
    }

    for (const worker of evidenceWorkers ?? []) {
      writeTextAtomic(
        resolveInside(root, worker.brief_path),
        renderEvidenceWorkerBrief(invocation, worker),
      )
    }

    const renderedMarkdown = renderInvocationMarkdown(invocation)
    // The supervisor procedure lives beside the card so the worker-visible
    // contract never carries a lifecycle command. It must exist before
    // invocation validation, which verifies both documents together.
    const supervisorProcedureMarkdown = delegation
      ? renderSupervisorProcedureMarkdown(invocation)
      : null

    if (supervisorProcedureMarkdown !== null) {
      writeTextAtomic(
        resolveInside(root, supervisorProcedurePath),
        supervisorProcedureMarkdown,
      )
    }

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
      supervisorProcedureMarkdown ?? undefined,
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
    recordDefaultModelEvidence(root, state, invocation)
    deferred.registration = {
      run_id: runId,
      invocation_id: invocationId,
      persona: stage.persona,
      executor: invocation.stage.persona_executor ?? 'cursor',
      model: invocation.stage.model,
    }

    return { state, invocation, advisories }
  })

  if (deferred.registration) {
    registerPreparedInvocation(root, deferred.registration)
  }

  // The delegation artifact and the probe belong to the delivery the
  // supervisor is about to perform, and both need the mutex this block no
  // longer holds: the probe records its marker through its own transaction.
  if (options.agent !== undefined && result.invocation) {
    const written = writeLabeledDelegationArtifact(
      root,
      result.invocation,
      options.agent,
    )
    const probe =
      written.artifact_path === null
        ? null
        : startDetachedWorkerModelProbe(
            root,
            runId,
            result.invocation.invocation_id,
          )

    return {
      ...result,
      prepared_delegation: {
        ...written,
        model_evidence: probe?.evidence ?? null,
        probe_pid: probe?.probe_pid ?? null,
      },
    }
  }

  return result
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
export function claudeCodeToolPolicy(
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
    // The invocation carries the persona the prepared card resolved, which for
    // a verdict-routed stage can differ from the stage's default persona.
    const mapping = resolvePersonaMapping(
      pipelineConfig,
      invocation.stage.persona,
    )

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
          `delegating '${invocation.stage.persona}' to claude-code (${mapping.model})`,
        )
        result = runExecutor(cardMarkdown)
      }
    } else {
      options.onProgress?.(
        `delegating '${invocation.stage.persona}' to claude-code (${mapping.model})`,
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

function blockingCriterionStateErrors(
  issues: StageOutputValidation['issues'],
): string[] {
  const blockingCodes = new Set([
    'criterion.unevaluated',
    'criterion.skipped_on_success',
  ])

  return issues
    .filter((issue) => blockingCodes.has(issue.code))
    .map((issue) => issue.message)
}

export interface MaterializedSubmission {
  value: unknown
  revisedFrom?: StageHistoryItem
}

/**
 * Materialize a full output document from either accepted submission form.
 *
 * The caller supplies `expectedInvocationId` from the run's active card, and
 * `null` when the run has none. The expectation is never derived from the
 * submitted document, because a check whose expected value comes from the
 * value it is checking proves nothing.
 */
export function materializeOutputSubmission(
  root: string,
  state: RunState,
  submittedValue: unknown,
  expectedInvocationId: string | null,
): MaterializedSubmission {
  if (!isRecord(submittedValue) || !('revises' in submittedValue)) {
    return { value: submittedValue }
  }

  invariant(
    expectedInvocationId !== null,
    'A revision submission MUST be made against an active invocation, and ' +
      'this run has none.',
    { code: 'INVALID_REVISION' },
  )
  invariant(
    typeof submittedValue.revises === 'string' &&
      submittedValue.revises.length > 0,
    'A revision submission MUST name the prior invocation in revises.',
    { code: 'INVALID_REVISION' },
  )
  invariant(
    isRecord(submittedValue.patch),
    'A revision submission MUST carry an object merge patch in patch.',
    { code: 'INVALID_REVISION' },
  )
  invariant(
    typeof submittedValue.patch.invocation_id === 'string' &&
      submittedValue.patch.invocation_id.length > 0 &&
      submittedValue.patch.invocation_id !== submittedValue.revises &&
      submittedValue.patch.invocation_id === expectedInvocationId,
    `A revision patch MUST set invocation_id to the current card's ` +
      `invocation id, not the revised attempt's.`,
    { code: 'INVALID_REVISION' },
  )

  const revisedFrom = state.stage_history.find(
    (item) => item.invocation_id === submittedValue.revises,
  )

  invariant(
    revisedFrom,
    `Revision names invocation '${submittedValue.revises}', which this run ` +
      `has no submitted attempt for.`,
    { code: 'INVALID_REVISION' },
  )

  return {
    value: applyJsonMergePatch(
      readJson(resolveInside(root, revisedFrom.output_path)),
      submittedValue.patch,
    ),
    revisedFrom,
  }
}

/**
 * Persist non-blocking verify findings as an operator inbox item. A
 * pass-with-warnings verdict advances the run because QA demonstrated the
 * change works, but the demoted findings must not evaporate: the inbox file is
 * the durable follow-up record VERIFY-001 promises. Returns the written
 * repo-relative path, or null when the output carries no demoted findings.
 */
function emitVerifyWarningsInboxItem(
  root: string,
  state: RunState,
  output: StageOutput,
): string | null {
  const verify = isRecord(output.data.verify) ? output.data.verify : null

  if (!verify || verify.verdict !== 'pass_with_warnings') {
    return null
  }

  const findings = Array.isArray(verify.findings)
    ? verify.findings.filter(isRecord)
    : []
  const warnings = findings.filter((finding) => finding.severity !== 'blocker')

  if (warnings.length === 0) {
    return null
  }

  const lines: string[] = [
    `# Verify warnings from run ${state.run_id}`,
    '',
    `The verify stage passed with warnings (invocation ${output.invocation_id}).`,
    'QA confirmed the change works, so these findings did not block the run.',
    'Schedule follow-up work for each finding, or record a decision to accept it.',
    '',
  ]

  for (const finding of warnings) {
    const id = typeof finding.id === 'string' ? finding.id : 'finding'
    const severity =
      typeof finding.severity === 'string' ? finding.severity : 'unknown'
    const statement =
      typeof finding.statement === 'string' ? finding.statement : ''
    const evidence = Array.isArray(finding.evidence)
      ? finding.evidence.filter((entry) => typeof entry === 'string')
      : []

    lines.push(`## ${id} (${severity})`, '')

    if (statement) {
      lines.push(statement, '')
    }

    if (evidence.length > 0) {
      lines.push('Evidence:', ...evidence.map((entry) => `- ${entry}`), '')
    }
  }

  const relativePath = queueInboxRelativePath(
    `${state.run_id}-verify-warnings.md`,
  )
  const absolutePath = resolveInside(root, relativePath)

  writeTextAtomic(absolutePath, `${lines.join('\n').trimEnd()}\n`)

  return relativePath
}

export function submitOutput(
  root: string,
  runId: string,
  submittedPath: string,
  options: OperationProgressOptions = {},
): SubmitOutputResult {
  // Both of these run after the mutex is released: the registry write is
  // bookkeeping the run state does not depend on, and the prefetch child is
  // work nothing joins.
  const deferred: {
    completedInvocationId: string | null
    prefetch: { profile: string; workspace_fingerprint: string } | null
  } = { completedInvocationId: null, prefetch: null }
  const result = withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const submittedRaw = readJson(resolveInside(root, submittedPath))
    const materialized = materializeOutputSubmission(
      root,
      state,
      submittedRaw,
      state.current_invocation?.id ?? null,
    )
    const submittedValue = materialized.value
    const priorForRevision = materialized.revisedFrom

    const invocationId = submittedInvocationId(submittedValue)
    const existing = invocationId
      ? state.stage_history.find((item) => item.invocation_id === invocationId)
      : undefined

    if (existing?.record_path) {
      const recordPath = artifactJsonPath(runId, existing.invocation_id, root)

      return {
        state,
        record: readTaskRecord(root, recordPath),
        advisories: [],
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
    assertSupervisorCardAttested(root, state, 'submit')
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

    const modelEvidence = settleSubmissionModelEvidence(root, state, invocation)
    const modelEvidenceAdvisories = modelEvidence.advisories

    // A recorded model that contradicts the run snapshot is the one model
    // failure that is not an advisory: the stage ran on a model this run did
    // not declare, so its verdict is not the one the run asked for. Like a
    // missing evidence report, it rejects outright without consuming an
    // attempt.
    invariant(
      modelEvidence.mismatches.length === 0,
      `Model evidence for invocation '${invocation.invocation_id}' ` +
        `contradicts the run snapshot: ${modelEvidence.mismatches.join('; ')}. ` +
        `Relaunch the affected worker on the declared model, or re-probe ` +
        `with ${panCommand(root)} models --probe --run ${runId} ` +
        `--invocation ${invocation.invocation_id} --await-probe.`,
      {
        code: 'MODEL_EVIDENCE_MISMATCH',
        details: {
          run_id: runId,
          invocation_id: invocation.invocation_id,
          mismatches: modelEvidence.mismatches,
        },
      },
    )
    // One path records an advisory and collects it for the submit result.
    // Each advisory kind arrived in its own change, and the third author
    // recorded to run state only, so `pan status` listed a conflict the
    // submit result that recorded it did not.
    const advisories: RunAdvisory[] = []
    const advise = (kind: RunAdvisory['kind'], messages: string[]): void => {
      advisories.push(
        ...recordRunAdvisories(
          state,
          {
            kind,
            source: 'submit',
            stage: stage.slug,
            invocation_id: invocation.invocation_id,
          },
          messages,
        ),
      )
    }

    advise('model_evidence', modelEvidenceAdvisories)

    if (modelEvidenceAdvisories.length > 0) {
      persistRun(root, state, 'model_evidence_advisory', {
        invocation_id: invocation.invocation_id,
        stage: stage.slug,
        advisories: modelEvidenceAdvisories,
      })
    }

    // Parallel evidence reports are supervisor-owned preconditions, so their
    // absence rejects the submission outright instead of consuming an attempt.
    for (const worker of invocation.evidence_workers ?? []) {
      const evidenceAbsolute = resolveInside(root, worker.evidence_path)

      invariant(
        fileExists(evidenceAbsolute) &&
          readText(evidenceAbsolute).trim().length > 0,
        `Evidence report for role '${worker.role}' is missing or empty at ` +
          `${worker.evidence_path}. Launch the parallel evidence workers ` +
          `from the supervisor procedure and persist their reports before ` +
          `submitting.`,
        { code: 'EVIDENCE_REPORT_MISSING' },
      )
    }

    // DELEGATE-001: the harness must have seen the worker reach a terminal
    // state. A completed `pan watch` record or a foreground-return attestation
    // is that evidence for a Cursor worker; `pan delegate` writes its own for
    // an external executor. Like a missing evidence report, this is a
    // supervisor-owned precondition and rejects outright without consuming an
    // attempt.
    const personaExecutor = invocation.stage.persona_executor ?? 'cursor'
    const delegationObservation: DelegationObservation | undefined =
      stage.persona !== 'orchestrator'
        ? summarizeDelegationObservation(
            root,
            runId,
            invocation.invocation_id,
            { externalExecutor: personaExecutor !== 'cursor' },
          )
        : undefined

    if (delegationObservation) {
      invariant(
        delegationObservation.observed,
        delegationUnobservedMessage(
          delegationObservation,
          panCommand(root),
          runId,
          invocation.invocation_id,
        ),
        {
          code: DELEGATION_UNOBSERVED,
          details: {
            watch_record_path: delegationObservation.watch.record_path,
            foreground_return_path:
              delegationObservation.foreground_return.record_path,
          },
        },
      )

      // DELEGATE-001 says a background conversion is watched immediately.
      // A late arming still submits — the work was observed — but the run
      // records how late, so a supervisor that armed at once and one that
      // armed after an operator reprimand stop looking identical.
      if (delegationObservation.watch.background_watch_late) {
        advise('delegation_supervision', [
          `${DELEGATION_WATCH_LATE}: the background watch for ` +
            `${invocation.invocation_id} was armed ` +
            `${delegationObservation.watch.background_mark_delay_seconds?.toFixed(0)}s ` +
            `after the launch, past the ${DELEGATION_WATCH_LATE_SECONDS}s ` +
            `DELEGATE-001 allows. Supervision was late, not absent.`,
        ])
      }
    }

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

    // OPERATOR-001: record a platform-guidance conflict as an advisory, so
    // `pan status` lists it for the supervisor.
    const guidanceConflicts =
      validation.output.platform_guidance_conflicts ?? []

    if (guidanceConflicts.length > 0) {
      const messages = guidanceConflicts.map(
        (conflict) =>
          `Platform guidance conflict: "${conflict.guidance}" covered ` +
          `${conflict.covered_step}; the worker followed ` +
          `${conflict.authority_followed}.`,
      )

      advise('platform_guidance', messages)
      persistRun(root, state, 'platform_guidance_conflict', {
        invocation_id: invocation.invocation_id,
        stage: stage.slug,
        conflicts: guidanceConflicts,
      })
    }

    // Claim, attestation, and artifact validators run before any repository
    // check gate. A shell gate can only confirm a success — `effectiveOutcome`
    // decides failure from a declared non-success result, a failed hard
    // self-criterion, a failed attestation, or a blocking harness validator
    // before deterministic results are consulted. When one of those has
    // already decided the outcome, running the gate commands (QA's full suite
    // above all) spends minutes proving nothing, so they are recorded as
    // skipped with the deciding reason instead of executed.
    // The commit base lets the scope criterion tell a commit of content the
    // stage already held from a change to the workspace.
    const workspaceAfter = gitWorkspaceSnapshot(
      workspaceDirectory(root, state),
      { commitBase: invocation.workspace_before.head },
    )
    const harnessValidation = runHarnessAuthoritativeValidators(
      root,
      runId,
      invocation,
      workspaceAfter.fingerprint,
      submittedValue as Record<string, unknown>,
      state as unknown as Record<string, unknown>,
    )
    const filterBriefDerivatives = (messages: string[]): string[] =>
      briefRenderFailed && briefRenderedPath
        ? messages.filter((message) => !message.includes(briefRenderedPath))
        : messages
    // A missing or mismatched attestation blocks every stage, because it means
    // the harness cannot show that the worker held the contract it acted on.
    // A required or authoritative harness validator failure blocks whichever
    // stage its policy binds it to — the enforcement and failure route the
    // card declares must be the enforcement the engine applies. Advisory
    // validator failures stay governance warnings on every stage, or the
    // advisory enforcement declared on the card would be false. Ship
    // additionally blocks on operator-brief and stage-output diagnostics.
    const blockingValidatorErrors = filterBriefDerivatives(
      harnessValidation.blocking_errors,
    ).map((message) => `Validator: ${message}`)
    const blockingCriterionErrors = blockingCriterionStateErrors(
      validation.issues,
    ).map((message) => `Stage output: ${message}`)
    const blockingValidationErrors =
      stage.slug === 'ship'
        ? [
            ...attestationErrors,
            ...briefErrors.map((message) => `Operator brief: ${message}`),
            ...validation.errors.map((message) => `Stage output: ${message}`),
            ...blockingValidatorErrors,
          ]
        : [
            ...attestationErrors,
            ...blockingCriterionErrors,
            ...blockingValidatorErrors,
          ]
    const declaredNonSuccess =
      isRecord(submittedValue) &&
      (submittedValue.result === 'failure' ||
        submittedValue.result === 'blocked')
        ? (submittedValue.result as string)
        : null
    const selfEvaluations = new Map(
      validation.output.criteria.map((item) => [item.id, item]),
    )
    const failedHardSelfCriterion = stage.criteria.find(
      (criterion) =>
        criterion.hard && selfEvaluations.get(criterion.id)?.result === 'fail',
    )
    const rejectingValidatorIds = [
      ...new Set(
        harnessValidation.blocking_errors
          .map(
            (message) => /^harness validator (\S+) failed/u.exec(message)?.[1],
          )
          .filter((value): value is string => typeof value === 'string'),
      ),
    ]
    const gateSkipReason = declaredNonSuccess
      ? `the stage reported result '${declaredNonSuccess}'`
      : attestationErrors.length > 0
        ? 'the invocation read attestation failed'
        : rejectingValidatorIds.length > 0
          ? `harness validator ${rejectingValidatorIds.join(', ')} rejected the output`
          : blockingValidationErrors.length > 0
            ? 'a blocking artifact or stage-output validator rejected the output'
            : failedHardSelfCriterion
              ? `hard criterion '${failedHardSelfCriterion.id}' was self-evaluated as failed`
              : null
    const entryGatePass = currentEntryGatePass(state, stage)
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
      gateSkipReason,
      workspaceAfter,
      entryGatePass ? { [entryGatePass.id]: entryGatePass } : {},
      invocation.harness_before,
    )

    advise('gate_bypass', evaluated.advisories)
    governanceArtifactWarnings.push(
      ...attestationErrors,
      ...briefErrors.map((message) => `Operator brief: ${message}`),
      ...validation.errors.map((message) => `Stage output: ${message}`),
      ...filterBriefDerivatives(harnessValidation.errors).map(
        (message) => `Validator: ${message}`,
      ),
    )
    recordGovernanceArtifactIssues(
      root,
      state,
      stage.slug,
      invocation.invocation_id,
      'validator',
      governanceArtifactWarnings,
    )

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
      harnessValidation.validatorOutcome,
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
      output_bytes: Buffer.byteLength(JSON.stringify(submittedValue)),
      validation_errors: allValidationErrors,
      governance_artifact_warnings: governanceArtifactWarnings,
      deterministic: evaluated.results,
      self_criteria: validation.output.criteria,
      ...(briefSourceRecord
        ? { operator_brief_source: briefSourceRecord }
        : {}),
    }

    state.stage_history.push(historyItem)

    const verifyWarningsPath =
      outcome === 'success'
        ? emitVerifyWarningsInboxItem(root, state, validation.output)
        : null

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
      if (outcome === 'success' && isSameReasonTrackedStage(stage)) {
        clearSameReasonTracker(state, stage.slug)
      }

      let sameReasonPauseTriggered = false

      if (outcome === 'failure' && isSameReasonTrackedStage(stage)) {
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
        // The invocation records the persona that actually ran, which for a
        // verdict-routed stage can differ from the workflow default.
        persona: invocation.stage.persona,
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
      ...(delegationObservation
        ? {
            delegation_observation: {
              source: delegationObservation.source,
              ...(delegationObservation.watch.record_present ||
              delegationObservation.watch.background_marked
                ? { watch: delegationObservation.watch }
                : {}),
              ...(delegationObservation.foreground_return.record_present
                ? { foreground_return: delegationObservation.foreground_return }
                : {}),
            },
          }
        : {}),
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
      ...(verifyWarningsPath
        ? { verify_warnings_inbox: verifyWarningsPath }
        : {}),
    })
    deferred.completedInvocationId = invocation.invocation_id
    deferred.prefetch = pendingReleaseProfilePrefetch(
      root,
      state,
      workflow,
      stage,
      outcome,
      evaluated.workspace.fingerprint,
    )

    return { state, record, advisories }
  })

  if (deferred.completedInvocationId) {
    completeInvocationAgent(root, runId, deferred.completedInvocationId)
  }

  if (deferred.prefetch) {
    startReleaseProfilePrefetch(
      root,
      result.state,
      deferred.prefetch.profile,
      deferred.prefetch.workspace_fingerprint,
    )
  }

  return result
}

/**
 * The release profile this submission should start computing now, or null.
 *
 * Only a passing source stage that hands the run to a read-only evidence
 * stage qualifies: its workspace stops changing at that moment, and the
 * evidence stage is long enough to absorb the work. A level that disables the
 * entry gate, a disabled gate cache, or the operator's own switch each leave
 * the gate to run the profile itself.
 */
function pendingReleaseProfilePrefetch(
  root: string,
  state: RunState,
  workflow: WorkflowDefinition,
  stage: StageDefinition,
  outcome: StageOutcome,
  workspaceFingerprint: string,
): { profile: string; workspace_fingerprint: string } | null {
  if (
    outcome !== 'success' ||
    stage.workspace_policy !== 'source_allowed' ||
    state.status !== 'running' ||
    state.current_stage === null ||
    process.env[PREFETCH_RELEASE_PROFILE_ENV] === '0' ||
    !gateCacheEnabled()
  ) {
    return null
  }

  const nextStage = workflow.stages.find(
    (candidate) => candidate.slug === state.current_stage,
  )

  if (nextStage?.workspace_policy !== 'read_only') {
    return null
  }

  const profile = entryGateRepositoryCheckProfile(workflow, state)

  if (!profile) {
    return null
  }

  // A recorded pass at this fingerprint already satisfies the gate, so a
  // second computation of the same answer would be the waste this removes.
  if (
    gateCacheLookup(
      root,
      gateCacheKey(
        root,
        workspaceFingerprint,
        repositoryCheckGateCommand(profile),
      ),
    )
  ) {
    return null
  }

  return { profile, workspace_fingerprint: workspaceFingerprint }
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
  source: RunActionActor = 'operator',
): void {
  const feedback = state.operator_feedback ?? []
  const index = feedback.length + 1
  const attempt = state.attempts[fromStage.slug] ?? 1
  // Control records document operator decisions for workers and audit, so they
  // live beside the decision records rather than in the operator directory.
  const relativePath = resolveRunLayout(root, state.run_id).decision(
    `${source}-feedback-${index}.md`,
  ).relative
  const heading =
    source === 'away'
      ? 'Away-mode remediation directive'
      : decision === 'approve'
        ? 'Operator directive attached to approval'
        : decision === 'reject'
          ? 'Operator rejection'
          : decision === 'revise'
            ? 'Operator revision directive'
            : 'Operator remediation note'
  const body =
    source === 'away'
      ? [
          `# ${heading}: ${fromStage.title} (\`${fromStage.slug}\`)`,
          '',
          `**Run** \`${state.run_id}\` · **Source attempt** ${attempt} · ` +
            `**Remediation stage** \`${toStage}\``,
          '',
          '## Required changes',
          '',
          note.trim(),
          '',
          `Away mode selected '${decision}' within the run guardrails. ` +
            'Treat this rationale as required remediation context.',
          '',
        ].join('\n')
      : [
          `# ${heading}: ${fromStage.title} (\`${fromStage.slug}\`)`,
          '',
          `**Run** \`${state.run_id}\` · **Source attempt** ${attempt} · ` +
            `**${decision === 'approve' ? 'Directed stage' : 'Remediation stage'}** \`${toStage}\``,
          '',
          decision === 'approve'
            ? '## Operator directive'
            : '## Required changes',
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
    source,
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

/**
 * The command that performs the operator's intent on a run whose status
 * refused the one they ran.
 *
 * `resume` and `decide` are one intent — continue this run — split across two
 * commands by a status the operator has to infer from an error. Naming the
 * working route in the refusal turns a second failed call into a first
 * successful one.
 */
function recoveryRouteFor(
  root: string,
  state: RunState,
  attempted: 'resume' | 'decide',
): string {
  const pan = panCommand(root)

  if (attempted === 'resume' && state.status === 'awaiting_operator') {
    return (
      `A run awaiting an operator continues with ` +
      `\`${pan} decide ${state.run_id} <approve|reject|revise> --note "<directive>"\`; ` +
      `route it to another stage with \`${pan} set-stage ${state.run_id} <stage> --note "<directive>"\`.`
    )
  }

  if (attempted === 'decide' && state.status === 'paused') {
    return (
      `A paused run continues with ` +
      `\`${pan} resume ${state.run_id} [--stage <stage>] --note "<directive>"\`.`
    )
  }

  return (
    `Read the run with \`${pan} status ${state.run_id}\` and act on the ` +
    'pending action it reports.'
  )
}

function decideRunWithActor(
  root: string,
  runId: string,
  decision: string,
  note = '',
  targetStage: string | null = null,
  actor: RunActionActor,
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    // A refusal that names only the precondition leaves the operator to infer
    // the route from a status it cannot see, so it names both.
    invariant(
      state.status === 'awaiting_operator' &&
        state.pending_action.type === 'operator_approval',
      `Run is not awaiting operator approval: its status is '${state.status}'. ` +
        recoveryRouteFor(root, state, 'decide'),
      { code: 'INVALID_RUN_ACTION', details: { status: state.status } },
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
        actor === 'operator' &&
        note.trim().length > 0 &&
        routedStage !== null &&
        state.status === 'running'
      ) {
        recordOperatorFeedback(root, state, stage, routedStage, 'approve', note)
      }
    } else if (decision === 'revise') {
      recordOperatorFeedback(
        root,
        state,
        stage,
        stage.slug,
        'revise',
        note,
        actor,
      )
      clearSameReasonTracker(state, stage.slug)

      if (actor === 'operator') {
        // Re-run the same stage with the operator's directive as required input.
        // The stage did not fail, so this must not consume its retry budget.
        const revisions = state.operator_revisions ?? {}

        revisions[stage.slug] = (revisions[stage.slug] ?? 0) + 1
        state.operator_revisions = revisions

        applyTransition(root, state, stage, 'failure', {
          overrideTarget: stage.slug,
          operatorDirected: true,
        })
      } else {
        applyTransition(root, state, stage, 'failure', {
          overrideTarget: stage.slug,
        })
      }
    } else {
      let target = stage.transitions.failure

      if (targetStage) {
        invariant(actor === 'operator', 'Away mode cannot override a route.', {
          code: 'AWAY_ACTION_FORBIDDEN',
        })
        stageBySlug(workflow, targetStage)
        target = targetStage
        resetAttemptsFrom(workflow, state, target)
      }

      recordOperatorFeedback(root, state, stage, target, 'reject', note, actor)
      applyTransition(root, state, stage, 'failure', {
        overrideTarget: target,
        operatorDirected: actor === 'operator' && Boolean(targetStage),
      })
    }

    persistRun(
      root,
      state,
      actor === 'operator'
        ? 'operator_decision_recorded'
        : 'away_decision_applied',
      {
        stage: stage.slug,
        decision,
        note,
        actor,
        target_stage: decision === 'approve' ? null : state.current_stage,
        ...(decision === 'revise' && actor === 'operator'
          ? { operator_revision: state.operator_revisions?.[stage.slug] }
          : {}),
      },
    )

    return state
  })
}

export function decideRun(
  root: string,
  runId: string,
  decision: string,
  note = '',
  targetStage: string | null = null,
): RunState {
  return decideRunWithActor(
    root,
    runId,
    decision,
    note,
    targetStage,
    'operator',
  )
}

/** Apply an away-mode gate decision without recording operator authorship. */
export function decideRunAsAway(
  root: string,
  runId: string,
  decision: string,
  note = '',
): RunState {
  return decideRunWithActor(root, runId, decision, note, null, 'away')
}

/**
 * Move a run to an operator-selected stage outside normal workflow transitions.
 * An obsolete worker may continue writing because durable state cannot observe
 * process lifetime, so stopping it first is prudent. That operational risk does
 * not constrain the operator's authority to redirect the run.
 */
function setRunStageWithActor(
  root: string,
  runId: string,
  stageSlug: string,
  note: string,
  actor: RunActionActor,
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(note.trim().length > 0, 'Stage repair note MUST be non-empty.', {
      code: 'REPAIR_NOTE_REQUIRED',
    })
    invariant(
      actor === 'operator' ||
        state.pending_action.type !== 'operator_decision' ||
        state.pending_action.operator_only !== true,
      'Away mode cannot redirect a run paused for an operator-only decision.',
      { code: 'AWAY_ACTION_FORBIDDEN' },
    )

    const workflow = loadRunWorkflow(root, state)
    stageBySlug(workflow, stageSlug)

    const fromStage = state.current_stage ?? state.status
    const sourceAttempt = state.current_stage
      ? (state.attempts[state.current_stage] ?? 0)
      : 0
    const feedback = state.operator_feedback ?? []
    const index = feedback.length + 1
    const relativePath = resolveRunLayout(root, state.run_id).decision(
      `${actor}-feedback-${index}.md`,
    ).relative
    const body = [
      actor === 'operator'
        ? '# Operator stage repair'
        : '# Away-mode stage repair',
      '',
      `**Run** \`${state.run_id}\` · **Previous state** \`${fromStage}\` · ` +
        `**Target stage** \`${stageSlug}\``,
      '',
      '## Repair reason',
      '',
      note.trim(),
      '',
      `This ${actor}-directed repair bypassed normal workflow transitions. ` +
        'Treat the reason above as required input for this stage.',
      '',
    ].join('\n')

    writeTextAtomic(resolveInside(root, relativePath), `${body}\n`)

    feedback.push({
      decision: 'set-stage',
      source: actor,
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
    clearEntryGateRoutes(state)
    state.status = 'running'
    state.current_stage = stageSlug
    state.pending_action = { type: 'prepare_invocation' }
    state.current_invocation = null
    state.pause_reason = null
    state.operator_pause = null
    state.accepted_workspace_fingerprint = null
    state.transition_count = 0
    state.consecutive_failures = 0

    persistRun(
      root,
      state,
      actor === 'operator' ? 'operator_stage_set' : 'away_stage_set',
      {
        from_stage: fromStage,
        to_stage: stageSlug,
        note_path: relativePath,
        actor,
      },
    )

    return state
  })
}

export function setRunStage(
  root: string,
  runId: string,
  stageSlug: string,
  note: string,
): RunState {
  return setRunStageWithActor(root, runId, stageSlug, note, 'operator')
}

/** Apply an away-mode stage repair without recording operator authorship. */
export function setRunStageAsAway(
  root: string,
  runId: string,
  stageSlug: string,
  note: string,
): RunState {
  return setRunStageWithActor(root, runId, stageSlug, note, 'away')
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
 * The ratified acceptance criteria of a run, read from its own accepted plan
 * output. A run that carries no plan stage reports none.
 */
function ratifiedAcceptanceCriteria(
  root: string,
  state: RunState,
): RatifiedAcceptanceCriterion[] {
  const planOutput = [...state.stage_history]
    .reverse()
    .find(
      (item) => item.stage === 'plan' && item.outcome === 'success',
    )?.output_path

  if (!planOutput || !fileExists(resolveInside(root, planOutput))) {
    return []
  }

  let value: unknown = null

  try {
    value = readJson(resolveInside(root, planOutput))
  } catch {
    return []
  }

  const data = isRecord(value) && isRecord(value.data) ? value.data : {}
  const criteria = Array.isArray(data.acceptance_criteria)
    ? data.acceptance_criteria
    : []

  return criteria.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string') {
      return []
    }

    const verification = verificationProse(item.verification)

    return verification ? [{ id: item.id, verification }] : []
  })
}

/**
 * The verification prose of one ratified criterion.
 *
 * The plan contract records `verification` as `{ method, expected }`, so the
 * consequence report matched nothing while it accepted only a bare string:
 * every real plan output produced an empty stranded list. Both shapes resolve,
 * because a criterion names its profile in either half.
 */
function verificationProse(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : null
  }

  if (!isRecord(value)) {
    return null
  }

  const prose = [value.method, value.expected]
    .filter((part): part is string => typeof part === 'string')
    .join(' — ')

  return prose.trim().length > 0 ? prose : null
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
  options: { confirmed?: boolean } = {},
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
    // A level change that strands a ratified criterion is discovered today at
    // the gate that demands the evidence, which is far past the point where
    // the operator could have chosen differently.
    const stranded = disabledEvidenceProducers(
      ratifiedAcceptanceCriteria(root, state),
      state.verification,
      resolved,
    )

    invariant(
      stranded.length === 0 || options.confirmed === true,
      `Verification level '${resolved.level}' disables the evidence ` +
        `producer of ${stranded.length} ratified acceptance ` +
        `criterion/criteria: ` +
        stranded
          .map((item) => `${item.criterion_id} (${item.profile}, ${item.gate})`)
          .join('; ') +
        '. Re-run with --confirm to apply the level and accept that those ' +
        'criteria lose their evidence producer.',
      {
        code: 'VERIFICATION_CONSEQUENCE_UNCONFIRMED',
        details: { level: resolved.level, disabled_evidence: stranded },
      },
    )

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
      ...(stranded.length > 0 ? { disabled_evidence: stranded } : {}),
      ...(note.trim().length > 0 ? { note: note.trim() } : {}),
    })

    return state
  })
}

/**
 * The newest workspace fingerprint some record in this run is accountable for.
 *
 * A stage attempt closes its window at its own after-fingerprint, and an
 * out-of-stage attribution record closes its window the same way. Whichever
 * closed last opens the next window, so consecutive records bound the
 * workspace without a gap.
 */
function lastAccountableFingerprint(state: RunState): string | undefined {
  const stage = state.stage_history.at(-1)
  const directive = state.workspace_directives?.at(-1)

  if (!directive) {
    return stage?.workspace_fingerprint
  }

  if (!stage) {
    return directive.workspace_fingerprint
  }

  return Date.parse(directive.timestamp) >= Date.parse(stage.submitted_at)
    ? directive.workspace_fingerprint
    : stage.workspace_fingerprint
}

/**
 * Record an operator directive executed against the workspace outside a
 * stage, so the next worker attributes the delta by reading rather than by
 * audit.
 *
 * The supervisor executes such a directive as the operator's mechanical
 * delegate, between stages, with no invocation of its own. Nothing else in
 * the run claims the resulting change.
 */
export function recordWorkspaceDirective(
  root: string,
  runId: string,
  options: {
    directive: string
    actingRole?: WorkspaceDirectiveRecord['acting_role']
    paths?: string[]
  },
): WorkspaceDirectiveRecord {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const directive = options.directive.trim()

    invariant(directive.length > 0, 'A directive text is required.', {
      code: 'INVALID_ARGUMENT',
    })

    const workspace = workspaceSnapshotForRun(root, state)
    const declared = (options.paths ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    const changedPaths = [
      ...new Set(
        declared.length > 0
          ? declared
          : gitStatusPaths(workspaceDirectory(root, state)).filter(
              (relativePath) =>
                !relativePath.startsWith('runtime/') &&
                !isProtectedWorkspacePath(relativePath),
            ),
      ),
    ].sort()

    invariant(
      changedPaths.length > 0,
      'The workspace holds no tracked change to attribute. Name the paths ' +
        'with --paths when the change is already committed.',
      { code: 'INVALID_RUN_ACTION' },
    )

    const records = state.workspace_directives ?? []
    const relativePath = resolveRunLayout(root, runId).evidence(
      `workspace-directive-${records.length + 1}.md`,
    ).relative
    const actingRole = options.actingRole ?? 'supervisor'
    const timestamp = now()
    const beforeFingerprint = lastAccountableFingerprint(state)
    const record: WorkspaceDirectiveRecord = {
      directive_id: `directive-${randomUUID()}`,
      acting_role: actingRole,
      directive,
      stage: state.current_stage ?? 'none',
      changed_paths: changedPaths,
      ...(beforeFingerprint
        ? { workspace_before_fingerprint: beforeFingerprint }
        : {}),
      workspace_fingerprint: workspace.fingerprint,
      artifact_path: relativePath,
      timestamp,
    }

    writeTextAtomic(
      resolveInside(root, relativePath),
      [
        '# Operator-directed workspace change',
        '',
        `**Run** \`${runId}\` · **Stage** \`${record.stage}\``,
        `**Acting role:** ${actingRole}`,
        `**Recorded at:** ${timestamp}`,
        `**Workspace fingerprint:** \`${beforeFingerprint ?? 'unrecorded'}\` → \`${workspace.fingerprint}\``,
        '',
        '## Directive',
        '',
        directive,
        '',
        '## Changed paths',
        '',
        ...changedPaths.map((item) => `- \`${item}\``),
        '',
      ].join('\n') + '\n',
    )

    records.push(record)
    state.workspace_directives = records
    persistRun(root, state, 'workspace_directive_recorded', {
      directive_id: record.directive_id,
      acting_role: actingRole,
      stage: record.stage,
      changed_paths: changedPaths,
      artifact_path: relativePath,
    })

    return record
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

/** Pause a run after recovery quarantine and preserve its resumable state. */
export function quarantineRunForAgent(
  root: string,
  runId: string,
  agentId: string,
  reason: string,
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

    if (state.status !== 'paused') {
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

    writeDecision(root, state, 'Hypervisor quarantined an agent', reason, [
      `Review agent '${agentId}' and its recovery evidence.`,
      `Resume with: ${panCommand(root)} resume ${state.run_id}`,
      `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
    ])
    persistRun(root, state, 'hypervisor_agent_quarantined', {
      agent_id: agentId,
      reason,
    })

    return state
  })
}

function resumeRunWithActor(
  root: string,
  runId: string,
  stageSlug: string | null = null,
  note = '',
  actor: RunActionActor,
): RunState {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'paused',
      `Only paused runs can be resumed: this run's status is '${state.status}'. ` +
        recoveryRouteFor(root, state, 'resume'),
      { code: 'INVALID_RUN_ACTION', details: { status: state.status } },
    )
    // A pause marked operator-only records a decision only the human operator
    // may take; the release gate raises one after its repair loops run out.
    invariant(
      actor === 'operator' ||
        state.pending_action.type !== 'operator_decision' ||
        state.pending_action.operator_only !== true,
      'Away mode cannot resume a run paused for an operator-only decision.',
      { code: 'AWAY_ACTION_FORBIDDEN' },
    )

    const workflow = loadRunWorkflow(root, state)
    const savedPause = state.operator_pause
    const currentWorkspace =
      actor === 'away' && savedPause?.workspace_before
        ? workspaceSnapshotForRun(root, state)
        : null

    invariant(
      !currentWorkspace ||
        currentWorkspace.fingerprint ===
          savedPause?.workspace_before?.fingerprint,
      'Away mode cannot ratify workspace changes made while the run was paused.',
      { code: 'AWAY_WORKSPACE_RATIFICATION_REQUIRED' },
    )

    const ratification =
      actor === 'operator' && savedPause
        ? ratifyPausedWorkspaceChanges(root, state, savedPause, note)
        : null

    if (savedPause && !stageSlug) {
      if (actor === 'operator' && note.trim().length > 0) {
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

      if (ratification || (actor === 'operator' && note.trim().length > 0)) {
        invalidatePausedInvocation(state)
      } else {
        state.status = savedPause.prior_status
        state.pending_action = savedPause.prior_pending_action
      }

      state.operator_pause = null
      state.pause_reason = null

      persistRun(
        root,
        state,
        actor === 'operator' ? 'run_resumed' : 'away_run_resumed',
        {
          restored_status: ratification ? 'running' : savedPause.prior_status,
          workspace_ratification: ratification?.ratification_id ?? null,
          actor,
        },
      )

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
      recordOperatorFeedback(root, state, source, target, 'resume', note, actor)
    }

    if (actor === 'operator' || stageSlug) {
      clearEntryGateRoutes(state)
    }

    state.status = 'running'
    state.current_stage = target
    state.pending_action = { type: 'prepare_invocation' }
    state.current_invocation = null
    state.pause_reason = null
    state.operator_pause = null
    state.consecutive_failures = 0

    persistRun(
      root,
      state,
      actor === 'operator' ? 'run_resumed' : 'away_run_resumed',
      {
        stage: target,
        workspace_ratification: ratification?.ratification_id ?? null,
        actor,
      },
    )

    return state
  })
}

export function resumeRun(
  root: string,
  runId: string,
  stageSlug: string | null = null,
  note = '',
): RunState {
  return resumeRunWithActor(root, runId, stageSlug, note, 'operator')
}

/** Resume a paused run without recording operator authorship. */
export function resumeRunAsAway(
  root: string,
  runId: string,
  stageSlug: string | null = null,
  note = '',
): RunState {
  return resumeRunWithActor(root, runId, stageSlug, note, 'away')
}

export interface WaiveGateOptions {
  stageSlug?: string | null
  targetStage?: string | null
  criterionIds?: string[]
  note: string
  deferredAcceptanceCriteria?: string[]
  createSpotfixCase?: boolean
  /**
   * Run whose ratified plan this waiver adopts. The subsumed run keeps
   * running, so its worktree claim moves to the adopting run and both states
   * record the move.
   */
  adoptPlanFromRunId?: string | null
}

/**
 * Move the subsumed run's worktree claim to the run that adopted its plan.
 *
 * The subsumed run stays live because nothing closed it, so liveness alone
 * would keep it occupying the worktree and release preparation for the
 * adopting run would refuse. Both states record the move, and the subsumed
 * run's write takes its own mutex.
 */
function transferWorktreeClaim(
  root: string,
  adoptingState: RunState,
  subsumedRunId: string,
  waiverId: string,
): WorktreeClaimTransfer {
  invariant(
    subsumedRunId !== adoptingState.run_id,
    'A run cannot adopt its own plan.',
    { code: 'INVALID_PLAN_ADOPTION' },
  )

  const worktree = adoptingState.managed_worktree?.name

  invariant(
    worktree,
    `Run '${adoptingState.run_id}' is not bound to a managed worktree, so ` +
      'there is no worktree claim to transfer.',
    { code: 'INVALID_PLAN_ADOPTION' },
  )

  const transfer: WorktreeClaimTransfer = {
    role: 'adopted',
    worktree,
    from_run_id: subsumedRunId,
    to_run_id: adoptingState.run_id,
    waiver_id: waiverId,
    timestamp: now(),
  }

  withOperationMutex(operationMutexPath(root, subsumedRunId), () => {
    const subsumed = loadState(root, subsumedRunId)

    invariant(
      subsumed.managed_worktree?.name === worktree,
      `Run '${subsumedRunId}' is not bound to worktree '${worktree}', so it ` +
        'holds no claim the adopting run can take.',
      { code: 'INVALID_PLAN_ADOPTION' },
    )

    subsumed.worktree_claim_transfer = { ...transfer, role: 'released' }
    persistRun(root, subsumed, 'worktree_claim_released', {
      worktree,
      to_run_id: adoptingState.run_id,
      waiver_id: waiverId,
    })
  })

  adoptingState.worktree_claim_transfer = transfer

  return transfer
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

  const declared = stage.criteria
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

  // A criterion the harness synthesizes, such as the scope criterion, never
  // appears in the stage file. Inferring blockers from the declared list alone
  // therefore returned nothing when one of those was the only failure, and the
  // caller widened the waiver to the whole stage.
  const declaredIds = new Set(stage.criteria.map((criterion) => criterion.id))
  const synthesized = record.evaluation.deterministic
    .filter(
      (result) =>
        !declaredIds.has(result.id) &&
        result.hard &&
        result.passed === false &&
        !result.disabled,
    )
    .map((result) => result.id)

  return [...declared, ...synthesized].sort()
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
  const relativePath = queueInboxRelativePath(
    `spotfix-case-${timestamp}-${state.run_id.slice(-8)}-${stage.slug}.md`,
  )
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
 * True when a lowercased waiver note names `token` as a word of its own.
 *
 * A bare substring test accepted `ship` inside `relationship`, `ownership`,
 * and `shipping`, so a note that never mentioned the jump satisfied the
 * confirmation the guard exists to demand.
 */
function noteNamesToken(noteBody: string, token: string): boolean {
  const escaped = token.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')

  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'u').test(noteBody)
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
): {
  state: RunState
  waiver: OperatorGateWaiver
  /** Stage entry gates this directive now reaches, in workflow order. */
  entry_gates_reached: EntryGateReach[]
  claimTransfer?: WorktreeClaimTransfer
} {
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
    // A waiver on a stage whose card is prepared or whose worker is running
    // names a blocker in that attempt, not a decision to discard it. Routing
    // forward by default threw away the prepared invocation.
    const holdsInvocation =
      state.current_stage === stage.slug &&
      state.pending_action.type === 'invoke_agent'
    const target =
      options.targetStage ??
      (holdsInvocation ? stage.slug : stage.transitions.success)

    invariant(target, `Stage '${stage.slug}' has no success transition.`, {
      code: 'INVALID_TRANSITION',
    })

    // A default route off a gated stage bypasses that stage's own gate. The
    // recorded case waived one evidence gap on verify and jumped to ship,
    // which the note never asked for. Naming the destination is the cheap
    // confirmation that the operator meant the jump.
    // `next_stage` advances on its own and gates nothing, so waiving it skips
    // no decision. The other three each withhold an advance until someone
    // judges the stage, and that is the judgment a forward route discards.
    const stageGate = stage.gate === 'next_stage' ? null : stage.gate
    const noteBody = options.note.trim().toLowerCase()

    // Naming the waived stage is not evidence: a note about waiving verify
    // says "verify" whether or not its author knew the run would leave for
    // ship. Only the destination, or the gate being given up, states the jump.
    invariant(
      options.targetStage !== undefined ||
        target === stage.slug ||
        stageGate === null ||
        noteNamesToken(noteBody, stageGate) ||
        noteNamesToken(noteBody, target.toLowerCase()),
      `Waiving '${stage.slug}' would route the run to '${target}' and bypass ` +
        `that stage's ${stageGate} gate, which the waiver note does not ` +
        `name. Pass --to <stage-slug> to state the destination, or name the ` +
        `gate or the destination stage in the note.`,
      {
        code: 'WAIVER_DESTINATION_REQUIRED',
        details: { stage: stage.slug, gate: stageGate, default_target: target },
      },
    )
    if (!['succeeded', 'failed', 'canceled', 'paused'].includes(target)) {
      stageBySlug(workflow, target)
    }

    // A directive is honored or refused by name, never silently ignored. The
    // entry gate runs before delegation, so a waiver that does not name it
    // leaves the destination stage refusing exactly as before.
    const entryGatesReached: EntryGateReach[] = workflow.stages.flatMap(
      (item) =>
        item.entry_gate &&
        waiverCoversCriterion(
          { stage: stage.slug, criterion_ids: waivedCriteria },
          item.slug,
          item.entry_gate.criterion,
        )
          ? [{ stage: item.slug, criterion: item.entry_gate.criterion }]
          : [],
    )
    const targetEntryGate = workflow.stages.find(
      (item) => item.slug === target,
    )?.entry_gate
    const targetGateRecord = targetEntryGate
      ? state.entry_gates?.[target]
      : undefined

    invariant(
      !targetEntryGate ||
        !targetGateRecord ||
        entryGateSatisfied(targetGateRecord.last_result) ||
        entryGatesReached.some((item) => item.stage === target),
      `Waiving '${stage.slug}' routes the run to '${target}', whose entry ` +
        `gate '${targetEntryGate?.criterion}' last failed and this directive ` +
        `does not reach. Waive that gate directly with: --stage ${target} ` +
        `--criteria ${targetEntryGate?.criterion} --to ${target}.`,
      {
        code: 'WAIVER_ENTRY_GATE_UNREACHED',
        details: {
          stage: stage.slug,
          target,
          entry_gate: targetEntryGate?.criterion,
        },
      },
    )

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

    const claimTransfer = options.adoptPlanFromRunId
      ? transferWorktreeClaim(root, state, options.adoptPlanFromRunId, waiverId)
      : null

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
      entry_gates_reached: entryGatesReached,
      ...(claimTransfer
        ? {
            worktree_claim_adopted_from: claimTransfer.from_run_id,
            worktree: claimTransfer.worktree,
          }
        : {}),
    })

    return {
      state,
      waiver,
      entry_gates_reached: entryGatesReached,
      ...(claimTransfer ? { claimTransfer } : {}),
    }
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

    const moved = finishInboxRequest(
      root,
      state.request.source_path,
      'canceled',
      state.request.stored_path,
    )

    if (moved) {
      state.request.source_path = moved
    }

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
  const health = registryHealthForRun(root, runId, state.current_invocation?.id)
  const statusState = health ? { ...state, agent_health: health } : state

  if (options.json) {
    return statusState
  }

  const validationStatus = state.current_invocation
    ? loadInvocationValidationStatus(root, runId, state.current_invocation.id)
    : null

  return renderStatus(
    statusState,
    validationStatus,
    buildSuiteProfileSummary(root, state),
  )
}

export function getRunState(root: string, runId: string): RunState {
  return loadState(root, runId)
}

/**
 * Mirror every validator `pan submit` runs before its shell gates, so a
 * mechanical defect does not consume a stage attempt. Only the shell gates
 * stay submit-only; the harness-authoritative validators run here from the
 * same resolved set `resolveSubmitValidators` gives the submission, without
 * persisting a validation record.
 */
export function validateOutputForSubmission(
  root: string,
  runId: string,
  invocation: Invocation,
  submittedValue: unknown,
  options: {
    /** Harness-relative path of the file under validation, when it exists. */
    submittedPath?: string
  } = {},
): { passed: boolean; checks: ValidationCheck[] } {
  const checks: ValidationCheck[] = []
  const state = loadState(root, runId)
  const materialized = materializeOutputSubmission(
    root,
    state,
    submittedValue,
    invocation.invocation_id,
  )
  const effectiveValue = materialized.value

  for (const worker of invocation.evidence_workers ?? []) {
    let present = false

    try {
      const absolute = resolveInside(root, worker.evidence_path)

      present = fileExists(absolute) && readText(absolute).trim().length > 0
    } catch {
      present = false
    }

    checks.push({
      id: `evidence.${worker.role}`,
      passed: present,
      message: present
        ? `Evidence report for role '${worker.role}' is present at ${worker.evidence_path}`
        : `Evidence report for role '${worker.role}' is missing or empty at ${worker.evidence_path}`,
    })
  }

  if (invocation.contract_manifest) {
    checks.push(
      ...validateInvocationAttestation(invocation, effectiveValue).checks,
    )
  }

  const workflow = loadRunWorkflow(root, state)
  const stage = stageBySlug(workflow, invocation.stage.slug)
  // The harness renders the operator brief during submission, so its absence
  // before submit is expected.
  const renderedPath = invocation.output.operator_brief?.rendered_path
  const structural = validateStageOutput(
    root,
    stage,
    invocation,
    effectiveValue,
    { pendingArtifactPaths: renderedPath ? [renderedPath] : [] },
  )
  const structuralErrors = structural.errors

  if (structuralErrors.length === 0) {
    checks.push({
      id: 'output.contract',
      passed: true,
      message: 'Output satisfies the structural stage contract',
    })
  } else {
    checks.push(
      ...structuralErrors.map((message, index) => ({
        id: `output.contract.${index + 1}`,
        passed: false,
        message,
      })),
    )
  }

  const catalog = loadRegistry(root)
  const submittedRecord = isRecord(effectiveValue)
    ? effectiveValue
    : ({} as Record<string, unknown>)
  // Before submit the output may still sit outside its declared path, or
  // only in memory. Output-targeted validators then read the file under
  // validation, or a scratch copy of the value that is removed afterwards, so
  // the mirror judges the same bytes the submission would.
  const declaredOutputExists = fileExists(
    resolveInside(root, invocation.output.path),
  )
  const submittedAbsolute =
    options.submittedPath !== undefined
      ? resolveInside(root, options.submittedPath)
      : null
  let scratchOutput: string | null = null
  const outputTargetPath = (): string => {
    // The operator's file wins. A stale copy at the declared path must not
    // stand in for the bytes the operator asked to validate.
    if (
      materialized.revisedFrom === undefined &&
      options.submittedPath !== undefined &&
      submittedAbsolute &&
      fileExists(submittedAbsolute)
    ) {
      return options.submittedPath
    }

    if (options.submittedPath === undefined && declaredOutputExists) {
      return invocation.output.path
    }

    // Handlers resolve a relative target against the harness root, so the
    // scratch copy lives under runtime/cache and is removed afterwards.
    if (scratchOutput === null) {
      scratchOutput = outputValidateScratchPath(
        runId,
        invocation.output.path,
        'submission-mirror',
      )
      writeJsonAtomic(resolveInside(root, scratchOutput), submittedRecord)
    }

    return scratchOutput
  }

  try {
    for (const {
      requirement,
      target_path: targetPath,
    } of resolveSubmitValidators(root, invocation, submittedRecord, catalog)) {
      if (renderedPath && targetPath === renderedPath) {
        checks.push({
          id: `validator.${requirement.registry_id}`,
          passed: true,
          message:
            `${requirement.registry_id} deferred to submit: the harness ` +
            `renders ${renderedPath} during submission`,
        })
        continue
      }

      const result = runRequirement({
        root,
        runId,
        requirement,
        targetPath:
          targetPath === invocation.output.path
            ? outputTargetPath()
            : targetPath,
        executor: 'harness',
        workspaceFingerprint: invocation.workspace_before.fingerprint,
        invocation: invocation as unknown as Record<string, unknown>,
        runState: state as unknown as Record<string, unknown>,
        catalog,
        persist: false,
      })
      const passed = isPassingResult(result)

      checks.push({
        id: `validator.${requirement.registry_id}`,
        passed,
        message: passed
          ? `${requirement.registry_id} passed (${requirement.enforcement})`
          : `${requirement.registry_id} ${result.status} (${requirement.enforcement}): ` +
            result.issues.map((issue) => issue.message).join('; '),
      })
    }
  } finally {
    if (scratchOutput !== null) {
      rmSync(path.dirname(resolveInside(root, scratchOutput)), {
        recursive: true,
        force: true,
      })
    }
  }

  return { passed: checks.every((check) => check.passed), checks }
}

export interface EvidenceWorkerDelegation {
  role: string
  persona: string
  evidence_path: string
  skipped: 'already_present' | 'cursor_persona' | null
  ok: boolean
  exit_code: number | null
  duration_ms: number
  stdout_path: string | null
  stderr_path: string | null
  error?: string
}

/**
 * Run the active invocation's parallel evidence workers through the
 * claude-code executor. The supervisor owns these launches for Cursor
 * personas; an eval driver or an external-executor supervisor uses this path
 * so the evidence reports exist before the stage worker is delegated. A worker
 * whose persona maps to Cursor is reported as skipped, never launched.
 */
export function delegateEvidenceWorkers(
  root: string,
  runId: string,
  options: OperationProgressOptions = {},
): EvidenceWorkerDelegation[] {
  const state = loadState(root, runId)

  invariant(
    state.pending_action.type === 'invoke_agent' && state.current_invocation,
    'Run is not awaiting delegation. Run prepare first.',
    { code: 'INVALID_RUN_ACTION', details: { pending: state.pending_action } },
  )

  const workflow = loadRunWorkflow(root, state)
  const stage = stageBySlug(workflow, state.current_stage)
  const invocation = readInvocation(root, state.current_invocation.json_path)
  const pipelineConfig = loadRunPipelineConfig(root, state)
  const workspaceDir = workspaceDirectory(root, state)
  const policy = claudeCodeToolPolicy(root, workspaceDir, stage)
  const evidenceDir = resolveRunLayout(root, runId).evidence('').relative
  const results: EvidenceWorkerDelegation[] = []

  for (const worker of invocation.evidence_workers ?? []) {
    const evidenceAbsolute = resolveInside(root, worker.evidence_path)
    const base = {
      role: worker.role,
      persona: worker.persona,
      evidence_path: worker.evidence_path,
    }

    if (fileExists(evidenceAbsolute) && readText(evidenceAbsolute).trim()) {
      results.push({
        ...base,
        skipped: 'already_present',
        ok: true,
        exit_code: null,
        duration_ms: 0,
        stdout_path: null,
        stderr_path: null,
      })
      continue
    }

    const mapping = resolvePersonaMapping(pipelineConfig, worker.persona)

    if (mapping.executor !== 'claude-code') {
      results.push({
        ...base,
        skipped: 'cursor_persona',
        ok: false,
        exit_code: null,
        duration_ms: 0,
        stdout_path: null,
        stderr_path: null,
      })
      continue
    }

    const brief = readText(resolveInside(root, worker.brief_path))
    const prompt =
      `${brief}\n\n## Evidence report destination\n\n` +
      `Write your complete evidence report as Markdown to ` +
      `\`${path.resolve(root, worker.evidence_path)}\`. ` +
      `That file is the only file you write outside the workspace. ` +
      `Do not submit the stage output; the stage worker owns it.\n`
    const configuredTimeout = mapping.options['timeout-ms']

    options.onProgress?.(
      `launching ${worker.role} evidence worker (${worker.persona}) via claude-code`,
    )

    const result = runClaudeCode({
      prompt,
      cwd: workspaceDir,
      model: mapping.model,
      permissionMode: mapping.options['permission-mode'] ?? 'default',
      allowedTools: policy.allowedTools,
      addDirs: policy.addDirs,
      ...(configuredTimeout ? { timeoutMs: Number(configuredTimeout) } : {}),
    })
    const stdoutPath = `${evidenceDir}/${invocation.invocation_id}.claude-code.${worker.role}.stdout.json`
    const stderrPath = `${evidenceDir}/${invocation.invocation_id}.claude-code.${worker.role}.stderr.log`

    writeTextAtomic(resolveInside(root, stdoutPath), result.stdout)
    writeTextAtomic(resolveInside(root, stderrPath), result.stderr)

    const present =
      fileExists(evidenceAbsolute) &&
      readText(evidenceAbsolute).trim().length > 0

    results.push({
      ...base,
      skipped: null,
      ok: result.ok && present,
      exit_code: result.exit_code,
      duration_ms: result.duration_ms,
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      ...(result.error
        ? { error: result.error }
        : present
          ? {}
          : {
              error: `evidence report not written at ${worker.evidence_path}`,
            }),
    })
  }

  return results
}
