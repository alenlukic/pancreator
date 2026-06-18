#!/usr/bin/env node
/**
 * Replace live `contentHash: TBD-on-commit` anchors with SHA-256 digests of the
 * full cited file (abbreviated per `resolveAbbrevLen` for `.json`, or peer width).
 *
 * Usage:
 *   node lib/internal/tools/format/refresh-tbd-contenthash.mjs [--dry-run|--write]
 *
 * @see lib/memory/handbook/glossary.md (contentHash)
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
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const TBD = "TBD-on-commit";
const FULL_SHA256_LEN = 64;

/** @type {string[]} posix prefixes — do not scan or edit */
const EXCLUDED_PREFIXES = [
  ".pan/archive/work/",
  ".pan/archive/inbox/",
  "lib/inbox/notes/",
  "lib/inbox/out/",
  "lib/inbox/threads/",
  "lib/inbox/in/",
  ".pan/work/",
];

/** @type {string[]} exact repo-relative paths to skip */
const EXCLUDED_FILES = new Set([
  "lib/memory/handbook/contract-format.md",
  "lib/internal/tools/format/reformat-markdown-citations.mjs",
  "lib/internal/tools/migrations/migrate-timestamp-naming.mjs",
  "lib/internal/tools/format/refresh-tbd-contenthash.mjs",
]);

/** @type {string[]} basename / path suffix skips */
const EXCLUDED_SUFFIXES = [
  "/normalize-dual-anchor-contenthash-corpus.rego",
];

/**
 * @param {string} posixRel
 * @returns {boolean}
 */
function isExcludedPath(posixRel) {
  const norm = posixRel.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (EXCLUDED_FILES.has(norm)) {
    return true;
  }
  if (EXCLUDED_PREFIXES.some((p) => norm.startsWith(p))) {
    return true;
  }
  if (EXCLUDED_SUFFIXES.some((s) => norm.endsWith(s))) {
    return true;
  }
  if (norm.startsWith("lib/memory/handbook/contract-templates/")) {
    return true;
  }
  if (norm.includes("/node_modules/") || norm.startsWith(".git/")) {
    return true;
  }
  return false;
}

/**
 * @param {string} repoRoot
 * @param {string} relDir
 * @returns {string[]}
 */
function collectFiles(repoRoot, relDir = "") {
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
      if (
        e.name === "node_modules" ||
        e.name === ".git" ||
        e.name === "dist" ||
        e.name === ".turbo"
      ) {
        continue;
      }
      out.push(...collectFiles(repoRoot, rel));
    } else if (e.isFile()) {
      if (isExcludedPath(posix)) {
        continue;
      }
      if (
        /\.(md|yaml|yml|json|rego)$/i.test(e.name) ||
        e.name === "AGENTS.md"
      ) {
        out.push(posix);
      }
    }
  }
  return out;
}

/**
 * Canonical stored width per json-formatting / glossary: abbreviated SHA-256 prefix
 * whose length matches `git rev-parse --short HEAD` at write time.
 *
 * @param {number} abbrevLen
 * @returns {number}
 */
function storedHashWidth(abbrevLen) {
  return abbrevLen;
}

/**
 * @param {string} utf8
 * @param {number} width
 * @returns {string}
 */
function digest(utf8, width) {
  const full = createHash("sha256").update(utf8, "utf8").digest("hex");
  return width >= FULL_SHA256_LEN ? full : full.slice(0, width);
}

/**
 * @param {string} repoRel
 * @returns {string | null}
 */
function readTarget(repoRel) {
  let norm = repoRel.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (norm.startsWith("/")) {
    norm = norm.slice(1);
  }
  const abs = path.join(ROOT, norm);
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
  const inline = pathInlineCitation(body, tbdIndex);
  if (inline) {
    return inline;
  }
  const jsonPath = pathBeforeTbdJson(body, tbdIndex);
  if (jsonPath) {
    return jsonPath;
  }
  return pathBeforeTbdYaml(body, tbdIndex);
}

