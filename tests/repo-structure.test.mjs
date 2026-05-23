import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}


function collectFiles(rel, predicate) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const entry = fs.statSync(abs);
  if (entry.isFile()) return predicate(rel) ? [rel] : [];
  if (!entry.isDirectory()) return [];
  const ignoredDirs = new Set([".git", "node_modules", "dist", ".turbo"]);
  const files = [];
  for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
    if (child.isDirectory() && ignoredDirs.has(child.name)) continue;
    files.push(...collectFiles(path.posix.join(rel, child.name), predicate));
  }
  return files;
}

function daysToFdsForSuffix(mmDdYy) {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(mmDdYy);
  assert.ok(m, `invalid MM-DD-YY suffix: ${mmDdYy}`);
  const [, mm, dd, yy] = m;
  const year = 2000 + Number(yy);
  const dayMs = Date.UTC(year, Number(mm) - 1, Number(dd), 0, 0, 0, 0);
  return Math.floor((FDS_UTC_MS - dayMs) / 86400000);
}


test("repository JSON files use two-space formatting", () => {
  const jsonFiles = collectFiles(".", (rel) => rel.endsWith(".json"));
  assert.ok(jsonFiles.length > 0);

  const offenders = [];
  for (const rel of jsonFiles) {
    const raw = read(rel);
    const expected = `${JSON.stringify(JSON.parse(raw), null, 2)}\n`;
    if (raw !== expected) offenders.push(rel);
  }

  assert.deepEqual(offenders, []);
});

test("operator-facing root keeps implementation under internal while tests and docs stay at root", () => {
  assert.ok(exists("src/internal/packages"));
  assert.ok(exists("src/internal/tools"));
  assert.ok(exists("src/internal/work_archive"));
  assert.ok(exists("tests/compliance/schemas/latest.yaml"));
  assert.ok(exists("docs/PRD.md"));
  assert.ok(exists("docs/BOOTSTRAP.md"));
  assert.ok(exists("docs/M1.index.md"));
  assert.ok(exists("src/work/README.md"));
  assert.equal(exists("packages"), false);
  assert.equal(exists("src/internal/tests"), false);
  assert.equal(exists("tools"), false);
  assert.equal(exists("PRD.md"), false);
  assert.equal(exists("BOOTSTRAP.md"), false);
  assert.equal(exists("M1.index.md"), false);
});


test("tesseract.yaml tracks live bootstrap state and embedded project root", () => {
  const config = read("tesseract.yaml");
  assert.match(config, /^project_root:\s+"\."$/m);
  assert.match(config, /^\s+phase:\s+"4"$/m);
  assert.match(config, /^\s+status:\s+phase-4-ratified$/m);
  assert.match(config, /^\s+completed_phases:\s+\["-1", "0", "1", "2", "3"\]$/m);

  const defaults = read("tesseract-defaults.yaml");
  assert.doesNotMatch(defaults, /^bootstrap:\s*$/m);
  assert.match(defaults, /introduced during Bootstrap Phase 2/);
});

test("configuration docs route project_root through adopter and handbook", () => {
  assert.ok(exists("src/memory/handbook/tesseract-config.md"));
  assert.match(read("src/memory/handbook/tesseract-config.md"), /project_root/);
  assert.match(read("src/personas/adopter.md"), /project_root/);
  assert.match(read("src/skills/adopt-existing-repo/SKILL.md"), /project_root/);
  assert.match(read("src/memory/handbook/index.md"), /tesseract-config\.md/);
});

test("archived work day-directory prefixes match days from UTC day to Jan 1 2500", () => {
  const archiveRoot = path.join(ROOT, "src", "internal", "work_archive");
  const names = fs.readdirSync(archiveRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{6}_\d{2}-\d{2}-\d{2}$/.test(name));
  assert.ok(names.length > 0);
  for (const name of names) {
    const [prefix, suffix] = name.split("_");
    assert.equal(Number(prefix), daysToFdsForSuffix(suffix), name);
  }
});

