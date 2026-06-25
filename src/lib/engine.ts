import { randomUUID } from 'node:crypto'
import { copyFileSync } from 'node:fs'
import path from 'node:path'

import { invariant, PanError } from './errors.js'
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
  withFileLock,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import { resolvePolicies } from './policies.js'
import {
  loadPipelineConfig,
  loadPipelineConfigSnapshot,
  makePipelineConfigSnapshot,
  resolvePersonaModel,
  syncCursorAgentModels,
} from './pipeline-config.js'
import {
  renderInvocationMarkdown,
  renderStatus,
  renderTaskRecord,
} from './render.js'
import {
  ledgerValidationPath,
  lockPath,
  loadState,
  makeRunId,
  now,
  persist,
  runDir,
  writeDecision,
} from './state.js'
import type {
  DeterministicResult,
  Invocation,
  OperatorFeedbackItem,
  OperatorGateWaiver,
  OperatorPauseContext,
  OperatorWorkspaceRatification,
  RunState,
  StageDefinition,
  StageHistoryItem,
  StageOutcome,
  StageOutput,
  SupervisorAssessment,
  TaskRecord,
  WorkflowDefinition,
  WorkspaceIndex,
} from './types.js'
import {
  buildValidationArtifact,
  delegationPath,
  delegationValidationPath,
  evaluateDeterministicCriteria,
  invocationValidationPath,
  loadInvocationValidationStatus,
  validateDelegationMarkdown,
  validateInvocationMarkdown,
  validateStageOutput,
} from './validation.js'
import {
  loadStagePrompt,
  loadWorkflow,
  loadWorkflowFile,
  stageBySlug,
} from './workflow.js'
import {
  acquireActiveWorkflowLease,
  loadWorkspaceIndex,
  readActiveWorkflowLease,
  releaseActiveWorkflowLease,
  saveWorkspaceIndex,
  snapshotWorkspace,
  workspaceSnapshotFromIndex,
  writeWorkflowBaseline,
} from './workspace/index.js'
import { adoptAuthorizedWorkspaceChanges } from './workspace/changes.js'
import { listFileLocks } from './workspace/locks.js'
import { resolveRoots } from './workspace/roots.js'
import {
  validateWorkflowChanges,
  waiveLedgerValidation,
} from './workspace/validate-changes.js'

interface CreateRunOptions {
  workflowSlug?: string
  requestPath: string | null
  title?: string | null
  workspace?: string | null
  gatesPath?: string | null
}

interface StatusOptions {
  json?: boolean
}

