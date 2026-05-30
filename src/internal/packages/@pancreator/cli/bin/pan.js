#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const binFile = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(binFile), "..");
const repoRoot = findRepoRoot(packageRoot);
const distEntry = path.join(packageRoot, "dist", "cli.js");
const dependencyPackageRoots = [
  path.join(packageRoot, "node_modules", "@pancreator", "core"),
  path.join(packageRoot, "node_modules", "@pancreator", "inbox"),
  path.join(packageRoot, "node_modules", "@pancreator", "intervention"),
  path.join(packageRoot, "node_modules", "@pancreator", "pipeline"),
  path.join(packageRoot, "node_modules", "@pancreator", "run-logger"),
];
const dependencyEntries = dependencyPackageRoots.map((root) =>
  path.join(root, "dist", "index.js"),
);
const sourceRoots = [
  path.join(packageRoot, "src"),
  ...dependencyPackageRoots.map((root) => path.join(root, "src")),
];
const sourceFiles = sourceRoots.flatMap((root) => listSourceFiles(root));
const missingDependencyEntries = dependencyEntries.filter((entry) => !fs.existsSync(entry));
const needsBuild =
  !fs.existsSync(distEntry) ||
  missingDependencyEntries.length > 0 ||
  sourceIsNewerThanDist(distEntry, sourceFiles);

function listSourceFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(abs);
    }
    return entry.isFile() && /\.[cm]?[tj]sx?$/u.test(entry.name) ? [abs] : [];
  });
}

function sourceIsNewerThanDist(distFile, sources) {
  if (!fs.existsSync(distFile)) {
    return true;
  }
  const distMtime = fs.statSync(distFile).mtimeMs;
  return sources.some((source) => fs.statSync(source).mtimeMs > distMtime);
}

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
  const result = spawnSync("pnpm", ["--dir", repoRoot, "--filter", "@pancreator/cli...", "run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!fs.existsSync(distEntry)) {
  console.error(`Missing CLI entrypoint after build: ${distEntry}`);
  process.exit(1);
}

await import(pathToFileURL(distEntry).href);
