/**
 * @packageDocumentation
 * Threshold-policy compatibility helpers (schema upgrade path for `tesseract.yaml`).
 */
import { TESSERACT_CORE_VERSION } from "@tesseract/core";

import { readPolicyDocument } from "./read-document.js";
import { upgradePolicyTree } from "./upgrade.js";

export const TESSERACT_POLICY_VERSION = "0.0.0" as const;

/** @deprecated Prefer `TESSERACT_POLICY_VERSION`. */
export const TESSERACT_POLICY_STUB = "policy" as const;

/** @deprecated Prefer `TESSERACT_POLICY_VERSION`. */
export function policyStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}

export type {
  PolicyBootstrapMeta,
  PolicyConfigV1,
  PolicyContractBundleV1,
  PolicyOverridesV1,
} from "./config-v1.js";
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
