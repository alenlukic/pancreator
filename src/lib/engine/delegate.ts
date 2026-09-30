/**
 * Harness-dispatched delegation of a stage to an external or headless executor.
 */

import path from 'node:path'

import { PanError, invariant } from '../errors.js'
import { cursorModelPredictionForSpec } from '../executors/cursor-probe.js'
import { createCursorAgentAdapter } from '../executors/cursor-agent.js'
import {
  isRecord,
  readJson,
  readText,
  resolveInside,
  withOperationMutex,
  writeJsonAtomic,
  writeTextAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { resolvePersonaMapping } from '../pipeline-config.js'
import { operationMutexPath, loadState, now } from '../state.js'
import type {
  ExternalDelegationRecord,
  ExternalExecutorAdapter,
  ExternalExecutorRunResult,
  Invocation,
  PersonaExecutorKind,
  RunState,
} from '../types.js'
import {
  delegationExecutionPath,
  delegationPath,
  deliveryPromptPath,
  invocationValidationPath,
  sessionRecordPath,
} from '../validation.js'
import { stageBySlug } from '../workflow.js'

import {
  loadRunPipelineConfig,
  loadRunWorkflow,
  type OperationProgressOptions,
  persistRun,
  readInvocation,
  workspaceDirectory,
} from './core.js'
import {
  claudeCodeToolPolicy,
  createClaudeCodeAdapter,
  createOpenAiAdapter,
  ensureExecutorReady,
  pauseForExecutorPreflight,
} from './executors.js'

export interface DelegateInvocationOptions extends OperationProgressOptions {
  timeoutMs?: number
  /** Permit the harness-owned driver to dispatch a Cursor persona. */
  headless?: boolean
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
      mapping.executor !== 'cursor' || options.headless === true,
      `Stage '${stage.slug}' resolves to the '${mapping.executor}' executor. ` +
        `'pan delegate' dispatches only external executors; cursor personas ` +
        `are delegated by the supervisor per INVOCATION-001.`,
      { code: 'EXECUTOR_UNSUPPORTED' },
    )

    // The resolved executor is never rewritten to another one: the prepared
    // invocation has to agree with the mapping, or the card the worker reads
    // would name a runtime the harness is not using.
    const executor: PersonaExecutorKind = mapping.executor

    invariant(
      (invocation.stage.persona_executor ?? 'cursor') === executor,
      `Invocation ${invocationId} was prepared for executor ` +
        `'${invocation.stage.persona_executor ?? 'cursor'}' but its persona ` +
        `now resolves to '${executor}'. Re-prepare the invocation before ` +
        `delegating.`,
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

    const preflight = ensureExecutorReady(root, state, executor)

    if (!preflight.ok) {
      pauseForExecutorPreflight(root, state, stage, executor, preflight.error)
      persistRun(root, state, 'run_paused', { reason: state.pause_reason })

      return { state, invocation, execution: null }
    }

    const workspaceDir = workspaceDirectory(root, state)
    const configuredTimeout = mapping.options['timeout-ms']
    const timeoutMs =
      options.timeoutMs ??
      (configuredTimeout ? Number(configuredTimeout) : undefined)
    const evidenceDir = resolveRunLayout(root, runId).evidence('').relative

    const selectAdapter = (): ExternalExecutorAdapter => {
      switch (executor) {
        case 'cursor':
          return createCursorAgentAdapter({
            workspaceDir,
            installationRoot: root,
            runtimeDir: path.join(root, 'runtime'),
            modelSpec: mapping.model_spec,
            modelVerification: cursorModelPredictionForSpec(
              root,
              mapping.model_spec,
            ),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          })
        case 'claude-code':
          return createClaudeCodeAdapter({
            workspaceDir,
            mapping,
            policy: claudeCodeToolPolicy(root, workspaceDir, stage),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          })
        case 'openai':
          return createOpenAiAdapter({
            root,
            runId,
            invocationId,
            stage,
            workspaceDir,
            mapping,
            evidenceDir,
            ...(options.timeoutMs !== undefined
              ? { timeoutOverrideMs: options.timeoutMs }
              : {}),
          })
        default: {
          const exhaustive: never = executor

          throw new PanError(
            `Unhandled persona executor: ${String(exhaustive)}`,
            { code: 'EXECUTOR_UNSUPPORTED' },
          )
        }
      }
    }
    const adapter: ExternalExecutorAdapter = selectAdapter()
    const runExecutor = (
      prompt: string,
      resumeSessionId?: string,
    ): ExternalExecutorRunResult => adapter.run(prompt, resumeSessionId)
    const writeExecutorLogs = (
      label: string,
      result: ExternalExecutorRunResult,
    ): { stdout_path: string; stderr_path: string } => {
      const stdoutPath = `${evidenceDir}/${invocationId}.${executor}${label}.stdout.json`
      const stderrPath = `${evidenceDir}/${invocationId}.${executor}${label}.stderr.log`

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

    const promptPath =
      executor === 'cursor'
        ? invocation.delegation?.delivery_prompt_path
        : state.current_invocation.markdown_path

    invariant(
      typeof promptPath === 'string' && promptPath.length > 0,
      `Invocation ${invocationId} has no delivery prompt for ${executor}.`,
      { code: 'INVALID_INVOCATION' },
    )

    const cardMarkdown = readText(resolveInside(root, promptPath))
    const delegationArtifactPath = delegationPath(runId, invocationId, root)

    let delegationKind: ExternalDelegationRecord['delegation_kind'] = 'fresh'
    let deliveredPrompt = cardMarkdown
    let result: ExternalExecutorRunResult
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
        `resuming ${executor} session ${resumeSession.session_id} with the operator directive`,
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
          `delegating '${invocation.stage.persona}' to ${executor} (${mapping.model})`,
        )
        result = runExecutor(cardMarkdown)
      }
    } else {
      options.onProgress?.(
        `delegating '${invocation.stage.persona}' to ${executor} (${mapping.model})`,
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
      executor,
      delegated_by: 'harness',
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
      ...(result.result_subtype
        ? { result_subtype: result.result_subtype }
        : {}),
      ...(result.is_error !== undefined ? { is_error: result.is_error } : {}),
      ...logs,
      ...(resumeAttempt ? { resume_attempt: resumeAttempt } : {}),
      delegation_artifact_path: delegationArtifactPath,
      recorded_at: now(),
      ...(result.request_settings
        ? { request_settings: result.request_settings }
        : {}),
      ...(result.tool_summary ? { tool_summary: result.tool_summary } : {}),
      ...(result.response_ids ? { response_ids: result.response_ids } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.failure_reason
        ? { failure_reason: result.failure_reason }
        : {}),
      ...(result.mcp_capabilities
        ? { mcp_capabilities: result.mcp_capabilities }
        : {}),
      ...(result.reported_model
        ? { reported_model: result.reported_model }
        : {}),
      ...(result.model_verification
        ? { model_verification: result.model_verification }
        : {}),
      ...(result.tool_policy ? { tool_policy: result.tool_policy } : {}),
    }

    writeJsonAtomic(
      resolveInside(root, delegationExecutionPath(runId, invocationId, root)),
      execution,
    )

    if (result.session_id) {
      const sessionRecord = {
        executor,
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
        executor,
        delegation_kind: delegationKind,
        exit_code: result.exit_code,
        timed_out: result.timed_out,
        ...(result.failure_reason
          ? { failure_reason: result.failure_reason }
          : {}),
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
      executor,
      delegation_kind: delegationKind,
      session_id: result.session_id ?? null,
    })

    return { state, invocation, execution }
  })
}
