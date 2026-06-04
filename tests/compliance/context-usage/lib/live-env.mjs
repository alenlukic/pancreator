import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const INSTRUCTION = `
[context-usage] Live harness is manual-only (operator spend).

Prototype matrix: {task-low, task-high} x {composer-2.5, gpt-5.5}

Provide credentials, then re-run from repo root:
  pnpm run context:usage:calibrate              # full matrix (~34 API calls at default --runs 8)
  pnpm run context:usage:expected -- --raw <path> # rebuild expected baselines from raw samples
  pnpm run context:usage:analyze                # re-run analyzer on existing trace summaries

Overhead-only probes:
  node tests/compliance/context-usage/calibrate-overhead.mjs --runs 10

The harness loads repo-root .env when CURSOR_API_KEY is unset (existing shell env wins).
pnpm run context:usage:* sets CURSOR_CONTEXT_USAGE=1 for that process.

Alternatively export explicitly:
  export CURSOR_CONTEXT_USAGE=1
  export CURSOR_API_KEY=<your-key>

See tests/compliance/context-usage/README.md for cost warnings and prerequisites.
`.trim();

/**
 * @returns {string}
 */
export function resolveHarnessRepoRoot() {
  return path.resolve(HARNESS_ROOT, "..", "..", "..");
}

/**
 * @param {string} absolutePath
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function repoRelativePath(absolutePath, repoRoot = resolveHarnessRepoRoot()) {
  const relative = path.relative(repoRoot, absolutePath);
  if (relative.startsWith("..")) {
    throw new Error(
      `[context-usage] path ${absolutePath} is outside repo root ${repoRoot}`,
    );
  }
  return relative.split(path.sep).join("/");
}

/**
 * @param {string} [repoRoot]
 */
export function loadRepoEnv(repoRoot = resolveHarnessRepoRoot()) {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key.length === 0 || Object.hasOwn(process.env, key)) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function ensureLiveUsageGate() {
  if (process.env.CURSOR_CONTEXT_USAGE === "1") {
    return;
  }
  const lifecycle = process.env.npm_lifecycle_event ?? "";
  if (lifecycle.startsWith("context:usage")) {
    process.env.CURSOR_CONTEXT_USAGE = "1";
  }
}

export function requireLiveEnv() {
  loadRepoEnv();
  ensureLiveUsageGate();

  if (process.env.CURSOR_CONTEXT_USAGE !== "1" || !process.env.CURSOR_API_KEY) {
    console.error(INSTRUCTION);
    process.exit(0);
  }
}
