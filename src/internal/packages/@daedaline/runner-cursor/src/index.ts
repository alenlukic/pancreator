/**
 * @packageDocumentation
 * Cursor harness runner: builds invocation envelopes for a persona binding and user message.
 */
import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export const DAEDALINE_RUNNER_CURSOR_VERSION = "0.0.0" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export const DAEDALINE_RUNNER_CURSOR_STUB = "runner-cursor" as const;

/** @deprecated Meta-package probe; prefer package exports. */
export function runnerCursorStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
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
