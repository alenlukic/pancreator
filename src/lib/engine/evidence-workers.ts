/**
 * Harness-dispatched delegation of a stage's parallel evidence workers.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import { cursorModelPredictionForSpec } from '../executors/cursor-probe.js'
import { createCursorAgentAdapter } from '../executors/cursor-agent.js'
import {
  fileExists,
  readText,
  resolveInside,
  withOperationMutex,
  writeTextAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { resolvePersonaMapping } from '../pipeline-config.js'
import { runClaudeCode } from '../executors/claude-code.js'
import { operationMutexPath, loadState } from '../state.js'
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
  createCopilotAdapter,
  ensureCursorReady,
  ensureExecutorReady,
  pauseForExecutorPreflight,
} from './executors.js'

export interface EvidenceWorkerDelegation {
  role: string
  persona: string
  evidence_path: string
  skipped: 'already_present' | 'cursor_persona' | 'executor_preflight' | null
  ok: boolean
  exit_code: number | null
  duration_ms: number
  stdout_path: string | null
  stderr_path: string | null
  error?: string
}

/**
 * Run the active invocation's parallel evidence workers as harness-owned
 * processes, so their reports exist before the stage worker is delegated.
 *
 * An operator session still owns its own Cursor launches: without the headless
 * option a Cursor persona is reported as skipped, exactly as `delegateInvocation`
 * refuses one. With it — the option only a harness-owned caller sets — the
 * worker runs through the same Cursor adapter a stage worker uses. Without that
 * path a driven run cannot advance any stage that declares evidence workers,
 * because every persona in the tracked configuration maps to Cursor.
 */
export function delegateEvidenceWorkers(
  root: string,
  runId: string,
  options: OperationProgressOptions & {
    headless?: boolean
    /** Dispatch only these roles, so a caller can run the workers in parallel processes. */
    roles?: string[]
  } = {},
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
  const preflighted = new Set<string>()

  for (const worker of invocation.evidence_workers ?? []) {
    if (options.roles && !options.roles.includes(worker.role)) {
      continue
    }

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
    const headlessCursor =
      mapping.executor === 'cursor' && options.headless === true
    const copilot = mapping.executor === 'copilot'

    if (mapping.executor !== 'claude-code' && !copilot && !headlessCursor) {
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

    if ((headlessCursor || copilot) && !preflighted.has(mapping.raw)) {
      const preflight = headlessCursor
        ? ensureCursorReady(root)
        : ensureExecutorReady(root, state, 'copilot', mapping)

      if (!preflight.ok) {
        // EXECUTOR-001 makes a failed preflight an operator-visible stop that
        // names its remedy. These workers run before the stage delegation that
        // carries that check, so an unready Cursor or Copilot CLI has to pause
        // the run here or it reaches the operator as a spawn error with no
        // remedy. The claude-code path keeps its existing behaviour: its
        // readiness probe spends a real invocation, and the run state that
        // caches one is not written from here.
        withOperationMutex(operationMutexPath(root, runId), () => {
          const paused = loadState(root, runId)

          pauseForExecutorPreflight(
            root,
            paused,
            stage,
            mapping.executor,
            preflight.error,
          )
          persistRun(root, paused, 'run_paused', {
            reason: paused.pause_reason,
          })
        })

        results.push({
          ...base,
          skipped: 'executor_preflight',
          ok: false,
          exit_code: null,
          duration_ms: 0,
          stdout_path: null,
          stderr_path: null,
          error: preflight.error,
        })
        break
      }

      preflighted.add(mapping.raw)
    }

    const brief = readText(resolveInside(root, worker.brief_path))
    const prompt =
      `${brief}\n\n## Evidence report destination\n\n` +
      `Write your complete evidence report as Markdown to ` +
      `\`${path.resolve(root, worker.evidence_path)}\`. ` +
      `That file is the only file you write outside the workspace. ` +
      `Do not submit the stage output; the stage worker owns it.\n`
    const configuredTimeout = mapping.options['timeout-ms']
    const timeoutMs = configuredTimeout ? Number(configuredTimeout) : undefined

    options.onProgress?.(
      `launching ${worker.role} evidence worker (${worker.persona}) via ${mapping.executor}`,
    )

    const result = headlessCursor
      ? createCursorAgentAdapter({
          workspaceDir,
          installationRoot: root,
          runtimeDir: path.join(root, 'runtime'),
          modelSpec: mapping.model_spec,
          modelVerification: cursorModelPredictionForSpec(
            root,
            mapping.model_spec,
          ),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }).run(prompt)
      : copilot
        ? createCopilotAdapter({
            root,
            workspaceDir,
            stage,
            persona: worker.persona,
            mapping,
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          }).run(prompt)
        : runClaudeCode({
            prompt,
            cwd: workspaceDir,
            model: mapping.model,
            permissionMode: mapping.options['permission-mode'] ?? 'default',
            allowedTools: policy.allowedTools,
            addDirs: policy.addDirs,
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          })
    const stdoutPath = `${evidenceDir}/${invocation.invocation_id}.${mapping.executor}.${worker.role}.stdout.json`
    const stderrPath = `${evidenceDir}/${invocation.invocation_id}.${mapping.executor}.${worker.role}.stderr.log`

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
