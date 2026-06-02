/**
 * @packageDocumentation
 * Harness boundary types for Cursor-oriented invocation (no horizontal import of `@pancreator/persona`).
 * Callers SHOULD pass objects shaped like the `PersonaSpec` type from `@pancreator/persona`.
 */

/**
 * Minimal persona view required to build a dry-run invocation envelope.
 * Structural match to the validated spec from `@pancreator/persona` without importing that package.
 */
export interface RunnerPersonaInput {
  name: string;
  description: string;
  model: string;
  permissionMode: string;
  tools: readonly string[];
  disallowedTools: readonly string[];
  mcpServers: readonly string[];
  maxTurns: number;
  skills: readonly string[];
  isolation: string;
  memory: string;
  effort: string;
  color: string;
  metadata: Readonly<Record<string, unknown>>;
}

export type RunnerInvocationMode = "manual" | "sdk";

export interface RunnerLedgerContext {
  taskId: string;
  pipelineId: string;
  stageId: string;
  featureId?: string;
}

/** OpenInference + OTel GenAI fragment for run-log append. */
export interface RunnerRunLogFragment {
  trace_id: string;
  span_id: string;
  name: string;
  attributes: Record<string, unknown>;
}

export interface RunnerInvokeInput {
  persona: RunnerPersonaInput;
  /** User or operator message for this step. */
  message: string;
  /** Optional correlation id for run logs. */
  requestId?: string;
  /** Absolute or repo-relative stage prompt path. */
  stagePromptPath?: string;
  /** Ledger coordinates for observability. */
  ledger?: RunnerLedgerContext;
  /** Expected stage output artifact path (primary). */
  artifactPath?: string;
  /** All repo-relative outputs that MUST exist after SDK stage work. */
  requiredArtifactPaths?: readonly string[];
  /** Inline stage prompt body (preferred over path-only in SDK mode). */
  stagePromptContent?: string;
  /** Pre-built run-log fragment (caller may omit for runner-generated span). */
  runLogFragment?: RunnerRunLogFragment;
  /** Per-stage SDK invocation counter for model escalation tiers. */
  stageInvocationIndex?: number;
  /** Absolute path to run.log.jsonl for escalation observability records. */
  runLogPath?: string;
}

export const RUNNER_INVOCATION_SCHEMA_VERSION = "1" as const;

export interface RunnerEscalationResolved {
  active_config: string;
  persona_slug: string;
  stage_invocation_index: number;
  resolved_model: string;
  full_model_string: string;
}

export interface RunnerResolvedInvocation {
  model: string;
  routingDescription: string;
  toolAllowlist: readonly string[];
  toolDenylist: readonly string[];
  maxTurns: number;
  invocation: RunnerInvocationMode;
  stagePromptPath?: string;
  artifactPath?: string;
  ledger?: RunnerLedgerContext;
  escalation?: RunnerEscalationResolved;
}

/**
 * Structured envelope the control plane and observability layers consume.
 */
export interface RunnerInvocationEnvelope {
  schemaVersion: typeof RUNNER_INVOCATION_SCHEMA_VERSION;
  runner: "cursor";
  dryRun: boolean;
  invocation: RunnerInvocationMode;
  personaName: string;
  requestId: string;
  userMessage: string;
  resolved: RunnerResolvedInvocation;
  runLogFragment?: RunnerRunLogFragment;
  /** Present when SDK transport completes. */
  sdkResult?: {
    artifactPath?: string;
    status: "ok" | "error";
    errorMessage?: string;
    resultText?: string;
  };
}

export type EscalationLogSeverity = "INFO" | "WARN" | "ERROR";

export interface EscalationLogInput {
  runLogPath: string;
  severity: EscalationLogSeverity;
  escalation: Record<string, unknown>;
  ledger?: RunnerLedgerContext;
  warnMessage?: string;
}

export interface CursorRunnerOptions {
  /** Default `manual`; SDK path requires explicit flag or config. */
  invocation?: RunnerInvocationMode;
  /** Repository root for escalation config loading. */
  repoRoot?: string;
  /** Repo root or workspace cwd for local SDK runs. */
  cwd?: string;
  /** Overrides `CURSOR_API_KEY` for SDK transport. */
  apiKey?: string;
  /** Injectable SDK transport (defaults to `Agent.prompt`). */
  sdkTransport?: import("./sdk-transport.js").CursorSdkTransport;
  /** Caller-owned run-log append hook; runner-cursor does not import `@pancreator/run-logger`. */
  appendEscalationLog?: (input: EscalationLogInput) => Promise<void>;
}

export interface Runner {
  invoke(input: RunnerInvokeInput): Promise<RunnerInvocationEnvelope>;
}
