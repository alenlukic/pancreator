/**
 * @packageDocumentation
 * Rego contract evaluation helpers. OPA and Conftest remain out-of-process; this package types the input surface.
 */
export { TESSERACT_CORE_VERSION } from "@tesseract/core";

export type { RegoContractPolicyInput, RegoFileIndex } from "./rego-input.js";
export { buildRegoPolicyInput, listMissingPaths } from "./rego-input.js";

export const TESSERACT_CONTRACT_RUNNER_REGO_STUB = "contract-runner-rego" as const;

import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * Returns the `tesseract` monorepo version string from `@tesseract/core`.
 */
export function contractRunnerRegoStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
