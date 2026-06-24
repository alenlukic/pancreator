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
  RunState,
  StageDefinition,
  StageHistoryItem,
  StageOutcome,
  StageOutput,
  SupervisorAssessment,
  TaskRecord,
  WorkflowDefinition,
} from './types.js'
import {
  evaluateDeterministicCriteria,
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
  readActiveWorkflowLease,
  releaseActiveWorkflowLease,
  snapshotWorkspace,
  writeWorkflowBaseline,
} from './workspace/index.js'
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

function ensureMutatingWorkflowInitialized(
  root: string,
  state: RunState,
  stage: StageDefinition,
): void {
  if (stage.workspace_policy !== 'source_allowed') {
    return
  }

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

  const reconciled = snapshotWorkspace(roots, true)
  const lockConflicts = listFileLocks(roots.state_root).filter(
    (lock) => lock.workflow_id !== state.run_id,
  )

  invariant(
    lockConflicts.length === 0,
    'Cannot start mutating stage while unrelated file locks are present.',
    { code: 'LOCK_HELD' },
  )

  writeWorkflowBaseline(
    roots.state_root,
    state.run_id,
    roots,
    reconciled.index,
    sha256({
      workspace_id: roots.workspace_id,
      scope_hash: roots.scope_hash,
      workspace_root: roots.workspace_root,
      state_root: roots.state_root,
    }),
  )
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
    references.push({
      path: feedback.path,
      description:
        `Operator remediation feedback ` +
        `(${feedback.from_stage} → ${feedback.to_stage})`,
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

    writeJsonAtomic(resolveInside(root, jsonPath), invocation)
    writeTextAtomic(
      resolveInside(root, markdownPath),
      renderInvocationMarkdown(invocation),
    )

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
    state.consecutive_failures = 0

    persist(root, state, 'run_resumed', { stage: target })

    return state
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

  return options.json ? state : renderStatus(state)
}

export function getRunState(root: string, runId: string): RunState {
  return loadState(root, runId)
}
