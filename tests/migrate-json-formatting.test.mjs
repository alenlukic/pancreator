import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  CANONICAL_JSON_INDENT_SPACES,
} from "../src/internal/tools/canonical-json-format.mjs";
import {
  abbreviateHashes,
  collectRepoJson,
  formatCanonicalJson,
  isExcludedRelPath,
  resolveAbbrevLen,
  rewriteJsonText,
} from "../src/internal/tools/migrate-json-formatting.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Flags single-line `{ ... "kind": "lines"|"symbol" ... }` dual-anchor blobs (spec anti-pattern). */
const COMPACT_DUAL_ANCHOR_INNER = /\{[^}\n\r]*"kind"\s*:\s*"(?:symbol|lines)"[^}\n\r]*"contentHash"\s*:/u;
const JS_LITERAL_CITATION = /\{kind:\s*(?:'|lines|symbol)/u;

function readComplianceDescriptor(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function readRepoText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function collectMarkdownCitationScanTargets() {
  const featureRoot = path.join(ROOT, "src/memory/features");
  const featureReports = fs
    .readdirSync(featureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.posix.join("src/memory/features", entry.name, "delivery-report.md"))
    .filter((rel) => fs.existsSync(path.join(ROOT, rel)))
    .sort();
  return [...featureReports, "src/personas/tech-writer.md"];
}

function toGlobalRegex(pattern) {
  return pattern.flags.includes("g")
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`);
}

function findLineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function listPatternHitLines(text, pattern) {
  const rx = toGlobalRegex(pattern);
  /** @type {number[]} */
  const lines = [];
  for (const match of text.matchAll(rx)) {
    if (match.index === undefined) continue;
    lines.push(findLineNumber(text, match.index));
  }
  return lines;
}

test("tests/compliance/json-formatting.yaml matches schema-ref contract surface", () => {
  const text = readComplianceDescriptor("tests/compliance/json-formatting.yaml");
  assert.match(text, /^schema_ref:\s+"tests\/compliance\/schemas\/latest\.yaml"$/m);
  assert.match(text, /^id:\s+"json-formatting"$/m);
  assert.match(text, /\bindent\b.*\b2\b/m);
  assert.match(text, /node_modules|\bnode_modules\//);
  assert.match(text, /package-lock\.json/);
  assert.match(text, /tsconfig\.tsbuildinfo/);
  assert.match(text, /contentHash/);
  assert.match(text, /Markdown|\bmarkdown\b/i);
  assert.match(text, /terminal|CLI|agent-chat|\bfixture\b/i);
  assert.match(text, /canonical-json-format\.mjs/);
});

test("resolveAbbrevLen: git-derived length succeeds on this repository", () => {
  const key = "PAN_JSON_FORMAT_ABBREV_LEN";
  const had = Object.hasOwn(process.env, key);
  const prev = process.env[key];
  delete process.env[key];
  try {
    const len = resolveAbbrevLen(ROOT);
    assert.ok(len >= 7 && len <= 40);
  } finally {
    if (had) {
      process.env[key] = prev;
    } else {
      delete process.env[key];
    }
  }
});

test("resolveAbbrevLen: env override yields deterministic abbreviation length", () => {
  const key = "PAN_JSON_FORMAT_ABBREV_LEN";
  const had = Object.hasOwn(process.env, key);
  const prev = process.env[key];
  process.env[key] = "11";
  try {
    assert.equal(resolveAbbrevLen(ROOT), 11);
  } finally {
    if (had) {
      process.env[key] = prev;
    } else {
      delete process.env[key];
    }
  }
});

test("rewriteJsonText: abbreviates contentHash SHA-256 to prefix length", () => {
  const full =
    "2e25524c03b9de8baef18fc3216d90c1bd0c85ceae1a47d8b0fd2212b0d49508";
  const input = `${JSON.stringify(
    {
      refs: [{ contentHash: full }],
      keep: true,
    },
    null,
    2,
  )}\n`;
  const { output, changed } = rewriteJsonText(input, 7);
  assert.equal(changed, true);
  const round = JSON.parse(output);
  assert.equal(round.refs[0].contentHash, full.slice(0, 7));
});

test("rewriteJsonText is idempotent on stable output", () => {
  const full =
    "2e25524c03b9de8baef18fc3216d90c1bd0c85ceae1a47d8b0fd2212b0d49508";
  const once = rewriteJsonText(
    `${JSON.stringify({ contentHash: full }, null, 2)}\n`,
    7,
  );
  const twice = rewriteJsonText(once.output, 7);
  assert.equal(twice.changed, false);
  assert.equal(twice.output, once.output);
});

test("rewriteJsonText keeps compact primitive arrays on one line", () => {
  const formatted = rewriteJsonText(
    `${JSON.stringify({ tags: [1, 2, 3], name: "x" }, null, 2)}\n`,
    7,
  ).output;
  assert.match(formatted, /"tags": \[1, 2, 3]/);
});

test("formatCanonicalJson nests objects inside arrays across multiple lines", () => {
  const doc = [{ id: "a", n: 1 }];
  assert.match(formatCanonicalJson(doc, 0), /\[\n\s+\{\n/u);
});

test("isExcludedRelPath and collectRepoJson skip node_modules and package-lock", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pan-jsonfmt-"));
  try {
    const nested = path.join(tmp, "node_modules", "pkg");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "x.json"), "{}", "utf8");
    fs.writeFileSync(path.join(tmp, "package-lock.json"), "{}", "utf8");
    fs.mkdirSync(path.join(tmp, "keep"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "keep", "a.json"), "{}", "utf8");

    assert.equal(isExcludedRelPath("node_modules/pkg/x.json"), true);
    assert.equal(isExcludedRelPath("package-lock.json"), true);
    const { repoRelativePaths } = collectRepoJson(tmp);
    assert.deepEqual(repoRelativePaths, ["keep/a.json"]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("abbreviateHashes shortens standalone 40-char git blobs", () => {
  const sha1 = "0".repeat(40);
  const out = abbreviateHashes({ rev: sha1 }, 7);
  assert.deepEqual(out, { rev: "0".repeat(7) });
});

test("abbreviateHashes ignores non-hash hex literals under abbreviation length gates", () => {
  const out = abbreviateHashes({ hex16: "a".repeat(16) }, 7);
  assert.deepEqual(out, { hex16: "a".repeat(16) });
});

test("markdown citation compliance scan flags compact and JS-literal dual-anchor forms", () => {
  const allowlist = new Set([
    "src/memory/features/json-formatting/spec.md",
    "tests/fixtures/json-formatting/forbidden-inline-citation-snippet.raw",
  ]);
  const targets = [
    ...new Set([
      ...collectMarkdownCitationScanTargets(),
      "src/memory/features/json-formatting/spec.md",
      "tests/fixtures/json-formatting/forbidden-inline-citation-snippet.raw",
    ]),
  ];
  const failures = [];

  for (const rel of targets) {
    const text = readRepoText(rel);
    const compactHits = listPatternHitLines(text, COMPACT_DUAL_ANCHOR_INNER);
    const jsLiteralHits = listPatternHitLines(text, JS_LITERAL_CITATION);
    if (allowlist.has(rel)) {
      continue;
    }
    for (const line of compactHits) {
      failures.push(`${rel}:${line} compact-dual-anchor`);
    }
    for (const line of jsLiteralHits) {
      failures.push(`${rel}:${line} js-literal-citation`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    `forbidden markdown citation pattern hits:\n${failures.join("\n")}`,
  );
});

const migrateScript = path.join(ROOT, "src/internal/tools/migrate-json-formatting.mjs");

test("canonical-json-format exposes two-space canonical indent metadata", () => {
  assert.equal(CANONICAL_JSON_INDENT_SPACES, 2);
});

test("fixture agent-chat expectation uses KV-per-line canonical object layout", () => {
  const rel = "tests/fixtures/json-formatting/agent-chat-payload-expectation.json";
  const raw = `${readRepoText(rel).trimEnd()}\n`;
  assert.equal(`${formatCanonicalJson(JSON.parse(raw), 0)}\n`, raw);
});

test("forbidden-inline fixture inner blob matches compact citation detector", () => {
  const line = readRepoText("tests/fixtures/json-formatting/forbidden-inline-citation-snippet.raw").trimEnd();
  const inner = line.startsWith("`") && line.endsWith("`") ? line.slice(1, -1).trim() : line;
  assert.match(inner, COMPACT_DUAL_ANCHOR_INNER);
});

test("migrate-json-formatting dry-run emits parseable canonically indented JSON summary", () => {
  const out = execFileSync(process.execPath, [migrateScript, "--dry-run", "--root", ROOT], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.match(out, /^\{\n {2}"mode"\s*:/);
  JSON.parse(out.trimEnd());
});

test("migration dry-run on canonically rewritten temp repo reports zero wouldRewrite count", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pan-json-canonical-"));
  try {
    fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
    const obj = { a: 1, tags: ["x"] };
    const abbrev = resolveAbbrevLen(ROOT);
    const canon = rewriteJsonText(`${JSON.stringify(obj, null, 2)}\n`, abbrev).output;
    fs.writeFileSync(path.join(tmp, "data", "x.json"), canon, "utf8");
    const out = execFileSync(process.execPath, [migrateScript, "--dry-run", "--root", tmp], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PAN_JSON_FORMAT_ABBREV_LEN: "7" },
    });
    const summary = JSON.parse(out.trimEnd());
    assert.equal(summary.wouldRewrite, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
