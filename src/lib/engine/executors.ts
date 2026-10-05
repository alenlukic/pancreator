/**
 * External executors: readiness preflights, tool and write policies, and the
 * Claude Code and OpenAI adapters.
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PanError } from '../errors.js'
import type { ParsedPersonaMapping } from '../executors/mapping.js'
import { cursorAuthenticationReadiness } from '../executors/cursor-probe.js'
import { cursorAgentBinaryReadiness } from '../executors/cursor-agent.js'
import { fileExists, isRecord, resolveInside } from '../io.js'
import { panCommand } from '../project-config.js'
import {
  claudeCodeCredentialPreflight,
  claudeCodeVersionPreflight,
  runClaudeCode,
} from '../executors/claude-code.js'
import {
  openAiExecutorPreflight,
  resolveOpenAiApiKey,
} from '../executors/openai-auth.js'
import {
  OPENAI_TOOL_NAMES,
  type OpenAiToolPolicy,
} from '../executors/openai-tools.js'
import {
  OPENAI_SESSION_DEFAULTS,
  redactOpenAiKey,
} from '../executors/openai-session.js'
import {
  COPILOT_READ_TOOLS,
  COPILOT_SHELL_TOOLS,
  COPILOT_WRITE_TOOLS,
  copilotCliBinary,
  copilotCliPreflight,
  copilotProviderOf,
  resolveCopilotCredential,
  runCopilotCli,
} from '../executors/copilot-cli.js'
import { projectionTargetPath } from '../projection/manifest.js'
import { now, writeDecision } from '../state.js'
import type {
  ExternalExecutorAdapter,
  ExternalMcpCapabilities,
  ExternalRequestSettings,
  PersonaExecutorKind,
  RunState,
  StageDefinition,
} from '../types.js'

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

/**
 * Verify the openai executor can run: platform capability plus a resolvable
 * credential. Both checks are local and make no request, so the cached result
 * saves work rather than a spent invocation.
 */
function ensureOpenAiReady(
  root: string,
  state: RunState,
): { ok: true } | { ok: false; error: string } {
  if (state.openai_preflight) {
    return { ok: true }
  }

  const preflight = openAiExecutorPreflight(root)

  if (!preflight.ok) {
    return { ok: false, error: preflight.error ?? 'preflight failed' }
  }

  state.openai_preflight = {
    key_source: preflight.key_source ?? 'unknown',
    verified_at: now(),
  }

  return { ok: true }
}

/**
 * Verify the copilot executor can run: the binary, its version, every flag the
 * adapter passes, and the credential the mapping's provider needs. Each check
 * is local, so no request is spent.
 */
function ensureCopilotReady(
  root: string,
  state: RunState,
  mapping: ParsedPersonaMapping | undefined,
): { ok: true } | { ok: false; error: string } {
  if (
    state.copilot_preflight === undefined ||
    state.copilot_preflight.binary !== copilotCliBinary()
  ) {
    const preflight = copilotCliPreflight()

    if (!preflight.ok) {
      return { ok: false, error: preflight.error ?? 'preflight failed' }
    }

    state.copilot_preflight = {
      binary: preflight.binary,
      version: preflight.version ?? 'unknown',
      verified_at: now(),
    }
  }

  const credential = resolveCopilotCredential(
    root,
    copilotProviderOf(mapping?.options ?? {}),
  )

  return credential.ok
    ? { ok: true }
    : { ok: false, error: credential.report.error ?? 'no credential' }
}

/**
 * Checks that the `cursor-agent` binary is installed and a Cursor API key is
 * available. Returns an error message instead of throwing when either is
 * missing.
 */
export function ensureCursorReady(
  root: string,
): { ok: true } | { ok: false; error: string } {
  const binary = cursorAgentBinaryReadiness()

  if (!binary.ok) {
    return { ok: false, error: binary.error }
  }

  const authentication = cursorAuthenticationReadiness(root)

  return authentication.key_available
    ? { ok: true }
    : { ok: false, error: authentication.advisories.join(' ') }
}

