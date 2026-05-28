/**
 * @packageDocumentation
 * Rego contract evaluation helpers. OPA and Conftest remain out-of-process; this package types the input surface.
 */
export { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export type { RegoContractPolicyInput, RegoFileIndex } from "./rego-input.js";
export { buildRegoPolicyInput, listMissingPaths } from "./rego-input.js";

export const DAEDALINE_CONTRACT_RUNNER_REGO_STUB = "contract-runner-rego" as const;

import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

/**
 * Returns the `daedaline` monorepo version string from `@daedaline/core`.
 */
export function contractRunnerRegoStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
}
