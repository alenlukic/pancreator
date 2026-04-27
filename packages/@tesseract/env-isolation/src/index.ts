import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Environment isolation lands in Phase 3+.
 */
export const TESSERACT_ENV_ISOLATION_STUB = "env-isolation" as const;

export function envIsolationStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
