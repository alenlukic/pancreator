/** Shared path normalization and read-tool detection for trace collection and analysis. */

export const READ_TOOL_NAMES = new Set([
  "read",
  "Read",
  "grep",
  "Grep",
  "glob",
  "Glob",
  "search",
  "Search",
]);

/**
 * @param {string} rel
 */
export function normalizePath(rel) {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Strip temporary calibration sandbox prefixes to keep paths fixture-relative.
 * @param {string} relPath
 */
export function stripTempSandboxPrefix(relPath) {
  const normalized = normalizePath(relPath);
  const match = normalized.match(
    /(?:^|\/)context-usage-task-(?:low|high)-[^/]+\/(.+)$/u,
  );
  return match?.[1] ? normalizePath(match[1]) : normalized;
}

/**
 * @param {string} relPath
 */
export function toExactPathRegex(relPath) {
  return new RegExp(`^${relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

/**
 * @param {string} observedPath
 * @param {string} relPath
 */
export function pathEqualsOrSuffix(observedPath, relPath) {
  const p = normalizePath(observedPath);
  const rel = normalizePath(relPath);
  return p === rel || p.endsWith(`/${rel}`);
}

/**
 * @param {readonly string[]} paths
 * @param {readonly RegExp[]} forbiddenPathPatterns
 */
export function findForbiddenPaths(paths, forbiddenPathPatterns) {
  return paths
    .map(normalizePath)
    .filter((p) => forbiddenPathPatterns.some((re) => re.test(p)));
}

/**
 * @param {readonly string[]} paths
 * @param {readonly string[]} requiredReadPaths
 * @returns {number[]} indices of missing required reads
 */
export function findMissingRequiredReads(paths, requiredReadPaths) {
  const normalized = paths.map(normalizePath);
  const requiredPatterns = requiredReadPaths.map(toExactPathRegex);
  const missing = [];
  for (let i = 0; i < requiredPatterns.length; i += 1) {
    if (
      !normalized.some(
        (p) => requiredPatterns[i].test(p) || pathEqualsOrSuffix(p, requiredReadPaths[i]),
      )
    ) {
      missing.push(i);
    }
  }
  return missing;
}