/**
 * Runs the readiness preflight for one persona executor (Cursor, Claude Code,
 * OpenAI, or Copilot) and returns an error message instead of throwing when it
 * fails. The Claude Code, OpenAI, and Copilot checks cache a successful result
 * on the run state, which the caller persists. The Copilot check also resolves
 * the credential of the provider `mapping` names. Throws
 * `EXECUTOR_UNSUPPORTED` for an unknown executor kind.
 */
export function ensureExecutorReady(
  root: string,
  state: RunState,
  executor: PersonaExecutorKind,
  mapping?: ParsedPersonaMapping,
): { ok: true } | { ok: false; error: string } {
  switch (executor) {
    case 'cursor':
      return ensureCursorReady(root)
    case 'claude-code':
      return ensureClaudeCodeReady(state)
    case 'openai':
      return ensureOpenAiReady(root, state)
    case 'copilot':
      return ensureCopilotReady(root, state, mapping)
    default: {
      const exhaustive: never = executor

      throw new PanError(`Unhandled persona executor: ${String(exhaustive)}`, {
        code: 'EXECUTOR_UNSUPPORTED',
      })
    }
  }
}

/** One remedy per executor, so a new kind cannot inherit another's by order. */
const EXECUTOR_PREFLIGHT_REMEDY: Record<PersonaExecutorKind, string> = {
  cursor:
    'Install cursor-agent and provide CURSOR_API_KEY in the process environment or repository-local .env file',
  'claude-code': 'Install and authenticate the Claude Code CLI on this machine',
  openai: 'Export OPENAI_API_KEY, or add it to the repository-local .env file',
  copilot:
    'Install the GitHub Copilot CLI and sign in with copilot login, or add the key the mapping provider names (OPENAI_API_KEY or ANTHROPIC_API_KEY) to the repository-local .env file',
}

function executorPreflightRemedy(executor: PersonaExecutorKind): string {
  return EXECUTOR_PREFLIGHT_REMEDY[executor]
}

/**
 * Pauses the run for an operator decision because a stage's executor failed its
 * preflight, and writes a decision record with the executor-specific remedy,
 * resume, remap, and abort options. Mutates the state without persisting it.
 *
 * Pausing is deliberate: substituting another executor would falsify the run's
 * model snapshot.
 */
export function pauseForExecutorPreflight(
  root: string,
  state: RunState,
  stage: StageDefinition,
  executor: PersonaExecutorKind,
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
    `${executorPreflightRemedy(executor)}, then resume with: ` +
      `${panCommand(root)} resume ${state.run_id}`,
    'Or change the persona mapping in config.json, run ' +
      `${panCommand(root)} models --sync, and start a new run.`,
    `Or abort with: ${panCommand(root)} abort ${state.run_id}`,
  ])
}

/** Whether a stage's workspace policy lets its executor change source. */
function stageMutatesSource(stage: StageDefinition): boolean {
  return (
    stage.workspace_policy === 'source_allowed' ||
    stage.workspace_policy === 'release_metadata_only'
  )
}

/**
 * Absolute directories a stage's executor may write into. A non-source stage
 * reaches only the harness runtime tree, where its declared output, evidence,
 * and brief artifacts live. Both external executors consume this one decision:
 * Claude Code renders it into `Write(...)` and `Edit(...)` rules, and the
 * OpenAI tool loop hands it to its path authorizer.
 */
export function stageWriteRoots(
  root: string,
  workspaceDir: string,
  stage: StageDefinition,
): string[] {
  const runtimeTree = path.join(root, 'runtime')

  return stageMutatesSource(stage)
    ? [...new Set([workspaceDir, runtimeTree])]
    : [runtimeTree]
}

/**
 * Write rules for a non-source stage, expressed relative to the executor's
 * working directory when the runtime tree is reachable that way, and absolute
 * (`//`) otherwise, which is the detached-installation case.
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
  const workspaceWritable = stageWriteRoots(root, workspaceDir, stage).includes(
    workspaceDir,
  )
  const allowedTools = [
    'Read',
    'Grep',
    'Glob',
    ...(workspaceWritable
      ? ['Bash', 'Write', 'Edit']
      : claudeCodeWriteRules(root, workspaceDir)),
  ]
  const relative = path.relative(workspaceDir, root)
  const addDirs = relative.startsWith('..') ? [root] : []

  return { allowedTools, addDirs }
}

/**
 * Stage-derived tool policy for an openai invocation. The model reads the run
 * workspace and the harness root, and writes only where the stage allows.
 */
