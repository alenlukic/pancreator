import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Intervention spectrum lands in Phase 3+.
 */
export const TESSERACT_INTERVENTION_STUB = "intervention" as const;

export function interventionStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
