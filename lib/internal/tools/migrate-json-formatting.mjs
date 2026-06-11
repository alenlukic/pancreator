#!/usr/bin/env node
/**
 * JSON formatting migration: read-parse-format-write for in-scope `.json` files.
 *
 * Dry-run (`--dry-run`, default) reports candidate paths, exclusion counts, and planned
 * edits without writes. `--write` mutates disk only when `PANCREATOR_MIGRATION_GO=1`,
 * mirroring migrate-timestamp-naming.mjs.
 *
 * Canonical formatting and hash abbreviation live in `canonical-json-format.mjs`
 * (`formatCanonicalJson`, `resolveAbbrevLen`, `abbreviateHashes`).
 *
 * Abbreviation length derives from `git rev-parse --short HEAD` against `repoRoot` unless
 * `PAN_JSON_FORMAT_ABBREV_LEN` (decimal digits only) overrides it for deterministic tests.
 *
 * @see tests/compliance/json-formatting.yaml
 * @see lib/memory/features/quality-governance/json-formatting/index.json
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  abbreviateHashes,
  deepCloneJson,
  formatCanonicalJson,
  quoteJsonString,
  resolveAbbrevLen,
  rewriteJsonText,
  stringifyCompactJson,
  stringifyRepoJson,
} from "./canonical-json-format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {{ reason: string, path: string }} ExcludedPath */

/** @type {Set<string>} */
const EXCLUDED_DIR_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".turbo",
  "vendor",
  "third_party",
]);

const EXCLUDED_BASENAMES = new Set(["package-lock.json", "tsconfig.tsbuildinfo"]);

/**
 * @param {string} posixRel normalized repo-relative path with /
 * @returns {boolean}
 */
export function isExcludedRelPath(posixRel) {
  const norm = posixRel.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const base = path.posix.basename(norm);
  if (EXCLUDED_BASENAMES.has(base)) {
    return true;
  }
  const parts = norm.split("/");
  return parts.some((p) => EXCLUDED_DIR_SEGMENTS.has(p));
}

/**
 * True when Git ignores `posixRel` under `repoRoot` (for example transient `.pan/work/` runs).
 *
 * @param {string} repoRoot
 * @param {string} posixRel
 * @returns {boolean}
 */
export function isGitignoredRelPath(repoRoot, posixRel) {
  const norm = posixRel.replace(/\\/g, "/").replace(/^\.\/+/, "");
  try {
    execFileSync("git", ["check-ignore", "-q", "--", norm], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Walks repo for `.json` files; exclusions increment `excludeCounts` by coarse reason bucket.
 *
 * @param {string} repoRoot
 * @returns {{ repoRelativePaths: string[], excludeCounts: Record<string, number> }}
 */
export function collectRepoJson(repoRoot) {
  /** @type {string[]} */
  const out = [];
  /** @type {Record<string, number>} */
  const excludeCounts = {
    tooling_regenerated: 0,
    vendored_or_dependency_tree: 0,
  };

  /**
   * @param {string} absDir
   * @param {string} relDir posix
   */
  function walk(absDir, relDir) {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = e.name;
      const rel = relDir ? `${relDir}/${name}` : name;

      if (e.isDirectory()) {
        const parts = rel.split("/");
        if (
          EXCLUDED_DIR_SEGMENTS.has(name) ||
          parts.some((p) => EXCLUDED_DIR_SEGMENTS.has(p))
        ) {
          excludeCounts.vendored_or_dependency_tree += 1;
          continue;
        }
        walk(path.join(absDir, name), rel);
      } else if (e.isFile() && name.endsWith(".json")) {
        if (isExcludedRelPath(rel)) {
          if (EXCLUDED_BASENAMES.has(name)) {
            excludeCounts.tooling_regenerated += 1;
          } else {
            excludeCounts.vendored_or_dependency_tree += 1;
          }
          continue;
        }
        out.push(rel);
      }
    }
  }

  walk(repoRoot, "");
  out.sort();
  return { repoRelativePaths: out, excludeCounts };
}

export { abbreviateHashes, formatCanonicalJson, resolveAbbrevLen, rewriteJsonText, stringifyRepoJson, quoteJsonString, stringifyCompactJson, deepCloneJson };

/**
 * @param {string} repoRoot
 * @param {boolean} write
 * @returns {{ candidates: number, rewritten: number, unchanged: number, excludeCounts: Record<string, number> }}
 */
export function runMigration({ repoRoot, write }) {
  const abbrevLen = resolveAbbrevLen(repoRoot);
  const { repoRelativePaths, excludeCounts } = collectRepoJson(repoRoot);

  let rewritten = 0;
  let unchanged = 0;

  for (const rel of repoRelativePaths) {
    const abs = path.join(repoRoot, ...rel.split("/"));
    const raw = readFileSync(abs, "utf8");
    const { changed, output } = rewriteJsonText(raw, abbrevLen);
    if (!changed) {
      unchanged += 1;
      continue;
    }
    if (write) {
      writeFileSync(abs, output, "utf8");
    }
    rewritten += 1;
  }

  return {
    candidates: repoRelativePaths.length,
    rewritten,
    unchanged,
    excludeCounts,
  };
}

function parseArgs(argv) {
  let dryRun = true;
  let write = false;
  let root = path.resolve(__dirname, "..", "..", "..");
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      write = false;
    } else if (a === "--write") {
      write = true;
      dryRun = false;
    } else if (a === "--root" && argv[i + 1]) {
      root = path.resolve(argv[++i]);
    }
  }
  return { dryRun, write, root };
}

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = args.root;

  if (args.write) {
    if (process.env.PANCREATOR_MIGRATION_GO !== "1") {
      console.error(
        "[migrate-json-formatting] refuse --write without PANCREATOR_MIGRATION_GO=1",
      );
      process.exitCode = 1;
      return;
    }
  }

  if (!existsSync(repoRoot)) {
    console.error(`[migrate-json-formatting] missing repo root: ${repoRoot}`);
    process.exitCode = 1;
    return;
  }

  const abbrevLen = resolveAbbrevLen(repoRoot);
  const { repoRelativePaths, excludeCounts } = collectRepoJson(repoRoot);

  /** @type {string[]} */
  const wouldChange = [];

  for (const rel of repoRelativePaths) {
    const abs = path.join(repoRoot, ...rel.split("/"));
    let raw;
    try {
      raw = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const { changed } = rewriteJsonText(raw, abbrevLen);
    if (changed) {
      wouldChange.push(rel);
    }
  }

  const summary = abbreviateHashes(
    {
      mode: args.write ? "write" : "dry-run",
      abbrevLen,
      candidates: repoRelativePaths.length,
      wouldRewrite: wouldChange.length,
      excludeCounts,
      sampleChanges: wouldChange.slice(0, 25),
    },
    abbrevLen,
  );

  console.log(`${formatCanonicalJson(summary, 0)}\n`);

  if (args.write) {
    const { rewritten } = runMigration({ repoRoot, write: true });
    console.log(
      `[migrate-json-formatting] write complete (PANCREATOR_MIGRATION_GO=1), files rewritten=${rewritten}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
