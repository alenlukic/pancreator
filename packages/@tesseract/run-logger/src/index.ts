import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. OpenInference run logging lands in Phase 3+.
 */
export const TESSERACT_RUN_LOGGER_STUB = "run-logger" as const;

export function runLoggerStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
