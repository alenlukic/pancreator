#!/usr/bin/env node
/**
 * Post-migration layout validator for archive/work/lib topology.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectTextFiles, isExcludedFromReferenceRewrite, REPO_ROOT } from "./migrate-repository-layout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_DIRS = [
  "archive/inbox",
  "archive/work",
  "work",
  "lib",
  "lib/inbox/in",
  "lib/internal/packages",
  "lib/personas/skills",
  "lib/memory/handbook",
];

const STALE_REFERENCE_EXCLUDE = new Set([
  "lib/internal/tools/migrate-repository-layout.mjs",
  "lib/internal/tools/migrate-repository-layout.test.mjs",
]);

const STALE_PATTERNS = [
  /\bsrc\/inbox\/archive\//,
  /\bsrc\/internal\/work_archive\//,
  /\bsrc\/work\//,
  /\bsrc\/skills\//,
  /\bsrc\/memory\//,
  /\bsrc\/personas\//,
  /\bsrc\/internal\//,
  /\bsrc\/inbox\/in\//,
  /\bsrc\/inbox\/out\//,
  /\bsrc\/inbox\/threads\//,
];

const NORMATIVE_SCAN_ROOTS = [
  "AGENTS.md",
  "OPERATION.md",
  "docs",
  "lib/memory/handbook",
  "lib/pipelines",
  "lib/personas",
  "lib/internal/packages",
  "lib/internal/tools",
  "tests",
  "client",
  ".cursor/rules",
  "pancreator.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
];

let failed = 0;

/** @param {string} msg */
function err(msg) {
  failed += 1;
  console.error(`[validate-repository-layout] ${msg}`);
}

/** @param {string} repoRoot */
export function validateRequiredDirectories(repoRoot = REPO_ROOT) {
  for (const rel of REQUIRED_DIRS) {
    if (!existsSync(path.join(repoRoot, rel))) {
      err(`Missing required directory: ${rel}`);
    }
  }
  if (existsSync(path.join(repoRoot, "src"))) {
    err("Stale top-level src/ directory still exists.");
  }
}

/** @param {string} repoRoot */
export function validateNoAgentVariants(repoRoot = REPO_ROOT) {
  const agentsDir = path.join(repoRoot, ".cursor", "agents");
  if (!existsSync(agentsDir)) {
    err("Missing .cursor/agents/");
    return;
  }
  for (const file of readdirSync(agentsDir)) {
    if (file.endsWith("-standard.md") || file.endsWith("-complex.md")) {
      err(`Retired agent variant still present: .cursor/agents/${file}`);
    }
  }
  const tiersDoc = path.join(repoRoot, "lib/memory/handbook/subagent-model-tiers.md");
  if (existsSync(tiersDoc)) {
    err("Retired handbook doc still present: lib/memory/handbook/subagent-model-tiers.md");
  }
}

/**
 * @param {string} repoRoot
 * @returns {{ rel: string, pattern: string }[]}
 */
export function findStaleReferences(repoRoot = REPO_ROOT) {
  /** @type {{ rel: string, pattern: string }[]} */
  const hits = [];
  const roots = NORMATIVE_SCAN_ROOTS.filter((r) => existsSync(path.join(repoRoot, r)));
  const seen = new Set();
  /** @param {string} rel */
  const scanFile = (rel) => {
    if (seen.has(rel) || isExcludedFromReferenceRewrite(rel) || STALE_REFERENCE_EXCLUDE.has(rel)) return;
    seen.add(rel);
    const text = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const pattern of STALE_PATTERNS) {
      if (pattern.test(text)) {
        hits.push({ rel, pattern: pattern.source });
      }
    }
  };

  for (const root of roots) {
    const abs = path.join(repoRoot, root);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isFile()) {
      scanFile(root);
      continue;
    }
    for (const rel of collectTextFiles(repoRoot, (candidate) => candidate === root || candidate.startsWith(`${root}/`))) {
      scanFile(rel);
    }
  }
  return hits;
}

/** @param {string} repoRoot */
export function validateStaleReferences(repoRoot = REPO_ROOT) {
  for (const hit of findStaleReferences(repoRoot)) {
    err(`Stale path reference in ${hit.rel} (pattern: ${hit.pattern})`);
  }
}

/** @param {string} repoRoot */
export function runValidation(repoRoot = REPO_ROOT) {
  validateRequiredDirectories(repoRoot);
  validateNoAgentVariants(repoRoot);
  validateStaleReferences(repoRoot);
  return failed === 0;
}

function main() {
  const ok = runValidation(REPO_ROOT);
  if (ok) {
    console.log("[validate-repository-layout] OK");
  }
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("validate-repository-layout.mjs")) {
  main();
}
