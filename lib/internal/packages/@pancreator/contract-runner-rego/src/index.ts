/**
 * @packageDocumentation
 * Rego contract evaluation helpers. OPA and Conftest remain out-of-process; this package types the input surface.
 */
export { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export type { RegoContractPolicyInput, RegoFileIndex } from "./rego-input.js";
export { buildRegoPolicyInput, listMissingPaths } from "./rego-input.js";

export const PANCREATOR_CONTRACT_RUNNER_REGO_STUB = "contract-runner-rego" as const;

import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

/**
 * Returns the `pancreator` monorepo version string from `@pancreator/core`.
 */
export function contractRunnerRegoStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}
