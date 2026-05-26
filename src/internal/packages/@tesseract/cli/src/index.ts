/**
 * @packageDocumentation
 * `tess` workspace CLI entry and programmatic driver.
 */
import { TESSERACT_CORE_VERSION } from "@tesseract/core";

export const TESSERACT_CLI_VERSION = "0.0.0" as const;

/** @deprecated Prefer `TESSERACT_CLI_VERSION`. */
export const TESSERACT_CLI_STUB = "cli" as const;

/** @deprecated Prefer `TESSERACT_CLI_VERSION`. */
export function cliStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

export type { CliRunOptions } from "./run.js";
export {
  parseAndRun,
  TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE,
  TESS_DEFERRED_EXIT_CODE,
} from "./run.js";