export interface PrepareInvocationResult {
  state: RunState
  invocation: Invocation | null
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

function assertRunPipelineConfigCurrent(
  root: string,
  state: RunState,
  snapshot: ReturnType<typeof loadRunPipelineConfig>,
): void {
  if (!state.pipeline_config) {
    return
  }

  const live = loadPipelineConfig(root)
  const sameConfig =
    live.name === snapshot.name &&
    sha256(live.config.personas) === sha256(snapshot.personas)

  invariant(
    sameConfig,
    `Run '${state.run_id}' uses pipeline config '${snapshot.name}', but the ` +
      `live active mapping has changed. Restore that mapping and run ` +
      './bin/pan models --sync before resuming this run.',
    { code: 'PIPELINE_CONFIG_DRIFT' },
  )

  const agentModelDrift = syncCursorAgentModels(root, live).filter(
    (entry) => entry.changed,
  )

  invariant(
    agentModelDrift.length === 0,
    'Cursor agent models do not match the run pipeline config. Run ./bin/pan models --sync.',
    {
      code: 'PIPELINE_CONFIG_NOT_SYNCED',
      details: { agents: agentModelDrift.map((entry) => entry.path) },
    },
  )
}

/** Absolute path of the deliverable workspace this run fingerprints and gates. */
function workspaceDirectory(root: string, state: RunState): string {
  return resolveInside(root, state.workspace_root || '.')
}

function rootsForRun(root: string, state: RunState) {
  return resolveRoots({
    installation_root: root,
    workspace_root: workspaceDirectory(root, state),
    state_root: state.state_root,
  })
}

function acquireRunWorkspaceTracking(root: string, state: RunState) {
  const roots = rootsForRun(root, state)

  state.workspace_id = roots.workspace_id
  state.installation_root = roots.installation_root
  state.state_root = roots.state_root
  state.scope_hash = roots.scope_hash

  const existingLease = readActiveWorkflowLease(roots.state_root)

  if (existingLease && existingLease.workflow_id !== state.run_id) {
    throw new PanError(
      `Mutating workflow lease is held by ${existingLease.workflow_id}.`,
      {
        code: 'WORKFLOW_LEASE_HELD',
        details: { workflow_id: existingLease.workflow_id },
      },
    )
  }

  if (!existingLease) {
    acquireActiveWorkflowLease(roots.state_root, {
      schema_version: 1,
      workspace_id: roots.workspace_id,
      workflow_id: state.run_id,
      acquired_at_ms: Date.now(),
      process_id: process.pid,
    })
  }

  const lockConflicts = listFileLocks(roots.state_root).filter(
    (lock) => lock.workflow_id !== state.run_id,
  )

  invariant(
    lockConflicts.length === 0,
    'Cannot start tracked workspace mutation while unrelated file locks are present.',
    { code: 'LOCK_HELD' },
  )

  return roots
}

function writeRunWorkspaceBaseline(
  state: RunState,
  roots: ReturnType<typeof rootsForRun>,
  index: WorkspaceIndex,
): void {
  writeWorkflowBaseline(
    roots.state_root,
    state.run_id,
    roots,
    index,
    sha256({
      workspace_id: roots.workspace_id,
      scope_hash: roots.scope_hash,
      workspace_root: roots.workspace_root,
      state_root: roots.state_root,
    }),
  )
}

function ensureMutatingWorkflowInitialized(
  root: string,
  state: RunState,
  stage: StageDefinition,
): void {
  if (stage.workspace_policy !== 'source_allowed') {
    return
  }

  const roots = acquireRunWorkspaceTracking(root, state)
  const reconciled = snapshotWorkspace(roots, true)

  writeRunWorkspaceBaseline(state, roots, reconciled.index)
}

function releaseWorkflowLeaseIfHeld(state: RunState): void {
  if (!state.state_root) {
    return
  }

  const lease = readActiveWorkflowLease(state.state_root)

  if (lease?.workflow_id === state.run_id) {
    const remainingLocks = listFileLocks(state.state_root).filter(
      (lock) => lock.workflow_id === state.run_id,
    )

    invariant(
      remainingLocks.length === 0,
      'Workflow cannot close while workflow-owned file locks remain.',
      { code: 'LOCK_HELD' },
    )
    releaseActiveWorkflowLease(state.state_root, state.run_id)
  }
}

function workspaceSnapshotForRun(root: string, state: RunState) {
  const roots = rootsForRun(root, state)
  const snapshot = snapshotWorkspace(roots, false)

  state.workspace_id = roots.workspace_id
  state.installation_root = roots.installation_root
  state.state_root = roots.state_root
  state.scope_hash = roots.scope_hash

  return snapshot.snapshot
}

/**
 * Resolve an operator-supplied `--workspace` to a repository-relative directory.
 * Returns `'.'` (the repository root) when no deliverable workspace is given.
 */
function normalizeWorkspaceRoot(
  root: string,
  workspace: string | null | undefined,
): string {
  if (!workspace || workspace === '.' || workspace === './') {
    return '.'
  }

  const relative = toRepoRelative(root, workspace)

  invariant(
    isDirectory(resolveInside(root, relative)),
    `--workspace must be an existing directory: ${workspace}`,
    { code: 'WORKSPACE_NOT_FOUND' },
  )

  return relative
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

function referencesForRun(state: RunState): Array<{
  path: string
  description: string
}> {
  const references = [
    {
      path: state.request.stored_path,
      description: 'Original operator request',
    },
  ]

  for (const item of state.stage_history) {
    references.push({
      path: item.output_path,
      description: `${item.stage} stage output (${item.outcome})`,
    })

    if (item.record_path) {
      references.push({
        path: item.record_path,
        description: `${item.stage} execution record`,
      })
    }
  }

  for (const feedback of state.operator_feedback ?? []) {
    const label =
      feedback.decision === 'set-stage'
        ? 'Operator stage repair'
        : 'Operator remediation feedback'

    references.push({
      path: feedback.path,
      description: `${label} (${feedback.from_stage} → ${feedback.to_stage})`,
    })
  }

  for (const waiver of state.operator_gate_waivers ?? []) {
    references.push({
      path: waiver.artifact_path,
      description: `Operator gate waiver for ${waiver.stage}`,
    })

    if (waiver.spotfix_case_path) {
      references.push({
        path: waiver.spotfix_case_path,
        description: 'Open deferred spotfix case',
      })
    }
  }

  for (const ratification of state.operator_workspace_ratifications ?? []) {
    references.push({
      path: ratification.artifact_path,
      description: `Operator-paused workspace ratification for ${ratification.stage}`,
    })
  }

  return references.filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.path === item.path) === index,
  )
}

function pauseForLimit(root: string, state: RunState, reason: string): void {
  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = { type: 'operator_decision' }

  writeDecision(root, state, 'Workflow paused by circuit breaker', reason, [
    `Resume from a chosen stage with: ./bin/pan resume ${state.run_id} --stage <stage>`,
    `Or abort with: ./bin/pan abort ${state.run_id}`,
  ])
}

