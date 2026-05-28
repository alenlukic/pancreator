import path from "node:path";

import { InvalidRegistryPathError } from "./errors.js";

export function defaultRegistryFilePath(repoRoot: string): string {
  return path.resolve(repoRoot, ".ddl", "sandboxes", "port-registry.json");
}

export function defaultSandboxesDir(repoRoot: string): string {
  return path.resolve(repoRoot, ".ddl", "sandboxes");
}

/** Ensures `registryFilePath` resolves inside `repoRoot/.ddl/sandboxes`. */
export function assertRegistryPathInSandboxes(repoRoot: string, registryFilePath: string): void {
  const sandboxes = defaultSandboxesDir(repoRoot);
  const file = path.resolve(registryFilePath);
  const rel = path.relative(sandboxes, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new InvalidRegistryPathError(
      `Registry path ${file} is outside sandboxes directory ${sandboxes}.`,
    );
  }
}
