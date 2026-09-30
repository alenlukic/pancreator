export type StageOutcome = 'success' | 'failure' | 'blocked'

export type RunStatus =
  | 'running'
  | 'awaiting_supervisor'
  | 'awaiting_operator'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'canceled'

export type WorkspacePolicy =
  | 'source_allowed'
  | 'release_metadata_only'
  | 'runtime_only'
  | 'read_only'

export type StageGate =
  | 'operator'
  | 'supervisor'
  | 'next_stage'
  | 'stage_verdict'

export type StageExecutor = 'agent' | 'harness'

/**
 * Which harness runs a persona's worker process. `cursor` delegates to a
 * projected Cursor subagent; `claude-code` spawns the operator-installed
 * Claude Code CLI; `openai` runs a bounded Responses API tool loop in a
 * harness-owned child process. Distinct from `StageExecutor`, which says
 * whether a stage is performed by an agent at all — this says which agent
 * runtime performs it.
 */
export type PersonaExecutorKind = 'cursor' | 'claude-code' | 'openai'

/** Persona executors the harness itself dispatches through `pan delegate`. */
export type ExternalPersonaExecutorKind = Exclude<PersonaExecutorKind, 'cursor'>

/**
 * Non-secret request settings an external executor resolved for one
 * delegation. Recorded so an operator can reproduce the invocation without
 * reading the executor's source.
 */
export interface ExternalRequestSettings {
  model: string
  store: false
  reasoning_effort?: string
  reasoning_mode?: string
  reasoning_context?: string
  reasoning_summary?: string
  text_verbosity?: string
  max_output_tokens?: number
  max_tool_rounds: number
  timeout_ms: number
  max_tool_result_bytes: number
}

/**
 * MCP capability set offered to an external executor. An empty list carries
 * its reason rather than being omitted, so the audit distinguishes "no tools
 * offered" from "the harness forgot to record them".
 */
export interface ExternalMcpCapabilities {
  offered: string[]
  reason?: string
}

/**
 * Executor session recorded after a successful external delegation, so an
 * operator revision round can resume the author's full context instead of
 * starting a fresh invocation.
 */
export interface ExternalExecutorSession {
  executor: PersonaExecutorKind
  session_id: string
  invocation_id: string
  stage: string
  recorded_at: string
}

/** Tool boundary the harness applied to one delegated worker process. */
export interface ExternalExecutorToolPolicy {
  granted_roots: string[]
  per_path_write_policy: boolean
  scope_gate: 'scope.no_unapproved_changes'
}

/**
 * Whether the harness could compare the model an executor reported against a
 * predicted variant. `unverifiable` carries its reason, so a delegation that
 * ran no drift check stays distinguishable from one that ran and matched.
 */
export type ExternalModelVerification =
  | { status: 'compared'; expected_model: string }
  | { status: 'unverifiable'; reason: string }

/** Normalized result returned by every harness-owned executor adapter. */
export interface ExternalExecutorRunResult {
  ok: boolean
  binary: string
  /** Resolved argument vector. Never carries the prompt body or a credential. */
  argv: string[]
  exit_code: number | null
  timed_out: boolean
  duration_ms: number
  stdout: string
  stderr: string
  session_id?: string
  error?: string
  result_subtype?: string
  is_error?: boolean
  request_settings?: ExternalRequestSettings
  tool_summary?: Record<string, number>
  response_ids?: string[]
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
  failure_reason?: string
  mcp_capabilities?: ExternalMcpCapabilities
  reported_model?: string
  model_verification?: ExternalModelVerification
  tool_policy?: ExternalExecutorToolPolicy
}

/** One harness-owned process adapter for a persona executor. */
export interface ExternalExecutorAdapter {
  kind: PersonaExecutorKind
  run: (prompt: string, resumeSessionId?: string) => ExternalExecutorRunResult
  sanitize: (text: string) => string
}

/**
 * Harness-authored audit of one external-executor delegation. The delegation
 * Markdown artifact reproduces the delivered prompt byte for byte; this record
 * carries everything the Markdown cannot: executor identity, the resolved
 * argument vector (excluding the prompt body, which is piped), exit status, and
 * the session the executor returned.
 */
export interface ExternalDelegationRecord {
  schema_version: 1
  run_id: string
  invocation_id: string
  stage: string
  executor: PersonaExecutorKind
  /**
   * Who dispatched the worker. Only the harness writes this record today, so
   * the value is always `harness` and the record's existence is itself the
   * harness-delegation signal `DELEGATE-001`'s watch exemption reads.
   * `operator_session` is reserved for a session-authored record and is not
   * yet produced by any writer.
   */
  delegated_by: 'harness' | 'operator_session'
  /**
   * `fresh` delivers the full canonical card in a new session. `resumed`
   * continues the recorded session with the operator's revision directive.
   * `resume_fallback` records a resume that failed and fell back to a fresh
   * full-card delivery.
   */
  delegation_kind: 'fresh' | 'resumed' | 'resume_fallback'
  binary: string
  argv: string[]
  exit_code: number | null
  timed_out: boolean
  duration_ms: number
  session_id?: string
  resumed_from_session_id?: string
  result_subtype?: string
  is_error?: boolean
  stdout_path: string
  stderr_path: string
  resume_attempt?: {
    exit_code: number | null
    timed_out: boolean
    stdout_path: string
    stderr_path: string
  }
  delegation_artifact_path: string
  recorded_at: string
  /** Populated by executors that resolve their own request parameters. */
  request_settings?: ExternalRequestSettings
  /** Executed tool calls by tool name, for executors that run a tool loop. */
  tool_summary?: Record<string, number>
  /** Provider response identifiers observed during the delegation, in order. */
  response_ids?: string[]
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  /** Named failure bound when a bounded loop terminated early. */
  failure_reason?: string
  /** Always recorded for a tool-loop executor, empty list and reason included. */
  mcp_capabilities?: ExternalMcpCapabilities
  /** Cursor's system/init model, and whether a prediction could check it. */
  reported_model?: string
  model_verification?: ExternalModelVerification
  /** Coarse process roots and the gate that still owns mutation enforcement. */
  tool_policy?: ExternalExecutorToolPolicy
}
