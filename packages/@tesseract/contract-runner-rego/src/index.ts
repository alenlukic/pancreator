import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. Rego runner lands in Phase 2+.
 */
export const TESSERACT_CONTRACT_RUNNER_REGO_STUB = "contract-runner-rego" as const;

export function contractRunnerRegoStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
