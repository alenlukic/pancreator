#!/usr/bin/env node
/**
 * Refresh stale or `TBD-on-commit` contentHash citations across Markdown fenced
 * JSON, standalone JSON bodies, and YAML frontmatter reference lists.
 *
 * Usage:
 *   node lib/internal/tools/format/refresh-citations.mjs [--dry-run] [<glob>...]
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAbbrevLen, stringifyRepoJson } from "./canonical-json-format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

export const TBD = "TBD-on-commit";
const FULL_SHA256_LEN = 64;

const INBOX_IMMUTABLE_PREFIXES = [
  "lib/inbox/in/",
  "lib/inbox/out/",
  "lib/inbox/threads/",
];
const NOTES_PREFIX = "lib/inbox/notes/";

/**
 * @param {string} posixRel
 * @returns {{ skip: boolean, warn?: string, refuse?: boolean }}
 */
export function classifyPath(posixRel) {
  const norm = posixRel.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (norm.startsWith(NOTES_PREFIX)) {
    return { skip: true, refuse: true };
  }
  for (const prefix of INBOX_IMMUTABLE_PREFIXES) {
    if (norm.startsWith(prefix)) {
      return {
        skip: true,
        warn: `Skipping semantically immutable inbox path: ${norm}`,
      };
    }
  }
  return { skip: false };
}

/**
 * @param {string} utf8
 * @param {number} width
 * @returns {string}
 */
export function digestContentHash(utf8, width) {
  const full = createHash("sha256").update(utf8, "utf8").digest("hex");
  return width >= FULL_SHA256_LEN ? full : full.slice(0, width);
}

/**
 * @param {string} repoRel
 * @param {string} repoRoot
 * @returns {string | null}
 */
export function readTargetFile(repoRel, repoRoot = REPO_ROOT) {
  let norm = repoRel.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (norm.startsWith("/")) {
    norm = norm.slice(1);
  }
  const abs = path.join(repoRoot, norm);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return null;
  }
  return readFileSync(abs, "utf8");
}

/**
 * @param {string} body
 * @param {number} index
 * @returns {string | null}
 */
