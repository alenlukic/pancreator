/**
 * @packageDocumentation
 * Harness boundary types for Cursor-oriented invocation (no horizontal import of `@tesseract/persona`).
 * Callers SHOULD pass objects shaped like the `PersonaSpec` type from `@tesseract/persona`.
 */

/**
 * Minimal persona view required to build a dry-run invocation envelope.
 * Structural match to the validated spec from `@tesseract/persona` without importing that package.
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

export interface RunnerInvokeInput {
  persona: RunnerPersonaInput;
  /** User or operator message for this step. */
  message: string;
  /** Optional correlation id for run logs. */
  requestId?: string;
}

export const RUNNER_INVOCATION_SCHEMA_VERSION = "1" as const;

/**
 * Structured envelope the control plane and observability layers consume; no LLM call in this slice.
 */
export interface RunnerInvocationEnvelope {
  schemaVersion: typeof RUNNER_INVOCATION_SCHEMA_VERSION;
  runner: "cursor";
  dryRun: true;
  personaName: string;
  requestId: string;
  userMessage: string;
  resolved: {
    model: string;
    routingDescription: string;
    toolAllowlist: readonly string[];
    toolDenylist: readonly string[];
    maxTurns: number;
  };
}

export interface Runner {
  invoke(input: RunnerInvokeInput): Promise<RunnerInvocationEnvelope>;
}
