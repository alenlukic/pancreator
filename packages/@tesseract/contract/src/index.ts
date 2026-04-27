import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Contract wrapper and runners land in Phase 2+.
 */
export const TESSERACT_CONTRACT_STUB = "contract" as const;

export function contractStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