export function openAiToolPolicy(
  root: string,
  workspaceDir: string,
  stage: StageDefinition,
  bounds: { maxResultBytes: number; shellTimeoutMs: number },
): OpenAiToolPolicy {
  return {
    workspaceDir,
    readRoots: [...new Set([workspaceDir, root])],
    writeRoots: stageWriteRoots(root, workspaceDir, stage),
    allowedTools: stageWriteRoots(root, workspaceDir, stage).includes(
      workspaceDir,
    )
      ? [...OPENAI_TOOL_NAMES]
      : OPENAI_TOOL_NAMES.filter((name) => name !== 'run_shell'),
    maxResultBytes: bounds.maxResultBytes,
    shellTimeoutMs: bounds.shellTimeoutMs,
  }
}

const OPENAI_AGENT_ENTRYPOINT = 'openai-agent-cli.js'

/**
 * Pancreator offers an OpenAI-executed persona no MCP-backed tool. The
 * harness's MCP servers are local stdio processes Cursor launches, and the
 * Responses hosted-MCP tool reaches remote HTTP or SSE servers only. The
 * record states the gap rather than omitting the field, so a stage that owes a
 * browser verdict reports the case as environment-blocked under BROWSER-001.
 */
const OPENAI_MCP_CAPABILITIES: ExternalMcpCapabilities = {
  offered: [],
  reason:
    'Pancreator MCP servers are local stdio processes the Cursor client hosts. ' +
    'The Responses API reaches only remote MCP endpoints, so no MCP-backed ' +
    'tool, including isolated browser inspection, is offered to this executor.',
}

function openAiAgentEntrypoint(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    OPENAI_AGENT_ENTRYPOINT,
  )
}