function executeHarnessStage(
  root: string,
  state: RunState,
  stage: StageDefinition,
  attempt: number,
): PrepareInvocationResult {
  const roots = rootsForRun(root, state)
  const validationPath = toRepoRelative(
    root,
    ledgerValidationPath(roots.state_root, state.run_id),
  )
  const result = validateWorkflowChanges({
    run_id: state.run_id,
    state_root: roots.state_root,
    roots,
  })
  const outcome: StageOutcome =
    result.status === 'passed' ? 'success' : 'blocked'
  const historyItem: StageHistoryItem = {
    stage: stage.slug,
    attempt,
    invocation_id: `${stage.slug}-${attempt}-harness`,
    output_path: validationPath,
    outcome,
    submitted_at: now(),
    workspace_fingerprint: workspaceSnapshotForRun(root, state).fingerprint,
    validation_errors: [],
    deterministic: [],
  }

  state.stage_history.push(historyItem)
  state.latest_ledger_validation = result.status
  state.latest_ledger_validation_path = validationPath

  if (result.status === 'passed') {
    applyTransition(root, state, stage, 'success')
  } else {
    state.status = 'paused'
    state.pending_action = { type: 'operator_decision' }
    state.pause_reason = `validate-changes detected ${result.anomalies.length} anomaly/anomalies.`
    writeDecision(
      root,
      state,
      'validate-changes requires operator adjudication',
      state.pause_reason,
      [
        `Review ${state.latest_ledger_validation_path} before deciding.`,
        `Waive with: ./bin/pan accept-change ${state.run_id} --waive`,
        `Restart at a stage with: ./bin/pan resume ${state.run_id} --stage <stage>`,
      ],
    )
  }

  persist(root, state, 'harness_stage_executed', {
    stage: stage.slug,
    attempt,
    status: result.status,
  })

  return { state, invocation: null }
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

  if (state.transition_count > state.limits.max_total_transitions) {
    pauseForLimit(root, state, 'Maximum workflow transitions exceeded.')
    return
  }

  if (state.consecutive_failures > state.limits.max_consecutive_failures) {
    pauseForLimit(root, state, 'Maximum consecutive failures exceeded.')
    return
  }

  if (target === 'succeeded' || target === 'failed' || target === 'canceled') {
    releaseWorkflowLeaseIfHeld(state)
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
      [`Resume with: ./bin/pan resume ${state.run_id}`],
    )
    return
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

export function createRun(root: string, options: CreateRunOptions): RunState {
  const workflowSlug = options.workflowSlug ?? 'dev'
  const requestPath = options.requestPath

  invariant(requestPath, '--request is required.', {
    code: 'REQUEST_REQUIRED',
  })

  const workflow = loadWorkflow(root, workflowSlug)
  const pipelineConfig = loadPipelineConfig(root)

  for (const stage of workflow.stages) {
    resolvePersonaModel(pipelineConfig.config, stage.persona)

    if (stage.persona !== 'orchestrator') {
      invariant(
        fileExists(path.join(root, '.cursor', 'agents', `${stage.persona}.md`)),
        `Missing Cursor agent for persona '${stage.persona}'.`,
        { code: 'MISSING_CURSOR_AGENT' },
      )
    }
  }

  const agentModelDrift = syncCursorAgentModels(root, pipelineConfig).filter(
    (entry) => entry.changed,
  )

  invariant(
    agentModelDrift.length === 0,
    'Cursor agent models do not match the active pipeline config. Run ./bin/pan models --sync.',
    {
      code: 'PIPELINE_CONFIG_NOT_SYNCED',
      details: { agents: agentModelDrift.map((entry) => entry.path) },
    },
  )

  const source = resolveInside(root, requestPath)

  invariant(fileExists(source), `Request file does not exist: ${requestPath}`, {
    code: 'REQUEST_NOT_FOUND',
  })

  const id = makeRunId()
  const directory = runDir(root, id)

  for (const child of [
    'invocations',
    'outputs',
    'assessments',
    'evidence',
    'records',
    'decisions',
    'artifacts',
  ]) {
    ensureDir(path.join(directory, child))
  }

  const requestExtension = path.extname(source) || '.md'
  const storedRequest = `runtime/logs/workflows/${id}/request${requestExtension}`
  copyFileSync(source, resolveInside(root, storedRequest))

  const workspaceRoot = normalizeWorkspaceRoot(root, options.workspace)
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: resolveInside(root, workspaceRoot),
  })
  const gateOverrides = readGateOverrides(root, options.gatesPath)

  const workflowSnapshot = `runtime/logs/workflows/${id}/workflow.snapshot.json`
  const workflowSnapshotValue = structuredClone(workflow)

  for (const stage of workflowSnapshotValue.stages) {
    stage.prompt = loadStagePrompt(root, stage)
    stage.prompt_sha256 = sha256(stage.prompt)
  }

  writeJsonAtomic(resolveInside(root, workflowSnapshot), workflowSnapshotValue)

  const pipelineConfigSnapshot = `runtime/logs/workflows/${id}/pipeline-config.snapshot.json`
  const pipelineConfigSnapshotValue = makePipelineConfigSnapshot(pipelineConfig)

  writeJsonAtomic(
    resolveInside(root, pipelineConfigSnapshot),
    pipelineConfigSnapshotValue,
  )

  const state: RunState = {
    schema_version: 1,
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

  persist(root, state, 'run_created', {
    workflow: workflow.slug,
    pipeline_config: pipelineConfig.name,
    workspace_root: workspaceRoot,
    state_root: roots.state_root,
  })

  return state
}

