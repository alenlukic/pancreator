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
} from "../src/internal/tools/context-budget-report.mjs";

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

test("classifyExclusiveTier separates handbook, active work, archival, durable JSON, internal source", () => {
  assert.equal(classifyExclusiveTier("src/memory/handbook/glossary.md"), "internal_operating");
  assert.equal(classifyExclusiveTier("src/memory/active/current.md"), "active_memory");
  assert.equal(classifyExclusiveTier("src/memory/features/foo/index.json"), "generated_machine");
  assert.equal(classifyExclusiveTier("src/work/README.md"), "active_work");
  assert.equal(classifyExclusiveTier("src/internal/work_archive/172997_05-09-26/example/plan.md"), "archival_memory");
  assert.equal(classifyExclusiveTier("src/internal/packages/@tesseract/core/src/index.ts"), "source_code");
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

test("indexing policy excludes archival, full specs, and agent projections while keeping compact routes", () => {
  const matchers = indexingMatchersFromRoot(ROOT);
  assert.ok(isIndexingExcluded(".cursor/agents/tech-lead.md", matchers));
  assert.ok(isIndexingExcluded(".cursor/agents/tech-lead-complex.md", matchers));
  assert.ok(isIndexingExcluded("src/inbox/archive/in/example.md", matchers));
  assert.ok(isIndexingExcluded("src/work/active-run/plan.md", matchers));
  assert.ok(isIndexingExcluded("src/internal/work_archive/172997_05-09-26/run/plan.md", matchers));
  assert.ok(isIndexingExcluded("src/inbox/notes/private.md", matchers));
  assert.ok(isIndexingExcluded("docs/PRD.md", matchers));
  assert.ok(isIndexingExcluded("docs/BOOTSTRAP.md", matchers));
  assert.ok(!isIndexingExcluded("src/memory/active/README.md", matchers));
  assert.ok(!isIndexingExcluded("docs/PRD.summary.md", matchers));
  assert.ok(!isIndexingExcluded("docs/M1.index.md", matchers));
});

test("CLI exits zero with eight tiers and aggregate labels", () => {
  const script = path.join(ROOT, "src", "internal", "tools", "context-budget-report.mjs");
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /active memory[\s\S]*active work[\s\S]*durable memory[\s\S]*archival memory[\s\S]*internal operating[\s\S]*product context[\s\S]*source code[\s\S]*generated machine/);
  assert.match(out, /total corpus/);
  assert.match(out, /indexable default context/);
  assert.match(out, /explicit-read-only corpus/);
  assert.match(out, /active memory footprint/);
  assert.match(out, /Cursor subagent projections/);
  assert.match(out, /standard:[\s\S]*complex:/);
  assert.match(out, /chars\/4/);
});

test("Cursor subagent projections expose standard and complex tiers", () => {
  const dir = path.join(ROOT, ".cursor", "agents");
  const names = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
  const bases = names.filter((n) => !n.endsWith("-standard") && !n.endsWith("-complex"));
  assert.ok(bases.length > 0);
  for (const base of bases) {
    const alias = fs.readFileSync(path.join(dir, `${base}.md`), "utf8");
    const standard = fs.readFileSync(path.join(dir, `${base}-standard.md`), "utf8");
    const complex = fs.readFileSync(path.join(dir, `${base}-complex.md`), "utf8");
    assert.match(alias, /^model: auto$/m, `${base} alias should use auto`);
    assert.match(standard, /^model: auto$/m, `${base}-standard should use auto`);
    assert.doesNotMatch(complex, /^model: auto$/m, `${base}-complex should preserve a fixed model`);
    assert.match(alias, new RegExp(`tesseract-base-persona: ${base}`));
    assert.match(complex, new RegExp(`tesseract-model-tier: complex`));
  }
});

test("persona and Cursor agent frontmatter avoids inline maxTurns comments", () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, "src", "personas")).map((f) => path.join(ROOT, "src", "personas", f)),
    ...fs.readdirSync(path.join(ROOT, ".cursor", "agents")).map((f) => path.join(ROOT, ".cursor", "agents", f)),
  ].filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const rel = posixRel(path.relative(ROOT, file));
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /^maxTurns:\s*[^\n#]+#/m, `${rel} has an inline maxTurns comment`);
  }
});
