import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const INSTRUCTION = `
[context-usage] Live harness is manual-only.

Provide credentials, then re-run:
  pnpm run context:usage -- --model composer-2.5          # single run vs baseline
  pnpm run context:usage:baseline -- --model composer-2.5 # regenerate deterministic bounded baseline
  pnpm run context:usage:calibrate # collect empirical overhead samples (manual spend)
  pnpm run context:usage:calibrate:summary # derive overhead envelopes from samples
  pnpm run context:usage:fd-trace -- --all                # representative trace suite
  pnpm run context:usage:fd-trace:session -- --model composer-2.5 # same-session growth check

The harness loads repo-root .env when CURSOR_API_KEY is unset (existing shell env wins).
pnpm run context:usage* also sets CURSOR_CONTEXT_USAGE=1 for that process.

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
 * Loads repo-root \`.env\` into \`process.env\` without logging values.
 * Existing process env wins; missing \`.env\` is a no-op.
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

/**
 * pnpm run context:usage* is explicit operator opt-in for live API spend.
 */
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
