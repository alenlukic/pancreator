/**
 * @packageDocumentation
 * Threshold-policy compatibility helpers (schema upgrade path for `pancreator.yaml`).
 */
import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

import { readPolicyDocument } from "./read-document.js";
import { upgradePolicyTree } from "./upgrade.js";

export const PANCREATOR_POLICY_VERSION = "0.0.0" as const;

/** @deprecated Prefer `PANCREATOR_POLICY_VERSION`. */
export const PANCREATOR_POLICY_STUB = "policy" as const;

/** @deprecated Prefer `PANCREATOR_POLICY_VERSION`. */
export function policyStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}

export type {
  PolicyBootstrapMeta,
  PolicyConfigV1,
  PolicyContractBundleV1,
  PolicyOverridesV1,
} from "./config-v1.js";
export type { BootstrapTrackingValidation } from "./bootstrap-tracking.js";
export {
  expectedCompletedPhases,
  nextBootstrapAfterRatification,
  parsePhaseNumber,
  validateBootstrapTracking,
} from "./bootstrap-tracking.js";
export type { LegacyPolicyLoadOptions } from "./legacy.js";
export { loadLegacyPolicyConfig } from "./legacy.js";
export { readPolicyDocument } from "./read-document.js";

/**
 * Reads `filePath` and returns a `PolicyConfigV1` tree without printing deprecation
 * warnings and without writing the filesystem.
 */
export async function upgradePolicyConfig(filePath: string) {
  const raw = await readPolicyDocument(filePath);
  return upgradePolicyTree(raw);
}