export function prepareInvocation(
  root: string,
  runId: string,
): PrepareInvocationResult {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'running',
      `Run is not running: ${state.status}`,
      {
        code: 'RUN_NOT_RUNNING',
      },
    )

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

    const model = resolvePersonaModel(pipelineConfig, stage.persona)
    const attempt = (state.attempts[stage.slug] ?? 0) + 1

    if (attempt > state.limits.max_stage_attempts) {
      pauseForLimit(
        root,
        state,
        `Stage '${stage.slug}' exceeded ` +
          `${state.limits.max_stage_attempts} attempts.`,
      )
      persist(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation: null }
    }

    state.attempts[stage.slug] = attempt

    ensureMutatingWorkflowInitialized(root, state, stage)

    if (stage.executor === 'harness') {
      return executeHarnessStage(root, state, stage, attempt)
    }

    const invocationId = `${stage.slug}-${attempt}-${randomUUID().slice(0, 8)}`
    const outputPath = `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`
    const jsonPath = `runtime/logs/workflows/${runId}/invocations/${invocationId}.json`
    const markdownPath = `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`

    const workspace = workspaceSnapshotForRun(root, state)
    const policies = resolvePolicies(root, {
      persona: stage.persona,
      workflow: workflow.slug,
      stage: stage.slug,
    })
    const nextAction =
      stage.persona === 'orchestrator'
        ? `Complete this stage in the current chat with model '${model}' ` +
          `when available, write ${outputPath}, then submit it.`
        : `Invoke the '${stage.persona}' Cursor subagent configured for ` +
          `'${model}' with this card, then submit ${outputPath}.`

    const invocation: Invocation = {
      $operator: {
        headline: `${stage.title} is ready`,
        summary:
          `The harness prepared attempt ${attempt} with model '${model}', ` +
          `${policies.length} scoped policies, and a workspace fingerprint.`,
        next_action: nextAction,
      },
      schema_version: 1,
      invocation_id: invocationId,
      run_id: runId,
      attempt,
      created_at: now(),
      workspace_root: state.workspace_root || '.',
      ...(state.gate_overrides ? { gate_overrides: state.gate_overrides } : {}),
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
        model,
        model_config: pipelineConfig.name,
        workspace_policy: stage.workspace_policy,
        gate: stage.gate,
      },
      prompt: loadStagePrompt(root, stage),
      inputs: { references: referencesForRun(state) },
      policies,
      rubric: stage.criteria,
      output: {
        path: outputPath,
        template: 'library/templates/stage-output.example.json',
        schema: 'library/schemas/stage-output.schema.json',
        required_data: stage.required_data ?? {},
      },
      boundaries: [
        'You MUST read this invocation card before broader repository context.',
        `You MUST respect workspace policy '${stage.workspace_policy}'.`,
        'You MUST write only the declared output and evidence.',
        'You MUST NOT alter workflow state directly.',
        'While a mutating workflow is active, external edits to tracked files MUST be avoided because cooperative locks cannot block non-harness writers.',
        'You MUST NOT commit, push, merge, publish, deploy, or perform destructive source-control actions.',
      ],
      workspace_before: workspace,
    }

    const renderedMarkdown = renderInvocationMarkdown(invocation)
    const invocationValidation = validateInvocationMarkdown(
      invocation,
      renderedMarkdown,
    )
    const invocationValidationArtifactPath = invocationValidationPath(
      runId,
      invocationId,
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

    invariant(
      invocationValidation.passed,
      'Invocation markdown failed policy manifest validation.',
      {
        code: 'INVOCATION_VALIDATION_FAILED',
        details: {
          validation_path: invocationValidationArtifactPath,
          summary: invocationValidationArtifact.summary,
        },
      },
    )

    writeJsonAtomic(resolveInside(root, jsonPath), invocation)
    writeTextAtomic(resolveInside(root, markdownPath), renderedMarkdown)

    state.current_invocation = {
      id: invocationId,
      json_path: jsonPath,
      markdown_path: markdownPath,
      output_path: outputPath,
    }
    state.pending_action = {
      type: 'invoke_agent',
      persona: stage.persona,
      path: markdownPath,
    }

    persist(root, state, 'invocation_prepared', {
      invocation_id: invocationId,
      stage: stage.slug,
      attempt,
    })

    return { state, invocation }
  })
}

