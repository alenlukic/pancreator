/**
 * Run creation. The cohort driver imports this module through the engine
 * facade, so it imports none of the cohort baseline helpers.
 */

import { copyFileSync } from 'node:fs'
import path from 'node:path'

import { COHORT_PLAN_WORKFLOW_SLUG } from '../cohorts/state.js'
import { buildContextReference } from '../context.js'
import { validateBriefSystem } from '../briefs/registry.js'
import { invariant } from '../errors.js'
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
  writeJsonAtomic,
} from '../io.js'
import { renderSupervisorCard } from '../governance/supervisor-card.js'
import {
  assertClaimableInboxRequest,
  claimInboxRequest,
  inboxStatusOf,
  isInboxRequestPath,
  rollbackInboxClaim,
} from '../inbox.js'
import { parseKnownFailingTests } from '../known-failing.js'
import { keywordRunSuffixFrom } from '../naming.js'
import { resolveRunLayout } from '../run-layout.js'
import {
  composeDesignWorkflow,
  workflowSupportsDesignComposition,
} from '../design-composition.js'
import {
  configuredWorkspaceRoot,
  isDetachedInstallation,
  panCommand,
  resolveAwayModeConfig,
} from '../project-config.js'
import {
  loadPipelineConfig,
  makePipelineConfigSnapshot,
  resolvePersonaMapping,
  type LoadedPipelineConfig,
} from '../pipeline-config.js'
import { claudeCodeVersionPreflight } from '../executors/claude-code.js'
import { openAiExecutorPreflight } from '../executors/openai-auth.js'
import {
  applyOperatorInvolvement,
  loadOperatorInvolvementFile,
  runHasContract,
  selectInvolvementProfile,
} from '../operator-involvement.js'
import { resolveVerification } from '../verification.js'
import {
  cursorAgentTarget,
  projectPersonaVariants,
  syncCursorProjection,
} from '../projection.js'
import { makeUniqueRunId, now } from '../state.js'
import type {
  BestOfNRunRole,
  CohortRunBinding,
  ExternalPersonaExecutorKind,
  HorizonLadderState,
  HorizonRunBinding,
  ManagedWorktreeReference,
  RunState,
} from '../types.js'
import {
  loadStagePrompt,
  loadWorkflow,
  stageBySlug,
  stagePersonaCandidates,
} from '../workflow.js'
import { resolveRoots } from '../workspace/roots.js'

import { persistRun, personaSubset } from './core.js'

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
  /** Compose the workflow's declared design stages and evidence workers. */
  design?: boolean
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
  /** Long-horizon task membership recorded when a session creates this run. */
  horizon?: HorizonRunBinding | null
  /** Per-task ladder counters inherited when a scoped re-plan restarts work. */
  horizonLadder?: HorizonLadderState | null
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

/**
 * Workflow `pan init` runs when the operator names none. Planning is the
 * entry point for delivery work: its ratified gate routes the plan into one
 * delivery run or a cohort fan-out, so the supervisor never guesses the
 * workflow from prose. The literal repeats `COHORT_PLAN_WORKFLOW_SLUG` because
 * `cohorts.js` imports this module, and a top-level read of its export would
 * hit the temporal dead zone when that module loads first.
 */
export const DEFAULT_WORKFLOW_SLUG = 'planning'

/**
 * Creates a new workflow run (the `planning` workflow unless one is named):
 * validates the options, persona mappings, executor preflights, Cursor agent
 * projection, and brief system, then claims an inbox request, copies the
 * request, writes the workflow and pipeline config snapshots, renders the
 * supervisor card, and persists the run with a `run_created` event. Returns the
 * new state, which starts at `prepare_invocation`.
 *
 * Every check that can fail runs before any run state exists, so a refusal
 * leaves nothing behind; a failure after the inbox claim rolls the claim back.
 * Throws `REQUEST_REQUIRED`, `REQUEST_NOT_FOUND`, `INVALID_ARGUMENT`,
 * `INVALID_PIPELINE_CONFIG`, `MISSING_CURSOR_AGENT`,
 * `EXECUTOR_PREFLIGHT_FAILED`, `PIPELINE_CONFIG_NOT_SYNCED`, or
 * `INVALID_BRIEF_SYSTEM`, among others.
 */
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

  let workflow = loadWorkflow(root, workflowSlug)

  if (options.design) {
    invariant(
      workflowSupportsDesignComposition(workflow),
      `Workflow '${workflowSlug}' does not support --with-design.`,
      {
        code: 'DESIGN_COMPOSITION_UNSUPPORTED',
        details: { workflow: workflowSlug },
      },
    )
    workflow = composeDesignWorkflow(root, workflow)
  }

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
  const workflowExternalExecutors = new Set<ExternalPersonaExecutorKind>()

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
        workflowExternalExecutors.add(mapping.executor)
      }
    }
  }

  // Fail closed before any run state exists: an external persona whose
  // executor is unavailable could never be delegated, and substituting Cursor
  // would falsify the model snapshot. Only the checks that cost nothing run
  // here — Claude Code's credential probe spends a real invocation, so it runs
  // at first delegation instead.
  for (const executor of workflowExternalExecutors) {
    const preflight =
      executor === 'claude-code'
        ? claudeCodeVersionPreflight()
        : openAiExecutorPreflight(root)

    invariant(
      preflight.ok,
      `Executor preflight failed for '${executor}': ${preflight.error}`,
      {
        code: 'EXECUTOR_PREFLIGHT_FAILED',
        details: { executor, ...preflight },
      },
    )
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

    const awayMode = resolveAwayModeConfig(
      root,
      involvementSelection.profile.away_mode,
    )
    const configurationOverrides =
      runHasContract(involvement, 'long_horizon') && !awayMode.enabled
        ? [
            {
              setting: 'away_mode.enabled' as const,
              configured_value: false,
              applied_value: true,
              reason:
                `Involvement profile '${involvement.profile}' carries the ` +
                'long_horizon contract, which requires away mode for this run.',
            },
          ]
        : []

    if (configurationOverrides.length > 0) {
      awayMode.enabled = true
    }
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
      ...(configurationOverrides.length > 0
        ? { configuration_overrides: configurationOverrides }
        : {}),
      operator_artifacts: {
        mode: options.operatorArtifacts ? 'requested' : 'suppressed',
        requested_stages: [],
      },
      ...(agentSuffix ? { cursor_agent_suffix: agentSuffix } : {}),
      ...(options.bestOfN ? { best_of_n: options.bestOfN } : {}),
      ...(options.cohort ? { cohort: options.cohort } : {}),
      ...(options.horizon ? { horizon: options.horizon } : {}),
      ...(options.horizonLadder
        ? { horizon_ladder: structuredClone(options.horizonLadder) }
        : {}),
      ...(autostartDelivery !== null
        ? { autostart_delivery: autostartDelivery }
        : {}),
      ...(autostartMaxParallel !== null
        ? { autostart_max_parallel: autostartMaxParallel }
        : {}),
      ...(options.design ? { design_composition: true as const } : {}),
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
      ...(options.design ? { design_composition: true } : {}),
      ...(configurationOverrides.length > 0
        ? { configuration_overrides: configurationOverrides }
        : {}),
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
