#!/usr/bin/env node
import { readdirSync, realpathSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  abortRun,
  assertDelegationAgentName,
  assessStage,
  createRun,
  DEFAULT_WORKFLOW_SLUG,
  decideRun,
  armWorkerWatch,
  delegateInvocation,
  getRunStatus,
  getRunState,
  materializeOutputSubmission,
  outputValidateScratchPath,
  pauseRun,
  describeDelegatedWorkers,
  recordDelegatedWorker,
  recordWorkspaceDirective,
  prepareInvocation,
  probeRunInvocationModel,
  startDetachedWorkerModelProbe,
  quarantineRunForAgent,
  recordInvocationModelEvidence,
  recordSupervisorModelEvidence,
  resumeRun,
  setRunStage,
  setRunVerification,
  submitOutput,
  validateOutputForSubmission,
  waiveGate,
} from './lib/engine.js'
import type { DelegatedWorkerPathState } from './lib/engine.js'
import {
  abandonBestOfNCandidate,
  bestOfNStatus,
  cleanBestOfN,
  consolidateBestOfN,
  initBestOfN,
  pruneBestOfN,
  refreshBestOfNAgents,
} from './lib/best-of-n.js'
import {
  abandonChunk,
  cleanCohortSession,
  cohortStatus,
  initCohortSession,
  integrateCohort,
  maybeAdvanceCohort,
  maybeStartDelivery,
  releaseCohort,
  retryDeliveryRoute,
  startCohort,
} from './lib/cohorts.js'
import type { DeliveryRouteOptions } from './lib/cohorts.js'
import {
  abandonHorizonSession,
  addHorizonTask,
  checkpointHorizonSession,
  deferHorizonTask,
  horizonStatus,
  initHorizonSession,
  latestHorizonHandoff,
  loadHorizonSession,
  nextHorizonTask,
  reconcileHorizonSession,
  reinstateHorizonTask,
  startHorizonSession,
  type HorizonQueueTaskInput,
} from './lib/horizon.js'
import {
  ARBITER_ACTIONS,
  HORIZON_HARD_BLOCKS,
  type ArbiterActionType,
  type HorizonHardBlock,
} from './lib/horizon-arbiter.js'
import {
  applyAwayDecision,
  evaluateAwayState,
} from './lib/away-orchestration.js'
import {
  installScheduleAgent,
  resolveScheduleConfig,
  runScheduledJob,
  scheduleStatus,
  scheduleTick,
  uninstallScheduleAgent,
  validateSchedule,
} from './lib/schedule.js'
import { GATE_CACHE_ENV, gateCacheStatus } from './lib/gate-cache.js'
import { personaExecutorOf } from './lib/executors/mapping.js'
import {
  cursorAuthenticationReadiness,
  probeCursorModels,
} from './lib/executors/cursor-probe.js'
import { claudeCodeVersionPreflight } from './lib/executors/claude-code.js'
import { openAiExecutorPreflight } from './lib/executors/openai-auth.js'
import { browserReadiness } from './lib/browser-readiness.js'
import { errorMessage, PanError } from './lib/errors.js'
import { assertArgvElementsWithinLimit } from './lib/argv-limits.js'
import {
  configuredWorkspaceRoot,
  harnessConfigName,
  localConfigName,
  mergeConfigValues,
  panCommand,
} from './lib/project-config.js'
import { resolvePolicies } from './lib/policies.js'
import { renderRunInvocationCard } from './lib/context-card.js'
import { orderedWorkerActions } from './lib/render.js'
import { resolvePrDescriptionContext } from './lib/pr-description.js'
import { allocateReleaseVersion } from './lib/release-allocation.js'
import {
  continueLocalRelease,
  finalizeLocalRelease,
  syncLocalRelease,
} from './lib/release-preparation.js'
import {
  AWAY_SUBCOMMAND_OPTIONS,
  awayDecisionLedgerPath,
  awayModeTrigger,
  readAwayDecisionLedger,
  recordAwayApplyResult,
  recordHypervisorQuarantine,
  resolveAwayApplyAction,
  unknownAwayOption,
  type AwayDecisionRecord,
} from './lib/away-mode.js'
import {
  createAgentRecoveryRunner,
  hypervisorEventsPath,
  hypervisorProcessStatus,
  registryHealthForRun,
  runHypervisorDaemon,
  startHypervisorProcess,
  stopHypervisorProcess,
  tickHypervisor,
} from './lib/hypervisor.js'
import {
  gitWorkspaceSnapshot,
  integrationBranchReadiness,
  isGitRepository,
} from './lib/git.js'
import { liveRunsBoundToWorktree } from './lib/state.js'
import { listInbox, renderInbox, restoreInboxRequest } from './lib/inbox.js'
import {
  archiveInstallationInboxItems,
  describeInstallations,
} from './lib/installations.js'
import {
  loadPipelineConfig,
  parsePipelineConfig,
  pipelineConfigPersonaMappings,
} from './lib/pipeline-config.js'
import { cursorCatalogStatus } from './lib/executors/cursor-catalog.js'
import { migratePipelineOverrides } from './lib/pipeline-config-migration.js'
import { loadOperatorInvolvementFile } from './lib/operator-involvement.js'
import { loadVerificationFile } from './lib/verification.js'
import { syncCursorProjection } from './lib/projection.js'
import {
  fileExists,
  findProjectRoot,
  isFile,
  isRecord,
  readJson,
  readText,
  referenceContentSha256,
  resolveInside,
  sha256,
  toRepoRelative,
  writeJsonAtomic,
  writeTextAtomic,
} from './lib/io.js'
import type {
  AgentRecord,
  DelegatedWorkerRecord,
  Invocation,
  RunState,
} from './lib/types.js'
import type { InvocationKind } from './lib/requirements/types.js'
import {
  delegationExecutionPath,
  invocationValidationPath,
  validateRepository,
} from './lib/validation.js'
import { PRIMER_BODY_FRESHNESS_LIMIT } from './lib/validators/target-repo-primer.js'
import { buildValidationMap } from './lib/requirements/map.js'
import { loadRegistry } from './lib/requirements/registry.js'
import { resolveRequirements } from './lib/requirements/resolve.js'
import {
  inferTargetKind,
  isPassingResult,
  registryAppliesToStage,
  resolveRequirementTargetPath,
  runRequirement,
} from './lib/requirements/run.js'
import type { ResolvedRequirement } from './lib/types.js'
import {
  readInvocationFromPath,
  scaffoldAssessment,
  scaffoldStageOutput,
} from './lib/requirements/scaffold.js'
import { auditDirectives } from './lib/governance/audit-directives.js'
import {
  gradeEvalRun,
  listEvalScenarios,
  renderEvalReportMarkdown,
  runEval,
  writeEvalReport,
} from './lib/evals/index.js'
import { buildGovernanceCard } from './lib/governance-card.js'
import { HELP_BODY, validatePanInvocation } from './lib/pan-command-grammar.js'
export { HELP_BODY } from './lib/pan-command-grammar.js'
import { availableReviewDimensions } from './lib/review-dimensions.js'
import {
  attestSupervisorCard,
  buildSupervisorCard,
} from './lib/governance/supervisor-card.js'
import { conflictsByTier, resolveReviewScope } from './lib/review-scope.js'
import {
  agentGatePassSuiteProfile,
  nextAgentGatePassAttempt,
  agentRepositoryCheckAdvisories,
  assertRepositoryChecksValid,
  loadRepositoryChecks,
  recordAgentRepositoryCheck,
  recordAgentRepositoryCheckForRuns,
  recordProfileGatePass,
  repositoryCheckWorkspaceRoot,
  repositoryChecksSourcePath,
  reusableProfileExecution,
  runRepositoryCheckStreaming,
} from './lib/repository-checks.js'
import { TEST_PROFILE_ENV } from './lib/suite-profile.js'
import {
  appendFastWallRun,
  buildFastWallReport,
  FAST_WALL_AGENT_PHASE,
  FAST_WALL_PHASE_ENV,
  FAST_WALL_RUN_ID_ENV,
  FAST_WALL_SERIES_ROOT_ENV,
  FAST_WALL_STANDALONE_PHASE,
  formatFastWallReport,
} from './lib/fast-wall-series.js'
import { detectWorkspaceTechnologies } from './lib/technologies.js'
import { resolveRunLayout } from './lib/run-layout.js'
import {
  buildBriefSystem,
  renderBrief,
  validateBriefSystem,
} from './lib/briefs.js'
import { generateOperatorArtifacts } from './lib/operator-artifact-generation.js'
import {
  maintainWorkflowRuntime,
  resolveRunCitation,
} from './lib/workflow-artifacts.js'
import {
  DEFAULT_STALL_TIMEOUT_SECONDS,
  WATCH_EXIT_CODES,
  formatWakeLine,
  parseAgentState,
  parseCadenceSeconds,
  parsePositiveInteger,
  parseTimeoutSeconds,
  recordForegroundReturn,
  foregroundReturnRecordPath,
  launchRecordPath,
  writeRedlineRecord,
} from './lib/watch.js'
import {
  createWorktree,
  listWorktrees,
  readWorktreeIndex,
  reconcileWorktrees,
  removeWorktree,
  resolveOrCreateWorktree,
  resolveWorktreeWorkspace,
  resolveWorkspacePathOrWorktree,
  workspaceRepositoryRoot,
  type WorktreeRecord,
} from './lib/worktrees.js'
import {
  DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION,
  isWorkspaceAttributionDisposition,
  WORKSPACE_ATTRIBUTION_DISPOSITIONS,
} from './lib/workspace-attribution.js'
import { runTestsImpacted } from './lib/test-impact.js'
import {
  checkpointConformArtifacts,
  scanConformArtifacts,
} from './lib/conform.js'
import {
  checkpointStyleArtifacts,
  scanStyleArtifacts,
} from './lib/code-style.js'
import {
  CODE_STYLE_POLICY_IDS,
  codeStylePolicyId,
} from './lib/validators/code-style.js'
import {
  applyTargetAuthoringDraft,
  readTargetExtensionManifest,
  validateTargetAuthoring,
} from './lib/target-authoring.js'
import {
  finalizePreparedTuneSession,
  prepareTuneSession,
  runBenchmarkSession,
  validateAudit,
} from './lib/test-tuning.js'

function helpText(root: string): string {
  const versionPath = path.join(root, 'VERSION')
  const version = fileExists(versionPath)
    ? readText(versionPath).trim()
    : 'unknown'

  return `Pancreator v${version}

${HELP_BODY}`
}

function option(
  args: string[],
  name: string,
  fallback: string | null = null,
): string | null {
  const index = args.indexOf(name)

  if (index === -1) {
    return fallback
  }

  const value = args[index + 1]

  if (!value || value.startsWith('--')) {
    throw new PanError(`${name} requires a value.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return value
}

function options(args: string[], name: string): string[] {
  const values: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue
    }

    const value = args[index + 1]

    if (!value || value.startsWith('--')) {
      throw new PanError(`${name} requires a value.`, {
        code: 'INVALID_ARGUMENT',
      })
    }

    values.push(value)
    index += 1
  }

  return values
}

function requiredArgument(
  value: string | null | undefined,
  name: string,
): string {
  if (!value) {
    throw new PanError(`${name} is required.`, { code: 'INVALID_ARGUMENT' })
  }

  return value
}

function parseWorkerLaunchMode(
  value: string | null,
): DelegatedWorkerRecord['launch_mode'] {
  if (value === null) {
    return 'unknown'
  }

  if (value !== 'foreground' && value !== 'background') {
    throw new PanError(
      `--launch-mode MUST be 'foreground' or 'background', not '${value}'.`,
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return value
}

/**
 * One declared path of a delegated worker, for the plain-text report.
 *
 * Every declared path is named, including one nobody has written, because a
 * missing report is the fact the supervisor came for. The producer is named
 * with it so a harness-written brief never reads as the worker's own output.
 */
function declaredPathState(item: DelegatedWorkerPathState): string {
  const producer = item.producer === 'harness' ? ' (harness-written)' : ''

  return item.exists
    ? `${item.path} ${item.size} bytes at ${item.modified_at}${producer}`
    : `${item.path} not written${producer}`
}

/** One required argument of a multi-argument command surface. */
interface RequiredArgument<Name extends string> {
  name: Name
  value: string | null | undefined
  /** A flag in a positional slot is a missing positional, never a value. */
  positional?: boolean
}

/**
 * Resolve every required argument of one command surface together.
 *
 * Validating each argument where it is read makes the first missing one throw
 * before the second is examined, so an operator discovers a three-argument
 * shape one failed call at a time. Collecting them reports the whole defect
 * on the first call.
 */
function requiredArguments<Name extends string>(
  entries: ReadonlyArray<RequiredArgument<Name>>,
): Record<Name, string> {
  const resolved = {} as Record<Name, string>
  const missing: string[] = []

  for (const entry of entries) {
    const usable =
      entry.value && !(entry.positional && entry.value.startsWith('--'))

    if (!usable) {
      missing.push(entry.name)
      continue
    }

    resolved[entry.name] = entry.value as string
  }

  if (missing.length > 0) {
    throw new PanError(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required.`,
      { code: 'INVALID_ARGUMENT', details: { missing } },
    )
  }

  return resolved
}

/**
 * A required positional argument. A flag in the positional slot, for example
 * `pan cohort release --json`, is a missing positional, not a value, so it is
 * refused as such instead of reaching the command's own validation.
 */
