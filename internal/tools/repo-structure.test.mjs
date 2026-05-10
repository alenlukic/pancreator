import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
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

test("operator-facing root keeps implementation directories under internal", () => {
  assert.ok(exists("internal/packages"));
  assert.ok(exists("internal/tests"));
  assert.ok(exists("internal/tools"));
  assert.ok(exists("internal/work_archive"));
  assert.ok(exists("work/README.md"));
  assert.equal(exists("packages"), false);
  assert.equal(exists("tests"), false);
  assert.equal(exists("tools"), false);
});

test("archived work day-directory prefixes match days from UTC day to Jan 1 2500", () => {
  const archiveRoot = path.join(ROOT, "internal", "work_archive");
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
  const activeWorkRoot = path.join(ROOT, "work");
  const offenders = fs.readdirSync(activeWorkRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d{6}_\d{2}-\d{2}-\d{2}$/.test(name));
  assert.deepEqual(offenders, []);
});

test("workspace, scripts, and workflow use internal implementation paths", () => {
  const workspace = read("pnpm-workspace.yaml");
  assert.match(workspace, /internal\/packages\/\*/);
  assert.match(workspace, /internal\/packages\/@tesseract\/\*/);

  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts["check:phase0a"], /^node internal\/tools\//);
  assert.match(pkg.scripts["context:budget"], /^node internal\/tools\//);
  assert.match(pkg.scripts["repo:structure:test"], /^node --test internal\/tools\//);

  const workflow = read(".github/workflows/phase-0a-scaffold.yml");
  assert.match(workflow, /internal\/packages\/\*\*/);
  assert.match(workflow, /internal\/tools\/\*\*/);
  assert.match(workflow, /internal\/tests\/\*\*/);
  assert.match(workflow, /pnpm run migration:test/);
  assert.match(workflow, /pnpm run context:budget:test/);
  assert.match(workflow, /pnpm run repo:structure:test/);
});

test("Cursor indexing excludes active and archived work by default", () => {
  const ignore = read(".cursorindexingignore");
  assert.match(ignore, /^work\/\*\*$/m);
  assert.match(ignore, /^internal\/work_archive\/\*\*$/m);
});

test("librarian owns completed work archival maintenance", () => {
  const librarian = read("personas/librarian.md");
  assert.match(librarian, /internal\/work_archive\//);
  assert.match(librarian, /archive_completed_work/);
});
