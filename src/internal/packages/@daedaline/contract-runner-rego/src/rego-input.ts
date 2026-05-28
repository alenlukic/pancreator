/**
 * Repo-relative path to file text, matching the `input.files` map consumed by Phase 2 rego policies.
 */
export type RegoFileIndex = Record<string, string>;

/**
 * JSON input shape for OPA policies that follow the Phase 2 `daedaline.phase2.*` packages.
 */
export type RegoContractPolicyInput = {
  files: RegoFileIndex;
};

/**
 * Builds the `input` object for OPA `opa eval` or Conftest against a Phase 2 policy.
 */
export function buildRegoPolicyInput(files: RegoFileIndex): RegoContractPolicyInput {
  return { files };
}

/**
 * Lists required paths that are missing from `files`. Policies use this pattern in `deny` rules.
 */
export function listMissingPaths(
  requiredPaths: ReadonlySet<string>,
  files: RegoFileIndex,
): string[] {
  const missing: string[] = [];
  for (const p of requiredPaths) {
    if (!(p in files)) {
      missing.push(p);
    }
  }
  return missing;
}
