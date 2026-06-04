import { stringifyRepoJson } from "@pancreator/core";

/** Derive repository root from a `lib/memory/` absolute directory. */
export function repoRootFromMemoryRoot(memoryRoot: string): string {
  const normalized = memoryRoot.replace(/\\/g, "/");
  if (!normalized.endsWith("/lib/memory") && normalized !== "lib/memory") {
    throw new Error(
      `memoryRoot must end with lib/memory (got ${memoryRoot})`,
    );
  }
  return normalized.slice(0, -"/lib/memory".length) || ".";
}

/** Serialize feature index and other memory-tier JSON with canonical layout. */
export function stringifyMemoryJson(memoryRoot: string, value: unknown): string {
  const repoRoot = repoRootFromMemoryRoot(memoryRoot);
  return stringifyRepoJson(value, repoRoot);
}