function positiveIntegerOption(
  options: Record<string, string>,
  key: string,
): number | undefined {
  const raw = options[key]

  if (raw === undefined) {
    return undefined
  }

  const parsed = Number(raw)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

interface OpenAiAdapterContext {
  root: string
  runId: string
  invocationId: string
  stage: StageDefinition
  workspaceDir: string
  mapping: ParsedPersonaMapping
  evidenceDir: string
  timeoutOverrideMs?: number
}

/**
 * The openai adapter runs the Responses tool loop in a child process.
 * `delegateInvocation` holds a synchronous run mutex whose helper releases on
 * return, so an awaited loop inline would drop the lock mid-delegation. The
 * child keeps the mutex, the evidence shape, and the process-level timeout
 * identical to the Claude Code path, and keeps the key out of the argument
 * vector the evidence records.
 */
export function createOpenAiAdapter(
  context: OpenAiAdapterContext,
): ExternalExecutorAdapter {
  const credential = resolveOpenAiApiKey(context.root)
  const apiKey = credential.key ?? ''
  const entrypoint = openAiAgentEntrypoint()
  const options = context.mapping.options

  const sessionTimeoutMs =
    context.timeoutOverrideMs ??
    positiveIntegerOption(options, 'timeout-ms') ??
    OPENAI_SESSION_DEFAULTS.sessionTimeoutMs
  const maxToolRounds =
    positiveIntegerOption(options, 'max-tool-rounds') ??
    OPENAI_SESSION_DEFAULTS.maxToolRounds
  const maxOutputTokens = positiveIntegerOption(options, 'max-output-tokens')
  const effort = options.effort

  // Validated against their enums by parsePersonaMapping, so the adapter
  // forwards them as-is rather than re-deriving the accepted sets here.
  const mode = options.mode
  const reasoningContext = options.context
  const summary = options.summary
  const verbosity = options.verbosity

  const responseParameters = {
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(mode ? { reasoning_mode: mode } : {}),
    ...(reasoningContext ? { reasoning_context: reasoningContext } : {}),
    ...(summary ? { reasoning_summary: summary } : {}),
    ...(verbosity ? { text_verbosity: verbosity } : {}),
  }

  const toolPolicy = openAiToolPolicy(
    context.root,
    context.workspaceDir,
    context.stage,
    {
      maxResultBytes: OPENAI_SESSION_DEFAULTS.maxToolResultBytes,
      shellTimeoutMs: Math.min(
        OPENAI_SESSION_DEFAULTS.shellTimeoutMs,
        sessionTimeoutMs,
      ),
    },
  )
  const requestSettings: ExternalRequestSettings = {
    model: context.mapping.model,
    store: false,
    ...responseParameters,
    ...(maxOutputTokens !== undefined
      ? { max_output_tokens: maxOutputTokens }
      : {}),
    max_tool_rounds: maxToolRounds,
    timeout_ms: sessionTimeoutMs,
    max_tool_result_bytes: toolPolicy.maxResultBytes,
  }
  const transcriptPathFor = (sessionId: string): string =>
    `${context.evidenceDir}/${sessionId}.openai-transcript.json`
  const sanitize = (text: string): string => redactOpenAiKey(text, apiKey)

  return {
    kind: 'openai',
    sanitize,
    run: (prompt, resumeSessionId) => {
      const sessionId = `openai-${context.invocationId}-${randomUUID().slice(0, 8)}`
      const request = {
        model: context.mapping.model,
        prompt,
        invocation_id: context.invocationId,
        stage: context.stage.slug,
        session_id: sessionId,
        ...responseParameters,
        ...(maxOutputTokens !== undefined
          ? { max_output_tokens: maxOutputTokens }
          : {}),
        max_tool_rounds: maxToolRounds,
        request_timeout_ms: sessionTimeoutMs,
        session_timeout_ms: sessionTimeoutMs,
        transcript_path: resolveInside(
          context.root,
          transcriptPathFor(sessionId),
        ),
        transcript_max_bytes: OPENAI_SESSION_DEFAULTS.transcriptMaxBytes,
        ...(resumeSessionId
          ? {
              resume_transcript_path: resolveInside(
                context.root,
                transcriptPathFor(resumeSessionId),
              ),
            }
          : {}),
        tool_policy: toolPolicy,
      }

      const argv = [entrypoint]
      const startedAt = Date.now()
      const spawned = spawnSync(process.execPath, argv, {
        cwd: context.workspaceDir,
        encoding: 'utf8',
        input: JSON.stringify(request),
        // The child reports its own named bound; the process timeout is the
        // outer guard for a child that never returns at all.
        timeout: sessionTimeoutMs + 30_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, OPENAI_API_KEY: apiKey },
      })

      const durationMs = Date.now() - startedAt
      const timedOut =
        (spawned.error as NodeJS.ErrnoException | undefined)?.code ===
        'ETIMEDOUT'
      const stdout = sanitize(spawned.stdout ?? '')
      const stderr = sanitize(spawned.stderr ?? '')

      const base = {
        binary: process.execPath,
        argv,
        exit_code: spawned.status,
        timed_out: timedOut,
        duration_ms: durationMs,
        stdout,
        stderr,
        request_settings: requestSettings,
        mcp_capabilities: OPENAI_MCP_CAPABILITIES,
      }

      if (spawned.error && !timedOut) {
        return {
          ...base,
          ok: false,
          error: `Failed to spawn the OpenAI executor: ${spawned.error.message}`,
        }
      }

      let parsed: unknown

      try {
        parsed = JSON.parse(stdout.trim().split('\n').at(-1) ?? '')
      } catch {
        parsed = null
      }

      if (!isRecord(parsed)) {
        return {
          ...base,
          ok: false,
          session_id: sessionId,
          error: timedOut
            ? `OpenAI delegation timed out after ${durationMs}ms.`
            : 'The OpenAI executor exited without the expected JSON result payload.',
        }
      }

      const payload = parsed as {
        ok?: unknown
        session_id?: unknown
        rounds?: unknown
        response_ids?: unknown
        tool_summary?: unknown
        usage?: unknown
        error?: unknown
        failure_reason?: unknown
      }

      return {
        ...base,
        ok: payload.ok === true && spawned.status === 0,
        session_id:
          typeof payload.session_id === 'string'
            ? payload.session_id
            : sessionId,
        ...(Array.isArray(payload.response_ids)
          ? {
              response_ids: payload.response_ids.filter(
                (id): id is string => typeof id === 'string',
              ),
            }
          : {}),
        ...(isRecord(payload.tool_summary)
          ? { tool_summary: payload.tool_summary as Record<string, number> }
          : {}),
        ...(isRecord(payload.usage)
          ? {
              usage: payload.usage as {
                input_tokens: number
                output_tokens: number
                total_tokens: number
              },
            }
          : {}),
        ...(typeof payload.failure_reason === 'string'
          ? { failure_reason: payload.failure_reason }
          : {}),
        ...(payload.ok === true && spawned.status === 0
          ? {}
          : {
              is_error: true,
              error: sanitize(
                typeof payload.error === 'string'
                  ? payload.error
                  : `The OpenAI executor exited with status ${spawned.status}.`,
              ),
            }),
      }
    },
  }
}

