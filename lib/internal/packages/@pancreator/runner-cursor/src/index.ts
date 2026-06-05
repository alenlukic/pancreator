/**
 * @packageDocumentation
 * Cursor harness runner: builds invocation envelopes for a persona binding and user message.
 */
import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export const PANCREATOR_RUNNER_CURSOR_VERSION = "0.0.0" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export const PANCREATOR_RUNNER_CURSOR_STUB = "runner-cursor" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function runnerCursorStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}

export { CursorRunner } from "./cursor-runner.js";
export type {
  CursorRunnerOptions,
  Runner,
  RunnerInvokeInput,
  RunnerInvocationEnvelope,
  RunnerInvocationMode,
  RunnerLedgerContext,
  RunnerPersonaInput,
  RunnerRunLogFragment,
} from "./types.js";
export { RUNNER_INVOCATION_SCHEMA_VERSION } from "./types.js";
export type { CursorSdkTransport, CursorSdkInvokeParams, CursorSdkInvokeResult } from "./sdk-transport.js";
export {
  buildSdkPrompt,
  createDefaultCursorSdkTransport,
  createStreamedCursorSdkTransport,
  findMissingArtifactPaths,
} from "./sdk-transport.js";
export type { CursorSdkUsageCapture } from "./sdk-transport.js";
export {
  assertUsageCaptured,
  collectFromStream,
  createEmptyMetrics,
  createProductionTraceSink,
  createTraceSink,
  drainRunStream,
  extractReadPathsFromToolEvent,
  processStreamEvent,
  redactTraceRecord,
  repoRelativePath,
  TurnEndedUsageMissingError,
  UsageCaptureMissingError,
} from "./sdk-trace-collector.js";
export type {
  ProductionTraceSinkConfig,
  TraceSinkConfig,
  TraceSummary,
  UsageMetrics,
} from "./sdk-trace-collector.js";
export {
  ensureCursorSdkRipgrepConfigured,
  resolveCursorRipgrepBinaryPath,
} from "./cursor-sdk-prereqs.js";
export {
  loadModelEscalationConfig,
  ModelEscalationConfigError,
  parseModelEscalationFile,
  resolveActiveConfigName,
} from "./model-escalation.js";
export type { LoadedModelEscalation, ModelEscalationFileConfig } from "./model-escalation.js";