function effectiveOutcome(
  stage: StageDefinition,
  output: StageOutput,
  validationErrors: string[],
  deterministic: DeterministicResult[],
): StageOutcome {
  if (validationErrors.length > 0) {
    return 'failure'
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

  if (deterministic.some((item) => item.hard && !item.passed)) {
    return 'failure'
  }

  return 'success'
}

export function submitOutput(
  root: string,
  runId: string,
  submittedPath: string,
): { state: RunState; record: TaskRecord; idempotent?: boolean } {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId)
    const submittedValue = readJson(resolveInside(root, submittedPath))
    const invocationId = submittedInvocationId(submittedValue)
    const existing = invocationId
      ? state.stage_history.find((item) => item.invocation_id === invocationId)
      : undefined

    if (existing?.record_path) {
      const recordPath = existing.record_path.replace(/\.md$/u, '.json')

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

    if (stage.persona !== 'orchestrator') {
      const delegationArtifactPath = delegationPath(
        runId,
        invocation.invocation_id,
      )
      const delegationAbsolute = resolveInside(root, delegationArtifactPath)

      invariant(
        fileExists(delegationAbsolute),
        'Delegation artifact is missing for the active invocation.',
        {
          code: 'DELEGATION_ARTIFACT_MISSING',
          details: { path: delegationArtifactPath },
        },
      )

      const canonicalMarkdown = readText(
        resolveInside(root, state.current_invocation.markdown_path),
      )
      const delegationMarkdown = readText(delegationAbsolute)
      const delegationValidation = validateDelegationMarkdown(
        canonicalMarkdown,
        delegationMarkdown,
      )
      const delegationValidationArtifactPath = delegationValidationPath(
        runId,
        invocation.invocation_id,
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

      invariant(
        delegationValidation.passed,
        'Delegation artifact failed canonical invocation validation.',
        {
          code: 'DELEGATION_VALIDATION_FAILED',
          details: {
            validation_path: delegationValidationArtifactPath,
            summary: delegationValidationArtifact.summary,
          },
        },
      )
    }

    const validation = validateStageOutput(
      root,
      stage,
      invocation,
      submittedValue,
    )

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
    )
    const outcome = effectiveOutcome(
      stage,
      validation.output,
      validation.errors,
      evaluated.results,
    )
    const historyItem: StageHistoryItem = {
      stage: stage.slug,
      attempt: invocation.attempt,
      invocation_id: invocation.invocation_id,
      output_path: state.current_invocation.output_path,
      outcome,
      submitted_at: now(),
      workspace_fingerprint: evaluated.workspace.fingerprint,
      validation_errors: validation.errors,
      deterministic: evaluated.results,
    }

    state.stage_history.push(historyItem)

    let nextState: string | null

    if (outcome === 'success' && stage.gate === 'supervisor') {
      const assessmentId = `assessment-${invocation.invocation_id}`
      const assessmentPath =
        `runtime/logs/workflows/${runId}/assessments/` + `${assessmentId}.json`
      const cardPath =
        `runtime/logs/workflows/${runId}/assessments/` +
        `${assessmentId}.request.json`

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
    } else if (outcome === 'success' && stage.gate === 'operator') {
      state.pending_action = {
        type: 'operator_approval',
        stage: stage.slug,
        proposed_transition: stage.transitions.success,
      }
      state.status = 'awaiting_operator'
      nextState = 'awaiting operator approval'
    } else {
      applyTransition(root, state, stage, outcome)
      nextState =
        state.status === 'running' ? state.current_stage : state.status
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
        deterministic: evaluated.results,
        self: validation.output.criteria,
      },
      workspace_fingerprint: evaluated.workspace.fingerprint,
      next_state: nextState,
      timestamp: now(),
    }
    const recordBase =
      `runtime/logs/workflows/${runId}/records/` + invocation.invocation_id

    writeJsonAtomic(resolveInside(root, `${recordBase}.json`), record)
    writeTextAtomic(
      resolveInside(root, `${recordBase}.md`),
      renderTaskRecord(record),
    )

    historyItem.record_path = `${recordBase}.md`

    persist(root, state, 'stage_output_submitted', {
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
  return withFileLock(lockPath(root, runId), () => {
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

    if (assessment.verdict === 'escalate') {
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

    persist(root, state, 'supervisor_assessment_recorded', {
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
  const relativePath =
    `runtime/logs/workflows/${state.run_id}/artifacts/` +
    `operator-feedback-${index}.md`
  const heading =
    decision === 'reject' ? 'Operator rejection' : 'Operator remediation note'
  const body = [
    `# ${heading}: ${fromStage.title} (\`${fromStage.slug}\`)`,
    '',
    `**Run** \`${state.run_id}\` · **Source attempt** ${attempt} · ` +
      `**Remediation stage** \`${toStage}\``,
    '',
    '## Required changes',
    '',
    note.trim().length > 0
      ? note.trim()
      : 'The operator rejected this stage without written feedback. ' +
        'Treat the prior output as unacceptable and re-derive the work.',
    '',
    'You MUST address this feedback before the run can reach the operator ' +
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
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'awaiting_operator' &&
        state.pending_action.type === 'operator_approval',
      'Run is not awaiting operator approval.',
      { code: 'INVALID_RUN_ACTION' },
    )
    invariant(
      decision === 'approve' || decision === 'reject',
      'Decision MUST be approve or reject.',
      { code: 'INVALID_DECISION' },
    )

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)

    state.status = 'running'

    if (decision === 'approve') {
      applyTransition(root, state, stage, 'success')
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

    persist(root, state, 'operator_decision_recorded', {
      stage: stage.slug,
      decision,
      note,
      target_stage: decision === 'reject' ? state.current_stage : null,
    })

    return state
  })
}

/**
 * Move a run to an operator-selected stage outside normal workflow transitions.
 * The operator contract requires any executing worker process to be terminated
 * before this function is invoked; the durable state cannot observe process
 * lifetime, so the action is audited rather than inferred.
 */
export function setRunStage(
  root: string,
  runId: string,
  stageSlug: string,
  note: string,
): RunState {
  return withFileLock(lockPath(root, runId), () => {
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
    const relativePath =
      `runtime/logs/workflows/${state.run_id}/artifacts/` +
      `operator-feedback-${index}.md`
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
    state.status = 'running'
    state.current_stage = stageSlug
    state.pending_action = { type: 'prepare_invocation' }
    state.current_invocation = null
    state.pause_reason = null
    state.operator_pause = null
    state.accepted_workspace_fingerprint = null
    state.transition_count = 0
    state.consecutive_failures = 0

    persist(root, state, 'operator_stage_set', {
      from_stage: fromStage,
      to_stage: stageSlug,
      note_path: relativePath,
    })

    return state
  })
}

function readPauseWorkspaceIndex(
  root: string,
  pause: OperatorPauseContext,
): WorkspaceIndex | null {
  if (!pause.workspace_index_path) {
    return null
  }

  const value = readJson(resolveInside(root, pause.workspace_index_path))

  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      typeof value.workspace_id === 'string' &&
      typeof value.workspace_root === 'string' &&
      typeof value.scope_hash === 'string' &&
      isRecord(value.entries),
    'Operator pause workspace index is invalid.',
    { code: 'INVALID_PAUSE_WORKSPACE_INDEX' },
  )

  return value as unknown as WorkspaceIndex
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

  const initialRoots = rootsForRun(root, state)
  const current = snapshotWorkspace(initialRoots, false)

  if (current.snapshot.fingerprint === before.fingerprint) {
    return null
  }

  const roots = acquireRunWorkspaceTracking(root, state)
  let acceptedIndex = loadWorkspaceIndex(roots.state_root)

  if (!acceptedIndex) {
    acceptedIndex = readPauseWorkspaceIndex(root, pause)

    invariant(
      acceptedIndex,
      'Workspace index is missing and the pause has no recoverable start index.',
      { code: 'MISSING_WORKSPACE_INDEX' },
    )
    saveWorkspaceIndex(roots.state_root, acceptedIndex)
  }

  const acceptedSnapshot = workspaceSnapshotFromIndex(acceptedIndex)

  invariant(
    acceptedSnapshot.fingerprint === before.fingerprint,
    'Workspace already diverged before the operator pause; use accept-change or restart the owning stage instead of auto-ratifying the pause delta.',
    { code: 'PREEXISTING_WORKSPACE_DIVERGENCE' },
  )

  writeRunWorkspaceBaseline(state, roots, acceptedIndex)

  const ratificationId = `pause-${randomUUID()}`
  const adopted = adoptAuthorizedWorkspaceChanges({
    state_root: roots.state_root,
    roots,
    workflow_id: state.run_id,
    stage: state.current_stage ?? 'unknown',
    stage_attempt: state.current_stage
      ? (state.attempts[state.current_stage] ?? 0)
      : 0,
    authorization_id: ratificationId,
  })
  const ratifications = state.operator_workspace_ratifications ?? []
  const relativePath =
    `runtime/logs/workflows/${state.run_id}/artifacts/` +
    `operator-pause-ratification-${ratifications.length + 1}.md`
  const body = [
    '# Operator-paused workspace ratification',
    '',
    `**Run** \`${state.run_id}\` · **Stage** \`${state.current_stage ?? 'none'}\``,
    '',
    'The operator explicitly paused the workflow before making these tracked-file changes. The harness recorded the resulting delta in the workflow ledger and adopted the resulting workspace fingerprint.',
    '',
    `**Accepted fingerprint:** \`${adopted.workspace_fingerprint}\``,
    '',
    '## Changed paths',
    '',
    ...(adopted.changed_paths.length > 0
      ? adopted.changed_paths.map((item) => `- \`${item}\``)
      : ['- None']),
    '',
    '## Deleted paths',
    '',
    ...(adopted.deleted_paths.length > 0
      ? adopted.deleted_paths.map((item) => `- \`${item}\``)
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
    workspace_fingerprint: adopted.workspace_fingerprint,
    changed_paths: adopted.changed_paths,
    deleted_paths: adopted.deleted_paths,
    note,
    artifact_path: relativePath,
    timestamp: now(),
  }

  ratifications.push(ratification)
  state.operator_workspace_ratifications = ratifications
  state.accepted_workspace_fingerprint = adopted.workspace_fingerprint

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

export function pauseRun(root: string, runId: string, note = ''): RunState {
  return withFileLock(lockPath(root, runId), () => {
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

      const roots = rootsForRun(root, state)
      const workspace = snapshotWorkspace(roots, false)
      const workspaceIndexPath =
        `runtime/logs/workflows/${state.run_id}/artifacts/` +
        `operator-pause-workspace-${state.revision + 1}.json`

      writeJsonAtomic(resolveInside(root, workspaceIndexPath), workspace.index)

      state.workspace_id = roots.workspace_id
      state.installation_root = roots.installation_root
      state.state_root = roots.state_root
      state.scope_hash = roots.scope_hash
      state.operator_pause = {
        prior_status: state.status,
        prior_pending_action: JSON.parse(
          JSON.stringify(state.pending_action),
        ) as OperatorPauseContext['prior_pending_action'],
        workspace_before: workspace.snapshot,
        workspace_index_path: workspaceIndexPath,
      }
    }

    state.status = 'paused'
    state.pause_reason = reason
    state.pending_action = { type: 'operator_decision' }

    writeDecision(root, state, 'Operator paused the workflow', reason, [
      `Resume with: ./bin/pan resume ${state.run_id}`,
      `Or abort with: ./bin/pan abort ${state.run_id}`,
      'While paused, you may modify tracked files in the workspace as needed.',
    ])

    persist(root, state, 'operator_pause', { note: reason })

    return state
  })
}

export function resumeRun(
  root: string,
  runId: string,
  stageSlug: string | null = null,
  note = '',
): RunState {
  return withFileLock(lockPath(root, runId), () => {
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

      if (ratification) {
        invalidatePausedInvocation(state)
      } else {
        state.status = savedPause.prior_status
        state.pending_action = savedPause.prior_pending_action
      }

      state.operator_pause = null
      state.pause_reason = null

      persist(root, state, 'run_resumed', {
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

    persist(root, state, 'run_resumed', {
      stage: target,
      workspace_ratification: ratification?.ratification_id ?? null,
    })

    return state
  })
}

export interface WaiveGateOptions {
  stageSlug?: string | null
  criterionIds: string[]
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

      return deterministic.get(criterion.id)?.passed === false
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
 * Record an explicit operator waiver for every failed hard criterion on the
 * latest attempt of a paused stage, then advance as though that stage passed.
 * The waiver is bound to the exact invocation and workspace fingerprint.
 */
export function waiveGate(
  root: string,
  runId: string,
  options: WaiveGateOptions,
): { state: RunState; waiver: OperatorGateWaiver } {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'paused' &&
        state.pending_action.type === 'operator_decision',
      'Run is not paused for an operator decision.',
      { code: 'INVALID_RUN_ACTION' },
    )
    invariant(
      options.note.trim().length > 0,
      'Waiver note MUST be non-empty.',
      {
        code: 'WAIVER_NOTE_REQUIRED',
      },
    )

    const workflow = loadRunWorkflow(root, state)
    const stageSlug = options.stageSlug ?? state.current_stage

    invariant(stageSlug, 'Run has no stage to waive.', {
      code: 'INVALID_RUN_ACTION',
    })
    invariant(
      state.current_stage === stageSlug,
      'A gate waiver MUST target the run current stage.',
      { code: 'INVALID_WAIVER_STAGE' },
    )

    const stage = stageBySlug(workflow, stageSlug)

    invariant(
      stage.executor !== 'harness',
      'Harness stages require accept-change adjudication, not a gate waiver.',
      {
        code: 'INVALID_WAIVER_STAGE',
      },
    )

    const history = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === stageSlug)

    invariant(history, 'No stage attempt is available to waive.', {
      code: 'NO_FAILED_GATE',
    })

    const assessmentPath =
      `runtime/logs/workflows/${state.run_id}/assessments/` +
      `assessment-${history.invocation_id}.json`
    const assessment =
      stage.gate === 'supervisor' &&
      fileExists(resolveInside(root, assessmentPath))
        ? parseSupervisorAssessment(
            readJson(resolveInside(root, assessmentPath)),
            assessmentPath,
          )
        : null

    if (assessment) {
      invariant(
        assessment.invocation_id === history.invocation_id,
        'Supervisor assessment does not belong to the latest stage attempt.',
        { code: 'INVALID_WAIVER_TARGET' },
      )
    }

    invariant(
      history?.outcome === 'failure' || assessment?.verdict === 'fail',
      'No failed stage attempt is available to waive.',
      {
        code: 'NO_FAILED_GATE',
      },
    )
    invariant(
      history.validation_errors.length === 0,
      'Malformed stage output cannot be waived; repair and resubmit the stage.',
      { code: 'INVALID_WAIVER_TARGET' },
    )
    invariant(history.record_path, 'Failed stage record is missing.', {
      code: 'INVALID_WAIVER_TARGET',
    })

    const record = readTaskRecord(
      root,
      history.record_path.replace(/\.md$/u, '.json'),
    )
    const blockers = failedHardCriteria(stage, record, assessment)
    const requested = normalizeIdentifiers(options.criterionIds)
    const sourceEvidencePath =
      assessment?.verdict === 'fail' ? assessmentPath : history.record_path

    invariant(
      blockers.length > 0,
      'The failed attempt has no declared hard criterion failure to waive.',
      {
        code: 'NO_FAILED_GATE',
      },
    )
    invariant(
      requested.length > 0,
      'At least one --criteria value is required.',
      {
        code: 'INVALID_WAIVER_CRITERIA',
      },
    )
    invariant(
      requested.length === blockers.length &&
        requested.every((criterionId) => blockers.includes(criterionId)),
      `Waiver criteria MUST exactly match the failed hard criteria: ${blockers.join(', ')}.`,
      {
        code: 'INVALID_WAIVER_CRITERIA',
        details: { failed_hard_criteria: blockers, requested },
      },
    )

    const roots = rootsForRun(root, state)
    const workspace = snapshotWorkspace(roots, false).snapshot

    invariant(
      workspace.fingerprint === history.workspace_fingerprint,
      'Workspace changed after the failed gate. Ratify the workspace change or rerun the owning stage before waiving its gate.',
      { code: 'STALE_WAIVER_FINGERPRINT' },
    )

    const deferred = normalizeIdentifiers(
      options.deferredAcceptanceCriteria ?? [],
    )

    if (options.createSpotfixCase) {
      invariant(
        deferred.length > 0,
        '--spotfix requires at least one deferred acceptance criterion.',
        { code: 'INVALID_SPOTFIX_CASE' },
      )
    } else {
      invariant(
        deferred.length === 0,
        'Deferred acceptance criteria require --spotfix so the follow-up is tracked.',
        { code: 'INVALID_SPOTFIX_CASE' },
      )
    }

    const waivers = state.operator_gate_waivers ?? []
    const waiverId = `waiver-${randomUUID()}`
    const artifactPath =
      `runtime/logs/workflows/${state.run_id}/artifacts/` +
      `gate-waiver-${waivers.length + 1}.md`
    const spotfixCasePath = options.createSpotfixCase
      ? writeSpotfixCase(
          root,
          state,
          waiverId,
          stage,
          history,
          requested,
          deferred,
          options.note,
          sourceEvidencePath,
        )
      : undefined
    const body = [
      '# Operator gate waiver',
      '',
      `**Run** \`${state.run_id}\` · **Stage** \`${stage.slug}\` · ` +
        `**Invocation** \`${history.invocation_id}\` · **Attempt** ${history.attempt}`,
      '',
      `**Workspace fingerprint:** \`${workspace.fingerprint}\``,
      `**Gate evidence:** \`${sourceEvidencePath}\``,
      '',
      '## Waived hard criteria',
      '',
      ...requested.map((item) => `- \`${item}\``),
      '',
      '## Operator rationale',
      '',
      options.note.trim(),
      '',
      ...(deferred.length > 0
        ? [
            '## Deferred acceptance criteria',
            '',
            ...deferred.map((item) => `- \`${item}\``),
            '',
            `**Spotfix case:** \`${spotfixCasePath}\``,
            '',
          ]
        : []),
      'This waiver is valid only for the invocation and workspace fingerprint above. A later attempt or workspace change does not inherit it.',
      '',
    ].join('\n')

    writeTextAtomic(resolveInside(root, artifactPath), `${body}\n`)

    const waiver: OperatorGateWaiver = {
      waiver_id: waiverId,
      stage: stage.slug,
      source_invocation_id: history.invocation_id,
      source_attempt: history.attempt,
      source_evidence_path: sourceEvidencePath,
      criterion_ids: requested,
      workspace_fingerprint: workspace.fingerprint,
      note: options.note,
      artifact_path: artifactPath,
      deferred_acceptance_criteria: deferred,
      ...(spotfixCasePath ? { spotfix_case_path: spotfixCasePath } : {}),
      timestamp: now(),
    }

    waivers.push(waiver)
    state.operator_gate_waivers = waivers
    state.status = 'running'
    state.pause_reason = null
    state.operator_pause = null
    state.current_invocation = null
    state.consecutive_failures = 0

    if (stage.gate === 'operator') {
      state.status = 'awaiting_operator'
      state.current_stage = stage.slug
      state.pending_action = {
        type: 'operator_approval',
        stage: stage.slug,
        proposed_transition: stage.transitions.success,
      }
    } else {
      applyTransition(root, state, stage, 'success', {
        operatorDirected: true,
      })
    }

    state.last_decision_path = artifactPath

    persist(root, state, 'operator_gate_waived', {
      waiver_id: waiverId,
      stage: stage.slug,
      source_invocation_id: history.invocation_id,
      source_attempt: history.attempt,
      source_evidence_path: sourceEvidencePath,
      criterion_ids: requested,
      workspace_fingerprint: workspace.fingerprint,
      spotfix_case_path: spotfixCasePath ?? null,
    })

    return { state, waiver }
  })
}

export function acceptChange(
  root: string,
  runId: string,
  note = '',
  waive = false,
): RunState {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'paused' &&
        state.pending_action.type === 'operator_decision',
      'Run is not paused for an operator decision.',
      { code: 'INVALID_RUN_ACTION' },
    )

    const target = state.current_stage
    invariant(target, 'Run has no current stage to resume.', {
      code: 'INVALID_RUN_ACTION',
    })
    const roots = rootsForRun(root, state)
    const snapshot = snapshotWorkspace(roots, waive)
    const fingerprint = snapshot.snapshot.fingerprint

    if (waive) {
      const waived = waiveLedgerValidation(roots.state_root, state.run_id)
      state.latest_ledger_validation = waived.status
      state.latest_ledger_validation_path = toRepoRelative(
        root,
        ledgerValidationPath(roots.state_root, state.run_id),
      )
    }

    state.accepted_workspace_fingerprint = fingerprint
    state.status = 'running'
    state.current_invocation = null
    state.pause_reason = null
    state.consecutive_failures = 0

    if (waive) {
      const workflow = loadRunWorkflow(root, state)
      const stage = stageBySlug(workflow, target)

      state.current_stage = target
      applyTransition(root, state, stage, 'success', {
        operatorDirected: true,
      })
    } else {
      state.current_stage = target
      state.pending_action = { type: 'prepare_invocation' }
    }

    writeDecision(
      root,
      state,
      waive
        ? 'Operator waived validate-changes anomalies'
        : 'Operator accepted an intentional workspace change',
      note ||
        (waive
          ? 'Operator waived validate-changes anomalies and adopted the current workspace index as accepted state.'
          : 'Operator attested the current workspace is intentional; review and QA evidence is honored against the accepted fingerprint.'),
      [`Continue with: ./bin/pan prepare ${state.run_id}`],
    )

    persist(root, state, 'workspace_change_accepted', {
      stage: target,
      accepted_workspace_fingerprint: fingerprint,
      waived_validation: waive,
      note,
    })

    return state
  })
}

export function abortRun(root: string, runId: string, note = ''): RunState {
  return withFileLock(lockPath(root, runId), () => {
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
    state.operator_pause = null

    persist(root, state, 'run_canceled', { note })

    return state
  })
}

export function getRunStatus(
  root: string,
  runId: string,
  options: StatusOptions = {},
): RunState | string {
  const state = loadState(root, runId)

  if (options.json) {
    return state
  }

  const validationStatus = state.current_invocation
    ? loadInvocationValidationStatus(root, runId, state.current_invocation.id)
    : null

  return renderStatus(state, validationStatus)
}

export function getRunState(root: string, runId: string): RunState {
  return loadState(root, runId)
}