/**
 * Returns an external executor adapter that runs a prompt through the Claude
 * Code CLI in the stage workspace with the mapping's model and permission mode
 * and the stage's tool policy, optionally resuming a session, and reports the
 * process result. Each `run` call spawns one `claude` process synchronously.
 */
export function createClaudeCodeAdapter(context: {
  workspaceDir: string
  mapping: ParsedPersonaMapping
  policy: { allowedTools: string[]; addDirs: string[] }
  timeoutMs?: number
}): ExternalExecutorAdapter {
  return {
    kind: 'claude-code',
    sanitize: (text) => text,
    run: (prompt, resumeSessionId) => {
      const result = runClaudeCode({
        prompt,
        cwd: context.workspaceDir,
        model: context.mapping.model,
        permissionMode: context.mapping.options['permission-mode'] ?? 'default',
        allowedTools: context.policy.allowedTools,
        addDirs: context.policy.addDirs,
        ...(resumeSessionId ? { resumeSessionId } : {}),
        ...(context.timeoutMs !== undefined
          ? { timeoutMs: context.timeoutMs }
          : {}),
      })

      return {
        ok: result.ok,
        binary: result.binary,
        argv: result.argv,
        exit_code: result.exit_code,
        timed_out: result.timed_out,
        duration_ms: result.duration_ms,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.session_id ? { session_id: result.session_id } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(result.parsed?.subtype
          ? { result_subtype: result.parsed.subtype }
          : {}),
        ...(result.parsed?.is_error !== undefined
          ? { is_error: result.parsed.is_error }
          : {}),
      }
    },
  }
}

export interface CopilotToolPolicy {
  availableTools: string[]
  addDirs: string[]
  /** The projected custom agent, when `.github/agents` carries one. */
  agent?: string
}

/**
 * Stage-derived tool policy for a copilot invocation. A stage whose write
 * roots exclude the workspace gets no shell tool, and no stage gets the
 * `task` subagent tool, the question tool, or a built-in MCP server. The
 * CLI verifies file paths against its working directory and `--add-dir`
 * roots, so the harness root and the projected agents directory join them
 * when they sit outside the workspace. `scope.no_unapproved_changes` remains
 * the gate of record for workspace mutation.
 */
export function copilotToolPolicy(
  root: string,
  workspaceDir: string,
  stage: StageDefinition,
  persona: string,
): CopilotToolPolicy {
  const workspaceWritable = stageWriteRoots(root, workspaceDir, stage).includes(
    workspaceDir,
  )
  const agentFile = path.resolve(
    projectionTargetPath(root, `.github/agents/pan-${persona}.agent.md`),
  )
  const agentHome = path.resolve(path.dirname(agentFile), '..', '..')
  const agentProjected = fileExists(agentFile)
  const outside = (directory: string): boolean =>
    path.relative(workspaceDir, directory).startsWith('..')
  const addDirs = [
    ...new Set(
      [path.resolve(root), ...(agentProjected ? [agentHome] : [])].filter(
        outside,
      ),
    ),
  ]

  return {
    availableTools: [
      ...COPILOT_READ_TOOLS,
      ...COPILOT_WRITE_TOOLS,
      ...(workspaceWritable ? COPILOT_SHELL_TOOLS : []),
    ],
    addDirs,
    ...(agentProjected ? { agent: `pan-${persona}` } : {}),
  }
}

