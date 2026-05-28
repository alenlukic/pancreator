/**
 * @packageDocumentation
 * Harness boundary types for Cursor-oriented invocation (no horizontal import of `@daedaline/persona`).
 * Callers SHOULD pass objects shaped like the `PersonaSpec` type from `@daedaline/persona`.
 */

/**
 * Minimal persona view required to build a dry-run invocation envelope.
 * Structural match to the validated spec from `@daedaline/persona` without importing that package.
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
  /** Expected stage output artifact path. */
  artifactPath?: string;
  /** Pre-built run-log fragment (caller may omit for runner-generated span). */
  runLogFragment?: RunnerRunLogFragment;
}

export const RUNNER_INVOCATION_SCHEMA_VERSION = "1" as const;

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

export interface CursorRunnerOptions {
  /** Default `manual`; SDK path requires explicit flag or config. */
  invocation?: RunnerInvocationMode;
  /** Repo root or workspace cwd for local SDK runs. */
  cwd?: string;
  /** Overrides `CURSOR_API_KEY` for SDK transport. */
  apiKey?: string;
  /** Injectable SDK transport (defaults to `Agent.prompt`). */
  sdkTransport?: import("./sdk-transport.js").CursorSdkTransport;
}

export interface Runner {
  invoke(input: RunnerInvokeInput): Promise<RunnerInvocationEnvelope>;
}
