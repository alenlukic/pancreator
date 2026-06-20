#!/usr/bin/env node
/**
 * Migrate pancreator/lib/memory Markdown frontmatter to the portable subset:
 * - flatten nested references[] to scalar JSON strings
 * - normalize related to block-style scalar lists
 * - close frontmatter with ... instead of ---
 *
 * Usage:
 *   node lib/internal/tools/migrations/migrate-memory-frontmatter-portability.mjs [--dry-run]
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import {
  quoteJsonString,
  stringifyCompactJson,
} from "../format/canonical-json-format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const MEMORY_ROOT = path.join(REPO_ROOT, "lib/memory");

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n([\s\S]*)$/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} ref
 * @returns {string}
 */
function flattenReference(ref) {
  if (typeof ref === "string") {
    return ref;
  }
  if (isPlainObject(ref)) {
    return stringifyCompactJson(ref);
  }
  throw new Error(`Unsupported reference entry: ${String(ref)}`);
}

/**
 * @param {string} serialized
 * @returns {string}
 */
function yamlSingleQuoted(serialized) {
  return `'${serialized.replace(/'/g, "''")}'`;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {string[]}
 */
function emitField(key, value) {
  if (key === "references" && Array.isArray(value)) {
    const lines = ["references:"];
    for (const item of value) {
      lines.push(`  - ${yamlSingleQuoted(flattenReference(item))}`);
    }
    return lines;
  }
  if (key === "related" && Array.isArray(value)) {
    const lines = ["related:"];
    for (const item of value) {
      lines.push(`  - ${String(item)}`);
    }
    return lines;
  }
  if (key === "owners" && Array.isArray(value)) {
    return [`owners: [${value.map(String).join(", ")}]`];
  }
  if (typeof value === "string" && value.includes("\n")) {
    const trimmed = value.replace(/\n+$/u, "");
    return [`${key}: |`, ...trimmed.split("\n").map((line) => `  ${line}`)];
  }
  if (Array.isArray(value)) {
    return [
      `${key}:`,
      ...value.map((item) =>
        typeof item === "string" ? `  - ${item}` : `  - ${stringifyCompactJson(item)}`,
      ),
    ];
  }
  if (value === null) {
    return [`${key}: null`];
  }
  if (typeof value === "boolean") {
    return [`${key}: ${value}`];
  }
  if (typeof value === "number") {
    return [`${key}: ${value}`];
  }
  const scalar = String(value);
  if (
    /[:#\[\]{}&*!|>'"%@`,]/.test(scalar) ||
    scalar.startsWith(" ") ||
    scalar.endsWith(" ") ||
    /^(yes|no|true|false|null|~)$/i.test(scalar) ||
    /^0b/i.test(scalar)
  ) {
    return [`${key}: ${quoteJsonString(scalar)}`];
  }
  return [`${key}: ${scalar}`];
}

/**
 * @param {string} content
 * @returns {{ content: string, changed: boolean }}
 */
export function migrateMemoryFrontmatterContent(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { content, changed: false };
  }
  const fmText = match[1] ?? "";
  const body = match[2] ?? "";
  const doc = parseDocument(fmText);
  const data = doc.toJSON();
  if (!isPlainObject(data)) {
    return { content, changed: false };
  }

  if (Array.isArray(data.references)) {
    data.references = data.references.map((ref) => flattenReference(ref));
  }

  const lines = ["---"];
  const items = doc.contents && "items" in doc.contents ? doc.contents.items : [];
  for (const item of items) {
    const key = String(item.key?.value ?? item.key ?? "");
    lines.push(...emitField(key, data[key]));
  }
  lines.push("...");
  lines.push("");
  const nextContent = `${lines.join("\n")}${body}`;
  return { content: nextContent, changed: nextContent !== content };
}

/**
 * @param {string} relDir
 * @returns {string[]}
 */
function collectMarkdownFiles(relDir = "") {
  /** @type {string[]} */
  const out = [];
  const absDir = relDir ? path.join(MEMORY_ROOT, relDir) : MEMORY_ROOT;
  if (!existsSync(absDir)) {
    return out;
  }
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectMarkdownFiles(rel));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(rel);
    }
  }
  return out.sort();
}

/**
 * @param {{ dryRun?: boolean }} [options]
 */
export function migrateMemoryFrontmatter(options = {}) {
  const dryRun = options.dryRun ?? false;
  let changedCount = 0;
  for (const rel of collectMarkdownFiles()) {
    const abs = path.join(MEMORY_ROOT, rel);
    const original = readFileSync(abs, "utf8");
    const { content, changed } = migrateMemoryFrontmatterContent(original);
    if (!changed) {
      continue;
    }
    changedCount += 1;
    if (dryRun) {
      process.stdout.write(`would update lib/memory/${rel}\n`);
    } else {
      writeFileSync(abs, content, "utf8");
    }
  }
  return { changedCount };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { changedCount } = migrateMemoryFrontmatter({ dryRun });
  process.stdout.write(
    `${dryRun ? "Would update" : "Updated"} ${changedCount} memory Markdown file(s).\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
