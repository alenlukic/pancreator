import {randomUUID} from 'node:crypto'
import {copyFileSync} from 'node:fs'
import path from 'node:path'

import {invariant} from './errors.js'
import {gitWorkspaceSnapshot} from './git.js'
import {
  ensureDir,
  fileExists,
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
import {resolvePolicies} from './policies.js'
import {
  renderInvocationMarkdown,
  renderStatus,
  renderTaskRecord,
} from './render.js'
import {
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

interface CreateRunOptions {
  workflowSlug?: string
  requestPath: string | null
  title?: string | null
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

  return references.filter(
    (item, index, all) =>
      all.findIndex((candidate) => candidate.path === item.path) === index,
  )
}

function pauseForLimit(root: string, state: RunState, reason: string): void {
  state.status = 'paused'
  state.pause_reason = reason
  state.pending_action = {type: 'operator_decision'}

  writeDecision(root, state, 'Workflow paused by circuit breaker', reason, [
    `Resume from a chosen stage with: ./bin/pan resume ${state.run_id} --stage <stage>`,
    `Or abort with: ./bin/pan abort ${state.run_id}`,
  ])
}

function applyTransition(
  root: string,
  state: RunState,
  stage: StageDefinition,
  outcome: StageOutcome,
): void {
  state.transition_count += 1
  state.consecutive_failures =
    outcome === 'failure' ? state.consecutive_failures + 1 : 0

  const target = stage.transitions[outcome]

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
    state.status = target
    state.current_stage = null
    state.pending_action = {type: 'none'}
    return
  }

  if (target === 'paused') {
    state.status = 'paused'
    state.pause_reason = `Stage '${stage.slug}' reported ${outcome}.`
    state.pending_action = {type: 'operator_decision'}

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
  state.pending_action = {type: 'prepare_invocation'}
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
    {code: 'INVALID_INVOCATION'},
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
    {code: 'INVALID_ASSESSMENT'},
  )
  invariant(
    typeof value.invocation_id === 'string' && value.invocation_id.length > 0,
    'Assessment invocation_id MUST be a non-empty string.',
    {code: 'INVALID_ASSESSMENT'},
  )
  invariant(
    value.verdict === 'pass' ||
      value.verdict === 'fail' ||
      value.verdict === 'escalate',
    'Assessment verdict MUST be pass, fail, or escalate.',
    {code: 'INVALID_ASSESSMENT'},
  )
  invariant(
    Array.isArray(value.criteria),
    'Assessment criteria MUST be an array.',
    {code: 'INVALID_ASSESSMENT'},
  )
  invariant(
    typeof value.summary === 'string' && value.summary.length > 0,
    'Assessment summary MUST be a non-empty string.',
    {code: 'INVALID_ASSESSMENT'},
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

  const workflowSnapshot = `runtime/logs/workflows/${id}/workflow.snapshot.json`
  const workflowSnapshotValue = structuredClone(workflow)

  for (const stage of workflowSnapshotValue.stages) {
    stage.prompt = loadStagePrompt(root, stage)
    stage.prompt_sha256 = sha256(stage.prompt)
  }

  writeJsonAtomic(resolveInside(root, workflowSnapshot), workflowSnapshotValue)

  const state: RunState = {
    schema_version: 1,
    run_id: id,
    workflow_slug: workflow.slug,
    workflow_snapshot: {
      path: workflowSnapshot,
      sha256: sha256(workflowSnapshotValue),
    },
    title: options.title ?? path.basename(requestPath),
    status: 'running',
    current_stage: workflow.start_stage,
    pending_action: {type: 'prepare_invocation'},
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

  persist(root, state, 'run_created', {workflow: workflow.slug})

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
        details: {pending: state.pending_action},
      },
    )

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)
    const attempt = (state.attempts[stage.slug] ?? 0) + 1

    if (attempt > state.limits.max_stage_attempts) {
      pauseForLimit(
        root,
        state,
        `Stage '${stage.slug}' exceeded ` +
          `${state.limits.max_stage_attempts} attempts.`,
      )
      persist(root, state, 'run_paused', {reason: state.pause_reason})

      return {state, invocation: null}
    }

    state.attempts[stage.slug] = attempt

    const invocationId = `${stage.slug}-${attempt}-${randomUUID().slice(0, 8)}`
    const outputPath = `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`
    const jsonPath = `runtime/logs/workflows/${runId}/invocations/${invocationId}.json`
    const markdownPath = `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`

    const workspace = gitWorkspaceSnapshot(root)
    const policies = resolvePolicies(root, {
      persona: stage.persona,
      workflow: workflow.slug,
      stage: stage.slug,
    })
    const nextAction =
      stage.persona === 'orchestrator'
        ? `Complete this stage in the current chat, write ${outputPath}, ` +
          'then submit it.'
        : `Invoke the '${stage.persona}' Cursor subagent with this card, ` +
          `then submit ${outputPath}.`

    const invocation: Invocation = {
      $operator: {
        headline: `${stage.title} is ready`,
        summary:
          `The harness prepared attempt ${attempt} with ` +
          `${policies.length} scoped policies and a workspace fingerprint.`,
        next_action: nextAction,
      },
      schema_version: 1,
      invocation_id: invocationId,
      run_id: runId,
      attempt,
      created_at: now(),
      workflow: {
        slug: workflow.slug,
        snapshot_path: state.workflow_snapshot.path,
        snapshot_sha256: state.workflow_snapshot.sha256,
      },
      stage: {
        slug: stage.slug,
        title: stage.title,
        persona: stage.persona,
        model_hint: stage.model_hint,
        workspace_policy: stage.workspace_policy,
        gate: stage.gate,
      },
      prompt: loadStagePrompt(root, stage),
      inputs: {references: referencesForRun(state)},
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

    return {state, invocation}
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
): {state: RunState; record: TaskRecord; idempotent?: boolean} {
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
      {code: 'INVALID_RUN_ACTION'},
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

    return {state, record}
  })
}

