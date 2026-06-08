#!/usr/bin/env node
/**
 * Dot-prefix de-indexed top-level directories (repo layout migration).
 *
 * Renames: docs → .docs, archive → .archive, sandbox → .sandbox,
 *          tmp → .tmp, work → .work
 * Does NOT rename: node_modules, client, tests
 *
 * Usage:
 *   node lib/internal/tools/migrate-deindexed-top-level-dirs.mjs [--dry-run]
 *   node lib/internal/tools/migrate-deindexed-top-level-dirs.mjs --refs-only
 *   node lib/internal/tools/migrate-deindexed-top-level-dirs.mjs --moves-only
 */
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

import {
  collectTextFiles,
  isExcludedFromReferenceRewrite,
  REPO_ROOT,
} from "./migrate-repository-layout.mjs";
import { quoteJsonString } from "./canonical-json-format.mjs";

/** Top-level directory renames for a fresh apply (idempotent skips missing sources). */
const DIR_MOVES = [
  ["docs", ".docs"],
  ["archive", ".archive"],
  ["sandbox", ".sandbox"],
  ["tmp", ".tmp"],
  ["work", ".work"],
];

const REFERENCE_EXCLUDE = new Set([
  "lib/internal/tools/migrate-deindexed-top-level-dirs.mjs",
]);

/** Protect nested fixture work trees from top-level work rewrites. */
const FIXTURE_WORK_TOKEN = "__PANCREATOR_FIXTURE_WORK_SLASH__";

/**
 * @param {string} text
 * @returns {string}
 */
export function shieldFixtureWorkPaths(text) {
  return text.replace(
    /tests\/compliance\/context-usage\/fixtures\/task-(?:low|high)\/work\//g,
    (m) => m.replace(/\/work\//, `/${FIXTURE_WORK_TOKEN}`),
  );
}

/**
 * @param {string} text
 * @returns {string}
 */
export function unshieldFixtureWorkPaths(text) {
  return text.replaceAll(`/${FIXTURE_WORK_TOKEN}`, "/work/");
}

/**
 * @param {string} text
 * @returns {{ text: string, count: number }}
 */
export function applyDeindexedDirReplacements(text) {
  let out = shieldFixtureWorkPaths(text);
  let count = 0;

  /** @type {Array<{ pattern: RegExp, to: string }>} */
  const steps = [
    { pattern: /(?<![.\w-])archive\/work\//g, to: ".archive/work/" },
    { pattern: /(?<![.\w-])archive\/inbox\//g, to: ".archive/inbox/" },
    { pattern: /(?<![.\w-])archive\//g, to: ".archive/" },
    { pattern: /(?<![.\w-])archive(?=")/g, to: ".archive" },

    { pattern: /(?<![.\w-])sandbox\//g, to: ".sandbox/" },
    { pattern: /(?<![.\w-])sandbox(?=")/g, to: ".sandbox" },

    { pattern: /(?<![.\w-])tmp\//g, to: ".tmp/" },
    { pattern: /(?<![.\w-])tmp(?=")/g, to: ".tmp" },

    { pattern: /(?<![.\w-])docs\//g, to: ".docs/" },
    { pattern: /(?<![.\w-])docs(?=")/g, to: ".docs" },

    { pattern: /\.archive\/work\//g, to: "__PAN_ARCHIVE_WORK__/" },
    { pattern: /(?<![.\w-])work\//g, to: ".work/" },
    { pattern: /(?<![.\w-])work(?=")/g, to: ".work" },
    { pattern: /__PAN_ARCHIVE_WORK__\//g, to: ".archive/work/" },
  ];

  for (const { pattern, to } of steps) {
    const matches = out.match(pattern);
    if (!matches?.length) continue;
    count += matches.length;
    out = out.replace(pattern, to);
  }

  out = unshieldFixtureWorkPaths(out);
  return { text: out, count };
}

/**
 * @param {string} repoRoot
 * @param {boolean} dryRun
 */
export function executeDirMoves(repoRoot = REPO_ROOT, dryRun = false) {
  for (const [from, to] of DIR_MOVES) {
    const fromAbs = path.join(repoRoot, from);
    const toAbs = path.join(repoRoot, to);
    if (!existsSync(fromAbs)) {
      console.log(`[skip] missing ${from}/`);
      continue;
    }
    if (existsSync(toAbs)) {
      throw new Error(`Target already exists: ${to}/`);
    }
    const cmd = `git mv ${quoteJsonString(from)} ${quoteJsonString(to)}`;
    if (dryRun) {
      console.log(`[git mv] ${from} -> ${to}`);
      continue;
    }
    try {
      execSync(cmd, { cwd: repoRoot, stdio: "pipe" });
    } catch {
      renameSync(fromAbs, toAbs);
      execSync(`git add ${quoteJsonString(to)}`, { cwd: repoRoot, stdio: "pipe" });
    }
    console.log(`[moved] ${from}/ -> ${to}/`);
  }
}

/**
 * @param {string} repoRoot
 * @param {boolean} dryRun
 */
export function applyReferenceUpdates(repoRoot = REPO_ROOT, dryRun = false) {
  const extensionless = [".cursorindexingignore", ".gitignore"];
  const files = [
    ...collectTextFiles(repoRoot, (rel) => {
      if (isExcludedFromReferenceRewrite(rel)) return false;
      if (REFERENCE_EXCLUDE.has(rel)) return false;
      return true;
    }),
    ...extensionless.filter((rel) => existsSync(path.join(repoRoot, rel))),
  ];
  let total = 0;
  const seen = new Set();
  for (const rel of files) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.join(repoRoot, rel);
    const raw = readFileSync(abs, "utf8");
    const { text, count } = applyDeindexedDirReplacements(raw);
    if (count === 0) continue;
    total += count;
    if (dryRun) {
      console.log(`[rewrite] ${rel} (${count})`);
    } else {
      writeFileSync(abs, text, "utf8");
    }
  }
  return total;
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const movesOnly = process.argv.includes("--moves-only");
  const refsOnly = process.argv.includes("--refs-only");

  if (!refsOnly) {
    executeDirMoves(REPO_ROOT, dryRun);
  }
  if (!movesOnly) {
    const total = applyReferenceUpdates(REPO_ROOT, dryRun);
    console.log(
      `[migrate-deindexed-top-level-dirs] ${dryRun ? "would rewrite" : "rewrote"} ${total} reference occurrence(s)`,
    );
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("migrate-deindexed-top-level-dirs.mjs")
) {
  main();
}
