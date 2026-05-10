import { readPolicyDocument } from "./read-document.js";

const DEPRECATION_LINE =
  "[@tesseract/policy] DEPRECATED: loadLegacyPolicyConfig() reads legacy JSON/YAML threshold-policy files. Migrate with upgradePolicyConfig() and persist via `tess upgrade --apply` (docs/BOOTSTRAP.md Phase 3 step 8 policy migration; internal tracker Q23).\n";

export interface LegacyPolicyLoadOptions {
  /** Receives the deprecation line; defaults to `process.stderr.write`. */
  writeDeprecation?: (chunk: string) => void;
}

/**
 * Loads a legacy on-disk policy file. The system MUST emit one deprecation notice
 * to stderr per successful call unless `writeDeprecation` overrides the sink.
 */
export async function loadLegacyPolicyConfig(
  filePath: string,
  options?: LegacyPolicyLoadOptions,
): Promise<unknown> {
  const sink = options?.writeDeprecation ?? ((c: string) => process.stderr.write(c));
  sink(DEPRECATION_LINE);
  return readPolicyDocument(filePath);
}
