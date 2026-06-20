#!/usr/bin/env node
/**
 * Thin bridge over @pancreator/cli cursor-sync runtime.
 * Prefer `pnpm -w exec pan cursor-sync` for operator use.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stringifyRepoJson } from "../format/canonical-json-format.mjs";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PAN_BIN = path.join(TOOLS_DIR, "../../packages/@pancreator/cli/bin/pan.js");

function runCursorSync(harnessRootInput, options = {}) {
  const harnessRoot = path.resolve(harnessRootInput || process.cwd());
  const args = ["cursor-sync"];
  if (options.dryRun) {
    args.push("--dry-run");
  }
  args.push(harnessRoot);
  const result = spawnSync(process.execPath, [PAN_BIN, ...args], {
    cwd: harnessRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PAN_JSON_FORMAT_ABBREV_LEN: process.env.PAN_JSON_FORMAT_ABBREV_LEN ?? "7",
    },
  });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "cursor-sync failed").trim();
    throw new Error(message);
  }
  return JSON.parse(result.stdout.trim());
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const harnessRoot = positional[0] ? path.resolve(positional[0]) : process.cwd();
  try {
    const payload = runCursorSync(harnessRoot, { dryRun });
    console.log(stringifyRepoJson(payload, process.cwd()).trimEnd());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}

export { runCursorSync, runCursorSync as syncCursorAgents };
