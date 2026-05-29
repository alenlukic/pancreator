import { ensureCursorSdkRipgrepConfigured } from "@daedaline/runner-cursor";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Loads repo-root `.env` into `process.env` without logging values.
 * Existing process env wins; missing `.env` is a no-op.
 */
export function loadRepoEnv(repoRoot: string): void {
  const envPath = path.join(repoRoot, ".env");
  if (!existsSync(envPath)) {
    return;
  }
  const raw = readFileSync(envPath, "utf8");
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
 * Sets `CURSOR_RIPGREP_PATH` when the platform `@cursor/sdk-*` bundle is present so
 * `@cursor/sdk` local runtime can call `configureRipgrepPath()` before ignore-map init.
 */
export function configureCursorSdkTransportPrereqs(repoRoot: string): boolean {
  return ensureCursorSdkRipgrepConfigured(repoRoot);
}
