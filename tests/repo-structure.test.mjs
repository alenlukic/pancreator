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

function daysToFdsForSuffix(mmDdYy) {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(mmDdYy);
  assert.ok(m, `invalid MM-DD-YY suffix: ${mmDdYy}`);
  const [, mm, dd, yy] = m;
  const year = 2000 + Number(yy);
  const dayMs = Date.UTC(year, Number(mm) - 1, Number(dd), 0, 0, 0, 0);
  return Math.floor((FDS_UTC_MS - dayMs) / 86400000);
}

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

test("active work contains no completed timestamp day directories", () => {
  const activeWorkRoot = path.join(ROOT, "src", "work");
  const offenders = fs.readdirSync(activeWorkRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{6}_\d{2}-\d{2}-\d{2}$/.test(name));
  assert.deepEqual(offenders, []);
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