/**
 * @param {string} body
 * @param {number} index
 * @returns {boolean}
 */
function isInsideExcludedFence(body, index) {
  const fences = [];
  // Opening fences only: bare ``` lines close blocks and must not start a new one.
  const re = /^(`{3,}|~{3,})(\w+)/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    const lang = m[2] ?? "";
    const open = m.index;
    const closer = new RegExp(`^${m[1]}\\s*$`, "gm");
    closer.lastIndex = re.lastIndex;
    const end = closer.exec(body);
    if (!end) {
      continue;
    }
    const closeIdx = end.index + end[0].length;
    if (index <= open || index >= closeIdx) {
      continue;
    }
    const inner = body.slice(re.lastIndex, end.index);
    if (
      lang === "json" &&
      inner.includes('"kind"') &&
      inner.includes('"path"') &&
      inner.includes("contentHash")
    ) {
      continue;
    }
    fences.push([open, closeIdx]);
  }
  return fences.some(([a, b]) => index > a && index < b);
}

/**
 * @param {string} body
 * @param {number} abbrevLen
 * @param {string} repoRel
 * @returns {{ body: string, resolved: number, skipped: { reason: string, path?: string }[] }}
 */
/**
 * @param {string} body
 * @param {number} abbrevLen
 * @returns {{ body: string, abbreviated: number }}
 */
function abbreviateFullContentHashes(body, abbrevLen) {
  let abbreviated = 0;
  const out = body.replace(
    /((?:["']contentHash["']|contentHash)\s*:\s*["']?)([0-9a-f]{64})(["']?)/gi,
    (_match, prefix, hash, suffix) => {
      abbreviated += 1;
      return `${prefix}${hash.slice(0, abbrevLen)}${suffix}`;
    },
  );
  return { body: out, abbreviated };
}

/**
 * @param {string} body
 * @param {number} abbrevLen
 * @param {string} repoRel
 * @returns {{ body: string, resolved: number, abbreviated: number, skipped: { reason: string, path?: string }[] }}
 */
function refreshBody(body, abbrevLen, repoRel) {
  const width = storedHashWidth(abbrevLen);
  /** @type {{ reason: string, path?: string }[]} */
  const skipped = [];
  let resolved = 0;
  let out = body;
  let searchFrom = 0;

  const patterns = [
    /contentHash:\s*TBD-on-commit/g,
    /["']contentHash["']\s*:\s*["']TBD-on-commit["']/g,
  ];

  /** @type {{ index: number, len: number, replacement: string }[]} */
  const edits = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(body)) !== null) {
      const idx = m.index;
      if (isInsideExcludedFence(body, idx)) {
        skipped.push({ reason: "example-fence" });
        continue;
      }
      const cited = resolveCitedPath(body, idx);
      if (!cited) {
        skipped.push({ reason: "no-path" });
        continue;
      }
      const fileBody = readTarget(cited);
      if (fileBody === null) {
        skipped.push({ reason: "gone", path: cited });
        continue;
      }
      const hash = digest(fileBody, width);
      let replacement;
      if (m[0].includes('"')) {
        replacement = `"contentHash": "${hash}"`;
      } else {
        replacement = `contentHash: ${hash}`;
      }
      edits.push({ index: idx, len: m[0].length, replacement });
    }
  }

  edits.sort((a, b) => b.index - a.index);
  for (const e of edits) {
    out = out.slice(0, e.index) + e.replacement + out.slice(e.index + e.len);
    resolved += 1;
  }

  const { body: abbreviatedBody, abbreviated } = abbreviateFullContentHashes(
    out,
    abbrevLen,
  );
  return { body: abbreviatedBody, resolved, abbreviated, skipped };
}

/**
 * @param {string} body
 * @param {number} abbrevLen
 * @returns {boolean}
 */
function hasFullLengthContentHash(body) {
  return /(?:["']contentHash["']|contentHash)\s*:\s*["']?[0-9a-f]{64}\b/.test(body);
}

/**
 * @param {boolean} write
 */
function main(write) {
  const abbrevLen = resolveAbbrevLen(ROOT);
  const files = collectFiles(ROOT).sort();
  let filesChanged = 0;
  let placeholdersResolved = 0;
  let fullHashesAbbreviated = 0;
  /** @type {Record<string, number>} */
  const skipReasons = {};
  /** @type {{ file: string, path: string }[]} */
  const gone = [];

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const original = readFileSync(abs, "utf8");
    const needsTbd = original.includes(TBD);
    const needsAbbrev = hasFullLengthContentHash(original);
    if (!needsTbd && !needsAbbrev) {
      continue;
    }
    let body;
    let resolved = 0;
    let abbreviated = 0;
    /** @type {{ reason: string, path?: string }[]} */
    let skipped = [];
    if (needsTbd) {
      const refreshed = refreshBody(original, abbrevLen, rel);
      body = refreshed.body;
      resolved = refreshed.resolved;
      abbreviated = refreshed.abbreviated;
      skipped = refreshed.skipped;
    } else {
      const abb = abbreviateFullContentHashes(original, abbrevLen);
      body = abb.body;
      abbreviated = abb.abbreviated;
    }
    for (const s of skipped) {
      skipReasons[s.reason] = (skipReasons[s.reason] ?? 0) + 1;
      if (s.reason === "gone" && s.path) {
        gone.push({ file: rel, path: s.path });
      }
    }
    if (resolved === 0 && abbreviated === 0) {
      continue;
    }
    placeholdersResolved += resolved;
    fullHashesAbbreviated += abbreviated;
    if (body !== original) {
      filesChanged += 1;
      if (write) {
        writeFileSync(abs, body, "utf8");
      }
    }
  }

  const report = {
    mode: write ? "write" : "dry-run",
    abbrevLen,
    filesScanned: files.length,
    filesChanged,
    placeholdersResolved,
    fullHashesAbbreviated,
    skipReasons,
    gone,
    remainingTbd: files.filter((rel) => {
      const t = readFileSync(path.join(ROOT, rel), "utf8");
      return /contentHash:\s*TBD-on-commit|["']contentHash["']\s*:\s*["']TBD-on-commit["']/.test(
        t,
      );
    }).length,
    remainingFullLength: files.filter((rel) => {
      const t = readFileSync(path.join(ROOT, rel), "utf8");
      return hasFullLengthContentHash(t);
    }).length,
  };
  process.stdout.write(stringifyRepoJson(report, ROOT));
  if (!write && filesChanged > 0) {
    process.exitCode = 0;
  }
}

const write = process.argv.includes("--write");
const fileFilter = process.argv.find((a) => a.startsWith("--file="))?.slice(7);

function mainFiltered() {
  const abbrevLen = resolveAbbrevLen(ROOT);
  if (!fileFilter) {
    main(write);
    return;
  }
  const rel = fileFilter.replace(/\\/g, "/");
  const original = readFileSync(path.join(ROOT, rel), "utf8");
  let body;
  let resolved = 0;
  let abbreviated = 0;
  let skipped = [];
  if (original.includes(TBD)) {
    const refreshed = refreshBody(original, abbrevLen, rel);
    body = refreshed.body;
    resolved = refreshed.resolved;
    abbreviated = refreshed.abbreviated;
    skipped = refreshed.skipped;
  } else {
    const abb = abbreviateFullContentHashes(original, abbrevLen);
    body = abb.body;
    abbreviated = abb.abbreviated;
  }
  if (write && (resolved > 0 || abbreviated > 0)) {
    writeFileSync(path.join(ROOT, rel), body, "utf8");
  }
  process.stdout.write(
    stringifyRepoJson({ file: rel, resolved, abbreviated, skipped, write }, ROOT),
  );
}

mainFiltered();
