/**
 * @packageDocumentation
 * Automation registry validation and I/O for `.pan/automations/`.
 */
import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export const PANCREATOR_SCHEDULER_VERSION = "0.0.0" as const;

export {
  AutomationNotFoundError,
  AutomationPathError,
  AutomationValidationError,
  InvalidAutomationIdError,
  SchedulerPathError,
} from "./errors.js";
export { acquireLock, activeLockCount, releaseLock } from "./lock.js";
export { cronMatches, isAutomationDue, nextCronFireAfter } from "./due.js";
export {
  abortRunByTaskId,
  abortSchedulerRunByTaskId,
  appendRunRecord,
  ensureRunsDir,
  readRunRecords,
  readRunRecordsNewestFirst,
  updateRunRecord,
  type RunRecord,
  type RunStatus,
  type RunTrigger,
} from "./run-log.js";
export {
  assertAutomationPathInRegistry,
  assertPathInScheduler,
  assertSafeAutomationId,
  automationFilePath,
  defaultAutomationsDir,
  defaultLocksDir,
  defaultRunsDir,
  defaultSchedulerDir,
  lockFilePath,
  runLogFilePath,
} from "./paths.js";
export {
  createAutomation,
  deleteAutomation,
  ensureAutomationsDir,
  getAutomation,
  listAutomations,
  listDueAutomations,
  updateAutomation,
} from "./registry.js";
export {
  aggregateTickExitCode,
  tickAutomations,
  type TickAutomationOutcome,
  type TickDispatchResult,
  type TickExecutors,
} from "./tick.js";
export {
  formatScheduleLabel,
  isValidCronExpression,
  toAutomationSummary,
  validateAutomationDocument,
  type AgentTrigger,
  type AutomationPolicy,
  type AutomationRecord,
  type AutomationSummary,
  type AutomationTrigger,
  type PanTrigger,
} from "./schema.js";

/** @deprecated Prefer `PANCREATOR_SCHEDULER_VERSION`. */
export function schedulerStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}
