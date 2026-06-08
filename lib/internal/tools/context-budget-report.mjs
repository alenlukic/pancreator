#!/usr/bin/env node
/**
 * Rough repository text footprint for context-budget discussions.
 * Token estimate = ceil(chars / 4); NOT model tokenizer output.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { quoteJsonString } from "./canonical-json-format.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** @param {string} p */
function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "coverage",
]);

/** @param {string} absDir */
function* walkFiles(absDir) {
  if (!exists(absDir)) return;
  const st = fs.statSync(absDir);
  if (!st.isDirectory()) {
    yield absDir;
    return;
  }
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIR_NAMES.has(e.name)) continue;
    const full = path.join(absDir, e.name);
    if (e.isDirectory()) yield* walkFiles(full);
    else if (e.isFile()) yield full;
  }
}

/** @param {(rel: string) => boolean} pred */
function countMatchingChars(pred) {
  let chars = 0;
  let files = 0;
  for (const abs of walkFiles(ROOT)) {
    const rel = posixRel(path.relative(ROOT, abs));
    if (!pred(rel)) continue;
    try {
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) continue;
      const s = buf.toString("utf8");
      chars += s.length;
      files += 1;
    } catch {
      /* unreadable */
    }
  }
  return { chars, files };
}

/** @param {string} relOrAbs */
export function posixRel(relOrAbs) {
  return relOrAbs.replace(/\\/g, "/");
}

