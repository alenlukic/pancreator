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
} from "../lib/internal/tools/context-budget-report.mjs";

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
  assert.equal(classifyExclusiveTier("lib/memory/handbook/glossary.md"), "internal_operating");
  assert.equal(classifyExclusiveTier("lib/memory/active/current.md"), "active_memory");
  assert.equal(classifyExclusiveTier("lib/memory/features/foo/index.json"), "generated_machine");
  assert.equal(classifyExclusiveTier("work/README.md"), "active_work");
  assert.equal(classifyExclusiveTier("archive/work/172997_05-09-26/example/plan.md"), "archival_memory");
  assert.equal(classifyExclusiveTier("lib/internal/packages/@pancreator/core/src/index.ts"), "source_code");
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
  assert.ok(isIndexingExcluded("archive/inbox/in/example.md", matchers));
  assert.ok(isIndexingExcluded("work/active-run/plan.md", matchers));
  assert.ok(isIndexingExcluded("archive/work/172997_05-09-26/run/plan.md", matchers));
  assert.ok(isIndexingExcluded("lib/inbox/notes/private.md", matchers));
  assert.ok(isIndexingExcluded("docs/PRD.md", matchers));
  assert.ok(isIndexingExcluded("docs/BOOTSTRAP.md", matchers));
  assert.ok(!isIndexingExcluded("lib/memory/active/README.md", matchers));
  assert.ok(!isIndexingExcluded("docs/PRD.summary.md", matchers));
  assert.ok(!isIndexingExcluded("docs/M1.index.md", matchers));
});

test("CLI exits zero with eight tiers and aggregate labels", () => {
  const script = path.join(ROOT, "lib", "internal", "tools", "context-budget-report.mjs");
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /active memory[\s\S]*active work[\s\S]*durable memory[\s\S]*archival memory[\s\S]*internal operating[\s\S]*product context[\s\S]*source code[\s\S]*generated machine/);
  assert.match(out, /total corpus/);
  assert.match(out, /indexable default context/);
  assert.match(out, /explicit-read-only corpus/);
  assert.match(out, /active memory footprint/);
  assert.match(out, /Cursor subagent projections/);
  assert.match(out, /canonical:/);
  assert.match(out, /chars\/4/);
});

test("Cursor persona projections use one canonical file per persona", () => {
  const dir = path.join(ROOT, ".cursor", "agents");
  const names = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
  const bases = names.filter((n) => !n.endsWith("-standard") && !n.endsWith("-complex") && n !== "general-purpose");
  assert.ok(bases.length > 0);
  for (const base of bases) {
    assert.equal(fs.existsSync(path.join(dir, `${base}-standard.md`)), false, `${base}-standard should be retired`);
    assert.equal(fs.existsSync(path.join(dir, `${base}-complex.md`)), false, `${base}-complex should be retired`);
    const canonical = fs.readFileSync(path.join(dir, `${base}.md`), "utf8");
    assert.match(canonical, /^model:\s*\S+/m, `${base} should declare a model`);
    assert.match(canonical, new RegExp(`pancreator-base-persona: ${base}`));
    assert.match(canonical, /pancreator-model-tier: canonical/);
  }
});

test("Cursor general-purpose agent is a standalone fallback, not a persona tier projection", () => {
  const dir = path.join(ROOT, ".cursor", "agents");
  const fallback = fs.readFileSync(path.join(dir, "general-purpose.md"), "utf8");
  assert.match(fallback, /^name: general-purpose$/m);
  assert.match(fallback, /pancreator-model-tier: standalone/);
  assert.match(fallback, /route discovery/i);
  assert.equal(fs.existsSync(path.join(dir, "general-purpose-standard.md")), false);
  assert.equal(fs.existsSync(path.join(dir, "general-purpose-complex.md")), false);
});

test("persona and Cursor agent frontmatter avoids inline maxTurns comments", () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, "lib", "personas")).map((f) => path.join(ROOT, "lib", "personas", f)),
    ...fs.readdirSync(path.join(ROOT, ".cursor", "agents")).map((f) => path.join(ROOT, ".cursor", "agents", f)),
  ].filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const rel = posixRel(path.relative(ROOT, file));
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /^maxTurns:\s*[^\n#]+#/m, `${rel} has an inline maxTurns comment`);
  }
});
