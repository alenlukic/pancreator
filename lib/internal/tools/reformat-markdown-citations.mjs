#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  abbreviateHashes,
  formatCanonicalJson,
  resolveAbbrevLen,
} from "./canonical-json-format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");
const FEATURES_DIR = path.join(ROOT, "lib", "memory", "features");

function listDeliveryReports() {
  return readdirSync(FEATURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.posix.join("lib/memory/features", entry.name, "delivery-report.md"))
    .filter((rel) => rel !== "lib/memory/features/json-formatting/delivery-report.md")
    .filter((rel) => existsSync(path.join(ROOT, rel)))
    .sort();
}

function splitTopLevel(body) {
  const out = [];
  let start = 0;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const prev = i > 0 ? body[i - 1] : "";
    if (inSingle) {
      if (ch === "'" && prev !== "\\") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== "\\") {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "[" || ch === "(" || ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "]" || ch === ")" || ch === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === "," && depth === 0) {
      out.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(body.slice(start).trim());
  return out.filter(Boolean);
}

function normalizeBareToken(token) {
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "null") return null;
  if (/^-?\d+$/.test(token)) return Number(token);
  return token;
}

function parseValue(raw) {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((item) => parseValue(item));
  }
  return normalizeBareToken(value);
}

function parseLegacyCitation(rawObjectLiteral) {
  const inner = rawObjectLiteral
    .trim()
    .replace(/^\{/, "")
    .replace(/\}$/, "")
    .trim();
  const pairs = splitTopLevel(inner);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const pair of pairs) {
    const idx = pair.indexOf(":");
    if (idx < 0) continue;
    const rawKey = pair.slice(0, idx).trim();
    const rawValue = pair.slice(idx + 1);
    const key = rawKey.replace(/^['"]|['"]$/g, "");
    out[key] = parseValue(rawValue);
  }
  return out;
}

function gitBlobHash(repoRelPath) {
  const abs = path.join(ROOT, repoRelPath);
  if (!existsSync(abs)) return null;
  try {
    return execFileSync("git", ["hash-object", abs], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

function normalizeCitation(citation, abbrevLen) {
  const normalized = { ...citation };
  if (typeof normalized.kind !== "string") {
    normalized.kind = String(normalized.kind ?? "");
  }
  if (typeof normalized.path !== "string") {
    normalized.path = String(normalized.path ?? "");
  }
  if (!("contentHash" in normalized)) {
    normalized.contentHash = "TBD-on-commit";
  }

  const replacementHash = gitBlobHash(String(normalized.path));
  if (replacementHash) {
    normalized.contentHash = replacementHash;
  }

  return abbreviateHashes(normalized, abbrevLen);
}

function citationToFence(citation) {
  return `\n\n\`\`\`json\n${formatCanonicalJson(citation, 0)}\n\`\`\`\n`;
}

function reformatFile(repoRelPath, abbrevLen) {
  const abs = path.join(ROOT, repoRelPath);
  const original = readFileSync(abs, "utf8");
  let changed = false;
  let rewrites = 0;
  const rewritten = original.replace(/`?\{kind:[^{}\n\r]*\}`?/gu, (match) => {
    const bare = match.startsWith("`") && match.endsWith("`") ? match.slice(1, -1) : match;
    const parsed = parseLegacyCitation(bare);
    if (!parsed.kind || !parsed.path || (!parsed.range && !parsed.symbol)) {
      return match;
    }
    const normalized = normalizeCitation(parsed, abbrevLen);
    const block = citationToFence(normalized);
    changed = true;
    rewrites += 1;
    return block;
  });

  if (changed) {
    writeFileSync(abs, rewritten, "utf8");
  }
  return { changed, rewrites };
}

function main() {
  const abbrevLen = resolveAbbrevLen(ROOT);
  const reports = listDeliveryReports();
  let filesChanged = 0;
  let citationsRewritten = 0;
  for (const rel of reports) {
    const result = reformatFile(rel, abbrevLen);
    if (result.changed) {
      filesChanged += 1;
      citationsRewritten += result.rewrites;
    }
  }
  const summary = {
    reportsScanned: reports.length,
    reportsChanged: filesChanged,
    citationsRewritten,
  };
  process.stdout.write(`${formatCanonicalJson(summary, 0)}\n`);
}

main();