function pathBeforeTbdYaml(body, index) {
  const windowStart = Math.max(0, index - 1200);
  const chunk = body.slice(windowStart, index);
  const itemStart = chunk.lastIndexOf("\n  - ");
  const block = itemStart >= 0 ? chunk.slice(itemStart) : chunk;
  const applies = /(?:^|\n)\s*path:\s*([^\n#]+)/g;
  let last = null;
  for (const m of block.matchAll(applies)) {
    last = m[1].trim().replace(/^['"]|['"]$/g, "");
  }
  return last;
}

/**
 * @param {string} body
 * @param {number} index
 * @returns {string | null}
 */
function pathBeforeTbdJson(body, index) {
  const windowStart = Math.max(0, index - 800);
  const chunk = body.slice(windowStart, index);
  const re = /"path"\s*:\s*"([^"]+)"/g;
  let last = null;
  for (const m of chunk.matchAll(re)) {
    last = m[1];
  }
  return last;
}

/**
 * @param {string} body
 * @param {number} index
 * @returns {string | null}
 */
function pathInlineCitation(body, index) {
  const windowStart = Math.max(0, index - 400);
  const chunk = body.slice(windowStart, index + 20);
  const m = chunk.match(
    /\{kind:\s*(?:'|")?(?:lines|symbol)(?:'|")?,\s*path:\s*([^,}\n`]+)/,
  );
  if (!m) {
    return null;
  }
  return m[1].trim().replace(/^['"]|['"]$/g, "");
}

/**
 * @param {string} body
 * @param {number} tbdIndex
 * @returns {string | null}
 */
function resolveCitedPath(body, tbdIndex) {
  return (
    pathInlineCitation(body, tbdIndex) ??
    pathBeforeTbdJson(body, tbdIndex) ??
    pathBeforeTbdYaml(body, tbdIndex)
  );
}

/**
 * @param {string} hash
 * @param {string} targetBody
 * @param {number} abbrevLen
 * @returns {boolean}
 */
function hashMatchesTarget(hash, targetBody, abbrevLen) {
  if (hash === TBD) {
    return false;
  }
  const expected = digestContentHash(targetBody, abbrevLen);
  if (hash === expected) {
    return true;
  }
  if (/^[0-9a-f]+$/i.test(hash) && hash.length === FULL_SHA256_LEN) {
    return hash.slice(0, abbrevLen) === expected;
  }
  return hash === expected;
}

/**
 * @param {string} body
 * @param {number} abbrevLen
 * @param {string} repoRoot
 * @returns {{ body: string, changed: boolean, skipped: { reason: string, path?: string }[] }}
 */
export function refreshCitationBody(body, abbrevLen, repoRoot = REPO_ROOT) {
  /** @type {{ reason: string, path?: string }[]} */
  const skipped = [];
  let changed = false;
  let out = body;
  let searchFrom = 0;
  while (true) {
    const idx = out.indexOf(TBD, searchFrom);
    if (idx === -1) {
      break;
    }
    const cited = resolveCitedPath(out, idx);
    if (cited === null) {
      skipped.push({ reason: "unresolved-citation" });
      searchFrom = idx + TBD.length;
      continue;
    }
    const target = readTargetFile(cited, repoRoot);
    if (target === null) {
      skipped.push({ reason: "gone", path: cited });
      searchFrom = idx + TBD.length;
      continue;
    }
    const replacement = digestContentHash(target, abbrevLen);
    out = `${out.slice(0, idx)}${replacement}${out.slice(idx + TBD.length)}`;
    changed = true;
    searchFrom = idx + replacement.length;
  }

  out = out.replace(
    /((?:["']contentHash["']|contentHash)\s*:\s*["']?)([0-9a-fA-F]+)(["']?)/g,
    (match, prefix, hash, suffix, offset) => {
      const cited = resolveCitedPath(out, offset);
      if (cited === null) {
        return match;
      }
      const target = readTargetFile(cited, repoRoot);
      if (target === null) {
        skipped.push({ reason: "gone", path: cited });
        return match;
      }
      if (hashMatchesTarget(hash, target, abbrevLen)) {
        const expected = digestContentHash(target, abbrevLen);
        if (hash !== expected) {
          changed = true;
          return `${prefix}${expected}${suffix}`;
        }
        return match;
      }
      const expected = digestContentHash(target, abbrevLen);
      changed = true;
      return `${prefix}${expected}${suffix}`;
    },
  );

  return { body: out, changed, skipped };
}

/**
 * @param {string} pattern
 * @param {string} rel
 * @returns {boolean}
 */
export function matchesGlobPattern(pattern, rel) {
  const norm = rel.replace(/\\/g, "/");
  if (pattern.includes("*") || pattern.includes("?")) {
    const re = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".")}$`,
    );
    return re.test(norm);
  }
  return norm === pattern || norm.endsWith(`/${pattern}`);
}

/**
 * @param {string} repoRoot
 * @param {string} relDir
 * @returns {string[]}
 */
function collectCandidateFiles(repoRoot, relDir = "") {
  /** @type {string[]} */
  const out = [];
  const absDir = relDir ? path.join(repoRoot, relDir) : repoRoot;
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    const posix = rel.replace(/\\/g, "/");
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") {
        continue;
      }
      out.push(...collectCandidateFiles(repoRoot, rel));
    } else if (/\.(md|json|ya?ml)$/i.test(e.name) || e.name === "AGENTS.md") {
      out.push(posix);
    }
  }
  return out;
}

/**
 * @param {{ dryRun?: boolean, globs?: string[], repoRoot?: string }} [options]
 * @returns {{ filesChanged: number, warnings: string[], refused: string[], report: Record<string, unknown> }}
 */
export function refreshCitations(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const dryRun = options.dryRun ?? false;
  const globs = options.globs ?? [];
  const abbrevLen = resolveAbbrevLen(repoRoot);
  const allFiles = collectCandidateFiles(repoRoot).sort();
  const files =
    globs.length === 0
      ? allFiles
      : allFiles.filter((rel) => globs.some((g) => matchesGlobPattern(g, rel)));

  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const refused = [];
  let filesChanged = 0;

  for (const rel of files) {
    const classification = classifyPath(rel);
    if (classification.warn) {
      warnings.push(classification.warn);
      continue;
    }
    if (classification.refuse) {
      refused.push(rel);
      continue;
    }
    const abs = path.join(repoRoot, rel);
    const original = readFileSync(abs, "utf8");
    if (!original.includes(TBD) && !/contentHash/i.test(original)) {
      continue;
    }
    const { body, changed } = refreshCitationBody(original, abbrevLen, repoRoot);
    if (!changed || body === original) {
      continue;
    }
    filesChanged += 1;
    if (dryRun) {
      process.stdout.write(`--- ${rel}\n`);
      process.stdout.write(`${body}`);
      if (!body.endsWith("\n")) {
        process.stdout.write("\n");
      }
    } else {
      writeFileSync(abs, body, "utf8");
    }
  }

  if (refused.length > 0) {
    throw new Error(
      `Refusing to write paths under ${NOTES_PREFIX}: ${refused.join(", ")}`,
    );
  }

  const report = {
    mode: dryRun ? "dry-run" : "write",
    abbrevLen,
    filesScanned: files.length,
    filesChanged,
    warnings,
  };
  return { filesChanged, warnings, refused, report };
}

/**
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, globs: string[] }}
 */
export function parseRefreshArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const globs = argv.slice(2).filter((a) => a !== "--dry-run");
  return { dryRun, globs };
}

async function main() {
  const { dryRun, globs } = parseRefreshArgs(process.argv);
  const { report, warnings } = refreshCitations({ dryRun, globs });
  for (const w of warnings) {
    console.warn(`[refresh-citations] ${w}`);
  }
  process.stdout.write(stringifyRepoJson(report, REPO_ROOT));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
