#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const binFile = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(binFile), "..");
const repoRoot = findRepoRoot(packageRoot);
const distEntry = path.join(packageRoot, "dist", "server.js");
const dependencyEntries = [
  path.join(packageRoot, "node_modules", "@daedaline", "core", "dist", "index.js"),
  path.join(packageRoot, "node_modules", "@daedaline", "inbox", "dist", "index.js"),
  path.join(packageRoot, "node_modules", "@daedaline", "intervention", "dist", "index.js"),
  path.join(packageRoot, "node_modules", "@daedaline", "memory", "dist", "index.js"),
  path.join(packageRoot, "node_modules", "@daedaline", "run-logger", "dist", "index.js"),
];
const missingDependencyEntries = dependencyEntries.filter((entry) => !fs.existsSync(entry));
const needsBuild = !fs.existsSync(distEntry) || missingDependencyEntries.length > 0;

function findRepoRoot(startDir) {
  let current = startDir;
  for (;;) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate repo root from ${startDir}`);
    }
    current = parent;
  }
}

if (needsBuild) {
  const result = spawnSync("pnpm", ["--dir", repoRoot, "--filter", "@daedaline/mcp-server...", "run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!fs.existsSync(distEntry)) {
  console.error(`Missing MCP server entrypoint after build: ${distEntry}`);
  process.exit(1);
}

await import(pathToFileURL(distEntry).href);
