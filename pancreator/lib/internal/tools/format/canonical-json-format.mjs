#!/usr/bin/env node
/**
 * Shared canonical JSON writer: two-space indent, one object KV per line,
 * abbreviated git-style and SHA-256 `contentHash` hex via `resolveAbbrevLen`.
 *
 * Imported by migrate-json-formatting.mjs (bulk `.json`) and CLI emitters (terminal/state).
 */

import { execFileSync } from "node:child_process";

const FULL_HEX_SHA1_LEN = 40;
const FULL_HEX_SHA256_LEN = 64;

const INDENT = "  ";

export const CANONICAL_JSON_INDENT_SPACES = 2;

/** @deprecated Internal layout knob; surfaced for tests/assertions only. */
export const MAX_INLINE_ARRAY_CHARS = 96;

/**
 * @param {string} repoRoot
 * @returns {number}
 */
export function resolveAbbrevLen(repoRoot = process.cwd()) {
  const o = process.env.PAN_JSON_FORMAT_ABBREV_LEN;
  if (o !== undefined && o !== "") {
    if (!/^[0-9]+$/.test(o)) {
      throw new Error(
        "PAN_JSON_FORMAT_ABBREV_LEN must contain decimal digits only when set.",
      );
    }
    const n = Number(o);
    if (n < 4 || n > 255) {
      throw new Error("PAN_JSON_FORMAT_ABBREV_LEN must be between 4 and 255.");
    }
    return n;
  }
  try {
    const s = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }).trim();
    if (!s) {
      throw new Error("empty git rev-parse --short HEAD");
    }
    return s.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `canonical-json-format: cannot derive abbreviation length (${msg}); export PAN_JSON_FORMAT_ABBREV_LEN for sandboxed repos.`,
    );
  }
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function isHexString(s) {
  return /^[0-9a-fA-F]+$/.test(s);
}

/**
 * @param {string} key
 * @param {unknown} val
 * @param {number} abbrevLen
 * @returns {string | null}
 */
function abbreviatedHashReplacement(key, val, abbrevLen) {
  if (typeof val !== "string") {
    return null;
  }
  if (!isHexString(val)) {
    return null;
  }
  if (val.length <= abbrevLen) {
    return null;
  }

  let eligible = false;
  if (key === "contentHash") {
    eligible = val.length === FULL_HEX_SHA256_LEN || val.length === FULL_HEX_SHA1_LEN;
  } else if (val.length === FULL_HEX_SHA256_LEN || val.length === FULL_HEX_SHA1_LEN) {
    eligible = true;
  }

  return eligible ? val.slice(0, abbrevLen) : null;
}

/**
 * Deep clones via JSON cycle-free assumption; abbreviates hashes in-place on the clone.
 *
 * @param {unknown} root
 * @param {number} abbrevLen
 * @returns {unknown}
 */
export function abbreviateHashes(root, abbrevLen) {
  return abbrevWalk(root, abbrevLen);
}

/**
 * @param {unknown} node
 * @param {number} abbrevLen
 * @returns {unknown}
 */
function abbrevWalk(node, abbrevLen) {
  if (node === null || typeof node !== "object") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((x) => abbrevWalk(x, abbrevLen));
  }
  /** @type {Record<string, unknown>} */
  const o = {};
  for (const k of Object.keys(node)) {
    const v = /** @type {Record<string, unknown>} */ (node)[k];
    const replacement = abbreviatedHashReplacement(k, v, abbrevLen);
    if (replacement !== null) {
      o[k] = replacement;
    } else {
      o[k] = abbrevWalk(v, abbrevLen);
    }
  }
  return o;
}

/**
 * @param {unknown} value
 * @param {number} depth nesting level (integer >= 0)
 * @returns {string}
 */
export function formatCanonicalJson(value, depth = 0) {
  if (value === null) {
    return "null";
  }
  const t = typeof value;
  if (t === "number" || t === "boolean") {
    return JSON.stringify(value);
  }
  if (t === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return formatCanonicalArray(value, depth);
  }
  if (t === "object") {
    return formatCanonicalObject(value, depth);
  }
  return JSON.stringify(value);
}

/**
 * @param {unknown[]} arr
 * @param {number} depth
 * @returns {string}
 */
function formatCanonicalArray(arr, depth) {
  if (arr.length === 0) {
    return "[]";
  }
  const pad = INDENT.repeat(depth);
  const innerPad = INDENT.repeat(depth + 1);

  const inlinePrimitiveCandidate = arr.every(
    (el) =>
      el === null ||
      typeof el === "string" ||
      typeof el === "number" ||
      typeof el === "boolean",
  );

  if (inlinePrimitiveCandidate) {
    const body = /** @type {unknown[]} */ (arr)
      .map((x) => formatCanonicalJson(x, 0))
      .join(", ");
    const line = `[${body}]`;
    if (line.length <= MAX_INLINE_ARRAY_CHARS) {
      return line;
    }
  }

  const lines = arr.map(
    (item) =>
      `${innerPad}${/** @type {string} */ (formatCanonicalJson(item, depth + 1))}`,
  );
  return `[\n${lines.join(",\n")}\n${pad}]`;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {number} depth
 * @returns {string}
 */
function formatCanonicalObject(obj, depth) {
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return "{}";
  }
  const pad = INDENT.repeat(depth);
  const innerPad = INDENT.repeat(depth + 1);
  const lines = keys.map((k) => {
    const keyStr = JSON.stringify(k);
    const v = formatCanonicalJson(obj[k], depth + 1);
    return `${innerPad}${keyStr}: ${v}`;
  });
  return `{\n${lines.join(",\n")}\n${pad}}`;
}

/**
 * Parse JSON text → abbreviate hashes → canonical pretty print.
 *
 * @param {string} text
 * @param {number} abbrevLen
 * @returns {{ changed: boolean, output: string }}
 */
export function rewriteJsonText(text, abbrevLen) {
  const parsed = JSON.parse(text);
  const abbreviated = abbreviateHashes(parsed, abbrevLen);
  const output = `${formatCanonicalJson(abbreviated, 0)}\n`;
  const changed = output !== text;
  return { changed, output };
}

/**
 * Compact single-line JSON for NDJSON records, HTTP bodies, and log append lines.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyCompactJson(value) {
  return JSON.stringify(value);
}

/**
 * Quote a string as a JSON string literal (YAML scalars, shell-safe path tokens, messages).
 *
 * @param {string} value
 * @returns {string}
 */
export function quoteJsonString(value) {
  return JSON.stringify(value);
}

/**
 * Deep-clone JSON-serializable data.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepCloneJson(value) {
  return JSON.parse(stringifyCompactJson(value));
}

/**
 * Canonical repo JSON document with trailing newline and abbreviated hashes.
 *
 * @param {unknown} value
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function stringifyRepoJson(value, repoRoot = process.cwd()) {
  const len = resolveAbbrevLen(repoRoot);
  const abbreviated = abbreviateHashes(value, len);
  return `${formatCanonicalJson(abbreviated, 0)}\n`;
}
