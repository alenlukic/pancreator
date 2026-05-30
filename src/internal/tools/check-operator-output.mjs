#!/usr/bin/env node
/**
 * Detect bare `pan` invocations in runnable fenced code blocks across operator-visible surfaces.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const GLOBS = [
  "AGENTS.md",
  "README.md",
  "OPERATION.md",
  "src/personas",
  ".cursor/agents",
  ".cursor/rules",
  "src/memory/handbook",
];

const RUNNABLE_LANGS = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "terminal",
]);

const BARE_PAN_RE = /(?:^|[\s;&|])(?<!\bpnpm\s+-w\s+exec\s+)pan\s+[a-z]/i;

let failures = 0;

function collectFiles(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const st = fs.statSync(abs);
  if (st.isFile()) return [rel];
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    out.push(...collectFiles(path.join(rel, ent.name)));
  }
  return out;
}

function checkMarkdown(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  const text = fs.readFileSync(abs, "utf8");
  const display = path.isAbsolute(rel) ? rel : rel.replace(/\\/g, "/");
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(text)) !== null) {
    const info = (m[1] || "").trim().toLowerCase();
    const lang = info.split(/\s+/)[0];
    if (lang && !RUNNABLE_LANGS.has(lang)) continue;
    const body = m[2];
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (BARE_PAN_RE.test(line)) {
        failures += 1;
        console.error(`[check-operator-output] ${display}: bare pan in runnable block: ${trimmed}`);
      }
    }
  }
}

const extraPaths = process.argv.slice(2).map((p) => p.replace(/\\/g, "/"));

if (extraPaths.length > 0) {
  for (const rel of extraPaths) {
    checkMarkdown(rel);
  }
} else {
  for (const root of GLOBS) {
    for (const rel of collectFiles(root)) {
      if (!/\.(md|mdc)$/i.test(rel)) continue;
      checkMarkdown(rel);
    }
  }
}

if (failures > 0) {
  console.error(`[check-operator-output] ${failures} violation(s)`);
  process.exit(1);
}

console.log("[check-operator-output] ok");
