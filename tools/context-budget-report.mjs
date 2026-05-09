#!/usr/bin/env node
/**
 * Rough repository text footprint for context-budget discussions.
 * Token estimate = ceil(chars / 4); NOT model tokenizer output.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

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
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
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

/** @param {string} prefix */
function underPrefix(prefix) {
  const norm = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return (rel) => rel === prefix || rel.startsWith(norm);
}

function main() {
  const scopes = [
    { id: "whole_repo_text", label: "Whole repo (text files, heuristic)", pred: () => true },
    { id: "work", label: "work/**", pred: underPrefix("work") },
    { id: "memory", label: "memory/**", pred: underPrefix("memory") },
    { id: "PRD_md", label: "PRD.md", pred: (rel) => rel === "PRD.md" },
    { id: "AGENTS_md", label: "AGENTS.md", pred: (rel) => rel === "AGENTS.md" },
    { id: "cursor", label: ".cursor/**", pred: underPrefix(".cursor") },
    { id: "personas", label: "personas/**", pred: underPrefix("personas") },
    { id: "packages", label: "packages/**", pred: underPrefix("packages") },
    { id: "pnpm_lock", label: "pnpm-lock.yaml", pred: (rel) => rel === "pnpm-lock.yaml" },
    {
      id: "generated_json_manifests",
      label: "Generated JSON manifests (heuristic globs)",
      pred: (rel) =>
        /(^|\/)migration-manifest[^/]*\.json$/i.test(rel) ||
        /\.(dry-run|post-write|write)\.json$/i.test(rel),
    },
  ];

  console.log("Context budget report (rough char counts; tokens ≈ chars/4)\n");
  console.log(`Root: ${ROOT}\n`);

  for (const { id, label, pred } of scopes) {
    const { chars, files } = countMatchingChars(pred);
    const estTok = Math.ceil(chars / 4);
    console.log(`${label}`);
    console.log(`  id=${id} files=${files} chars=${chars} est_tokens≈${estTok} (chars/4, labeled rough)`);
    console.log("");
  }
}

main();
