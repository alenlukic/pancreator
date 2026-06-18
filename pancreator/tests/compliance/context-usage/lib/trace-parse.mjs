import { READ_TOOL_NAMES } from "./paths.mjs";

/**
 * @param {string} maybePath
 */
function isConcreteReadPath(maybePath) {
  if (!maybePath || /[*?{}[\]]/u.test(maybePath)) {
    return false;
  }
  const normalized = maybePath.replace(/\\/g, "/");
  if (normalized.endsWith("/")) {
    return false;
  }
  const leaf = normalized.split("/").pop() ?? "";
  if (!leaf.includes(".")) {
    return false;
  }
  return true;
}

/**
 * @param {unknown} event
 * @returns {string[]}
 */
export function extractReadPathsFromToolEvent(event) {
  if (!event || typeof event !== "object") {
    return [];
  }
  const e = /** @type {Record<string, unknown>} */ (event);
  const name = String(e.name ?? "");
  if (!READ_TOOL_NAMES.has(name)) {
    return [];
  }
  if (!/^read$/iu.test(name)) {
    return [];
  }
  const paths = [];
  const args = e.args ?? e.input;
  if (args && typeof args === "object") {
    const a = /** @type {Record<string, unknown>} */ (args);
    if (typeof a.path === "string" && isConcreteReadPath(a.path)) {
      paths.push(a.path);
    }
  }
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (typeof parsed?.path === "string" && isConcreteReadPath(parsed.path)) {
        paths.push(String(parsed.path));
      }
    } catch {
      // ignore non-JSON args
    }
  }
  return paths;
}