export function requiredPositional(
  value: string | null | undefined,
  name: string,
): string {
  if (!value || value.startsWith('--')) {
    throw new PanError(`${name} is required.`, { code: 'INVALID_ARGUMENT' })
  }

  return value
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

/**
 * Operator note taken from `--note` or from `--note-file <path>`.
 *
 * A full decision packet exceeds what argv carries safely, so the file option
 * is the route the argv refusal names. The two spellings are exclusive so a
 * command never has to choose between two notes.
 */
function noteOption(
  root: string,
  args: string[],
  fallback: string | null = null,
): string | null {
  const inline = option(args, '--note')
  const notePath = option(args, '--note-file')

  if (inline !== null && notePath !== null) {
    throw new PanError('--note and --note-file cannot be used together.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (notePath === null) {
    return inline ?? fallback
  }

  const absolute = resolveInside(
    root,
    path.isAbsolute(notePath) ? toRepoRelative(root, notePath) : notePath,
  )

  if (!isFile(absolute)) {
    throw new PanError(`--note-file does not name a file: ${notePath}`, {
      code: 'NOTE_FILE_NOT_FOUND',
    })
  }

  return readText(absolute)
}

/** Integer-valued option, or null when absent. A non-integer value is refused. */
function integerOption(args: string[], name: string): number | null {
  const raw = option(args, name)

  if (raw === null) {
    return null
  }

  const value = Number(raw)

  if (!Number.isInteger(value)) {
    throw new PanError(`${name} requires an integer.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return value
}

/**
 * Utility-wide worktree targeting contract.
 *
 * One shared `--worktree <name>` option selects the workspace a command runs
 * against, creating the named worktree when the index does not hold it yet.
 * `acceptsWorktreeOption` declares every command surface that runs against a
 * selectable workspace; every other command rejects the option explicitly so
 * an unsupported use fails loudly instead of being silently ignored.
 * Projected persona and utility commands that delegate outside the CLI bind
 * their workspace through `pan worktree resolve`, which applies the same
 * create-or-resolve behavior to an operator-named worktree.
 */
export const WORKTREE_CAPABLE_SURFACES = [
  'init',
  'decide',
  'cohort route',
  'horizon init',
  'prepare',
  'resume',
  'submit',
  'author apply|validate',
  'release sync|continue|finalize',
  'conform scan|checkpoint',
  'style scan|checkpoint',
  'repository-check <profile>',
  'requirements run',
  'tests impacted',
  'technologies detect',
  'doctor',
  'governance card',
]

const SUBCOMMAND_STYLE_COMMANDS = new Set([
  'assessment',
  'author',
  'away',
  'cohort',
  'best-of-n',
  'briefs',
  'conform',
  'context',
  'governance',
  'hypervisor',
  'horizon',
  'inbox',
  'installs',
  'output',
  'release',
  'repository-check',
  'requirements',
  'schedule',
  'spotfix',
  'style',
  'technologies',
  'tune',
  'worker',
  'worktree',
])

function acceptsWorktreeOption(command: string, args: string[]): boolean {
  const validation = validatePanInvocation([command, ...args])

  if (validation.surface === null) {
    // These families parse their own subcommand after the shared option gate.
    // Preserve that stable error precedence for an unknown subcommand.
    return command === 'conform' || command === 'release' || command === 'style'
  }

  return validation.unknown_option !== '--worktree'
}

/**
 * Reject `--worktree` on a command surface that does not run against a
 * selected workspace. Exported so a test can hold a projected command file to
 * the command lines this CLI actually accepts, rather than to its own prose.
 */
export function assertWorktreeOptionSupported(
  command: string,
  args: string[],
): void {
  if (!hasFlag(args, '--worktree') || acceptsWorktreeOption(command, args)) {
    return
  }

  const sub = args[0]
  const surface =
    sub && !sub.startsWith('--') && SUBCOMMAND_STYLE_COMMANDS.has(command)
      ? `${command} ${sub}`
      : command

  throw new PanError(
    `'pan ${surface}' does not run against a selected workspace, so it does ` +
      'not accept --worktree. Commands that accept the shared worktree ' +
      `option: ${WORKTREE_CAPABLE_SURFACES.join(', ')}.`,
    { code: 'WORKTREE_OPTION_UNSUPPORTED' },
  )
}

/** Workspace the shared `--worktree <name>` option selects, created on demand. */
function sharedWorktreeWorkspace(
  root: string,
  args: string[],
  description?: string | null,
): WorktreeRecord | null {
  const name = option(args, '--worktree')

  if (!name) {
    return null
  }

  const record = resolveOrCreateWorktree(
    root,
    name,
    description ?? `Worktree '${name}'`,
  )

  return record
}

/**
 * Check a lifecycle worktree selection against the identity stored at init.
 *
 * The name comparison occurs before worktree resolution, so a conflicting
 * selection cannot create or switch an unrelated worktree.
 */
function assertRunWorktreeBinding(
  root: string,
  runId: string,
  args: string[],
): void {
  const name = option(args, '--worktree')
  const state = getRunState(root, runId)
  const binding = state.managed_worktree

  if ((name && !binding) || (name && binding?.name !== name)) {
    throw new PanError(
      `Run '${runId}' is bound to worktree ` +
        `'${binding?.name ?? '(none)'}', not '${name}'.`,
      { code: 'RUN_WORKTREE_MISMATCH' },
    )
  }

  if (!binding) {
    return
  }

  const resolved = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === binding.name,
  )

  if (
    !resolved ||
    resolved.path !== binding.path ||
    resolved.branch !== binding.branch
  ) {
    throw new PanError(
      `Run '${runId}' worktree identity no longer matches the index.`,
      { code: 'RUN_WORKTREE_IDENTITY_MISMATCH' },
    )
  }

  const resolvedPath = resolveWorktreeWorkspace(root, binding.name)

  if (resolvedPath !== binding.path) {
    throw new PanError(
      `Run '${runId}' resolved worktree path no longer matches its binding.`,
      { code: 'RUN_WORKTREE_IDENTITY_MISMATCH' },
    )
  }
}

/**
 * Comma-separated list option: null when the flag is absent, at least one item
 * when it is present. A present flag that names nothing (`--criteria ,`) is
 * refused rather than read as "no selection", because every caller treats the
 * absent flag as a wider default that the operator did not ask for. An empty
 * segment (`security,` after the shell split `security, performance`) is
 * refused the same way, because dropping it would silently narrow the list.
 */
function commaSeparatedOption(
  args: string[],
  name: string,
  accepted?: readonly string[],
): string[] | null {
  const value = option(args, name)

  if (value === null) {
    return null
  }

  const items = value.split(',').map((item) => item.trim())

  if (items.some((item) => item.length === 0)) {
    throw new PanError(
      `${name} needs at least one value, comma-separated with no spaces ` +
        `and no empty segment; got '${value}'.` +
        (accepted ? ` Accepted values: ${accepted.join(', ')}.` : ''),
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return items
}

function repeatedOption(args: string[], name: string): string[] {
  const values: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue
    }

    const value = args[index + 1]

    if (!value || value.startsWith('--')) {
      throw new PanError(`${name} requires a value.`, {
        code: 'INVALID_ARGUMENT',
      })
    }

    values.push(value)
    index += 1
  }

  return values
}

const INVOCATION_KINDS = new Set<InvocationKind>([
  'workflow',
  'assessment',
  'spotfix',
  'investigation',
  'repair',
  'decomposition',
  'documentation',
  'standalone',
])

function invocationKindOption(
  args: string[],
  required = false,
): InvocationKind | undefined {
  const value = option(args, '--kind')

  if (!value) {
    if (required) {
      throw new PanError('--kind is required.', { code: 'INVALID_ARGUMENT' })
    }

    return undefined
  }

  if (!INVOCATION_KINDS.has(value as InvocationKind)) {
    // Agents guess a registry name, artifact type, or requirement phase here,
    // so the error spells the closed set and disambiguates it from --registry.
    throw new PanError(
      `Unknown invocation kind: ${value}. --kind names the invocation kind, ` +
        `one of ${[...INVOCATION_KINDS].join(', ')}. It is not the registry ` +
        'id (use --registry), the artifact type, or the requirement phase. ' +
        "A worker inside a workflow run passes '--kind workflow'.",
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return value as InvocationKind
}

/** Normalize invocation paths; resolve bare ids through their run layout. */
function requirementsRunInvocationPath(
  root: string,
  invocationReference: string,
  runId: string | null,
): string {
  const isPathReference =
    path.isAbsolute(invocationReference) ||
    invocationReference.includes('/') ||
    invocationReference.includes('\\') ||
    path.extname(invocationReference).length > 0

  if (isPathReference) {
    try {
      return toRepoRelative(root, invocationReference)
    } catch (error) {
      if (error instanceof PanError && error.code === 'PATH_ESCAPE') {
        throw new PanError(
          `Invocation path must remain inside the harness root: ` +
            `${invocationReference}. Pass a harness-relative path inside the ` +
            'root, or pass an invocation id together with --run <run-id>.',
          { code: 'INVALID_ARGUMENT' },
        )
      }

      throw error
    }
  }

  if (!runId) {
    throw new PanError(
      `Invocation id '${invocationReference}' requires --run <run-id>. ` +
        'Alternatively, pass the exact invocation JSON snapshot path.',
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return resolveRunLayout(root, runId).invocation(invocationReference, '.json')
    .relative
}

/** Load and validate the invocation fields `requirements run` consumes. */
function requirementsRunInvocation(
  root: string,
  invocationPath: string,
): Invocation {
  const value: unknown = readInvocationFromPath(root, invocationPath)
  const validRequirement = (entry: unknown): boolean =>
    isRecord(entry) &&
    typeof entry.policy_id === 'string' &&
    typeof entry.requirement_id === 'string' &&
    typeof entry.registry_id === 'string' &&
    typeof entry.registry_version === 'string' &&
    (entry.kind === 'automation' || entry.kind === 'validator') &&
    typeof entry.phase === 'string' &&
    typeof entry.executor === 'string' &&
    typeof entry.target === 'string' &&
    isRecord(entry.arguments) &&
    typeof entry.enforcement === 'string' &&
    typeof entry.failure_route === 'string'

  if (
    !isRecord(value) ||
    typeof value.invocation_id !== 'string' ||
    value.invocation_id.length === 0 ||
    typeof value.run_id !== 'string' ||
    value.run_id.length === 0 ||
    typeof value.workspace_root !== 'string' ||
    value.workspace_root.length === 0 ||
    !isRecord(value.workflow) ||
    typeof value.workflow.slug !== 'string' ||
    !isRecord(value.stage) ||
    typeof value.stage.slug !== 'string' ||
    typeof value.stage.persona !== 'string' ||
    !isRecord(value.output) ||
    typeof value.output.path !== 'string' ||
    !isRecord(value.workspace_before) ||
    (value.workspace_before.kind !== 'git' &&
      value.workspace_before.kind !== 'filesystem') ||
    typeof value.workspace_before.fingerprint !== 'string' ||
    !Array.isArray(value.workspace_before.entries) ||
    !value.workspace_before.entries.every(
      (entry) => typeof entry === 'string',
    ) ||
    !isRecord(value.requirements) ||
    !Array.isArray(value.requirements.validation_requirements) ||
    !value.requirements.validation_requirements.every(validRequirement) ||
    !Array.isArray(value.requirements.automation_requirements) ||
    !value.requirements.automation_requirements.every(validRequirement)
  ) {
    throw new PanError(
      `--invocation does not contain the workflow, stage, output, ` +
        `workspace_before, and requirement fields needed by requirements run: ` +
        invocationPath,
      { code: 'INVALID_INVOCATION' },
    )
  }

  return value as unknown as Invocation
}

function print(value: unknown, asJson = false): void {
  if (asJson || typeof value !== 'string') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  } else {
    process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
  }
}

function parseRunState(value: unknown, source: string): RunState {
  if (
    !isRecord(value) ||
    typeof value.run_id !== 'string' ||
    typeof value.status !== 'string'
  ) {
    throw new PanError(`${source} does not contain a valid run state.`, {
      code: 'INVALID_STATE',
    })
  }

  return value as unknown as RunState
}

function listRuns(root: string): Array<Record<string, unknown>> {
  const base = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(base)) {
    return []
  }

  return readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fileExists(resolveRunLayout(root, entry.name).state.absolute),
    )
    .map((entry) => {
      const statePath = resolveRunLayout(root, entry.name).state.absolute

      return parseRunState(readJson(statePath), statePath)
    })
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((state) => ({
      ...(() => {
        const health = registryHealthForRun(
          root,
          state.run_id,
          state.current_invocation?.id,
        )

        return {
          agent_health: health?.health ?? 'unknown',
          health_evidence_at: health?.evidence_at ?? null,
          recovery_state: health?.recovery.step ?? null,
        }
      })(),
      run_id: state.run_id,
      title: state.title,
      status: state.status,
      stage: state.current_stage,
      pending_action: state.pending_action.type,
      updated_at: state.updated_at,
    }))
}

function reprepareRecoveredAgent(
  root: string,
  agent: AgentRecord,
): {
  ok: boolean
  evidence: string
  failure_signature?: string
  supported?: boolean
} {
  const state = getRunState(root, agent.run_id)
  const current = state.current_invocation

  if (
    !current ||
    current.id !== agent.invocation_id ||
    state.current_stage === null
  ) {
    return {
      ok: false,
      supported: false,
      failure_signature: 'invocation-changed',
      evidence: 'The run no longer expects this invocation.',
    }
  }

  const invocation = readJson(resolveInside(root, current.json_path))
  const validationPath = resolveInside(
    root,
    invocationValidationPath(agent.run_id, agent.invocation_id, root),
  )
  const validation = fileExists(validationPath)
    ? readJson(validationPath)
    : undefined

  const priorFingerprint =
    isRecord(invocation) &&
    isRecord(invocation.workspace_before) &&
    typeof invocation.workspace_before.fingerprint === 'string'
      ? invocation.workspace_before.fingerprint
      : null
  const currentFingerprint = gitWorkspaceSnapshot(
    state.workspace_root,
  ).fingerprint
  const validationPassed = isRecord(validation) && validation.status === 'pass'

  if (validationPassed && priorFingerprint === currentFingerprint) {
    return {
      ok: false,
      supported: false,
      failure_signature: 'canonical-invocation-still-valid',
      evidence:
        'The canonical invocation still validates against the workspace.',
    }
  }

  setRunStage(
    root,
    state.run_id,
    state.current_stage,
    'Hypervisor re-prepared an invalid or workspace-stale invocation.',
  )
  const prepared = prepareInvocation(root, state.run_id)

  if (!prepared.invocation) {
    return {
      ok: false,
      failure_signature: 'reprepare-produced-no-invocation',
      evidence: 'The harness did not produce a replacement invocation.',
    }
  }

  return {
    ok: true,
    evidence: `Prepared replacement invocation ${prepared.invocation.invocation_id}.`,
  }
}

function runHypervisorCycle(root: string): Record<string, unknown> {
  const recoveryRunner = createAgentRecoveryRunner(root)
  const tick = tickHypervisor(root, {
    recoveryRunner: {
      ...recoveryRunner,
      reprepare: (agent) => reprepareRecoveredAgent(root, agent),
    },
  })
  const quarantinedRuns = new Set<string>()

  for (const event of tick.recovery_events) {
    if (event.step !== 'quarantine') {
      continue
    }

    const agent = tick.agents.find(
      (candidate) => candidate.agent_id === event.agent_id,
    )

    if (
      !agent ||
      (agent.health !== 'stalled' && agent.health !== 'dead') ||
      quarantinedRuns.has(agent.run_id)
    ) {
      continue
    }

    const reason = `Agent '${agent.agent_id}' was quarantined. ${event.evidence}`
    const state = quarantineRunForAgent(
      root,
      agent.run_id,
      agent.agent_id,
      reason,
    )

    recordHypervisorQuarantine(root, state, {
      health: agent.health,
      summary: reason,
      evidence_reference: path
        .relative(root, hypervisorEventsPath(root))
        .split(path.sep)
        .join('/'),
    })
    quarantinedRuns.add(agent.run_id)
  }

  return { tick, away_decisions: [] }
}

/**
 * Identify requirements that execute identically, whatever policy declares
 * them. Exported so a test can hold sibling declarations to the shape this
 * command collapses, rather than to the ambiguity message.
 */
export function requirementShapeKey(requirement: ResolvedRequirement): string {
  return [
    // The declaring policy is part of the shape. Two language policies bind
    // one code-style handler, and collapsing them discarded the one field
    // that says which handbook the evidence is judged against.
    requirement.policy_id,
    requirement.registry_id,
    requirement.registry_version,
    requirement.phase,
    requirement.executor,
    requirement.resolved_target ?? requirement.target,
    requirement.enforcement,
    requirement.failure_route,
    requirement.evidence_class,
    requirement.success_condition,
    JSON.stringify(requirement.arguments),
  ].join('|')
}

/** Operator worktree choice shared by the two commands that route a plan. */
function deliveryRouteOptions(args: string[]): DeliveryRouteOptions {
  const worktreeName = option(args, '--worktree')

  return worktreeName ? { worktreeName } : {}
}

/**
 * The requirements `pan output validate` runs before submission.
 *
 * Selection is by side-effect freedom, not by executor. The executor field
 * keeps a state-mutating validator out of an agent's hands, which is right
 * for a validator that costs a gate; it is wrong for a deterministic
 * read-only one. Filtering by executor made the claims validator — the check
 * this command exists to catch, and a harness-executor entry that declares
 * both `deterministic` and `side_effect_free` — unreachable by construction,
 * so a mechanical claim defect consumed a stage attempt behind a passing
 * suite. A requirement whose registry entry declares either property false
 * still stays out, whatever its executor.
 *
 * Exported so a test can hold the selection to the registry rather than to
 * the command's own prose.
 */
export function preSubmitRequirements(
  root: string,
  invocation: Invocation,
): ResolvedRequirement[] {
  const catalog = loadRegistry(root)

  return [
    ...(invocation.requirements?.validation_requirements ?? []),
    ...(invocation.requirements?.automation_requirements ?? []),
  ].filter((item) => {
    if (
      (item.phase !== 'pre_submit' && item.phase !== 'before_operation') ||
      item.enforcement === 'advisory'
    ) {
      return false
    }

    const entry = catalog.entries.get(item.registry_id)

    return entry?.deterministic === true && entry.side_effect_free === true
  })
}

function runAgentPreSubmitValidators(
  root: string,
  runId: string,
  invocation: Record<string, unknown>,
  requirements: ResolvedRequirement[],
  filePath: string,
  submittedValue: Record<string, unknown>,
): Array<{
  requirement: ResolvedRequirement
  result: ReturnType<typeof runRequirement>
}> {
  const catalog = loadRegistry(root)
  const stageSlug =
    isRecord(invocation.stage) && typeof invocation.stage.slug === 'string'
      ? invocation.stage.slug
      : ''
  const declaredOutputPath =
    isRecord(invocation.output) && typeof invocation.output.path === 'string'
      ? invocation.output.path
      : null

  return requirements.flatMap((requirement) => {
    const entry = catalog.entries.get(requirement.registry_id)

    if (!entry) {
      return []
    }

    if (requirement.registry_id.includes('ASSESSMENT')) {
      return []
    }

    if (!registryAppliesToStage(requirement.registry_id, stageSlug)) {
      return []
    }

    const resolvedTargetPath = resolveRequirementTargetPath(
      requirement,
      filePath,
      {
        ...submittedValue,
        ...(isRecord(invocation.output) &&
        isRecord(invocation.output.artifact_targets)
          ? { artifact_targets: invocation.output.artifact_targets }
          : {}),
      },
    )
    const targetPath =
      resolvedTargetPath === declaredOutputPath ? filePath : resolvedTargetPath

    if (!targetPath) {
      return [
        {
          requirement,
          result: {
            schema_version: 1 as const,
            requirement_id: requirement.requirement_id,
            policy_id: requirement.policy_id,
            registry_id: requirement.registry_id,
            registry_version: requirement.registry_version,
            handler: 'unresolved-target',
            command: `pan output validate --registry ${requirement.registry_id}`,
            target_path: requirement.target,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            exit_code: 1,
            status: 'failed' as const,
            executor: 'agent' as const,
            issues: [
              {
                code: 'target.unresolved',
                message: `Could not resolve target ${requirement.target}`,
              },
            ],
            evidence_paths: [],
          },
        },
      ]
    }

    const targetKind = inferTargetKind(targetPath)

    if (!entry.target_types.includes(targetKind)) {
      return []
    }

    return [
      {
        requirement,
        result: runRequirement({
          root,
          runId,
          requirement,
          targetPath,
          executor: 'agent',
          invocation,
          runState: getRunState(root, runId) as unknown as Record<
            string,
            unknown
          >,
          catalog,
          persist: true,
        }),
      },
    ]
  })
}

async function main(): Promise<void> {
  const root = findProjectRoot()
  const help = helpText(root)
  const pan = panCommand(root)
  const rawArgs = process.argv.slice(2)

  // The refusal runs on the assembled argument list, before dispatch, so an
  // oversized value fails with a named error rather than after run resolution.
  assertArgvElementsWithinLimit(rawArgs)

  const [command = 'help', ...args] = rawArgs
  const json = hasFlag(args, '--json')

  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    print(help)
    return
  }

  assertWorktreeOptionSupported(command, args)

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      print(help)
      return
    case 'init': {
      const workspace = option(args, '--workspace')

      if (workspace && hasFlag(args, '--worktree')) {
        throw new PanError(
          '--workspace and --worktree cannot be used together.',
          { code: 'INVALID_ARGUMENT' },
        )
      }

      if (hasFlag(args, '--autostart') && hasFlag(args, '--no-autostart')) {
        throw new PanError(
          '--autostart and --no-autostart cannot be used together.',
          { code: 'INVALID_ARGUMENT' },
        )
      }

      const title = option(args, '--title')
      const worktreeWorkspace = sharedWorktreeWorkspace(root, args, title)
      // Routing on ratification is the planning default. `--autostart` is
      // kept as an explicit spelling of that default; `--no-autostart` is the
      // opt-out that stops the run at the ratified plan.
      const autostartDelivery = hasFlag(args, '--no-autostart')
        ? false
        : hasFlag(args, '--autostart')
          ? true
          : undefined
      const state = createRun(root, {
        workflowSlug:
          option(args, '--workflow', DEFAULT_WORKFLOW_SLUG) ??
          DEFAULT_WORKFLOW_SLUG,
        requestPath: option(args, '--request'),
        title,
        workspace: worktreeWorkspace ? worktreeWorkspace.path : workspace,
        worktree: worktreeWorkspace,
        gatesPath: option(args, '--gates'),
        involvement: option(args, '--involvement'),
        verification: option(args, '--verification'),
        design: hasFlag(args, '--with-design'),
        operatorArtifacts: hasFlag(args, '--operator-artifacts'),
        contextReferencePath: option(args, '--context-reference'),
        autostartDelivery,
        autostartMaxParallel: integerOption(args, '--max-parallel'),
      })

      print({
        status: 'created',
        run_id: state.run_id,
        workflow: state.workflow_slug,
        workspace_root: state.workspace_root,
        managed_worktree: state.managed_worktree ?? null,
        pipeline_config: state.pipeline_config?.name,
        involvement_profile: state.operator_involvement?.profile,
        run_contracts: state.operator_involvement?.contracts ?? [],
        applied_gates: state.operator_involvement?.applied_gates ?? {},
        verification_level: state.verification?.level,
        design_composition: state.design_composition === true,
        operator_artifacts: state.operator_artifacts,
        context_reference: state.request.context_reference ?? null,
        autostart_delivery: state.autostart_delivery ?? false,
        next_command: `${pan} prepare ${state.run_id}`,
        state_path: resolveRunLayout(root, state.run_id).state.relative,
      })
      return
    }
    case 'prepare': {
      const runId = requiredArgument(args[0], 'run-id')
      const agent = option(args, '--agent')

      assertRunWorktreeBinding(root, runId, args)

      // Refuse an unusable label before the run advances, so a prepare either
      // writes delivery-ready evidence or changes nothing.
      if (agent !== null) {
        assertDelegationAgentName(agent)
      }

      const result = prepareInvocation(root, runId, {
        operatorArtifacts: hasFlag(args, '--operator-artifacts'),
        ...(agent !== null ? { agent } : {}),
        onProgress: (message) =>
          process.stderr.write(`[pan next:${runId}] ${message}\n`),
      })

      if (!result.invocation) {
        print({
          status: result.state.status,
          reason: result.state.pause_reason,
          decision_path: result.state.last_decision_path,
          advisories: result.advisories,
        })
        return
      }

      // The ordered launches this stage owes. A verify stage owes its
      // evidence workers before the consolidating worker that reads them.
      const workerActions = orderedWorkerActions(result.invocation)

      print({
        status: 'ready',
        run_id: runId,
        stage: result.invocation.stage.slug,
        persona: result.invocation.stage.persona,
        model: result.invocation.stage.model,
        model_config: result.invocation.stage.model_config,
        invocation_json: result.state.current_invocation?.json_path,
        invocation_markdown: result.state.current_invocation?.markdown_path,
        expected_output: result.state.current_invocation?.output_path,
        ...(workerActions.length > 0 ? { worker_actions: workerActions } : {}),
        ...(result.prepared_delegation
          ? { prepared_delegation: result.prepared_delegation }
          : {}),
        ...(result.prepared_evidence
          ? { prepared_evidence: result.prepared_evidence }
          : {}),
        advisories: result.advisories,
      })
      return
    }
    case 'delegate': {
      const runId = requiredArgument(args[0], 'run-id')
      const timeoutValue = option(args, '--timeout-ms')
      let timeoutMs: number | undefined

      if (timeoutValue !== null) {
        const parsedTimeout = Number(timeoutValue)

        if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1_000) {
          throw new PanError(
            '--timeout-ms MUST be an integer of at least 1000.',
            { code: 'INVALID_ARGUMENT' },
          )
        }

        timeoutMs = parsedTimeout
      }

      const result = delegateInvocation(root, runId, {
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        onProgress: (message) =>
          process.stderr.write(`[pan delegate:${runId}] ${message}\n`),
      })

      if (!result.execution) {
        print({
          status: result.state.status,
          reason: result.state.pause_reason,
          decision_path: result.state.last_decision_path,
        })
        return
      }

      print({
        status: 'delegated',
        run_id: runId,
        stage: result.invocation?.stage.slug,
        persona: result.invocation?.stage.persona,
        executor: result.execution.executor,
        delegation_kind: result.execution.delegation_kind,
        session_id: result.execution.session_id ?? null,
        exit_code: result.execution.exit_code,
        duration_ms: result.execution.duration_ms,
        execution_record: delegationExecutionPath(
          runId,
          result.execution.invocation_id,
          root,
        ),
        expected_output: result.state.current_invocation?.output_path,
        next_command: `${pan} submit ${runId} ${result.state.current_invocation?.output_path ?? '<output-json>'}`,
      })
      return
    }
    case 'submit': {
      const runId = requiredArgument(args[0], 'run-id')
      const outputPath = requiredArgument(args[1], 'output-json')

      assertRunWorktreeBinding(root, runId, args)

      process.stderr.write(
        `[pan submit:${runId}] validating stage output, brief, and repository checks...\n`,
      )
      const result = submitOutput(root, runId, outputPath, {
        onProgress: (message) =>
          process.stderr.write(`[pan submit:${runId}] ${message}\n`),
      })
      process.stderr.write(`[pan submit:${runId}] validation complete.\n`)

      // The hook runs after the submission is durable and outside the run
      // mutex, so the integration takes its own mutexes and a failed advance
      // cannot roll back the recorded stage result.
      const advance = maybeAdvanceCohort(root, result.state)

      print({
        status: result.state.status,
        outcome: result.record.outcome,
        stage: result.record.stage.slug,
        operator_brief_html:
          result.record.artifacts.find((artifact) =>
            artifact.path.endsWith('.html'),
          )?.path ?? null,
        next_stage: result.state.current_stage,
        pending_action: result.state.pending_action,
        advisories: result.advisories.map((advisory) => advisory.message),
        ...(advance ? { advance } : {}),
      })
      return
    }
    case 'assess': {
      const runId = requiredArgument(args[0], 'run-id')
      const assessmentPath = requiredArgument(args[1], 'assessment-json')
      const result = assessStage(root, runId, assessmentPath)
      const advance = maybeAdvanceCohort(root, result.state)

      print({
        status: result.state.status,
        verdict: result.assessment.verdict,
        next_stage: result.state.current_stage,
        pending_action: result.state.pending_action,
        ...(advance ? { advance } : {}),
      })
      return
    }
    case 'decide': {
      const runId = requiredArgument(args[0], 'run-id')
      const decision = requiredArgument(args[1], 'decision')
      const state = decideRun(
        root,
        runId,
        decision,
        noteOption(root, args, '') ?? '',
        option(args, '--stage'),
      )

      // The hook runs after the decision is durable and outside the run mutex,
      // so delivery run creation takes its own mutexes and a routing failure
      // cannot roll back the recorded approval.
      const autostart = maybeStartDelivery(
        root,
        state,
        { actor: 'operator', action: decision },
        deliveryRouteOptions(args),
      )
      // The same shape for the cohort side: a decision that closed the last
      // unit run of a group integrates that group and starts the next one.
      const advance = maybeAdvanceCohort(root, state)

      print({
        status: state.status,
        decision,
        next_stage: state.current_stage,
        operator_revisions: state.operator_revisions ?? {},
        pending_action: state.pending_action,
        ...(autostart ? { autostart } : {}),
        ...(advance ? { advance } : {}),
      })
      return
    }
    case 'involvement': {
      const file = loadOperatorInvolvementFile(root)

      print(
        {
          active: file.active,
          profiles: Object.fromEntries(
            Object.entries(file.profiles).map(([name, profile]) => [
              name,
              {
                summary: profile.summary,
                gates: profile.gates ?? {},
                contracts: profile.contracts ?? [],
                away_mode: profile.away_mode ?? null,
              },
            ]),
          ),
        },
        true,
      )
      return
    }
    case 'verification': {
      const runId = args[0] && !args[0].startsWith('--') ? args[0] : null

      if (!runId) {
        const file = loadVerificationFile(root)

        print(
          {
            active: file.active,
            levels: Object.fromEntries(
              Object.entries(file.levels).map(([name, level]) => [
                name,
                { summary: level.summary, gates: level.gates },
              ]),
            ),
          },
          true,
        )
        return
      }

      if (args[1] === 'set') {
        const level = requiredArgument(args[2], 'level')
        const state = setRunVerification(
          root,
          runId,
          level,
          option(args, '--note', '') ?? '',
          { confirmed: hasFlag(args, '--confirm') },
        )

        print({
          status: 'updated',
          run_id: runId,
          verification_level: state.verification?.level,
          gates: state.verification?.gates ?? {},
          next_command: `${pan} resume ${runId}`,
        })
        return
      }

      const state = getRunState(root, runId)

      print(
        {
          run_id: runId,
          verification_level: state.verification?.level ?? null,
          summary: state.verification?.summary ?? null,
          gates: state.verification?.gates ?? {},
        },
        true,
      )
      return
    }
    case 'pause': {
      const runId = requiredArgument(args[0], 'run-id')
      const actor = option(args, '--actor', 'operator')

      if (actor !== 'operator' && actor !== 'supervisor') {
        throw new PanError(
          `--actor MUST be 'operator' or 'supervisor', not '${actor}'.`,
          { code: 'INVALID_ARGUMENT' },
        )
      }

      const state = pauseRun(root, runId, noteOption(root, args, '') ?? '', {
        actor,
      })

      print({
        status: state.status,
        current_stage: state.current_stage,
        pause_reason: state.pause_reason,
        pending_action: state.pending_action,
        actor: state.operator_pause?.actor ?? actor,
        decision_path: state.last_decision_path,
      })
      return
    }
    case 'attribute': {
      const runId = requiredArgument(args[0], 'run-id')
      const directive = option(args, '--note')

      if (!directive) {
        throw new PanError('--note is required for attribute.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      const role = option(args, '--role', 'supervisor')

      if (role !== 'supervisor' && role !== 'operator') {
        throw new PanError('--role MUST be supervisor or operator.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      const disposition = option(
        args,
        '--disposition',
        DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION,
      )

      if (!isWorkspaceAttributionDisposition(disposition)) {
        throw new PanError(
          `--disposition MUST be one of ${WORKSPACE_ATTRIBUTION_DISPOSITIONS.join(', ')}.`,
          { code: 'INVALID_ARGUMENT' },
        )
      }

      const paths = option(args, '--paths')
      const record = recordWorkspaceDirective(root, runId, {
        directive,
        actingRole: role,
        disposition,
        ...(paths ? { paths: paths.split(',') } : {}),
      })

      print({
        directive_id: record.directive_id,
        acting_role: record.acting_role,
        disposition: record.disposition,
        changed_paths: record.changed_paths,
        artifact_path: record.artifact_path,
      })
      return
    }
    case 'resume': {
      const runId = requiredArgument(args[0], 'run-id')

      assertRunWorktreeBinding(root, runId, args)

      const state = resumeRun(
        root,
        runId,
        option(args, '--stage'),
        noteOption(root, args, '') ?? '',
      )

      print({
        status: state.status,
        current_stage: state.current_stage,
        next_command: `${pan} prepare ${runId}`,
      })
      return
    }
    case 'set-stage': {
      const runId = requiredArgument(args[0], 'run-id')
      const stage = option(args, '--stage')
      const note = noteOption(root, args)

      if (!stage) {
        throw new PanError('--stage is required for set-stage.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      if (!note || note.trim().length === 0) {
        throw new PanError('--note or --note-file is required for set-stage.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      const state = setRunStage(root, runId, stage, note, {
        abandonWorkers: hasFlag(args, '--abandon-workers'),
      })

      print({
        status: state.status,
        current_stage: state.current_stage,
        pending_action: state.pending_action,
        next_command: `${pan} prepare ${runId}`,
      })
      return
    }
    case 'waive-gate': {
      const runId = requiredArgument(args[0], 'run-id')
      const criteria = commaSeparatedOption(args, '--criteria') ?? []
      const note = noteOption(root, args)

      if (!note || note.trim().length === 0) {
        throw new PanError(
          '--note or --note-file is required for waive-gate.',
          { code: 'INVALID_ARGUMENT' },
        )
      }

      const result = waiveGate(root, runId, {
        stageSlug: option(args, '--stage'),
        targetStage: option(args, '--to'),
        criterionIds: criteria,
        note,
        deferredAcceptanceCriteria: commaSeparatedOption(args, '--defer') ?? [],
        createSpotfixCase: hasFlag(args, '--spotfix'),
        adoptPlanFromRunId: option(args, '--adopt-plan-from'),
      })

      print({
        status: result.state.status,
        current_stage: result.state.current_stage,
        pending_action: result.state.pending_action,
        waiver_id: result.waiver.waiver_id,
        waiver_artifact: result.waiver.artifact_path,
        directive_target: result.waiver.directive_target ?? null,
        spotfix_case: result.waiver.spotfix_case_path ?? null,
        entry_gates_reached: result.entry_gates_reached,
        worktree_claim_transfer: result.claimTransfer ?? null,
      })
      return
    }
    case 'abort': {
      const runId = requiredArgument(args[0], 'run-id')
      const state = abortRun(root, runId, option(args, '--note', '') ?? '')

      print({
        status: state.status,
        run_id: runId,
        // Work the run is leaving uncommitted belongs to nobody once the run
        // is terminal, so the command that ends it says what it left.
        ...(state.dirty_exit ? { dirty_exit: state.dirty_exit } : {}),
      })
      return
    }
    case 'hypervisor': {
      const subcommand = requiredArgument(args[0], 'hypervisor subcommand')

      if (subcommand === 'start') {
        print(
          startHypervisorProcess(
            root,
            requiredArgument(process.argv[1], 'CLI path'),
          ),
          json,
        )
        return
      }

      if (subcommand === 'run') {
        await runHypervisorDaemon(root, () => {
          runHypervisorCycle(root)
        })
        return
      }

      if (subcommand === 'tick') {
        print(runHypervisorCycle(root), json)
        return
      }

      if (subcommand === 'status') {
        print(hypervisorProcessStatus(root), json)
        return
      }

      if (subcommand === 'stop') {
        print(stopHypervisorProcess(root), json)
        return
      }

      throw new PanError(`Unknown hypervisor subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'away': {
      const subcommand = requiredArgument(args[0], 'away subcommand')
      const runId = requiredArgument(args[1], 'run-id')
      const rejected = unknownAwayOption(subcommand, args)

      if (rejected) {
        throw new PanError(
          `Unknown option for 'pan away ${subcommand}': ${rejected}. ` +
            `Accepted: ${(AWAY_SUBCOMMAND_OPTIONS[subcommand] ?? []).join(', ')}.`,
          { code: 'UNKNOWN_OPTION' },
        )
      }

      const state = getRunState(root, runId)
      const blocker = awayModeTrigger(state, undefined, root)

      if (subcommand === 'status') {
        const runDecisions = readAwayDecisionLedger(root).filter(
          (record) => record.run_id === runId,
        )
        const appliedIds = new Set(
          runDecisions
            .filter((record) => record.result === 'applied')
            .map((record) => record.linked_decision_id)
            .filter((value): value is string => typeof value === 'string'),
        )

        print(
          {
            run_id: runId,
            enabled: state.away_mode?.enabled ?? false,
            blocker,
            decisions: runDecisions.length,
            // The exact ids `pan away apply --decision` accepts, so the
            // supervisor never has to guess between the ledger id and a
            // mirrored run-local decision packet id.
            apply_ready_decision_ids: runDecisions
              .filter(
                (record) =>
                  record.result === 'accepted' &&
                  !appliedIds.has(record.decision_id),
              )
              .map((record) => record.decision_id),
          },
          json,
        )
        return
      }

      if (subcommand === 'evaluate') {
        if (!blocker) {
          throw new PanError(
            'The run has no blocker that away mode can evaluate.',
            { code: 'AWAY_TRIGGER_UNAVAILABLE' },
          )
        }

        print(evaluateAwayState(root, state, blocker), json)
        return
      }

      if (subcommand === 'apply') {
        const decisionId = requiredArgument(
          option(args, '--decision'),
          '--decision',
        )
        const ledger = readAwayDecisionLedger(root)
        const decision = ledger.find(
          (record) =>
            record.run_id === runId &&
            record.decision_id === decisionId &&
            record.result === 'accepted',
        )

        if (!decision) {
          const applied = new Set(
            ledger
              .filter(
                (record) =>
                  record.run_id === runId && record.result === 'applied',
              )
              .map((record) => record.linked_decision_id)
              .filter((value): value is string => typeof value === 'string'),
          )
          const applyReady = ledger
            .filter(
              (record) =>
                record.run_id === runId &&
                record.result === 'accepted' &&
                !applied.has(record.decision_id),
            )
            .map((record) => record.decision_id)
          const inLedger = ledger.find(
            (record) => record.decision_id === decisionId,
          )
          // A wrong id is almost always the mirrored run-local decision
          // packet under agent/decisions/. Name the canonical namespace and
          // the ids it would accept, so the caller needs no source dive.
          const detail = inLedger
            ? `The id exists in the ledger but is not an accepted decision for run ${runId} (result: ${inLedger.result}, run: ${inLedger.run_id}).`
            : `The id is not in the away decision ledger at ${awayDecisionLedgerPath(root)}; run-local agent/decisions/ packet ids are not apply ids.`

          throw new PanError(
            `Accepted away decision not found: ${decisionId}. ${detail}` +
              (applyReady.length
                ? ` Apply-ready decision ids for this run: ${applyReady.join(', ')}.`
                : ` No accepted, unapplied decisions exist for this run; run 'pan away evaluate' first.`),
            { code: 'AWAY_DECISION_NOT_FOUND' },
          )
        }

        // Only a successful apply consumes the decision. A failed apply leaves
        // its own ledger record and the decision stays apply-ready, so the
        // supervisor can retry once the cause is repaired instead of spending
        // another evaluation on the same gate.
        if (
          ledger.some(
            (record) =>
              record.run_id === runId &&
              record.linked_decision_id === decisionId &&
              record.result === 'applied',
          )
        ) {
          throw new PanError(
            `Away decision was already applied: ${decisionId}`,
            { code: 'AWAY_DECISION_ALREADY_APPLIED' },
          )
        }

        // The refusal comes before the apply, so a mismatched --action leaves
        // the decision apply-ready rather than spending it on a failure.
        const action = resolveAwayApplyAction(
          decision,
          option(args, '--action'),
        )
        let next: RunState
        let record: AwayDecisionRecord

        try {
          next = applyAwayDecision(root, state, decision)
          record = recordAwayApplyResult(
            root,
            decision,
            'applied',
            undefined,
            action,
          )
        } catch (error) {
          recordAwayApplyResult(root, decision, 'failed', errorMessage(error))
          throw error
        }

        // Same hook as `pan decide`: it runs after the applied decision is
        // durable and outside the try above, so a routing failure neither rolls
        // back the approval nor records a `failed` beside the `applied`.
        const autostart = maybeStartDelivery(root, next, {
          actor: 'away',
          action: decision.selected_action?.action ?? '',
        })
        const advance = maybeAdvanceCohort(root, next)

        print(
          {
            state: next,
            decision: record,
            ...(autostart ? { autostart } : {}),
            ...(advance ? { advance } : {}),
          },
          json,
        )
        return
      }

      throw new PanError(`Unknown away subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'technologies': {
      const subcommand = requiredArgument(args[0], 'technologies subcommand')

      if (subcommand !== 'detect') {
        throw new PanError(`Unknown technologies subcommand: ${subcommand}`, {
          code: 'UNKNOWN_COMMAND',
        })
      }

      const worktreeWorkspace = sharedWorktreeWorkspace(root, args)

      print(
        detectWorkspaceTechnologies(
          root,
          worktreeWorkspace ? { workspace: worktreeWorkspace.path } : {},
        ),
        true,
      )
      return
    }
    case 'conform': {
      const subcommand = requiredArgument(args[0], 'conform subcommand')
      const asJson = hasFlag(args, '--json')
      const sinceRef = option(args, '--since')
      const all = hasFlag(args, '--all')

      const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
      const workspaceRoot = path.resolve(
        root,
        worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
      )

      function formatResultFiles(
        files: Array<{
          editable: boolean
          exists: boolean
          relative_path: string
          issues: Array<{ code: string }>
        }>,
      ): string {
        if (files.length === 0) {
          return 'No eligible conform artifacts were selected.'
        }

        const lines = files.map((file) => {
          const scope = file.editable ? 'editable' : 'report-only'
          const existence = file.exists ? '' : ' (deleted)'
          const issueCount = file.issues.length
          const issueLabel =
            issueCount === 1 ? '1 issue' : `${issueCount} issues`

          return `- ${scope}: ${file.relative_path}${existence} — ${issueLabel}`
        })

        return lines.join('\n')
      }

      if (subcommand === 'scan') {
        const result = scanConformArtifacts(root, {
          workspace_root: workspaceRoot,
          since_ref: sinceRef,
          all,
        })

        print(
          asJson
            ? result
            : [
                `Conform scan: ${result.status}`,
                `Base: ${result.base}`,
                `Head: ${result.head}`,
                `Files: ${result.summary.files}`,
                '',
                formatResultFiles(result.files),
              ].join('\n'),
          asJson,
        )

        if (result.status !== 'passed') {
          process.exitCode = 1
        }

        return
      }

      if (subcommand === 'checkpoint') {
        const result = checkpointConformArtifacts(root, {
          workspace_root: workspaceRoot,
          since_ref: sinceRef,
          all,
        })

        print(
          asJson
            ? result
            : [
                `Conform checkpoint: ${result.status}`,
                `Head: ${result.head}`,
                `Checkpoint: ${result.checkpoint_path}`,
                `Wrote checkpoint: ${result.wrote_checkpoint ? 'yes' : 'no'}`,
                '',
                formatResultFiles(result.files),
              ].join('\n'),
          asJson,
        )

        if (result.status !== 'passed') {
          process.exitCode = 1
        }

        return
      }

      throw new PanError(`Unknown conform subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'style': {
      const subcommand = requiredArgument(args[0], 'style subcommand')
      const asJson = hasFlag(args, '--json')
      const sinceRef = option(args, '--since')
      const all = hasFlag(args, '--all')

      const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
      const workspaceRoot = path.resolve(
        root,
        worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
      )

      function formatStyleFiles(
        files: Array<{
          editable: boolean
          exists: boolean
          relative_path: string
          issues: Array<{ code: string }>
        }>,
      ): string {
        if (files.length === 0) {
          return 'No eligible style artifacts were selected.'
        }

        return files
          .map((file) => {
            const scope = file.editable ? 'editable' : 'report-only'
            const existence = file.exists ? '' : ' (deleted)'
            const issueCount = file.issues.length
            const issueLabel =
              issueCount === 1 ? '1 issue' : `${issueCount} issues`

            return `- ${scope}: ${file.relative_path}${existence} — ${issueLabel}`
          })
          .join('\n')
      }

      if (subcommand === 'scan') {
        const result = scanStyleArtifacts(root, {
          workspace_root: workspaceRoot,
          since_ref: sinceRef,
          all,
        })

        print(
          asJson
            ? result
            : [
                `Style scan: ${result.status}`,
                `Languages: ${result.languages.join(', ') || 'none detected'}`,
                `Base: ${result.base}`,
                `Head: ${result.head}`,
                `Files: ${result.summary.files}`,
                '',
                formatStyleFiles(result.files),
              ].join('\n'),
          asJson,
        )

        if (result.status !== 'passed') {
          process.exitCode = 1
        }

        return
      }

      if (subcommand === 'checkpoint') {
        const result = checkpointStyleArtifacts(root, {
          workspace_root: workspaceRoot,
          since_ref: sinceRef,
          all,
        })

        print(
          asJson
            ? result
            : [
                `Style checkpoint: ${result.status}`,
                `Head: ${result.head}`,
                `Checkpoint: ${result.checkpoint_path}`,
                `Wrote checkpoint: ${result.wrote_checkpoint ? 'yes' : 'no'}`,
                '',
                formatStyleFiles(result.files),
              ].join('\n'),
          asJson,
        )

        if (result.status !== 'passed') {
          process.exitCode = 1
        }

        return
      }

      throw new PanError(`Unknown style subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'repository-check': {
      const profile = requiredArgument(args[0], 'profile')

      if (profile === 'validate') {
        const config = assertRepositoryChecksValid(root)

        print(
          {
            status: 'valid',
            config_path: path
              .relative(root, repositoryChecksSourcePath(root))
              .split(path.sep)
              .join('/'),
            profiles: Object.keys(config.profiles).sort(),
          },
          hasFlag(args, '--json'),
        )
        return
      }

      const timeoutValue = option(args, '--timeout-ms')
      let timeoutMs: number | undefined

      if (timeoutValue !== null) {
        const parsedTimeout = Number(timeoutValue)

        if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1_000) {
          throw new PanError(
            '--timeout-ms MUST be an integer of at least 1000.',
            { code: 'INVALID_ARGUMENT' },
          )
        }

        timeoutMs = parsedTimeout
      }

      const workspaceOption = option(args, '--workspace')

      if (workspaceOption && hasFlag(args, '--worktree')) {
        throw new PanError(
          '--workspace and --worktree cannot be used together.',
          { code: 'INVALID_ARGUMENT' },
        )
      }

      // `--run` names the run the execution is evidence for, which a run
      // whose workspace is not a managed worktree (a release run in the base
      // checkout) cannot express through `--worktree`.
      const evidenceRunId = option(args, '--run')
      const evidenceRun = evidenceRunId
        ? getRunState(root, evidenceRunId)
        : null
      const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
      const checkWorkspace = worktreeWorkspace
        ? worktreeWorkspace.path
        : workspaceOption
          ? resolveWorkspacePathOrWorktree(root, workspaceOption)
          : evidenceRun
            ? path.resolve(root, evidenceRun.workspace_root)
            : null

      // The harness starts this command for itself when it prefetches the
      // release profile, and that execution is not an agent spending its
      // allowance. It also has no terminal to stream to.
      const harnessInitiated = hasFlag(args, '--harness-initiated')
      // Two evidence workers of one stage share an invocation id, so without
      // the role they would share one reuse key and the second worker would
      // be handed the first one's pass instead of producing its own log.
      const workerRole = option(args, '--role')
      const startedAt = new Date().toISOString()

      // DEV-001: a clean pass reaches a later gate only when the workspace
      // never moved, so the run is bracketed by the fingerprint the gate
      // itself would compare.
      const fingerprintBefore = gitWorkspaceSnapshot(
        repositoryCheckWorkspaceRoot(root, checkWorkspace ?? undefined),
      ).fingerprint
      // HR3-006: the run already paid for this profile at this fingerprint
      // under this invocation, and the ledger says so. Executing again buys
      // nothing, so the recorded pass answers the request. The harness
      // prefetch keeps executing: it exists to fill an empty cache.
      const forceRepeat = hasFlag(args, '--force-repeat')
      const reusable =
        evidenceRun && !forceRepeat && !harnessInitiated
          ? reusableProfileExecution(
              root,
              evidenceRun.run_id,
              evidenceRun.current_invocation?.id ?? null,
              profile,
              fingerprintBefore,
              workerRole,
            )
          : null

      if (reusable) {
        process.stderr.write(
          `[repository-check:${profile}] reusing the pass recorded at ` +
            `${reusable.started_at} for invocation ` +
            `${reusable.invocation_id ?? '(none)'}; pass --force-repeat to ` +
            'execute the profile again.\n',
        )
        print(
          {
            profile,
            status: 'passed',
            reused_execution: reusable,
          },
          hasFlag(args, '--json'),
        )
        return
      }

      // A pass this command stores is reused by a later gate instead of
      // re-running the suite, so the execution writes the same profile that
      // gate would have written. Only a named run has a place to put it.
      // One ordinal for both artifacts this execution owns, resolved before
      // the run so a second permitted execution at the same fingerprint
      // cannot be handed the first one's log name.
      const gatePassAttempt = evidenceRun
        ? nextAgentGatePassAttempt(
            root,
            evidenceRun.run_id,
            profile,
            fingerprintBefore,
          )
        : 1
      const gatePassSuiteProfile = evidenceRun
        ? agentGatePassSuiteProfile(
            root,
            evidenceRun.run_id,
            profile,
            fingerprintBefore,
            gatePassAttempt,
          )
        : null
      const result = await runRepositoryCheckStreaming(root, profile, {
        ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
        ...(checkWorkspace ? { workspace: checkWorkspace } : {}),
        env: {
          [FAST_WALL_SERIES_ROOT_ENV]: root,
          [FAST_WALL_PHASE_ENV]: FAST_WALL_AGENT_PHASE,
          ...(evidenceRun
            ? { [FAST_WALL_RUN_ID_ENV]: evidenceRun.run_id }
            : {}),
          ...(gatePassSuiteProfile
            ? { [TEST_PROFILE_ENV]: gatePassSuiteProfile.absolute }
            : {}),
        },
        ...(harnessInitiated
          ? {}
          : {
              on_start: (kind, commandText) => {
                process.stderr.write(
                  `[repository-check:${profile}] ${kind}: ${commandText}\n`,
                )
              },
              on_stdout: (chunk) => process.stderr.write(chunk),
              on_stderr: (chunk) => process.stderr.write(chunk),
            }),
      })

      if (result.status === 'not_configured') {
        process.stderr.write('PANCREATOR_CHECK_SKIPPED=1\n')
      }

      // A worker runs a profile inside its run's worktree, and the run is the
      // only place a supervisor can audit that execution from harness records.
      // An explicit run wins over the worktree scan. A bare invocation names
      // no run and records nothing: an operator's own check from the base
      // checkout is not evidence of any run that happens to share it.
      const initiator = harnessInitiated ? 'harness' : 'agent'
      // Only a clean pass can reach a gate, so the run lookup a store needs
      // is spent only when one is possible.
      const gatePassRunIds =
        result.status === 'passed'
          ? evidenceRun
            ? [evidenceRun.run_id]
            : worktreeWorkspace
              ? liveRunsBoundToWorktree(root, worktreeWorkspace.name).map(
                  (bound) => bound.run_id,
                )
              : []
          : []
      // The store resolves the log this execution owns, so it runs before the
      // ledger entry that must name that log.
      const gatePass = recordProfileGatePass(root, profile, result, {
        run_ids: gatePassRunIds,
        fingerprint_before: fingerprintBefore,
        started_at: startedAt,
        attempt: gatePassAttempt,
        initiator,
      })
      const runEvidence = evidenceRun
        ? recordAgentRepositoryCheckForRuns(
            root,
            [evidenceRun.run_id],
            result,
            startedAt,
            initiator,
            gatePass?.evidence_path ?? null,
            forceRepeat,
            workerRole,
          )
        : worktreeWorkspace
          ? recordAgentRepositoryCheck(
              root,
              worktreeWorkspace.name,
              result,
              startedAt,
              initiator,
            )
          : []

      print(
        {
          ...result,
          ...(runEvidence.length > 0
            ? { run_evidence_paths: runEvidence }
            : {}),
          ...(gatePass
            ? { gate_pass_evidence_path: gatePass.evidence_path }
            : {}),
        },
        hasFlag(args, '--json'),
      )

      if (result.status === 'failed') {
        process.exitCode = 1
      }
      return
    }
    case 'tests': {
      const sub = args[0]

      if (sub === 'benchmark') {
        const populationTolerance = integerOption(
          args,
          '--population-tolerance',
        )

        if (populationTolerance === null || populationTolerance < 0) {
          throw new PanError(
            '--population-tolerance is required and MUST be a non-negative integer.',
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const benchmark = runBenchmarkSession({
          root,
          baseline_workspace: requiredArgument(
            option(args, '--baseline-workspace'),
            '--baseline-workspace',
          ),
          candidate_workspace: requiredArgument(
            option(args, '--candidate-workspace'),
            '--candidate-workspace',
          ),
          population_tolerance: populationTolerance,
          ...(option(args, '--profile')
            ? { profile: option(args, '--profile') as string }
            : {}),
          ...(option(args, '--output')
            ? { output_path: option(args, '--output') as string }
            : {}),
        })

        print(benchmark, hasFlag(args, '--json'))

        if (benchmark.record.comparison.status === 'refused') {
          process.exitCode = 1
        }
        return
      }

      if (sub === 'wall') {
        const report = buildFastWallReport(root)

        print(hasFlag(args, '--json') ? report : formatFastWallReport(report))

        if (report.status === 'failed') {
          process.exitCode = 1
        }
        return
      }

      if (sub === 'record-fast-wall') {
        const loadAverage = Number(
          requiredArgument(option(args, '--load-average'), '--load-average'),
        )
        const wrapperWall = Number(
          requiredArgument(
            option(args, '--wrapper-wall-ms'),
            '--wrapper-wall-ms',
          ),
        )

        appendFastWallRun({
          series_root: requiredArgument(
            option(args, '--series-root'),
            '--series-root',
          ),
          workspace_fingerprint: gitWorkspaceSnapshot(
            requiredArgument(
              option(args, '--workspace-root'),
              '--workspace-root',
            ),
          ).fingerprint,
          duration_record_path: requiredArgument(
            option(args, '--duration-record'),
            '--duration-record',
          ),
          worker_count:
            integerOption(args, '--worker-count') ??
            (() => {
              throw new PanError('--worker-count is required.', {
                code: 'INVALID_ARGUMENT',
              })
            })(),
          load_average: loadAverage,
          wrapper_wall_clock_ms: wrapperWall,
          invoker: requiredArgument(option(args, '--invoker'), '--invoker'),
          run_id:
            option(args, '--run-id') ??
            process.env[FAST_WALL_RUN_ID_ENV] ??
            'standalone',
          phase:
            option(args, '--phase') ??
            process.env[FAST_WALL_PHASE_ENV] ??
            FAST_WALL_STANDALONE_PHASE,
          exit_code:
            integerOption(args, '--exit-code') ??
            (() => {
              throw new PanError('--exit-code is required.', {
                code: 'INVALID_ARGUMENT',
              })
            })(),
        })
        return
      }

      if (sub === 'impacted') {
        const worktree = sharedWorktreeWorkspace(root, args)
        const impact = await runTestsImpacted(root, args.slice(1), {
          ...(worktree ? { workspace: path.resolve(root, worktree.path) } : {}),
        })

        process.exitCode = impact.exit_code
        return
      }

      throw new PanError(`Unknown tests subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'release': {
      const sub = requiredArgument(args[0], 'release subcommand')
      const worktreeName = requiredArgument(
        option(args, '--worktree'),
        '--worktree',
      )

      if (sub === 'sync') {
        const onto = option(args, '--onto')
        const result = syncLocalRelease(
          root,
          worktreeName,
          requiredArgument(option(args, '--message'), '--message'),
          option(args, '--run') ?? undefined,
          {
            ...(onto === null ? {} : { onto }),
            ...(hasFlag(args, '--no-rebase') ? { noRebase: true } : {}),
          },
        )

        print(result, hasFlag(args, '--json'))

        if (result.status === 'conflict') {
          process.exitCode = 1
        }

        return
      }

      if (sub === 'continue') {
        const result = continueLocalRelease(
          root,
          worktreeName,
          option(args, '--run') ?? undefined,
        )

        print(result, hasFlag(args, '--json'))

        if (result.status === 'conflict') {
          process.exitCode = 1
        }

        return
      }

      if (sub === 'finalize') {
        print(
          finalizeLocalRelease(
            root,
            worktreeName,
            requiredArgument(option(args, '--fetched-main'), '--fetched-main'),
            option(args, '--run') ?? undefined,
          ),
          hasFlag(args, '--json'),
        )
        return
      }

      if (sub === 'allocate') {
        print(
          allocateReleaseVersion(
            root,
            worktreeName,
            requiredArgument(option(args, '--bump'), '--bump'),
            { runId: option(args, '--run') },
          ),
          hasFlag(args, '--json'),
        )
        return
      }

      throw new PanError(`Unknown release subcommand: ${sub}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'tune': {
      const sub = args[0]
      const asJson = hasFlag(args, '--json')

      if (sub === 'prepare') {
        const baselineRef = option(args, '--baseline')
        const prepared = prepareTuneSession(root, {
          ...(baselineRef ? { baselineRef } : {}),
        })

        print({ status: 'prepared', ...prepared }, asJson)
        return
      }

      if (sub === 'finalize') {
        const sessionId = requiredArgument(
          option(args, '--session'),
          '--session',
        )
        const result = finalizePreparedTuneSession(root, sessionId)

        print({ status: 'finalized', ...result }, asJson)
        return
      }

      if (sub === 'validate-audit') {
        const result = validateAudit(root, {
          recordPath: requiredArgument(option(args, '--record'), '--record'),
          baselineRef: requiredArgument(
            option(args, '--baseline'),
            '--baseline',
          ),
          targetRef: requiredArgument(option(args, '--target'), '--target'),
          json: asJson,
        })

        print(
          { status: result.complete ? 'valid' : 'invalid', ...result },
          asJson,
        )

        if (!result.complete) {
          process.exitCode = 1
        }

        return
      }

      throw new PanError(`Unknown tune subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'worktree': {
      const sub = args[0]
      const rest = args.slice(1)
      const asJson = hasFlag(args, '--json')

      if (sub === 'create') {
        const worktree = createWorktree(
          root,
          requiredArgument(rest[0], 'worktree-name'),
          {
            from: option(args, '--from'),
            description: option(args, '--description'),
          },
        )

        print({ status: 'created', worktree }, asJson)
        return
      }

      if (sub === 'resolve') {
        const name = requiredArgument(rest[0], 'worktree-name')
        const created = !readWorktreeIndex(root).worktrees.some(
          (entry) => entry.name === name,
        )
        const worktree = resolveOrCreateWorktree(
          root,
          name,
          option(args, '--description') ?? `Worktree '${name}'`,
        )

        print({ status: 'resolved', created, worktree }, asJson)
        return
      }

      if (sub === 'list') {
        print({ status: 'listed', worktrees: listWorktrees(root) }, asJson)
        return
      }

      if (sub === 'remove') {
        const removed = removeWorktree(
          root,
          requiredArgument(rest[0], 'worktree-name'),
          {
            force: hasFlag(args, '--force'),
            deleteBranch: hasFlag(args, '--delete-branch'),
          },
        )

        print({ status: 'removed', worktree: removed }, asJson)
        return
      }

      if (sub === 'reconcile') {
        const result = reconcileWorktrees(
          root,
          {
            into: option(args, '--into'),
            into_branch: option(args, '--into-branch'),
          },
          repeatedOption(args, '--source'),
        )

        print(result, asJson)

        if (result.status === 'conflict') {
          process.exitCode = 1
        }
        return
      }

      throw new PanError(`Unknown worktree subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'status': {
      const runId = requiredArgument(args[0], 'run-id')
      const citation = option(args, '--resolve')

      if (citation !== null) {
        const resolution = resolveRunCitation(root, runId, citation)

        print(
          json
            ? resolution
            : resolution.path
              ? `${resolution.citation} resolves to ${resolution.path}.`
              : `${resolution.citation} resolves to ${resolution.resolved}, ` +
                'which names no file this run holds.',
          json,
        )
        return
      }

      if (hasFlag(args, '--redline')) {
        const record = writeRedlineRecord(
          root,
          runId,
          option(args, '--occasion') ?? 'session',
        )
        print(
          json
            ? record
            : `Platform-guidance redline recorded at ${record.record_path} ` +
                `(declaration ${record.declarations.length}).`,
          json,
        )
        return
      }

      print(getRunStatus(root, runId, { json }), json)
      return
    }
    case 'list':
      print(listRuns(root), true)
      return
    case 'installs': {
      const sub = args[0]

      if (sub === 'list') {
        print(describeInstallations(root), json)
        return
      }

      if (sub === 'archive') {
        print(
          archiveInstallationInboxItems(root, {
            installId: requiredPositional(args[1], 'install-id'),
            intakePath: requiredArgument(option(args, '--intake'), '--intake'),
            items: options(args, '--item'),
          }),
          json,
        )
        return
      }

      throw new PanError(`Unknown installs subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'inbox': {
      if (args[0] === 'restore') {
        const result = restoreInboxRequest(
          root,
          requiredPositional(args[1], 'inbox-file'),
        )

        print(
          {
            status: 'restored',
            ...result,
            next_command: `${pan} init --request ${result.to}`,
          },
          true,
        )
        return
      }

      const items = listInbox(root)

      if (json) {
        print(items, true)
      } else {
        print(renderInbox(items))
      }

      return
    }
    case 'archive': {
      const daysValue = option(args, '--days')
      const retentionDays = daysValue === null ? 7 : Number(daysValue)
      const hasComplete = hasFlag(args, '--complete')
      const hasCanceled = hasFlag(args, '--canceled')

      print(
        maintainWorkflowRuntime(root, {
          retentionDays,
          inboxArchive: {
            complete: hasComplete || !hasCanceled,
            canceled: hasCanceled,
          },
        }),
        hasFlag(args, '--json'),
      )
      return
    }
    case 'models': {
      const runId = option(args, '--run')
      const invocationId = option(args, '--invocation')

      if (args[0] === 'evidence') {
        const role = requiredArgument(option(args, '--role'), '--role')
        const effectiveModel = requiredArgument(
          option(args, '--effective-model'),
          '--effective-model',
        )
        const source = requiredArgument(option(args, '--source'), '--source')
        const requiredRunId = requiredArgument(runId, '--run')

        if (role === 'supervisor') {
          const recorded = recordSupervisorModelEvidence(
            root,
            requiredRunId,
            effectiveModel,
            source,
          )

          print(
            {
              ...recorded.evidence,
              advisories: recorded.advisories.map(
                (advisory) => advisory.message,
              ),
            },
            true,
          )
          return
        }

        print(
          recordInvocationModelEvidence(
            root,
            requiredRunId,
            requiredArgument(invocationId, '--invocation'),
            role,
            effectiveModel,
            source,
            requiredArgument(
              option(args, '--launch-handle'),
              '--launch-handle',
            ),
          ),
          true,
        )
        return
      }

      if (hasFlag(args, '--probe') && (runId || invocationId)) {
        const probeRunId = requiredArgument(runId, '--run')
        const probeInvocationId = requiredArgument(invocationId, '--invocation')

        // The detached child carries `--await-probe` and performs the live
        // call. Without it the command records the in-flight marker, starts
        // the child, and returns: only submission reads the answer, so no
        // worker launch waits for Cursor.
        if (hasFlag(args, '--await-probe')) {
          print(
            probeRunInvocationModel(root, probeRunId, probeInvocationId),
            true,
          )
          return
        }

        const started = startDetachedWorkerModelProbe(
          root,
          probeRunId,
          probeInvocationId,
        )

        print({ ...started.evidence, probe_pid: started.probe_pid }, true)
        return
      }

      // A tracked config.json replacement runs before loadPipelineConfig:
      // the point of the migration is to repair an effective map the normal
      // load would reject. Preservation is validated on the merged result
      // before any file mutation, so a failed migration changes nothing.
      const migrateFrom = option(args, '--migrate-from')
      let migration = null

      if (migrateFrom) {
        const previousPath = path.isAbsolute(migrateFrom)
          ? migrateFrom
          : path.join(root, migrateFrom)
        const trackedName = harnessConfigName(root)

        if (!trackedName) {
          throw new PanError('No config.json exists to migrate.', {
            code: 'INVALID_PIPELINE_CONFIG',
          })
        }

        const next = readJson(path.join(root, trackedName))
        const overridesName = localConfigName(root)
        const overridesPath = path.join(root, overridesName)
        const result = migratePipelineOverrides({
          previous: readJson(previousPath),
          next,
          overrides: fileExists(overridesPath) ? readJson(overridesPath) : null,
        })

        if (result.missing.length > 0) {
          throw new PanError(
            'Configuration replacement stopped before mutation: the ' +
              'effective model map still has empty mappings that the ' +
              `previous configuration cannot fill: ${result.missing.join(', ')}. ` +
              `Add them to ${overridesName} and rerun.`,
            { code: 'INVALID_PIPELINE_CONFIG' },
          )
        }

        // Grammar-validate the merged result before touching the overrides
        // file, so a malformed preservation never lands on disk.
        parsePipelineConfig(
          mergeConfigValues(next, result.overrides),
          trackedName,
        )

        if (result.changed) {
          writeJsonAtomic(overridesPath, result.overrides)
        }

        migration = {
          previous_path: migrateFrom,
          overrides_path: overridesName,
          preserved: result.preserved,
          overrides_written: result.changed,
        }
      }

      const syncRequested = hasFlag(args, '--sync')
      const force = hasFlag(args, '--force')

      if (force && !syncRequested) {
        throw new PanError('models --force requires --sync.', {
          code: 'INVALID_ARGUMENT',
        })
      }

      // A bare `pan models` is diagnosis, so it reports a stale catalog
      // instead of failing at config load. `--sync` writes projections, so it
      // keeps catalog validation unless `--force` waives it.
      const skipCatalog = force || !syncRequested
      const loaded = loadPipelineConfig(root, undefined, { skipCatalog })
      const modelCatalog = cursorCatalogStatus(
        root,
        pipelineConfigPersonaMappings(loaded.file),
      )
      const changes = syncCursorProjection(root, {
        write: syncRequested,
        skipCatalog,
        pipeline: loaded,
      })

      // Static validation proves each spec is well-formed for the catalog
      // snapshot; --probe proves what it launches today by spending one
      // minimal cursor-agent call per distinct spec and comparing the echoed
      // variant against the catalog's prediction.
      const probes = hasFlag(args, '--probe')
        ? await probeCursorModels(root, loaded.config.personas)
        : null

      print(
        {
          active_config: loaded.name,
          summary: loaded.config.summary,
          personas: loaded.config.personas,
          persona_executors: Object.fromEntries(
            Object.entries(loaded.config.personas).map(([persona, model]) => [
              persona,
              personaExecutorOf(model),
            ]),
          ),
          sync_requested: syncRequested,
          force,
          catalog_skipped: skipCatalog,
          cursor_model_catalog: modelCatalog,
          changed_projections: changes.filter((entry) => entry.changed),
          ...(migration ? { migration } : {}),
          ...(probes ? { probes } : {}),
        },
        true,
      )

      if (probes) {
        const failed = probes.filter((probe) => !probe.ok)

        if (failed.length > 0) {
          throw new PanError(
            `${failed.length} model spec(s) did not resolve to the ` +
              `expected variant on live Cursor: ` +
              failed
                .map(
                  (probe) =>
                    `'${probe.spec}' (${probe.personas.join(', ')}) → ` +
                    `${probe.resolved ?? `unresolvable: ${probe.error ?? 'unknown error'}`}` +
                    (probe.expected ? ` (expected '${probe.expected}')` : ''),
                )
                .join('; ') +
              `. Cursor silently falls back to the model's default variant ` +
              `on an unusable spec, so fix these before delegating.`,
            { code: 'UNRESOLVED_CURSOR_MODEL' },
          )
        }
      }
      return
    }
    case 'briefs': {
      const subcommand = requiredArgument(args[0], 'briefs-subcommand')

      if (subcommand === 'build') {
        const result = buildBriefSystem(root, {
          force: hasFlag(args, '--force'),
        })

        print(result, hasFlag(args, '--json'))
        return
      }

      if (subcommand === 'validate') {
        const result = validateBriefSystem(root)

        print(result, hasFlag(args, '--json'))

        if (result.status === 'failed') {
          process.exitCode = 1
        }
        return
      }

      if (subcommand === 'render') {
        const inputPath = requiredArgument(option(args, '--input'), '--input')
        const outputPath = requiredArgument(
          option(args, '--output'),
          '--output',
        )

        print(renderBrief(root, inputPath, outputPath), hasFlag(args, '--json'))
        return
      }

      if (subcommand === 'generate') {
        const runId = requiredArgument(option(args, '--run'), '--run')
        const result = generateOperatorArtifacts(root, {
          runId,
          stage: option(args, '--stage'),
          force: hasFlag(args, '--force'),
        })

        print(result, hasFlag(args, '--json'))
        return
      }

      throw new PanError(`Unknown briefs subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'validation-map': {
      print(buildValidationMap(root), hasFlag(args, '--json'))
      return
    }
    case 'author': {
      const sub = args[0]

      if (sub === 'apply') {
        const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
        const result = applyTargetAuthoringDraft(
          root,
          requiredArgument(option(args, '--input'), '--input'),
          {
            ...(worktreeWorkspace ? { workspace: worktreeWorkspace.path } : {}),
          },
        )

        print(result, hasFlag(args, '--json'))
        return
      }

      if (sub === 'validate') {
        const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
        const extensionId = option(args, '--extension')
        const result = validateTargetAuthoring(root, {
          ...(extensionId ? { extensionId } : {}),
          repair: true,
          ...(worktreeWorkspace ? { workspace: worktreeWorkspace.path } : {}),
        })
        const manifestSha256 = extensionId
          ? sha256(readTargetExtensionManifest(root, extensionId))
          : null

        print(
          {
            ...result,
            manifest_sha256: manifestSha256,
          },
          hasFlag(args, '--json'),
        )

        if (!result.ok) {
          process.exitCode = 1
        }
        return
      }

      throw new PanError(`Unknown author subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'governance': {
      const sub = args[0]

      if (sub === 'audit-directives') {
        print(auditDirectives(root), hasFlag(args, '--json'))
        return
      }

      if (sub === 'card' && option(args, '--mode') === 'supervisor') {
        const card = buildSupervisorCard(
          root,
          requiredArgument(option(args, '--run'), '--run'),
        )

        print({
          status: 'ready',
          mode: 'supervisor',
          run_id: card.run_id,
          card_path: card.path,
          sha256: card.sha256,
          attested: card.attested,
          attest_command: card.attest_command,
          policies: card.policies,
        })
        return
      }

      if (sub === 'attest-supervisor') {
        const runId = requiredArgument(args[1], 'run-id')
        const card = attestSupervisorCard(
          root,
          runId,
          requiredArgument(option(args, '--sha256'), '--sha256'),
        )

        print({
          status: 'attested',
          run_id: runId,
          card_path: card.path,
          sha256: card.sha256,
          attested_at: card.attested_at,
          session_generation: card.session_generation,
          next_command: `${pan} status ${runId} --redline --occasion <pan-start|pan-resume>`,
          then: `${pan} prepare ${runId}`,
        })
        return
      }

      if (sub === 'card') {
        const card = buildGovernanceCard(root, {
          mode: requiredArgument(option(args, '--mode'), '--mode'),
          extensionId: option(args, '--extension'),
          requestPath: option(args, '--request'),
          outputPath: option(args, '--out'),
          worktreeName: option(args, '--worktree'),
          baseRef: option(args, '--base'),
          targetRef: option(args, '--target'),
          closureRevision: option(args, '--closure-revision'),
          dimensions: commaSeparatedOption(
            args,
            '--dimensions',
            availableReviewDimensions(root).map((dimension) => dimension.slug),
          ),
          contracts: option(args, '--horizon')
            ? loadHorizonSession(root, option(args, '--horizon') as string)
                .contracts
            : undefined,
        })

        print({
          status: 'ready',
          mode: card.mode,
          card_path: card.path,
          ...(card.review_dimensions
            ? { review_dimensions: card.review_dimensions }
            : {}),
          ...(card.worktree
            ? {
                worktree: card.worktree.name,
                workspace_root: card.worktree.path,
              }
            : {}),
          policies: card.policies.map((policy) => policy.id),
          agent_requirements: [
            ...card.requirements.automation_requirements,
            ...card.requirements.validation_requirements,
          ]
            .filter((requirement) => requirement.executor !== 'harness')
            .map((requirement) => requirement.registry_id),
        })
        return
      }

      if (sub === 'review-scope') {
        const scope = resolveReviewScope(root, workspaceRepositoryRoot(root), {
          head: requiredArgument(option(args, '--target'), '--target'),
          base: option(args, '--base'),
          defaultBranch: option(args, '--default-branch'),
          closureRevision: option(args, '--closure-revision'),
        })

        const tiers = conflictsByTier(scope.conflicts)

        print({
          base: scope.base,
          head: scope.head,
          closure_tracking: scope.closure_tracking,
          closure_revision: scope.closure_revision,
          changed_path_count: scope.changed_paths.length,
          independent: scope.independent,
          clean: scope.clean,
          conflicts: {
            instrument: tiers.instrument,
            conduct: tiers.conduct,
            substrate: tiers.substrate,
          },
          standards_delta: scope.standards_delta,
        })
        return
      }

      throw new PanError(
        `Unknown governance subcommand: ${sub ?? '(missing)'}`,
        {
          code: 'UNKNOWN_COMMAND',
        },
      )
    }
    case 'best-of-n': {
      const sub = args[0]
      const rest = args.slice(1)
      const asJson = hasFlag(args, '--json')

      if (sub === 'init') {
        const state = initBestOfN(root, {
          requestPath: requiredArgument(option(args, '--request'), '--request'),
          configsPath: requiredArgument(option(args, '--configs'), '--configs'),
          ...(option(args, '--workflow')
            ? { candidateWorkflow: option(args, '--workflow') as string }
            : {}),
          ...(option(args, '--consolidation-workflow')
            ? {
                consolidationWorkflow: option(
                  args,
                  '--consolidation-workflow',
                ) as string,
              }
            : {}),
          operatorArtifacts: hasFlag(args, '--operator-artifacts'),
        })

        print(
          {
            status: 'created',
            bon_id: state.bon_id,
            candidate_workflow: state.candidate_workflow,
            candidates: state.candidates.map((candidate) => ({
              slot: candidate.slot,
              run_id: candidate.run_id,
              worktree_path: candidate.worktree_path,
            })),
            state_path: `runtime/logs/best-of-n/${state.bon_id}/state.json`,
          },
          asJson,
        )
        return
      }

      if (sub === 'status') {
        print(bestOfNStatus(root, requiredArgument(rest[0], 'bon-id')), asJson)
        return
      }

      if (sub === 'refresh-agents') {
        print(
          refreshBestOfNAgents(root, requiredArgument(rest[0], 'bon-id')),
          asJson,
        )
        return
      }

      if (sub === 'abandon') {
        const state = abandonBestOfNCandidate(
          root,
          requiredArgument(rest[0], 'bon-id'),
          requiredArgument(rest[1], 'run-id'),
          requiredArgument(option(args, '--note'), '--note'),
        )

        print({ status: 'abandoned', candidates: state.candidates }, asJson)
        return
      }

      if (sub === 'consolidate') {
        const state = consolidateBestOfN(
          root,
          requiredArgument(rest[0], 'bon-id'),
        )

        print(
          {
            status: 'created',
            bon_id: state.bon_id,
            consolidation: state.consolidation,
            next_command: `${pan} status ${state.consolidation?.run_id}`,
          },
          asJson,
        )
        return
      }

      if (sub === 'clean') {
        print(
          cleanBestOfN(root, requiredArgument(rest[0], 'bon-id'), {
            force: hasFlag(args, '--force'),
          }),
          asJson,
        )
        return
      }

      if (sub === 'prune') {
        print(pruneBestOfN(root, { force: hasFlag(args, '--force') }), asJson)
        return
      }

      throw new PanError(
        `Unknown best-of-n subcommand: ${sub ?? '(missing)'}`,
        {
          code: 'UNKNOWN_COMMAND',
        },
      )
    }
    case 'schedule': {
      const sub = args[0]
      const rest = args.slice(1)
      const asJson = hasFlag(args, '--json')

      if (sub === 'list') {
        print(resolveScheduleConfig(root), asJson)
        return
      }

      if (sub === 'status') {
        print(scheduleStatus(root), asJson)
        return
      }

      if (sub === 'tick') {
        print(scheduleTick(root), asJson)
        return
      }

      if (sub === 'run') {
        print(
          runScheduledJob(root, requiredPositional(rest[0], 'job-id')),
          asJson,
        )
        return
      }

      if (sub === 'validate') {
        print(validateSchedule(root), asJson)
        return
      }

      if (sub === 'install-agent') {
        print(installScheduleAgent(root), asJson)
        return
      }

      if (sub === 'uninstall-agent') {
        print(uninstallScheduleAgent(root), asJson)
        return
      }

      throw new PanError(`Unknown schedule subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'horizon': {
      const sub = args[0]
      const rest = args.slice(1)
      const asJson = hasFlag(args, '--json')

      if (sub === 'init') {
        print(
          initHorizonSession(
            root,
            requiredArgument(option(args, '--queue'), '--queue'),
            {
              ...(option(args, '--session')
                ? { sessionId: option(args, '--session') as string }
                : {}),
              ...(option(args, '--involvement')
                ? { involvement: option(args, '--involvement') as string }
                : {}),
              ...(option(args, '--worktree')
                ? { worktree: option(args, '--worktree') as string }
                : {}),
            },
          ),
          asJson,
        )
        return
      }

      if (sub === 'add') {
        const taskPath = requiredArgument(option(args, '--task'), '--task')
        print(
          addHorizonTask(
            root,
            requiredPositional(rest[0], 'session-id'),
            readJson(resolveInside(root, taskPath)) as HorizonQueueTaskInput,
          ),
          asJson,
        )
        return
      }

      if (sub === 'start') {
        const sessionId = requiredPositional(rest[0], 'session-id')
        let state = startHorizonSession(root, sessionId, {
          attestSupervisorCard: hasFlag(args, '--attest-supervisor-card'),
        })

        // The operator's chat session is the supervisor by default: start
        // arms the session and hands back, and the chat opens and advances
        // each task itself. Only a scheduled job with no chat open drives the
        // session in harness-owned processes.
        if (!hasFlag(args, '--headless')) {
          print(horizonStatus(root, sessionId), asJson)
          return
        }

        let childCount = 0

        while (state.status === 'running' && childCount < 10_000) {
          const child = spawnSync(
            process.execPath,
            [
              fileURLToPath(import.meta.url),
              'horizon',
              'next',
              sessionId,
              '--driver-child',
              '--json',
            ],
            {
              cwd: root,
              encoding: 'utf8',
              timeout: 86_400_000,
              maxBuffer: 16 * 1024 * 1024,
            },
          )

          if (child.error || child.status !== 0) {
            throw new PanError(
              `Horizon driver process failed: ${child.error?.message ?? child.stderr ?? `exit ${String(child.status)}`}`,
              { code: 'HORIZON_DRIVER_FAILED' },
            )
          }

          state = horizonStatus(root, sessionId)
          childCount += 1
        }

        if (childCount >= 10_000) {
          throw new PanError(
            'Horizon session exceeded its 10000-task driver bound.',
            {
              code: 'HORIZON_DRIVER_LIMIT',
            },
          )
        }

        print(state, asJson)
        return
      }

      if (sub === 'next') {
        const sessionId = requiredPositional(rest[0], 'session-id')
        const result = nextHorizonTask(root, sessionId)

        if (hasFlag(args, '--driver-child') && result.run) {
          let state = result.session
          let checkpoints = 0

          while (state.active_task_id && checkpoints < 100) {
            state = checkpointHorizonSession(root, sessionId).session
            checkpoints += 1
          }

          if (checkpoints >= 100) {
            throw new PanError(
              'Horizon task exceeded its 100-checkpoint bound.',
              {
                code: 'HORIZON_TASK_DRIVER_LIMIT',
              },
            )
          }

          print(state, asJson)
          return
        }

        print(result, asJson)
        return
      }

      if (sub === 'status') {
        print(
          horizonStatus(root, requiredPositional(rest[0], 'session-id')),
          asJson,
        )
        return
      }

      if (sub === 'checkpoint') {
        print(
          checkpointHorizonSession(
            root,
            requiredPositional(rest[0], 'session-id'),
          ),
          asJson,
        )
        return
      }

      if (sub === 'reconcile') {
        print(
          reconcileHorizonSession(
            root,
            requiredPositional(rest[0], 'session-id'),
          ),
          asJson,
        )
        return
      }

      if (sub === 'resume') {
        print(
          latestHorizonHandoff(root, requiredPositional(rest[0], 'session-id')),
          asJson,
        )
        return
      }

      if (sub === 'reinstate') {
        const actionType = requiredArgument(
          option(args, '--action'),
          '--action',
        )

        if (!(ARBITER_ACTIONS as readonly string[]).includes(actionType)) {
          throw new PanError(
            `Unknown reinstate action '${actionType}'. Known: ${ARBITER_ACTIONS.join(', ')}.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const decision = option(args, '--decision')

        if (
          decision !== undefined &&
          decision !== null &&
          decision !== 'approve' &&
          decision !== 'reject' &&
          decision !== 'revise'
        ) {
          throw new PanError(
            `--decision must be approve, reject, or revise, not '${decision}'.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const stage = option(args, '--stage')
        print(
          reinstateHorizonTask(
            root,
            requiredPositional(rest[0], 'session-id'),
            requiredArgument(option(args, '--task'), '--task'),
            {
              type: actionType as ArbiterActionType,
              note: requiredArgument(option(args, '--note'), '--note'),
              ...(stage ? { stage } : {}),
              ...(decision ? { decision } : {}),
            },
            requiredArgument(option(args, '--reason'), '--reason'),
          ),
          asJson,
        )
        return
      }

      if (sub === 'defer') {
        const hardBlock = option(args, '--hard-block')
        const operatorDirective = hasFlag(args, '--operator-directive')

        if (!hardBlock && !operatorDirective) {
          throw new PanError(
            'horizon defer requires --hard-block <LH-H1|LH-H2|LH-H3|LH-H4> naming the hard block you confirmed, or --operator-directive when the operator asked for the deferral. No other authority ends a long-horizon task (HORIZON-001).',
            { code: 'HORIZON_DEFER_UNAUTHORIZED' },
          )
        }

        if (
          hardBlock &&
          !(HORIZON_HARD_BLOCKS as readonly string[]).includes(hardBlock)
        ) {
          throw new PanError(
            `Unknown hard block '${hardBlock}'. Known: ${HORIZON_HARD_BLOCKS.join(', ')}.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        print(
          deferHorizonTask(
            root,
            requiredPositional(rest[0], 'session-id'),
            requiredArgument(option(args, '--task'), '--task'),
            requiredArgument(option(args, '--reason'), '--reason'),
            repeatedOption(args, '--evidence'),
            hardBlock
              ? {
                  kind: 'hard_block',
                  hard_block: hardBlock as HorizonHardBlock,
                }
              : { kind: 'operator_directive' },
          ),
          asJson,
        )
        return
      }

      if (sub === 'abandon') {
        print(
          abandonHorizonSession(
            root,
            requiredPositional(rest[0], 'session-id'),
            requiredArgument(option(args, '--reason'), '--reason'),
          ),
          asJson,
        )
        return
      }

      throw new PanError(`Unknown horizon subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'cohort': {
      const sub = args[0]
      const rest = args.slice(1)
      const asJson = hasFlag(args, '--json')

      if (sub === 'init') {
        const state = initCohortSession(root, {
          planRunId: requiredArgument(option(args, '--plan-run'), '--plan-run'),
          from: option(args, '--from'),
          maxParallel: integerOption(args, '--max-parallel'),
        })

        print(
          {
            status: 'created',
            cohort_id: state.cohort_id,
            plan_run_id: state.plan_run_id,
            parent_spec_path: state.parent_spec_path,
            base_branch: state.base_branch,
            max_parallel: state.max_parallel,
            cohorts: state.cohorts,
            next_command: `${pan} cohort start ${state.cohort_id}`,
            state_path: `runtime/logs/cohorts/${state.cohort_id}/state.json`,
          },
          asJson,
        )
        return
      }

      if (sub === 'start') {
        const cohortOption = option(rest, '--cohort')
        const cohortIndex =
          cohortOption === null ? undefined : Number(cohortOption)

        if (cohortIndex !== undefined && !Number.isInteger(cohortIndex)) {
          throw new PanError('--cohort requires an integer cohort index.', {
            code: 'INVALID_ARGUMENT',
          })
        }

        print(
          {
            status: 'started',
            ...startCohort(root, requiredPositional(rest[0], 'cohort-id'), {
              cohortIndex,
            }),
          },
          asJson,
        )
        return
      }

      if (sub === 'status') {
        print(
          cohortStatus(root, requiredPositional(rest[0], 'cohort-id')),
          asJson,
        )
        return
      }

      if (sub === 'integrate') {
        print(
          {
            status: 'integrated',
            ...integrateCohort(root, requiredPositional(rest[0], 'cohort-id'), {
              intoBranch: option(rest, '--into-branch'),
            }),
          },
          asJson,
        )
        return
      }

      if (sub === 'release') {
        const result = releaseCohort(
          root,
          requiredPositional(rest[0], 'cohort-id'),
        )

        print(result, asJson)

        if (result.status === 'failed') {
          process.exitCode = 1
        }
        return
      }

      if (sub === 'abandon') {
        const state = abandonChunk(
          root,
          requiredPositional(rest[0], 'cohort-id'),
          requiredArgument(option(args, '--chunk'), '--chunk'),
          requiredArgument(option(args, '--note'), '--note'),
        )

        print({ status: 'abandoned', chunks: state.chunks }, asJson)
        return
      }

      if (sub === 'clean') {
        print(
          cleanCohortSession(root, requiredPositional(rest[0], 'cohort-id'), {
            force: hasFlag(args, '--force'),
          }),
          asJson,
        )
        return
      }

      if (sub === 'route') {
        const result = retryDeliveryRoute(
          root,
          requiredArgument(option(args, '--plan-run'), '--plan-run'),
          deliveryRouteOptions(args),
        )

        print(result, asJson)

        if (result.status === 'failed') {
          process.exitCode = 1
        }
        return
      }

      throw new PanError(`Unknown cohort subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'context': {
      const sub = args[0]

      if (sub === 'digest') {
        const relativePath = requiredPositional(args[1], 'repo-relative-file')
        const absolute = resolveInside(root, relativePath)

        // A directory exists but has no content to digest; naming the
        // repo-relative path keeps the absolute root out of the message.
        if (!isFile(absolute)) {
          throw new PanError(`File does not exist: ${relativePath}`, {
            code: 'CONTEXT_REFERENCE_NOT_FOUND',
            details: { path: relativePath },
          })
        }

        const digest = referenceContentSha256(readText(absolute))

        print(
          hasFlag(args, '--json')
            ? {
                source_path: relativePath,
                content_sha256: digest,
                basis:
                  'sha256 of the text after leading and trailing whitespace is trimmed',
              }
            : digest,
          hasFlag(args, '--json'),
        )
        return
      }

      if (sub === 'card') {
        const runId = requiredPositional(args[1], 'run-id')
        const card = renderRunInvocationCard(
          root,
          runId,
          option(args, '--invocation') ?? undefined,
        )

        print(
          hasFlag(args, '--json') ? card : card.markdown,
          hasFlag(args, '--json'),
        )
        return
      }

      throw new PanError(`Unknown context subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'pr-description': {
      const sub = args[0]

      if (sub === 'context') {
        const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
        const workspaceRoot = path.resolve(
          root,
          worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
        )
        const policies = resolvePolicies(root, {
          persona: 'release-steward',
          workflow: 'standalone',
          stage: 'write-pr',
          operator_artifacts: 'requested',
        })

        print(
          resolvePrDescriptionContext(workspaceRoot, policies),
          hasFlag(args, '--json'),
        )
        return
      }

      throw new PanError(
        `Unknown pr-description subcommand: ${sub ?? '(missing)'}`,
        { code: 'UNKNOWN_COMMAND' },
      )
    }
    case 'requirements': {
      const sub = args[0]

      if (sub === 'resolve') {
        const persona = requiredArgument(option(args, '--persona'), '--persona')
        const workflow = requiredArgument(
          option(args, '--workflow'),
          '--workflow',
        )
        const stage = requiredArgument(option(args, '--stage'), '--stage')

        const outputPath = option(args, '--output-path') ?? undefined
        const invocationKind = invocationKindOption(args)

        print(
          resolveRequirements(root, {
            persona,
            workflow,
            stage,
            ...(invocationKind ? { invocation_kind: invocationKind } : {}),
            ...(outputPath
              ? {
                  invocation: {
                    output_path: outputPath,
                    artifact_paths: [outputPath],
                  },
                }
              : {}),
          }),
          hasFlag(args, '--json'),
        )
        return
      }

      if (sub === 'run') {
        const runOption = option(args, '--run')
        const invocationReference = option(args, '--invocation')
        const invocationPath = invocationReference
          ? requirementsRunInvocationPath(root, invocationReference, runOption)
          : null
        const invocation = invocationPath
          ? requirementsRunInvocation(root, invocationPath)
          : null
        const contextualArgument = (
          name: string,
          invocationValue: string | undefined,
        ): string => {
          const explicit = option(args, name)

          if (explicit && invocationValue && explicit !== invocationValue) {
            throw new PanError(
              `${name} '${explicit}' does not match invocation value ` +
                `'${invocationValue}'.`,
              { code: 'INVALID_ARGUMENT' },
            )
          }

          return requiredArgument(explicit ?? invocationValue ?? null, name)
        }
        const persona = contextualArgument(
          '--persona',
          invocation?.stage.persona,
        )
        const workflow = contextualArgument(
          '--workflow',
          invocation?.workflow.slug,
        )
        const stage = contextualArgument('--stage', invocation?.stage.slug)
        const explicitKind = invocationKindOption(args, invocation === null)
        const invocationKind = explicitKind ?? 'workflow'

        if (invocation && invocationKind !== 'workflow') {
          throw new PanError(
            `--kind '${invocationKind}' does not match a workflow invocation.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const registryId = requiredArgument(
          option(args, '--registry'),
          '--registry',
        )
        const targetPath = requiredArgument(
          option(args, '--target') ?? invocation?.output.path ?? null,
          '--target',
        )
        let validatorInvocation: Record<string, unknown> | undefined =
          invocation
            ? (invocation as unknown as Record<string, unknown>)
            : undefined

        // Handlers that inspect the workspace (changed files, Git state,
        // evidence paths) resolve it from the exact invocation snapshot when
        // supplied. Otherwise the run state or selected worktree identifies
        // the workspace, preserving the standalone command contract.
        if (invocation && runOption && runOption !== invocation.run_id) {
          throw new PanError(
            `--run '${runOption}' does not match invocation run ` +
              `'${invocation.run_id}'.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const boundRunState = runOption
          ? (getRunState(root, runOption) as unknown as Record<string, unknown>)
          : null
        const worktreeOption = option(args, '--worktree')

        if (invocation && worktreeOption) {
          throw new PanError(
            '--invocation and --worktree cannot be used together; the ' +
              'invocation already names its exact workspace.',
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const worktreeWorkspace = worktreeOption
          ? readWorktreeIndex(root).worktrees.find(
              (entry) => entry.name === worktreeOption,
            )
          : undefined

        if (worktreeOption && !worktreeWorkspace) {
          // A read-only check must not create a worktree from a typo.
          throw new PanError(
            `No worktree named '${worktreeOption}' is recorded. Run ` +
              `'pan worktree list' to see the recorded worktrees.`,
            { code: 'WORKTREE_NOT_FOUND' },
          )
        }

        const workspaceRoot = path.resolve(
          root,
          invocation?.workspace_root ??
            worktreeWorkspace?.path ??
            (typeof boundRunState?.workspace_root === 'string'
              ? boundRunState.workspace_root
              : configuredWorkspaceRoot(root)),
        )
        const validatorRunState: Record<string, unknown> = {
          ...(boundRunState ?? {}),
          workspace_root: workspaceRoot,
        }

        if (!invocation && registryId === 'PR-DESCRIPTION-VALIDATE-001') {
          const policies = resolvePolicies(root, {
            persona,
            workflow,
            stage,
            operator_artifacts: 'requested',
          })

          validatorInvocation = {
            inputs: {
              pr_description: resolvePrDescriptionContext(
                workspaceRoot,
                policies,
              ),
            },
          }
        }

        const manifest =
          invocation?.requirements ??
          resolveRequirements(root, {
            persona,
            workflow,
            stage,
            invocation_kind: invocationKind,
            invocation: {
              output_path: targetPath,
              artifact_paths: [targetPath],
            },
          })
        const governingPolicy =
          registryId === 'CODE-STYLE-VALIDATE-001'
            ? codeStylePolicyId(targetPath)
            : null
        const requirements = [
          ...manifest.automation_requirements,
          ...manifest.validation_requirements,
        ].filter(
          (item) =>
            item.registry_id === registryId &&
            // Each language policy declares the same code-style check, and
            // only the one that governs the scanned file may judge it.
            (governingPolicy === null ||
              !CODE_STYLE_POLICY_IDS.includes(item.policy_id) ||
              item.policy_id === governingPolicy),
        )
        let selected = requirements

        if (requirements.length > 1) {
          // Sibling policies may each declare the same check on one shared
          // context: the style mode binds one code-style check through both
          // its language policies. Identical execution shapes describe one
          // run, so collapsing them keeps the ambiguity error for the
          // configurations that really are ambiguous.
          const shapes = new Set(
            requirements.map((item) => requirementShapeKey(item)),
          )

          if (shapes.size === 1) {
            selected = [requirements[0] as ResolvedRequirement]
          } else {
            const required = requirements.filter(
              (item) => item.enforcement === 'required',
            )

            if (required.length === 1) {
              selected = required
            }
          }
        }

        if (selected.length !== 1) {
          throw new PanError(
            requirements.length === 0
              ? `Registry ${registryId} did not resolve for this context.`
              : `Registry ${registryId} resolved more than once for this context.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const catalog = loadRegistry(root)
        const entry = catalog.entries.get(registryId)
        const targetKind = inferTargetKind(targetPath)

        if (entry?.kind !== 'validator') {
          throw new PanError(
            `Registry ${registryId} is not a standalone validator.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        if (!entry.target_types.includes(targetKind)) {
          throw new PanError(
            `Registry ${registryId} does not accept target kind ${targetKind}.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const comparisonBase = invocation
          ? {
              source: 'invocation.workspace_before' as const,
              workspace_root: workspaceRoot,
              fingerprint: invocation.workspace_before.fingerprint,
              invocation_path: requiredArgument(invocationPath, '--invocation'),
              run_id: invocation.run_id,
            }
          : {
              source: 'workspace.cumulative_diff' as const,
              workspace_root: workspaceRoot,
              ...(runOption ? { run_id: runOption } : {}),
            }
        const result = runRequirement({
          root,
          requirement: selected[0],
          targetPath,
          executor: 'agent',
          ...(invocation
            ? { workspaceFingerprint: invocation.workspace_before.fingerprint }
            : {}),
          comparisonBase,
          ...(validatorInvocation ? { invocation: validatorInvocation } : {}),
          runState: validatorRunState,
          catalog,
          persist: false,
        })

        print(result, hasFlag(args, '--json'))

        if (!isPassingResult(result)) {
          process.exitCode = 1
        }

        return
      }

      throw new PanError(
        `Unknown requirements subcommand: ${sub ?? '(missing)'}`,
        {
          code: 'UNKNOWN_COMMAND',
        },
      )
    }
    case 'output': {
      const sub = args[0]

      if (sub === 'scaffold') {
        requiredArgument(args[1], 'run-id')
        const invocationPath = requiredArgument(
          option(args, '--invocation'),
          '--invocation',
        )
        const outputPath = requiredArgument(
          option(args, '--output'),
          '--output',
        )
        const invocation = readInvocationFromPath(root, invocationPath)
        print(
          scaffoldStageOutput(
            root,
            invocation,
            outputPath,
            hasFlag(args, '--force'),
          ),
          true,
        )
        return
      }

      if (sub === 'validate') {
        // Three arguments, each knowable on the first call. `--run` exists so
        // a flag in the positional slot cannot be read as a run id.
        const {
          'run-id': runId,
          '--file': filePath,
          '--invocation': invocationPath,
        } = requiredArguments([
          {
            name: 'run-id' as const,
            value: option(args, '--run') ?? args[1],
            positional: true,
          },
          { name: '--file' as const, value: option(args, '--file') },
          {
            name: '--invocation' as const,
            value: option(args, '--invocation'),
          },
        ])
        const invocation = readInvocationFromPath(root, invocationPath)
        const submittedValue = readJson(resolveInside(root, filePath))
        const materialized = materializeOutputSubmission(
          root,
          getRunState(root, runId),
          submittedValue,
          invocation.invocation_id,
        )

        const effectiveValue = materialized.value
        const effectiveRecord = isRecord(effectiveValue) ? effectiveValue : {}
        const scratchPath =
          materialized.revisedFrom === undefined
            ? null
            : outputValidateScratchPath(
                runId,
                invocation.output.path,
                'output-validate',
              )
        const effectivePath = scratchPath ?? filePath

        if (scratchPath !== null) {
          writeJsonAtomic(resolveInside(root, scratchPath), effectiveValue)
        }

        const agentRequirements = preSubmitRequirements(root, invocation)

        let submission: ReturnType<typeof validateOutputForSubmission>
        let results: ReturnType<typeof runAgentPreSubmitValidators>

        try {
          // Always run the submission mirror. A mechanical defect that reaches
          // submit time consumes a stage attempt.
          submission = validateOutputForSubmission(
            root,
            runId,
            invocation,
            effectiveValue,
            { submittedPath: effectivePath },
          )
          results =
            agentRequirements.length === 0
              ? []
              : runAgentPreSubmitValidators(
                  root,
                  runId,
                  invocation as unknown as Record<string, unknown>,
                  agentRequirements,
                  effectivePath,
                  effectiveRecord,
                )
        } finally {
          if (scratchPath !== null) {
            rmSync(path.dirname(resolveInside(root, scratchPath)), {
              recursive: true,
              force: true,
            })
          }
        }
        const passed =
          submission.passed &&
          results.every((item) => isPassingResult(item.result))
        // Advisory only: a repeated agent-run `fast` profile is reported by
        // name for the supervisor's audit and never fails the validation.
        const advisories = agentRepositoryCheckAdvisories(
          root,
          runId,
          invocation.invocation_id,
        )

        print(
          hasFlag(args, '--json')
            ? {
                passed,
                submission_checks: submission.checks,
                results,
                advisories,
              }
            : [
                ...submission.checks
                  .filter(
                    (check) =>
                      !check.passed && !check.id.startsWith('validator.'),
                  )
                  .map((check) => `${check.id}: FAIL ${check.message}`),
                ...submission.checks
                  .filter((check) => check.id.startsWith('validator.'))
                  .map(
                    (check) =>
                      `${check.id}: ${check.passed ? 'PASS' : 'FAIL'} ` +
                      check.message,
                  ),
                `submission checks: ${
                  submission.passed
                    ? `pass (${submission.checks.length} checks)`
                    : 'fail'
                }`,
                ...results.map(
                  (item) =>
                    `${item.requirement.registry_id}: ${item.result.status}`,
                ),
                ...advisories.map(
                  (item) => `advisory ${item.id}: ${item.message}`,
                ),
              ].join('\n'),
          hasFlag(args, '--json'),
        )

        if (!passed) {
          process.exitCode = 1
        }

        return
      }

      throw new PanError(`Unknown output subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'assessment': {
      const sub = args[0]

      if (sub === 'scaffold') {
        const invocationPath = requiredArgument(
          option(args, '--invocation'),
          '--invocation',
        )
        const outputPath = requiredArgument(
          option(args, '--output'),
          '--output',
        )
        const invocation = readInvocationFromPath(root, invocationPath)

        print(
          scaffoldAssessment(
            root,
            invocation.invocation_id,
            outputPath,
            invocation.rubric.map((item) => item.id),
            hasFlag(args, '--force'),
          ),
          true,
        )
        return
      }

      throw new PanError(
        `Unknown assessment subcommand: ${sub ?? '(missing)'}`,
        {
          code: 'UNKNOWN_COMMAND',
        },
      )
    }
    case 'spotfix': {
      const sub = args[0]

      if (sub === 'scaffold-escalation') {
        const inputPath = requiredArgument(option(args, '--input'), '--input')
        const outputPath = requiredArgument(
          option(args, '--output'),
          '--output',
        )
        const content = readText(resolveInside(root, inputPath))
        writeTextAtomic(
          resolveInside(root, outputPath),
          `# Escalation\n\n${content}\n`,
        )
        print({ path: outputPath, status: 'scaffolded' }, true)
        return
      }

      throw new PanError(`Unknown spotfix subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'worker': {
      const subcommand = requiredArgument(args[0], 'worker subcommand')
      const runId = requiredArgument(args[1], 'run-id')
      const invocationId = option(args, '--invocation')
      const role = option(args, '--role')

      if (subcommand === 'record') {
        const agent = option(args, '--agent')
        const model = option(args, '--model')
        const launch = recordDelegatedWorker(root, runId, {
          handle: requiredArgument(option(args, '--handle'), '--handle'),
          ...(invocationId ? { invocationId } : {}),
          ...(role ? { role } : {}),
          ...(agent ? { agent } : {}),
          ...(model ? { model } : {}),
          launchMode: parseWorkerLaunchMode(option(args, '--launch-mode')),
          ...(hasFlag(args, '--new-attempt') ? { newAttempt: true } : {}),
        })

        print(
          json
            ? launch
            : `worker recorded: ${launch.record.role} attempt ` +
                `${launch.record.attempt} of invocation ` +
                `${launch.record.invocation_id}, handle ${launch.record.handle}` +
                (launch.evidence_attempt
                  ? `, brief ${launch.evidence_attempt.brief_path}, evidence ` +
                    `${launch.evidence_attempt.evidence_path}`
                  : '') +
                (launch.warnings?.length
                  ? `\nWarning: ${launch.warnings.join('\nWarning: ')}`
                  : ''),
          json,
        )
        return
      }

      if (subcommand === 'state') {
        const workers = describeDelegatedWorkers(root, runId, {
          ...(invocationId ? { invocationId } : {}),
          ...(role ? { role } : {}),
        })

        print(
          json
            ? { run_id: runId, workers }
            : workers.length === 0
              ? `No delegated worker is recorded for run ${runId}. A launch ` +
                `records one with 'pan worker record'.`
              : workers
                  .map(
                    (worker) =>
                      `${worker.role} attempt ${worker.attempt} of ` +
                      `${worker.invocation_id}: handle ${worker.handle}, ` +
                      `launched ${worker.launched_at} ` +
                      `(${worker.seconds_since_launch.toFixed(0)}s ago), ` +
                      (worker.wrote_nothing
                        ? 'wrote nothing yet'
                        : 'has written') +
                      `: ${worker.declared_paths.map(declaredPathState).join('; ')}`,
                  )
                  .join('\n'),
          json,
        )
        return
      }

      throw new PanError(`Unknown worker subcommand: ${subcommand}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'watch': {
      const runId = requiredArgument(args[0], 'run-id')
      const invocationId = option(args, '--invocation')

      if (hasFlag(args, '--foreground-returned')) {
        if (hasFlag(args, '--mark-background')) {
          throw new PanError(
            '--foreground-returned and --mark-background are exclusive: a ' +
              'launch returned in the foreground or it became a background ' +
              'subagent.',
            { code: 'INVALID_ARGUMENT' },
          )
        }

        const launchedAt = option(args, '--launched-at')
        const record = recordForegroundReturn(root, runId, {
          ...(invocationId ? { invocationId } : {}),
          ...(launchedAt ? { launchedAt } : {}),
        })

        print(
          json
            ? record
            : `foreground return recorded: invocation ${record.invocation_id}, ` +
                `launched ${record.launched_at} (${record.launched_at_source}), ` +
                `returned ${record.returned_at} after ` +
                `${record.elapsed_seconds.toFixed(1)}s, output ` +
                `${record.observation.output_present ? 'present' : 'absent'}, ` +
                `record ${foregroundReturnRecordPath(root, runId, record.invocation_id)}` +
                (record.elapsed_implausibility
                  ? `\n${record.elapsed_implausibility}`
                  : ''),
          json,
        )
        return
      }

      const agentState = parseAgentState(option(args, '--agent-state'))
      const armLaunchedAt = option(args, '--launched-at')

      const workerHandle = option(args, '--handle')
      const workerAgent = option(args, '--agent')
      const workerModel = option(args, '--model')

      const result = await armWorkerWatch(root, runId, {
        ...(invocationId ? { invocationId } : {}),
        cadenceSeconds: parseCadenceSeconds(option(args, '--cadence-seconds')),
        stallTimeoutSeconds: parsePositiveInteger(
          option(args, '--stall-timeout-seconds'),
          '--stall-timeout-seconds',
          DEFAULT_STALL_TIMEOUT_SECONDS,
        ),
        timeoutSeconds: parseTimeoutSeconds(option(args, '--timeout-seconds')),
        markBackground: hasFlag(args, '--mark-background'),
        ...(armLaunchedAt ? { launchedAt: armLaunchedAt } : {}),
        ...(workerHandle ? { workerHandle } : {}),
        ...(workerAgent ? { workerAgent } : {}),
        ...(workerModel ? { workerModel } : {}),
        ...(agentState ? { agentState } : {}),
        // OUTPUT-001: progress lines only on an interactive terminal, so a
        // captured watch stays byte-identical to the JSON result.
        onWake: process.stderr.isTTY
          ? (entry) => process.stderr.write(`${formatWakeLine(entry)}\n`)
          : undefined,
      })

      print(
        json
          ? result
          : `watch ${result.state}: invocation ${result.invocation_id}, ` +
              `${result.wakes} wakes over ${result.elapsed_seconds.toFixed(1)}s, ` +
              `record ${result.record_path}, launch ` +
              `${launchRecordPath(root, runId, result.invocation_id)}`,
        json,
      )
      process.exitCode = WATCH_EXIT_CODES[result.state]
      return
    }
    case 'validate': {
      const result = validateRepository(root)
      print(result, true)

      if (!result.ok) {
        process.exitCode = 1
      }
      return
    }
    case 'eval': {
      const sub = args[0]
      const asJson = hasFlag(args, '--json')

      if (sub === 'list') {
        const scenarios = listEvalScenarios(root).map(
          ({ scenario, path: file }) => ({
            name: scenario.name,
            workflow: scenario.workflow,
            verification: scenario.verification,
            fixture: scenario.fixture,
            policy_instructions: scenario.policy_instructions.map(
              (item) => `${item.policy_id}#${item.instruction}`,
            ),
            graders: scenario.graders.map((grader) => grader.id),
            description: scenario.description,
            path: file,
          }),
        )

        print(
          asJson
            ? scenarios
            : scenarios.length === 0
              ? 'No eval scenarios under evals/scenarios/.'
              : scenarios
                  .map(
                    (item) =>
                      `${item.name}  [${item.workflow}/${item.verification}, fixture ${item.fixture}]\n` +
                      `    ${item.description}\n` +
                      `    policies: ${item.policy_instructions.join(', ')}\n` +
                      `    graders: ${item.graders.join(', ')}`,
                  )
                  .join('\n'),
          asJson,
        )
        return
      }

      if (sub === 'grade') {
        const runId = requiredArgument(args[1], 'run-id')
        const scenarioName = requiredArgument(
          option(args, '--scenario'),
          '--scenario',
        )

        const report = gradeEvalRun(root, runId, scenarioName)
        const outDir = option(args, '--out')
        const written = outDir ? writeEvalReport(root, outDir, report) : null

        print(
          asJson
            ? { ...report, ...(written ? { report_paths: written } : {}) }
            : renderEvalReportMarkdown(report) +
                (written
                  ? `\nReport written to ${written.json_path} and ${written.markdown_path}.\n`
                  : ''),
          asJson,
        )

        if (!report.passed) {
          process.exitCode = 1
        }

        return
      }

      if (sub === 'run') {
        const scenarioName = requiredArgument(args[1], 'scenario')
        const result = runEval(root, scenarioName, {
          attestSupervisorCard: hasFlag(args, '--attest-supervisor-card'),
          ...(typeof option(args, '--pipeline-config') === 'string'
            ? {
                pipelineConfigName: option(args, '--pipeline-config') as string,
              }
            : {}),
          onProgress: (message) =>
            process.stderr.write(`[pan eval:${scenarioName}] ${message}\n`),
        })

        print(
          asJson
            ? { ...result, report: result.report }
            : [
                `Eval ${result.eval_id} (${result.status}) for run ${result.run_id}.`,
                `Workspace: ${result.workspace}`,
                `Report: ${result.report_paths.markdown_path}`,
                ...(result.operator_steps.length > 0
                  ? [
                      '',
                      'Operator steps:',
                      ...result.operator_steps.map(
                        (step, index) => `${index + 1}. ${step}`,
                      ),
                    ]
                  : ['', `Graders: ${result.report.passed ? 'PASS' : 'FAIL'}`]),
              ].join('\n'),
          asJson,
        )

        if (result.status === 'graded' && !result.report.passed) {
          process.exitCode = 1
        }

        return
      }

      throw new PanError(`Unknown eval subcommand: ${sub ?? '(missing)'}`, {
        code: 'UNKNOWN_COMMAND',
      })
    }
    case 'doctor': {
      const worktreeWorkspace = sharedWorktreeWorkspace(root, args)
      const validation = validateRepository(root)
      // Doctor is the command an operator reaches for when a command fails,
      // so it is exempt from the catalog validation that runs at config load.
      // It reports the catalog state instead of dying with the rest.
      const pipelineConfig = loadPipelineConfig(root, undefined, {
        skipCatalog: true,
      })
      const modelCatalog = cursorCatalogStatus(
        root,
        pipelineConfigPersonaMappings(pipelineConfig.file),
      )

      // Doctor's report must survive a malformed repository-checks file:
      // validateRepository already records the same defect, and aborting here
      // would replace the full diagnostic report with one error.
      let repositoryChecks: ReturnType<typeof loadRepositoryChecks> = {
        schema_version: 1,
        profiles: {},
      }
      let repositoryChecksError: string | null = null

      try {
        repositoryChecks = loadRepositoryChecks(root)
      } catch (error) {
        repositoryChecksError =
          error instanceof Error ? error.message : String(error)
      }
      const nodeMajor = Number(process.versions.node.split('.')[0])
      const workspaceRoot = path.resolve(
        root,
        worktreeWorkspace?.path ?? configuredWorkspaceRoot(root),
      )
      const result = {
        ok: validation.ok && nodeMajor >= 22,
        node: {
          version: process.versions.node,
          supported: nodeMajor >= 22,
        },
        workspace: {
          root:
            path.relative(root, workspaceRoot).split(path.sep).join('/') || '.',
          worktree: worktreeWorkspace?.name ?? null,
        },
        // Advisory: a repository without a web UI needs no browser, so an
        // unready browser stack MUST NOT fail doctor. BROWSER-001 turns the gap
        // into an environment-blocked case at the point a verdict is owed.
        browser_automation: browserReadiness([root, workspaceRoot]),
        // Advisory: a missing credential MUST NOT fail doctor. An interactive
        // `cursor-agent login` authenticates the CLI with no environment key.
        cursor_authentication: cursorAuthenticationReadiness(root),
        // Git availability is a property of the deliverable workspace, not the
        // installation. These coincide only when the harness sits inside the
        // target, which a detached installation does not.
        git: {
          available_repository: isGitRepository(workspaceRoot),
          // Advisory: ACTION-001 lands agent work on the integration branch,
          // so its absence is a readiness gap rather than a failure. The
          // installer creates it on the next fresh install or refresh.
          integration_branch: integrationBranchReadiness(workspaceRoot),
        },
        pipeline_config: {
          active: pipelineConfig.name,
          personas: pipelineConfig.config.personas,
        },
        // Advisory: the catalog is account-local and optional, so a stale one
        // MUST NOT fail doctor. It fails the lifecycle commands, which is
        // exactly why this report has to survive it.
        cursor_model_catalog: modelCatalog,
        gate_cache: {
          ...gateCacheStatus(root),
          disable_with: `${GATE_CACHE_ENV}=0`,
        },
        // Advisory: `PRIMER-001` makes the primer mandatory reading in every
        // installation, so doctor states its freshness even where repository
        // validation stays silent. A drifted primer is a readiness gap the
        // librarian closes with `/pan-build-docs`, not a doctor failure.
        target_repo_primer: {
          ...(validation.target_repo_primer ?? {
            source_head: null,
            current_head: null,
            generated_at: null,
            drifted: false,
            stamp_predates_source: false,
            body_freshness: 'unverified' as const,
            message: 'no target repository primer is present',
          }),
          limit: PRIMER_BODY_FRESHNESS_LIMIT,
        },
        repository_check_environment: {
          profiles_without_probes: Object.entries(repositoryChecks.profiles)
            .filter(
              ([, profile]) => (profile.environment_probes ?? []).length === 0,
            )
            .map(([name]) => name),
          advisory:
            'Profiles without environment_probes rely on their ordinary probes.',
          ...(repositoryChecksError === null
            ? {}
            : { error: repositoryChecksError }),
        },
        // Each external executor is reported only when the active mapping
        // routes a persona to it; a pure-Cursor installation owes neither.
        ...(Object.values(pipelineConfig.config.personas).some(
          (model) => personaExecutorOf(model) === 'claude-code',
        )
          ? { claude_code: claudeCodeVersionPreflight() }
          : {}),
        ...(Object.values(pipelineConfig.config.personas).some(
          (model) => personaExecutorOf(model) === 'openai',
        )
          ? { openai: openAiExecutorPreflight(root) }
          : {}),
        validation,
        constraints: {
          runtime_dependencies: 0,
          development_tools: ['TypeScript', 'Prettier'],
          orchestration_runtime: 'Cursor supervisor + repository state machine',
          supported_integrations: [
            'Cursor subagents',
            'Cursor commands',
            'Cursor rules',
            'MCP tools available to Cursor',
            'Claude Code CLI (external stage executor)',
            'OpenAI Responses API (external stage executor)',
          ],
        },
      }

      print(result, true)

      if (!result.ok) {
        process.exitCode = 1
      }
      return
    }
    default:
      throw new PanError(`Unknown command: ${command}\n\n${help}`, {
        code: 'UNKNOWN_COMMAND',
      })
  }
}

/**
 * Whether `argvPath` names this module, so a direct run executes `main` and an
 * import does not.
 *
 * A read the guard cannot perform is not an answer. Swallowing the failure
 * returned "not the entrypoint", which exits 0 having run no command: the
 * operator sees a silent success where the CLI never started.
 */
export function cliEntrypointMatches(argvPath: string): boolean {
  let resolved: string

  try {
    resolved = realpathSync(argvPath)
  } catch (error) {
    throw new PanError(
      `Failed to resolve the invoked entrypoint path: ${argvPath}`,
      {
        code: 'ENTRYPOINT_PATH_UNREADABLE',
        details: { cause: errorMessage(error) },
      },
    )
  }

  return resolved === fileURLToPath(import.meta.url)
}

if (process.argv[1] !== undefined && cliEntrypointMatches(process.argv[1])) {
  main().catch((error: unknown) => {
    const known = error instanceof PanError
    const message = error instanceof Error ? error.message : String(error)
    const payload = {
      error: known ? error.code : 'UNEXPECTED_ERROR',
      message,
      ...(known && error.details !== undefined
        ? { details: error.details }
        : {}),
    }

    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
    process.exitCode = known ? error.exitCode : 1
  })
}