/**
 * Pancreator offers a Copilot-executed persona no MCP-backed tool until the
 * VS Code MCP projection lands, so a stage that owes a browser verdict reports
 * the case as environment-blocked under BROWSER-001.
 */
const COPILOT_MCP_CAPABILITIES: ExternalMcpCapabilities = {
  offered: [],
  reason:
    'The copilot executor runs with --disable-builtin-mcps and receives no ' +
    'Pancreator MCP configuration, so no MCP-backed tool, including isolated ' +
    'browser inspection, is offered to it.',
}

/**
 * Returns an external executor adapter that runs a prompt through the Copilot
 * CLI in the stage workspace. Each `run` call spawns one `copilot` process
 * synchronously, with the card on stdin, the mapping's model, provider, and
 * effort, and the stage's tool policy. A model the JSONL stream names that
 * differs from the requested model fails the delegation.
 */
export function createCopilotAdapter(context: {
  root: string
  workspaceDir: string
  stage: StageDefinition
  persona: string
  mapping: ParsedPersonaMapping
  timeoutMs?: number
}): ExternalExecutorAdapter {
  const provider = copilotProviderOf(context.mapping.options)
  const credential = resolveCopilotCredential(context.root, provider)
  const secret = credential.ok ? credential.credential.secret : null
  const sanitize = (text: string): string =>
    secret && secret.length > 0 ? text.replaceAll(secret, '[REDACTED]') : text
  const policy = copilotToolPolicy(
    context.root,
    context.workspaceDir,
    context.stage,
    context.persona,
  )

  return {
    kind: 'copilot',
    sanitize,
    run: (prompt, resumeSessionId) => {
      if (!credential.ok) {
        return {
          ok: false,
          binary: copilotCliBinary(),
          argv: [],
          exit_code: null,
          timed_out: false,
          duration_ms: 0,
          stdout: '',
          stderr: '',
          error: credential.report.error ?? 'no Copilot CLI credential',
        }
      }

      const result = runCopilotCli({
        prompt,
        cwd: context.workspaceDir,
        model: context.mapping.model,
        ...(policy.agent ? { agent: policy.agent } : {}),
        ...(context.mapping.options.effort
          ? { effort: context.mapping.options.effort }
          : {}),
        availableTools: policy.availableTools,
        addDirs: policy.addDirs,
        ...(resumeSessionId ? { resumeSessionId } : {}),
        ...(context.timeoutMs !== undefined
          ? { timeoutMs: context.timeoutMs }
          : {}),
        environment: credential.credential.environment,
      })
      const reported = result.parsed?.model
      const modelError =
        result.ok &&
        reported !== undefined &&
        reported !== context.mapping.model
          ? `Copilot CLI reported model '${reported}' but the mapping requested '${context.mapping.model}'.`
          : null

      const ok = result.ok && modelError === null

      return {
        ok,
        is_error: !ok,
        binary: result.binary,
        argv: result.argv,
        exit_code: result.exit_code,
        timed_out: result.timed_out,
        duration_ms: result.duration_ms,
        stdout: sanitize(result.stdout),
        stderr: sanitize(result.stderr),
        ...(result.session_id ? { session_id: result.session_id } : {}),
        ...(reported ? { reported_model: reported } : {}),
        model_verification: reported
          ? { status: 'compared', expected_model: context.mapping.model }
          : {
              status: 'unverifiable',
              reason: 'the Copilot CLI JSONL stream named no model',
            },
        mcp_capabilities: COPILOT_MCP_CAPABILITIES,
        tool_policy: {
          granted_roots: [context.workspaceDir, ...policy.addDirs],
          per_path_write_policy: false,
          scope_gate: 'scope.no_unapproved_changes',
        },
        ...(modelError !== null
          ? { error: modelError }
          : result.error
            ? { error: sanitize(result.error) }
            : {}),
      }
    },
  }
}