test("active work day directories use canonical days-to-FDS prefixes", () => {
  const activeWorkRoot = path.join(ROOT, "src", "work");
  const dayDirs = fs.readdirSync(activeWorkRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const offenders = dayDirs.filter((name) => !/^\d{6}_\d{2}-\d{2}-\d{2}$/.test(name));
  assert.deepEqual(offenders, []);
  for (const name of dayDirs) {
    const [prefix, suffix] = name.split("_");
    assert.equal(Number(prefix), daysToFdsForSuffix(suffix), name);
  }
});



test("planning/execution handoff contract is represented across active memory, pipeline, and personas", () => {
  assert.ok(exists("src/memory/active/handoffs.md"));

  const activeReadme = read("src/memory/active/README.md");
  assert.match(activeReadme, /src\/memory\/active\/handoffs\.md/);
  assert.match(activeReadme, /src\/work\/<day>\/<task-id>\/handoff\.md/);

  const contextEconomy = read("src/memory/handbook/context-economy.md");
  assert.match(contextEconomy, /Planning\/execution handoff discipline/);
  assert.match(contextEconomy, /src\/memory\/active\/handoffs\.md/);

  const pipeline = read("src/pipelines/feature-delivery.yaml");
  assert.match(pipeline, /src\/work\/<day>\/<task-id>\/handoff\.md/);

  const techLead = read("src/personas/tech-lead.md");
  const coder = read("src/personas/coder.md");
  const supervisor = read("src/personas/supervisor.md");
  const glossary = read("src/memory/handbook/glossary.md");
  assert.match(glossary, /Handoff card/);
  assert.match(techLead, /handoff\.md/);
  assert.match(coder, /handoff\.md/);
  assert.match(supervisor, /src\/memory\/active\/handoffs\.md/);
});

test("workspace, scripts, and workflow use conventional test and docs paths", () => {
  const workspace = read("pnpm-workspace.yaml");
  assert.match(workspace, /src\/internal\/packages\/\*/);
  assert.match(workspace, /src\/internal\/packages\/@tesseract\/\*/);

  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts["check:phase0a"], /^node src\/internal\/tools\//);
  assert.match(pkg.scripts["context:budget"], /^node src\/internal\/tools\//);
  assert.match(pkg.scripts["repo:structure:test"], /^node --test tests\//);

  const workflow = read(".github/workflows/phase-0a-scaffold.yml");
  assert.match(workflow, /src\/internal\/packages\/\*\*/);
  assert.match(workflow, /src\/internal\/tools\/\*\*/);
  assert.match(workflow, /docs\/\*\*/);
  assert.match(workflow, /tests\/\*\*/);
  assert.match(workflow, /\.cursor\/agents\/\*\*/);
  assert.match(workflow, /\.cursor\/hooks\/\*\*/);
  assert.match(workflow, /\.cursor\/rules\/\*\*/);
  assert.match(workflow, /pnpm run migration:test/);
  assert.match(workflow, /pnpm run context:budget:test/);
  assert.match(workflow, /pnpm run repo:structure:test/);
});

test("Cursor indexing excludes active and archived work by default", () => {
  const ignore = read(".cursorindexingignore");
  assert.match(ignore, /^src\/work\/\*\*$/m);
  assert.match(ignore, /^src\/internal\/work_archive\/\*\*$/m);
});

test("librarian owns completed work archival maintenance", () => {
  const librarian = read("src/personas/librarian.md");
  assert.match(librarian, /src\/internal\/work_archive\//);
  assert.match(librarian, /archive_completed_work/);
});

test("live normative surfaces use three-level work placeholders", () => {
  const roots = [
    "AGENTS.md",
    ".cursor/hooks/enforce-policy-compliance.sh",
    ".cursor/rules",
    "docs",
    "src/internal/packages",
    "src/memory/handbook",
    "src/skills",
    "tests/compliance",
  ];
  const files = [];
  const addPath = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        addPath(path.posix.join(rel, entry.name));
      }
    } else if (stat.isFile()) {
      files.push(rel);
    }
  };
  roots.forEach(addPath);

  const offenders = [];
  for (const rel of files) {
    const text = read(rel);
    if (
      /src\/work\/<(?:id|task-id)>\//.test(text) ||
      /src\/work\/\*\/run\.log\.jsonl/.test(text)
    ) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});

test("policy-compliance hook accepts only canonical three-level artifacts", () => {
  const hook = read(".cursor/hooks/enforce-policy-compliance.sh");
  assert.match(hook, /\^src\/work\/\[\^\/\]\+\/\[\^\/\]\+\/policy-compliance\\\.json\$/);
  assert.doesNotMatch(hook, /\^src\/work\/\[\^\/\]\+\/policy-compliance\\\.json\$/);
  assert.match(hook, /src\/work\/<day>\/<task-id>\/policy-compliance\.json/);
});

test("Cursor implementation rules avoid broad src-wide activation", () => {
  const coderRule = read(".cursor/rules/coder.mdc");
  assert.doesNotMatch(coderRule, /"src\/\*\*\/\*"|"src\/\*\*\/\*\*"|"src\/\*\*\/*"/);
  assert.doesNotMatch(coderRule, /-\s+"src\/\*\*\/*"/);
  assert.match(coderRule, /src\/internal\/packages\/\*\*\/src\/\*\*\/\*/);
  assert.match(coderRule, /tests\/\*\*\/\.mjs|tests\/\*\*\/\*\.mjs/);
});
