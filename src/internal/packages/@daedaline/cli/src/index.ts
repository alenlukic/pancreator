/**
 * @packageDocumentation
 * `ddl` workspace CLI entry and programmatic driver.
 */
import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export const DAEDALINE_CLI_VERSION = "0.0.0" as const;

/** @deprecated Prefer `DAEDALINE_CLI_VERSION`. */
export const DAEDALINE_CLI_STUB = "cli" as const;

/** @deprecated Prefer `DAEDALINE_CLI_VERSION`. */
export function cliStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
}

export type { CliRunOptions } from "./run.js";
export {
  parseAndRun,
  DDL_ACTIVE_MEMORY_CONFLICT_EXIT_CODE,
  DDL_DEFERRED_EXIT_CODE,
} from "./run.js";
