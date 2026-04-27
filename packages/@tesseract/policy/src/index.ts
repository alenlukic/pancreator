import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Threshold policy and Conftest land in Phase 2+.
 */
export const TESSERACT_POLICY_STUB = "policy" as const;

export function policyStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
