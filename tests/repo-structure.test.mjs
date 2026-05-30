import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import yaml from "yaml";

import { validateBootstrapTracking } from "../lib/internal/packages/@pancreator/policy/dist/index.js";
import {
  isExcludedRelPath,
  rewriteJsonText,
  resolveAbbrevLen,
} from "../lib/internal/tools/migrate-json-formatting.mjs";

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

const OUT_OF_BAND_MANIFEST = "out-of-band.manifest.json";

function isOutOfBandWorkTask(taskAbs) {
  const manifestPath = path.join(taskAbs, OUT_OF_BAND_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return false;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return typeof manifest?.reason === "string" && manifest.reason.trim().length >= 12;
}


test("repository JSON files use two-space formatting", () => {
  const abbrevLen = resolveAbbrevLen(ROOT);
  const jsonFiles = collectFiles(".", (rel) => rel.endsWith(".json"));
  assert.ok(jsonFiles.length > 0);

  const offenders = [];
  const posixRel = (rel) => rel.replace(/\\/g, "/");
  for (const rel of jsonFiles) {
    if (isExcludedRelPath(posixRel(rel))) continue;
    const raw = read(rel);
    const { output } = rewriteJsonText(raw, abbrevLen);
    if (raw !== output) offenders.push(rel);
  }

  assert.deepEqual(offenders, []);
});

test("operator-facing root keeps implementation under internal while tests and docs stay at root", () => {
  assert.ok(exists("lib/internal/packages"));
  assert.ok(exists("lib/internal/tools"));
  assert.ok(exists("archive/work"));
  assert.ok(exists("tests/compliance/schemas/latest.yaml"));
  assert.ok(exists("docs/PRD.md"));
  assert.ok(exists("docs/BOOTSTRAP.md"));
  assert.ok(exists("docs/M1.index.md"));
  assert.ok(exists("work/README.md"));
  assert.equal(exists("packages"), false);
  assert.equal(exists("lib/internal/tests"), false);
  assert.equal(exists("tools"), false);
  assert.equal(exists("PRD.md"), false);
  assert.equal(exists("BOOTSTRAP.md"), false);
  assert.equal(exists("M1.index.md"), false);
  assert.equal(exists("src"), false);
});


test("pancreator.yaml tracks live bootstrap state and embedded project root", async () => {
  const config = read("pancreator.yaml");
  assert.match(config, /^project_root:\s+"\."$/m);

  const doc = yaml.parse(config);
  const bootstrap = doc?.bootstrap;
  const validation = validateBootstrapTracking({
    phase: bootstrap?.phase,
    status: bootstrap?.status,
    completedPhases: bootstrap?.completed_phases ?? bootstrap?.completedPhases,
  });
  assert.equal(
    validation.ok,
    true,
    validation.violations.join("\n"),
  );

  const defaults = read("pancreator-defaults.yaml");
  assert.doesNotMatch(defaults, /^bootstrap:\s*$/m);
  assert.match(defaults, /introduced during Bootstrap Phase 2/);
});

test("configuration docs route project_root through adopter and handbook", () => {
  assert.ok(exists("lib/memory/handbook/pancreator-config.md"));
  assert.match(read("lib/memory/handbook/pancreator-config.md"), /project_root/);
  assert.match(read("lib/personas/adopter.md"), /project_root/);
  assert.match(read("lib/personas/skills/adopt-existing-repo/SKILL.md"), /project_root/);
  assert.match(read("lib/memory/handbook/index.md"), /pancreator-config\.md/);
});

test("archived work day-directory prefixes match days from UTC day to Jan 1 2500", () => {
  const archiveRoot = path.join(ROOT, "archive", "work");
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
  const activeWorkRoot = path.join(ROOT, "work");
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

test("active work task directories without feature-delivery state are absent", () => {
  const allowlist = new Set(["99999_test_fixture"]);
  const activeWorkRoot = path.join(ROOT, "work");
  const offenders = [];
  for (const dayEntry of fs.readdirSync(activeWorkRoot, { withFileTypes: true })) {
    if (!dayEntry.isDirectory() || !/^\d{6}_\d{2}-\d{2}-\d{2}$/.test(dayEntry.name)) {
      continue;
    }
    const dayAbs = path.join(activeWorkRoot, dayEntry.name);
    for (const taskEntry of fs.readdirSync(dayAbs, { withFileTypes: true })) {
      if (!taskEntry.isDirectory()) {
        continue;
      }
      if (allowlist.has(taskEntry.name)) {
        continue;
      }
      const taskAbs = path.join(dayAbs, taskEntry.name);
      const taskRel = path.posix.join("work", dayEntry.name, taskEntry.name);
      const statePath = path.join(taskAbs, "state.json");
      if (!fs.existsSync(statePath) && !isOutOfBandWorkTask(taskAbs)) {
        offenders.push(taskRel);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "work/<day>/<task-id>/ without state.json is orphan residue; archive via librarian, add out-of-band.manifest.json for active manual work, or write manifests under archive/work",
  );
});
test("planning/execution handoff contract is represented across active memory, pipeline, and personas", () => {
  assert.ok(exists("lib/memory/active/handoffs.md"));

  const activeReadme = read("lib/memory/active/README.md");
  assert.match(activeReadme, /lib\/memory\/active\/handoffs\.md/);
  assert.match(activeReadme, /work\/<day>\/<task-id>\/handoff\.md/);

  const contextEconomy = read("lib/memory/handbook/context-economy.md");
  assert.match(contextEconomy, /Planning\/execution handoff discipline/);
  assert.match(contextEconomy, /lib\/memory\/active\/handoffs\.md/);

  const pipeline = read("lib/pipelines/feature-delivery.yaml");
  assert.match(pipeline, /work\/<day>\/<task-id>\/handoff\.md/);

  const techLead = read("lib/personas/tech-lead.md");
  const coder = read("lib/personas/coder.md");
  const supervisor = read("lib/personas/supervisor.md");
  const glossary = read("lib/memory/handbook/glossary.md");
  assert.match(glossary, /Handoff card/);
  assert.match(techLead, /handoff\.md/);
  assert.match(coder, /handoff\.md/);
  assert.match(supervisor, /lib\/memory\/active\/handoffs\.md/);
});

test("workspace and scripts use conventional test and docs paths", () => {
  const workspace = read("pnpm-workspace.yaml");
  assert.match(workspace, /lib\/internal\/packages\/\*/);
  assert.match(workspace, /lib\/internal\/packages\/@pancreator\/\*/);

  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts["check:phase0a"], /^node lib\/internal\/tools\//);
  assert.match(pkg.scripts["context:budget"], /^node lib\/internal\/tools\//);
  assert.match(pkg.scripts["repo:structure:test"], /^node --test tests\//);
  assert.match(pkg.scripts.test, /turbo run test/);
  assert.match(pkg.scripts.test, /node --test tests\//);
  assert.match(pkg.scripts["test:run-logger-conformance"], /tests\/run-logger-conformance/);
});

test("Cursor indexing excludes active and archived work by default", () => {
  const ignore = read(".cursorindexingignore");
  assert.match(ignore, /^work\/\*\*$/m);
  assert.match(ignore, /^archive\/work\/\*\*$/m);
});

test("librarian owns completed work archival maintenance", () => {
  const librarian = read("lib/personas/librarian.md");
  assert.match(librarian, /archive\/work\//);
  assert.match(librarian, /archive_completed_work/);
});

test("live normative surfaces use three-level work placeholders", () => {
  const roots = [
    "AGENTS.md",
    ".cursor/hooks/enforce-policy-compliance.sh",
    ".cursor/rules",
    "docs",
    "lib/internal/packages",
    "lib/memory/handbook",
    "lib/personas/skills",
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
  assert.match(hook, /\^work\/\[\^\/\]\+\/\[\^\/\]\+\/policy-compliance\\\.json\$/);
  assert.doesNotMatch(hook, /\^work\/\[\^\/\]\+\/policy-compliance\\\.json\$/);
  assert.match(hook, /work\/<day>\/<task-id>\/policy-compliance\.json/);
});

test("Cursor implementation rules avoid broad lib-wide activation", () => {
  const coderRule = read(".cursor/rules/coder.mdc");
  assert.doesNotMatch(coderRule, /"lib\/\*\*\/\*"|"lib\/\*\*\/\*\*"|"lib\/\*\*\/*"/);
  assert.doesNotMatch(coderRule, /-\s+"lib\/\*\*\/*"/);
  assert.match(coderRule, /lib\/internal\/packages\/\*\*\/src\/\*\*\/\*/);
  assert.match(coderRule, /tests\/\*\*\/\.mjs|tests\/\*\*\/\*\.mjs/);
});

test("pan deferral emits JSON envelopes without stub payloads", async () => {
  const cliRun = read("lib/internal/packages/@pancreator/cli/src/run.ts");
  const panExecute = read("lib/internal/packages/@pancreator/mcp-server/src/pan-execute.ts");
  assert.doesNotMatch(cliRun, /status:\s*"stub"/u);
  assert.doesNotMatch(panExecute, /status:\s*"stub"/u);

  const { parseAndRun, PAN_DEFERRED_EXIT_CODE } = await import("@pancreator/cli");
  const batchTracking =
    "lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md";
  const matrix = [
    { argv: ["approve"], tracking: batchTracking },
    { argv: ["memory"], tracking: batchTracking },
    { argv: ["contracts"], tracking: batchTracking },
    { argv: ["lint"], tracking: batchTracking },
    { argv: ["run", "not-a-pipeline"], tracking: batchTracking },
    { argv: ["status"], tracking: batchTracking },
  ];
  for (const { argv, tracking } of matrix) {
    const chunks = [];
    const code = await parseAndRun(argv, {
      repoRoot: ROOT,
      writeOut: (chunk) => chunks.push(chunk),
    });
    assert.equal(code, PAN_DEFERRED_EXIT_CODE);
    const emitted = chunks.join("");
    assert.ok(!emitted.includes('"stub"'));
    assert.match(emitted, /"status":\s*"deferred"/);
    const env = JSON.parse(emitted);
    assert.equal(env.status, "deferred");
    assert.match(env.milestone, /^M[123]$/);
    assert.equal(env.tracking_intake, tracking);
  }
});
