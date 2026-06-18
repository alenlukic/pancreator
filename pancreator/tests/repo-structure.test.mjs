import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import yaml from "yaml";

import {
  isExcludedRelPath,
  isGitignoredRelPath,
  rewriteJsonText,
  resolveAbbrevLen,
} from "../lib/internal/tools/migrations/migrate-json-formatting.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PROJECT_ROOT = path.join(ROOT, "pancreator");
const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);
const IGNORED_WALK_DIRS = new Set([".git", "node_modules", "dist", ".turbo", ".next"]);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

/** @param {string} rel posix path from repo root */
function walkRepoFiles(rel, predicate = () => true) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  const entry = fs.statSync(abs);
  if (entry.isFile()) return predicate(rel) ? [rel] : [];
  if (!entry.isDirectory()) return [];
  const files = [];
  for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
    if (child.isDirectory() && IGNORED_WALK_DIRS.has(child.name)) continue;
    files.push(...walkRepoFiles(path.posix.join(rel, child.name), predicate));
  }
  return files;
}

function collectFiles(rel, predicate) {
  return walkRepoFiles(rel, predicate);
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

function isComplianceAuditWorkTask(taskAbs) {
  return (
    fs.existsSync(path.join(taskAbs, "compliance-audit.md")) &&
    fs.existsSync(path.join(taskAbs, "compliance-result.json"))
  );
}

function isOutOfBandWorkTask(taskAbs) {
  const manifestPath = path.join(taskAbs, OUT_OF_BAND_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return false;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return typeof manifest?.reason === "string" && manifest.reason.trim().length >= 12;
}

function isBatchLedgerWorkTask(taskAbs, taskId) {
  return taskId.startsWith("batch-") && fs.existsSync(path.join(taskAbs, "batch.json"));
}

function isExemptActiveWorkTaskWithoutState(taskAbs, taskId) {
  return (
    isOutOfBandWorkTask(taskAbs) ||
    isComplianceAuditWorkTask(taskAbs) ||
    isBatchLedgerWorkTask(taskAbs, taskId)
  );
}


test("repository JSON files use two-space formatting", () => {
  const abbrevLen = resolveAbbrevLen(PROJECT_ROOT);
  const jsonFiles = collectFiles(".", (rel) => rel.endsWith(".json"));
  assert.ok(jsonFiles.length > 0);

  const offenders = [];
  const posixRel = (rel) => rel.replace(/\\/g, "/");
  for (const rel of jsonFiles) {
    const normalized = posixRel(rel);
    const projectRelative = normalized.startsWith("pancreator/")
      ? normalized.slice("pancreator/".length)
      : normalized;
    if (isExcludedRelPath(projectRelative)) continue;
    if (isGitignoredRelPath(PROJECT_ROOT, projectRelative)) continue;
    const raw = read(rel);
    const { output } = rewriteJsonText(raw, abbrevLen);
    if (raw !== output) offenders.push(rel);
  }

  assert.deepEqual(offenders, []);
});

test("operator-facing root keeps implementation under internal while de-indexed dirs use dot prefix at root", () => {
  assert.ok(exists("pancreator/lib/internal/packages"));
  assert.ok(exists("pancreator/lib/internal/tools"));
  assert.ok(exists("pancreator/.pan/archive/work"));
  assert.ok(exists("pancreator/tests/compliance/schemas/latest.yaml"));
  assert.ok(exists("pancreator/.docs/PRD.md"));
  assert.ok(exists("pancreator/.docs/BOOTSTRAP.md"));
  assert.ok(exists("pancreator/.docs/M1.index.md"));
  assert.ok(exists("pancreator/.docs/README.md"));
  assert.ok(exists("pancreator/.pan/work/README.md"));
  assert.equal(exists("packages"), false);
  assert.equal(exists("pancreator/lib/internal/.tests"), false);
  assert.equal(exists("tools"), false);
  assert.equal(exists("PRD.md"), false);
  assert.equal(exists("BOOTSTRAP.md"), false);
  assert.equal(exists("M1.index.md"), false);
  assert.equal(exists("src"), false);
});


test("pancreator.yaml declares embedded project root and bundled defaults without bootstrap tracking", async () => {
  const config = read("pancreator/pancreator.yaml");
  assert.match(config, /^project_root:\s+"pancreator"$/m);

  const doc = yaml.parse(config);
  assert.equal(doc?.bootstrap, undefined);
  assert.equal(doc?.defaults?.medium?.risk_tier, "medium");
  assert.equal(doc?.defaults?.high?.gates?.security?.new_cves_max?.value, 0);
});

test("configuration docs route project_root through adopter and handbook", () => {
  assert.ok(exists("pancreator/lib/memory/handbook/pancreator-config.md"));
  assert.match(read("pancreator/lib/memory/handbook/pancreator-config.md"), /project_root/);
  assert.match(read("pancreator/lib/personas/adopter.md"), /project_root/);
  assert.match(read("pancreator/lib/personas/skills/adopt-existing-repo/SKILL.md"), /project_root/);
  assert.match(read("pancreator/lib/memory/handbook/index.md"), /pancreator-config\.md/);
});

test("archived work day-directory prefixes match days from UTC day to Jan 1 2500", () => {
  const archiveRoot = path.join(ROOT, "pancreator/.pan/archive", "work");
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
  const activeWorkRoot = path.join(ROOT, "pancreator/.pan/work");
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
  const activeWorkRoot = path.join(ROOT, "pancreator/.pan/work");
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
      const taskRel = path.posix.join("pancreator/.pan/work", dayEntry.name, taskEntry.name);
      const statePath = path.join(taskAbs, "state.json");
      if (!fs.existsSync(statePath) && !isExemptActiveWorkTaskWithoutState(taskAbs, taskEntry.name)) {
        offenders.push(taskRel);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    ".pan/work/<day>/<task-id>/ without state.json is orphan residue; archive via librarian, add out-of-band.manifest.json, or retain compliance-audit.md plus compliance-result.json from /compliance-auditor",
  );
});
test("planning/execution handoff contract is represented across active memory, pipeline, and personas", () => {
  assert.ok(exists("pancreator/lib/memory/active/handoffs.md"));

  const activeReadme = read("pancreator/lib/memory/active/README.md");
  assert.match(activeReadme, /lib\/memory\/active\/handoffs\.md/);
  assert.match(activeReadme, /\.pan\/work\/<day>\/<task-id>\/handoff\.md/);

  const contextEconomy = read("pancreator/lib/memory/handbook/context-economy.md");
  assert.match(contextEconomy, /Planning\/execution handoff discipline/);
  assert.match(contextEconomy, /lib\/memory\/active\/handoffs\.md/);

  const pipeline = read("pancreator/lib/pipelines/feature-delivery.yaml");
  assert.match(pipeline, /\.pan\/work\/<day>\/<task-id>\/handoff\.md/);

  const techLead = read("pancreator/lib/personas/tech-lead.md");
  const coder = read("pancreator/lib/personas/coder.md");
  const supervisor = read("pancreator/lib/personas/supervisor.md");
  const glossary = read("pancreator/lib/memory/handbook/glossary.md");
  assert.match(glossary, /Handoff card/);
  assert.match(techLead, /handoff\.md/);
  assert.match(coder, /handoff\.md/);
  assert.match(supervisor, /lib\/memory\/active\/handoffs\.md/);
});

test("workspace and scripts use conventional client and tests paths", () => {
  const workspace = read("pnpm-workspace.yaml");
  assert.doesNotMatch(workspace, /pancreator\/lib\/internal\/packages\/\*/);
  assert.match(workspace, /pancreator\/lib\/internal\/packages\/@pancreator\/\*/);
  assert.match(workspace, /"pancreator\/client"/);

  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts["check:workspace-contracts"], /^node pancreator\/lib\/internal\/tools\//);
  assert.match(pkg.scripts["context:budget"], /^node pancreator\/lib\/internal\/tools\//);
  assert.match(pkg.scripts["repo:structure:test"], /^node --test pancreator\/tests\//);
  assert.match(pkg.scripts.test, /turbo run test/);
  assert.match(pkg.scripts.test, /node --test pancreator\/tests\//);
  assert.match(pkg.scripts["test:run-logger-conformance"], /pancreator\/tests\/run-logger-conformance/);
});

test("Cursor indexing excludes dot-prefixed de-indexed run and docs paths", () => {
  const ignore = read(".cursorindexingignore");
  assert.match(ignore, /^pancreator\/\.pan\/work\/\*\*$/m);
  assert.match(ignore, /^pancreator\/\.pan\/archive\/work\/\*\*$/m);
  assert.match(ignore, /^pancreator\/\.docs\/\*\*$/m);
  assert.doesNotMatch(ignore, /^pancreator\/client\/\*\*$/m);
  assert.doesNotMatch(ignore, /^pancreator\/tests\/\*\*$/m);
});

test("librarian owns close-artifacts archival contract", () => {
  const librarian = read("pancreator/lib/personas/librarian.md");
  assert.match(librarian, /close-artifacts/);
  assert.match(librarian, /work-remains-active-until-close-artifacts/);
  assert.match(librarian, /MUST NOT manually move run artifacts from `\/\.pan\/work\/` to `\/\.pan\/archive\/work\/`/);
  assert.doesNotMatch(librarian, /archive_completed_work/);
});

test("active work tree has no feature-delivery runs awaiting close-artifacts", async () => {
  const { scanWorkArchiveHygiene } = await import("@pancreator/cli");
  const { issues } = await scanWorkArchiveHygiene(ROOT);
  const offenders = issues.map(
    (issue) => `${issue.code} ${issue.path}${issue.taskId ? ` (${issue.taskId})` : ""}`,
  );
  assert.deepEqual(
    offenders,
    [],
    ".pan/work/archive hygiene issues detected; run pnpm -w exec pan check and close-artifacts per remediation",
  );
});

test("live normative surfaces use three-level work placeholders", () => {
  const roots = [
    "AGENTS.md",
    "pancreator/lib/personas/rules",
    "pancreator/.docs",
    "pancreator/lib/internal/packages",
    "pancreator/lib/memory/handbook",
    "pancreator/lib/personas/skills",
    "pancreator/tests/compliance",
  ];
  const files = roots.flatMap((rel) => walkRepoFiles(rel));

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

test("AGENTS.md documents Build-mode inbox scaffolding contract", () => {
  const agents = read("AGENTS.md");
  assert.match(agents, /Build-mode inbox scaffolding/);
  assert.match(agents, /pan intake from-build-plan/);
});

test("local Cursor hooks do not enforce commit-time policy artifacts", () => {
  const hooksPath = path.join(ROOT, ".cursor/hooks.json");
  if (!fs.existsSync(hooksPath)) {
    return;
  }
  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  const beforeShell = hooks.hooks?.beforeShellExecution ?? [];
  assert.equal(beforeShell.length, 0);
});

test("Cursor implementation rules avoid broad lib-wide activation", () => {
  const coderRule = read("pancreator/lib/personas/rules/coder.yaml");
  assert.doesNotMatch(coderRule, /-\s+"?lib\/\*\*\/?\*"?/);
  assert.doesNotMatch(coderRule, /-\s+"?lib\/\*\*\/?\*\*"?/);
  assert.match(coderRule, /lib\/internal\/packages\/\*\*\/src\/\*\*\//);
  assert.match(coderRule, /tests\/\*\*\/\*\.mjs/);
});

test("pan deferral emits JSON envelopes without stub payloads", async () => {
  const cliRun = read("pancreator/lib/internal/packages/@pancreator/cli/src/run.ts");
  const panExecute = read("pancreator/lib/internal/packages/@pancreator/mcp-server/src/pan-execute.ts");
  assert.doesNotMatch(cliRun, /status:\s*"stub"/u);
  assert.doesNotMatch(panExecute, /status:\s*"stub"/u);

  const { parseAndRun, PAN_DEFERRED_EXIT_CODE } = await import("@pancreator/cli");
  const batchTracking =
    "lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md";
  const matrix = [
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
