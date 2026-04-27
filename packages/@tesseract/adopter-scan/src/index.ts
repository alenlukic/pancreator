import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Adopter scan behavior is deferred to Phase 3+.
 */
export const TESSERACT_ADOPTER_SCAN_STUB = "adopter-scan" as const;

export function adopterScanStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