/** @param {string} s */
function escapeRegexChars(s) {
  return s.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

/**
 * @param {string} pat basename glob with at most bare * segments
 */
function basenameGlobAnchoredRegex(pat) {
  const escaped = escapeRegexChars(pat).replace(/\\\*/g, "[^/]*");
  return new RegExp(`(^|/)${escaped}$`, "i");
}

/**
 * @param {string} line one non-comment line from .cursorindexingignore
 * @returns {(rel: string) => boolean}
 */
export function matcherForIndexingPatternLine(line) {
  let pat = posixRel(line.trim());
  if (pat.endsWith("/")) pat = pat.slice(0, -1);

  if (pat.endsWith("/**")) {
    const pre = pat.slice(0, -3);
    if (!pre.includes("*")) {
      return (rel) => {
        const r = posixRel(rel);
        return r === pre || r.startsWith(`${pre}/`);
      };
    }
  }

  if (!pat.includes("*")) {
    const exact = pat;
    return (rel) => posixRel(rel) === exact;
  }

  const doubleStarSlash = "**/";
  let idx = pat.indexOf(doubleStarSlash);
  if (idx !== -1) {
    const left = pat.slice(0, idx);
    const rest = pat.slice(idx + doubleStarSlash.length);

    /* Nested JSON globs rooted at lib/memory/. */
    if (rest === "*.json") {
      const pre = left.replace(/\/$/, "");
      const preRe = escapeRegexChars(pre);
      return (rel) => {
        const r = posixRel(rel);
        return new RegExp(`^${preRe}/(.*/)?[^/]+\\.json$`, "i").test(r);
      };
    }

    // lib/memory/** slash delivery-report.md and memory slash index.json literals
    if (left.replace(/\/$/, "").length > 0 && !rest.includes("*")) {
      const pre = escapeRegexChars(left.replace(/\/$/, ""));
      const restEsc = escapeRegexChars(rest).replace(/\\\*/g, "[^/]*");
      return (rel) => {
        const r = posixRel(rel);
        return new RegExp(`^${pre}/(.*/)?${restEsc}$`, "i").test(r);
      };
    }

    // Patterns like ** slash migration-manifeststar.json at any depth.
    if (left === "" && rest.length > 0) {
      return (rel) => basenameGlobAnchoredRegex(rest).test(posixRel(rel));
    }
  }

  throw new Error(
    `[context-budget-report] unsupported .cursorindexingignore glob: ${quoteJsonString(line)} — extend matcherForIndexingPatternLine`,
  );
}

/**
 * @param {string} root
 * @returns {((rel: string) => boolean)[]}
 */
export function indexingMatchersFromRoot(root) {
  const ignorePath = path.join(root, ".cursorindexingignore");
  if (!exists(ignorePath)) {
    const err = new Error(`[context-budget-report] missing required file: ${ignorePath}`);
    err.code = "ENOENT";
    throw err;
  }
  const ig = fs.readFileSync(ignorePath, "utf8");
  return ig
    .split(/\r?\n/)
    .map((ln) => ln.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((ln) => matcherForIndexingPatternLine(ln));
}

/**
 * @param {string} rel
 * @param {((rel: string) => boolean)[]} matchers
 */
export function isIndexingExcluded(rel, matchers) {
  const r = posixRel(rel);
  return matchers.some((m) => m(r));
}

export function classifyExclusiveTier(rel) {
  const r = posixRel(rel);

  // Generated-machine bucket mirrors spec tiers for JSON and lock artifacts.
  if (r === "pnpm-lock.yaml") return "generated_machine";
  if (/(?:^|\/)migration-manifest[^/]*\.json$/i.test(r)) return "generated_machine";
  if (/\.(dry-run|post-write|write)\.json$/i.test(r)) return "generated_machine";
  if (/^lib\/memory\/(.+\/)?index\.json$/i.test(r)) return "generated_machine";
  if (/^lib\/memory\/(.+\/)?delivery-report\.md$/i.test(r)) return "generated_machine";
  if (/^lib\/memory\/.+\.json$/i.test(r)) return "generated_machine";

  const activeWork = /^\.pan\/work(?:\/|$)/.test(r);
  if (activeWork) return "active_work";

  const archival =
    /^\.pan\/archive\/work(?:\/|$)/.test(r) ||
    /^lib\/inbox\/out(?:\/|$)/.test(r) ||
    /^\.pan\/archive\/inbox(?:\/|$)/.test(r) ||
    /^lib\/inbox\/threads(?:\/|$)/.test(r);
  if (archival) return "archival_memory";

  if (/^lib\/memory\/active(?:\/|$)/.test(r)) return "active_memory";

  const durable = /^lib\/memory\/features(?:\/|$)/.test(r);
  if (durable) return "durable_memory";

  const internalProduct = r === "AGENTS.md" || /^\.docs(?:\/|$)/.test(r);
  if (internalProduct) return "internal_product";

  const internalBuild =
    /^lib\/memory\/adr(?:\/|$)/.test(r) ||
    /^lib\/memory\/backlog(?:\/|$)/.test(r) ||
    /^lib\/memory\/research(?:\/|$)/.test(r) ||
    /^tests(?:\/|$)/.test(r) ||
    /^client(?:\/|$)/.test(r);
  if (internalBuild) return "internal_build";

  const internal =
    /^lib\/memory\/handbook(?:\/|$)/.test(r) ||
    /^lib\/personas(?:\/|$)/.test(r) ||
    /^\.cursor\/rules(?:\/|$)/.test(r) ||
    /^\.cursor\/agents(?:\/|$)/.test(r);
  if (internal) return "internal_operating";

  const src =
    /^lib\/internal\/packages(?:\/|$)/.test(r) ||
    /^lib\/internal\/tools(?:\/|$)/.test(r);
  if (src) return "source_code";

  return "other";
}

const TIER_META = /** @type {const} */ ({
  active_memory: { label: "1 active memory", dir: "`lib/memory/active/**`" },
  active_work: { label: "2 active work", dir: "`.pan/work/**`" },
  durable_memory: {
    label: "3 durable memory",
    dir: "`lib/memory/features/**`",
  },
  archival_memory: {
    label: "4 archival memory",
    dir: "`.pan/archive/work/**`, `lib/inbox/out/**`, `.pan/archive/inbox/**`, `lib/inbox/threads/**`",
  },
  internal_operating: {
    label: "5 internal operating content",
    dir: "`lib/memory/handbook/**`, `lib/personas/**`, `lib/personas/skills/**`, `.cursor/rules/**`, `.cursor/agents/**`",
  },
  internal_product: {
    label: "6 internal product (Pancreator self-dev)",
    dir: "`.docs/**` (including `.docs/README.md`), `AGENTS.md`",
  },
  internal_build: {
    label: "7 internal build",
    dir: "`lib/memory/adr/**`, `lib/memory/backlog/**`, `lib/memory/research/**`, `tests/**`, `client/**`",
  },
  source_code: { label: "8 source code", dir: "`lib/internal/packages/**`, `lib/internal/tools/**`" },
  generated_machine: {
    label: "9 generated machine artifacts",
    dir: "JSON manifests, `.dry-run|.write|.post-write.json`, `lib/memory/**`/index/report JSON, lockfile",
  },
  other: { label: "(unclassified)", dir: "paths outside the nine groups" },
});

/**
 * @param {string} [rootOverride]
 */
export function computeTierAndIndexingStats(rootOverride = ROOT) {
  /** @type {Record<string, { chars: number, files: number }>} */
  const byTier = Object.fromEntries(
    Object.keys(TIER_META).map((k) => [k, { chars: 0, files: 0 }]),
  );
  const matchers = indexingMatchersFromRoot(rootOverride);

  let totalChars = 0;
  let totalFiles = 0;
  let activeChars = 0;
  let activeFiles = 0;
  let indexableChars = 0;
  let indexableFiles = 0;
  let excludedChars = 0;
  let excludedFiles = 0;

  const absRoot = rootOverride;

  for (const abs of walkFiles(absRoot)) {
    const rel = posixRel(path.relative(absRoot, abs));
    try {
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) continue;
      const s = buf.toString("utf8");
      const n = s.length;
      const tierId = classifyExclusiveTier(rel);
      byTier[tierId].chars += n;
      byTier[tierId].files += 1;

      totalChars += n;
      totalFiles += 1;

      if (tierId === "active_memory") {
        activeChars += n;
        activeFiles += 1;
      }

      if (isIndexingExcluded(rel, matchers)) {
        excludedChars += n;
        excludedFiles += 1;
      } else {
        indexableChars += n;
        indexableFiles += 1;
      }
    } catch {
      /* unreadable */
    }
  }

  return {
    byTier,
    matchers,
    totalChars,
    totalFiles,
    activeChars,
    activeFiles,
    indexableChars,
    indexableFiles,
    excludedChars,
    excludedFiles,
  };
}

function pad(s, n) {
  const t = `${s}`;
  return t.length >= n ? t : t + " ".repeat(n - t.length);
}

function printReport() {
  const ignorePath = path.join(ROOT, ".cursorindexingignore");
  if (!exists(ignorePath)) {
    console.error(`[context-budget-report] missing required file: ${ignorePath}`);
    process.exit(1);
  }
  let data;
  try {
    data = computeTierAndIndexingStats(ROOT);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("missing required file:")) {
      console.error(message);
      process.exit(1);
    }
    throw error;
  }

  console.log(
    "Context budget report (approximate chars; estimated tokens ~ ceil(chars/4), labeled rough, not tokenizer output)\n",
  );
  console.log(`Root: ${ROOT}\n`);

  const order = /** @type {(keyof typeof TIER_META)[]} */ ([
    "active_memory",
    "active_work",
    "durable_memory",
    "archival_memory",
    "internal_operating",
    "internal_product",
    "internal_build",
    "source_code",
    "generated_machine",
    "other",
  ]);

  console.log(`${pad("Tier group", 36)} ${pad("files", 9)} ${pad("chars", 14)} est_tokens~(rough)`);
  console.log(`${"-".repeat(36)} ${"-".repeat(9)} ${"-".repeat(14)} ${"-".repeat(22)}`);

  for (const id of order) {
    const m = TIER_META[id];
    const { chars, files } = data.byTier[id];
    const est = Math.ceil(chars / 4);
    console.log(
      `${pad(m.label.replace(/^\d+ /, ""), 36)} ${pad(String(files), 9)} ${pad(String(chars), 14)} ~${est} (chars/4)`,
    );
    console.log(`  scope: ${m.dir}`);
  }

  console.log("");
  console.log("Approximate aggregates (sums use every scanned text file once)");
  console.log(
    `  total corpus:              files=${data.totalFiles} chars=${data.totalChars} est_tokens~(rough)~${Math.ceil(data.totalChars / 4)} (chars/4)`,
  );
  console.log(
    `  active memory footprint:   files=${data.activeFiles} chars=${data.activeChars} est_tokens~(rough)~${Math.ceil(data.activeChars / 4)} (chars/4)`,
  );
  console.log(
    `  indexable default context: files=${data.indexableFiles} chars=${data.indexableChars} est_tokens~(rough)~${Math.ceil(data.indexableChars / 4)} (chars/4)`,
  );
  console.log(`    (approx. Cursor semantic indexing set per lines in .cursorindexingignore at repo root)`);
  console.log(
    `  explicit-read-only corpus: files=${data.excludedFiles} chars=${data.excludedChars} est_tokens~(rough)~${Math.ceil(data.excludedChars / 4)} (chars/4)`,
  );
  console.log(`    (files matching .cursorindexingignore; still reachable via explicit reads)`);
  console.log("");

  const subagentStats = countMatchingChars((rel) => /^\.cursor\/agents\/[^/]+\.md$/.test(posixRel(rel)));
  const canonicalStats = countMatchingChars((rel) => {
    const r = posixRel(rel);
    return /^\.cursor\/agents\/[^/]+\.md$/.test(r) && !/-standard\.md$/.test(r) && !/-complex\.md$/.test(r);
  });

  console.log("Cursor subagent projections (explicit-read/default-excluded)\n");
  console.log(`  canonical: files=${canonicalStats.files} chars=${canonicalStats.chars} est_tokens~(rough)~${Math.ceil(canonicalStats.chars / 4)} (chars/4)`);
  console.log(`  all:       files=${subagentStats.files} chars=${subagentStats.chars} est_tokens~(rough)~${Math.ceil(subagentStats.chars / 4)} (chars/4)\n`);

  const legacyScopes = [
    { id: "whole_repo_text", label: "Legacy: Whole repo scan (every text file under root)", pred: () => true },
    { id: "active_work", label: "Active work slice: .pan/work/**", pred: (rel) => /^\.pan\/work(?:\/|$)/.test(posixRel(rel)) },
    { id: "archived_work", label: "Archived work slice: .pan/archive/work/**", pred: (rel) => /^\.pan\/archive\/work(?:\/|$)/.test(posixRel(rel)) },
    { id: "memory", label: "Legacy slice: lib/memory/**", pred: (rel) => /^lib\/memory(?:\/|$)/.test(posixRel(rel)) },
  ];

  console.log("Legacy single-path slices (for diffing older reports)\n");

  for (const { label, pred } of legacyScopes) {
    const { chars, files } = countMatchingChars(pred);
    const estTok = Math.ceil(chars / 4);
    console.log(`${label}`);
    console.log(`  files=${files} chars=${chars} est_tokens~(rough)~${estTok} (chars/4)\n`);
  }
}

export { walkFiles };

const ENTRY = path.resolve(fileURLToPath(import.meta.url));

function isExecutedAsCli() {
  const argv1 = typeof process.argv[1] === "string" ? process.argv[1] : "";
  return ENTRY === path.resolve(argv1);
}

function main() {
  printReport();
}

if (isExecutedAsCli()) {
  main();
}
