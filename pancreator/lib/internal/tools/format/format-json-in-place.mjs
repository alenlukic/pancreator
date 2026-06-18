#!/usr/bin/env node
/**
 * Canonicalize one or more repo-relative `.json` files in place.
 *
 * Used by commit hooks and operators to fix agent-written JSON that used
 * legacy pretty-print style instead of the canonical printer.
 *
 * @see lib/internal/tools/format/canonical-json-format.mjs
 * @see tests/compliance/json-formatting.yaml
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAbbrevLen, rewriteJsonText } from "./canonical-json-format.mjs";

/**
 * @param {string} absPath
 * @param {string} repoRoot
 * @returns {{ changed: boolean }}
 */
export function formatJsonFileInPlace(absPath, repoRoot) {
  const raw = readFileSync(absPath, "utf8");
  const abbrevLen = resolveAbbrevLen(repoRoot);
  const { changed, output } = rewriteJsonText(raw, abbrevLen);
  if (changed) {
    writeFileSync(absPath, output, "utf8");
  }
  return { changed };
}

/**
 * @param {string} repoRoot
 * @param {string[]} relPaths posix paths from repo root
 * @returns {{ changed: number, paths: string[] }}
 */
export function formatJsonFilesInPlace(repoRoot, relPaths) {
  /** @type {string[]} */
  const changedPaths = [];
  for (const rel of relPaths) {
    const norm = rel.replace(/\\/g, "/").replace(/^\.\/+/, "");
    const abs = path.join(repoRoot, ...norm.split("/"));
    const { changed } = formatJsonFileInPlace(abs, repoRoot);
    if (changed) {
      changedPaths.push(norm);
    }
  }
  return { changed: changedPaths.length, paths: changedPaths };
}

function parseArgs(argv) {
  let root = process.cwd();
  /** @type {string[]} */
  const files = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1]) {
      root = path.resolve(argv[++i]);
    } else if (arg === "--") {
      files.push(...argv.slice(i + 1));
      break;
    } else if (!arg.startsWith("-")) {
      files.push(arg);
    }
  }
  return { root, files };
}

async function main() {
  const { root, files } = parseArgs(process.argv);
  if (files.length === 0) {
    console.error("[format-json-in-place] usage: format-json-in-place.mjs [--root <repo>] <path.json>...");
    process.exitCode = 1;
    return;
  }
  const { changed, paths } = formatJsonFilesInPlace(root, files);
  if (changed > 0) {
    console.error(`[format-json-in-place] canonicalized ${changed} file(s): ${paths.join(", ")}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
