import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyExclusiveTier,
  computeTierAndIndexingStats,
  indexingMatchersFromRoot,
  isIndexingExcluded,
  matcherForIndexingPatternLine,
  posixRel,
} from "./context-budget-report.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function eachIndexingPatternLine(cb) {
  const text = fs.readFileSync(path.join(ROOT, ".cursorindexingignore"), "utf8");
  text
    .split(/\r?\n/)
    .map((ln) => ln.replace(/#.*/, "").trim())
    .filter(Boolean)
    .forEach(cb);
}

test("every ignore pattern line compiles to a matcher function", () => {
  eachIndexingPatternLine((ln) => {
    assert.equal(typeof matcherForIndexingPatternLine(ln), "function");
  });
});

test("classifyExclusiveTier separates handbook, durable JSON, packages, tests", () => {
  assert.equal(classifyExclusiveTier("memory/handbook/glossary.md"), "internal_operating");
  assert.equal(classifyExclusiveTier("memory/active/current.md"), "active_memory");
  assert.equal(classifyExclusiveTier("memory/features/foo/index.json"), "generated_machine");
  assert.equal(classifyExclusiveTier("packages/@tesseract/core/src/index.ts"), "source_code");
  assert.equal(
    classifyExclusiveTier("tests/compliance/schemas/latest.yaml"),
    "source_code",
  );
});

test("posixRel normalizes slashes", () => {
  assert.equal(posixRel(`a${path.sep}b`), "a/b");
});

test("tier char sums reconcile with total corpus and indexable partitioning", () => {
  const s = computeTierAndIndexingStats(ROOT);
  let sumChars = 0;
  let sumFiles = 0;
  for (const [, v] of Object.entries(s.byTier)) {
    sumChars += v.chars;
    sumFiles += v.files;
  }
  assert.equal(sumChars, s.totalChars);
  assert.equal(sumFiles, s.totalFiles);
  assert.equal(s.indexableChars + s.excludedChars, s.totalChars);
  assert.equal(s.indexableFiles + s.excludedFiles, s.totalFiles);
  assert.equal(s.activeChars, s.byTier.active_memory.chars);
});

test(".cursor/agents mirrored paths are indexer-excluded; memory/active markdown is indexer-included", () => {
  const matchers = indexingMatchersFromRoot(ROOT);
  assert.ok(isIndexingExcluded(".cursor/agents/tech-lead.md", matchers));
  assert.ok(!isIndexingExcluded("memory/active/README.md", matchers));
});

test("CLI exits zero with seven tiers and aggregate labels", () => {
  const script = path.join(import.meta.dirname, "context-budget-report.mjs");
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /active memory[\s\S]*durable memory[\s\S]*archival memory[\s\S]*internal operating[\s\S]*product context[\s\S]*source code[\s\S]*generated machine/);
  assert.match(out, /total corpus/);
  assert.match(out, /indexable default context/);
  assert.match(out, /explicit-read-only corpus/);
  assert.match(out, /active memory footprint/);
  assert.match(out, /chars\/4/);
});