export function assessStage(
  root: string,
  runId: string,
  assessmentPath: string,
): {state: RunState; assessment: SupervisorAssessment} {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'awaiting_supervisor' &&
        state.pending_action.type === 'supervisor_assessment',
      'Run is not awaiting supervisor assessment.',
      {code: 'INVALID_RUN_ACTION'},
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
      {code: 'INVALID_ASSESSMENT'},
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
      state.pending_action = {type: 'operator_decision'}

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

    return {state, assessment}
  })
}

export function decideRun(
  root: string,
  runId: string,
  decision: string,
  note = '',
): RunState {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(
      state.status === 'awaiting_operator' &&
        state.pending_action.type === 'operator_approval',
      'Run is not awaiting operator approval.',
      {code: 'INVALID_RUN_ACTION'},
    )
    invariant(
      decision === 'approve' || decision === 'reject',
      'Decision MUST be approve or reject.',
      {code: 'INVALID_DECISION'},
    )

    const workflow = loadRunWorkflow(root, state)
    const stage = stageBySlug(workflow, state.current_stage)

    state.status = 'running'
    applyTransition(
      root,
      state,
      stage,
      decision === 'approve' ? 'success' : 'failure',
    )
    persist(root, state, 'operator_decision_recorded', {
      stage: stage.slug,
      decision,
      note,
    })

    return state
  })
}

export function resumeRun(
  root: string,
  runId: string,
  stageSlug: string | null = null,
): RunState {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId)

    invariant(state.status === 'paused', 'Only paused runs can be resumed.', {
      code: 'INVALID_RUN_ACTION',
    })

    const workflow = loadRunWorkflow(root, state)
    const target = stageSlug ?? state.current_stage ?? workflow.start_stage

    stageBySlug(workflow, target)

    state.status = 'running'
    state.current_stage = target
    state.pending_action = {type: 'prepare_invocation'}
    state.current_invocation = null
    state.pause_reason = null
    state.consecutive_failures = 0

    persist(root, state, 'run_resumed', {stage: target})

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
      {code: 'RUN_TERMINAL'},
    )

    state.status = 'canceled'
    state.current_stage = null
    state.pending_action = {type: 'none'}

    persist(root, state, 'run_canceled', {note})

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
