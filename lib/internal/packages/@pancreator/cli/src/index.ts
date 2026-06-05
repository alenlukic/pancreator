/**
 * @packageDocumentation
 * `pan` workspace CLI entry and programmatic driver.
 */
import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export const PANCREATOR_CLI_VERSION = "0.0.0" as const;

/** @deprecated Prefer `PANCREATOR_CLI_VERSION`. */
export const PANCREATOR_CLI_STUB = "cli" as const;

/** @deprecated Prefer `PANCREATOR_CLI_VERSION`. */
export function cliStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}

export type { CliRunOptions } from "./run.js";
export {
  parseAndRun,
  PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE,
  PAN_DEFERRED_EXIT_CODE,
} from "./run.js";
export type { WorkArchiveHygieneIssue, WorkArchiveHygieneScanResult } from "./work-archive-hygiene.js";
export { isExemptOrphanWorkDirectory, scanWorkArchiveHygiene } from "./work-archive-hygiene.js";
