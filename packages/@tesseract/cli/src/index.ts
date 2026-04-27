import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. `tess` CLI is deferred to Phase 3+.
 */
export const TESSERACT_CLI_STUB = "cli" as const;

export function cliStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
