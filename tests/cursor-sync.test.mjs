import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { frontmatterHasKey, splitAgentProjection } from "./cursor-agents-retrieval-contract.test.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PAN_BIN = path.join(REPO_ROOT, "lib/internal/packages/@pancreator/cli/bin/pan.js");

function runPan(args, cwd) {
  return spawnSync(process.execPath, [PAN_BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PAN_JSON_FORMAT_ABBREV_LEN: process.env.PAN_JSON_FORMAT_ABBREV_LEN ?? "7",
    },
  });
}

function parseJsonStdout(stdout) {
  return JSON.parse(stdout.trim());
}

test("pan cursor-sync applies active escalation default models before agent projection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-sync-escalation-"));
  await writeFile(path.join(root, "pancreator.yaml"), 'project_root: "."\n', "utf8");
  const escalationYaml = await readFile(
    path.join(REPO_ROOT, "pancreator-model-escalation.yaml"),
    "utf8",
  );
  await writeFile(
    path.join(root, "pancreator-model-escalation.yaml"),
    escalationYaml.replace(/^active_config:\s*auto/mu, "active_config: default"),
    "utf8",
  );
  const personaSrc = path.join(REPO_ROOT, "lib/personas/intake-analyst.md");
  await mkdir(path.join(root, "lib/personas"), { recursive: true });
  await cp(personaSrc, path.join(root, "lib/personas/intake-analyst.md"));
  const beforePersona = await readFile(path.join(root, "lib/personas/intake-analyst.md"), "utf8");

  const result = runPan(["cursor-sync"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJsonStdout(result.stdout);
  assert.equal(payload.activeEscalationConfig, "default");
  assert.ok(payload.personaModelsSynced >= 1);
  assert.ok(
    payload.written.some((entry) => entry.path === "lib/personas/intake-analyst.md"),
  );

  const afterPersona = await readFile(path.join(root, "lib/personas/intake-analyst.md"), "utf8");
  assert.notEqual(afterPersona, beforePersona);
  assert.match(afterPersona, /model:\s*gpt-5\.4\[context=272k,reasoning=high,fast=false\]/u);
  const projection = await readFile(path.join(root, ".cursor/agents/intake-analyst.md"), "utf8");
  assert.match(projection, /^model:\s*gpt-5\.4\[context=272k,reasoning=high,fast=false\]/m);
});

test("pan cursor-sync --dry-run emits envelope without writing files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-sync-dry-"));
  await writeFile(path.join(root, "pancreator.yaml"), 'project_root: "."\n', "utf8");
  await cp(
    path.join(REPO_ROOT, "pancreator-model-escalation.yaml"),
    path.join(root, "pancreator-model-escalation.yaml"),
  );
  await cp(path.join(REPO_ROOT, "lib/personas"), path.join(root, "lib/personas"), { recursive: true });
  await mkdir(path.join(root, ".cursor/agents"), { recursive: true });
  await writeFile(path.join(root, ".cursor/agents/.gitkeep"), "", "utf8");

  const beforeAgents = await readdir(path.join(root, ".cursor/agents"));
  const result = runPan(["cursor-sync", "--dry-run"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJsonStdout(result.stdout);
  assert.equal(payload.command, "cursor-sync");
  assert.equal(payload.dryRun, true);
  assert.equal(payload.status, "ok");
  assert.ok(Array.isArray(payload.written));
  assert.ok(payload.written.length > 0);
  assert.ok(payload.written.some((entry) => entry.path === ".cursor/agents/intake-analyst.md"));
  const afterAgents = await readdir(path.join(root, ".cursor/agents"));
  assert.deepEqual(afterAgents.sort(), beforeAgents.sort());
});

test("pan cursor-sync writes projections for project_root dot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-sync-dot-"));
  await writeFile(path.join(root, "pancreator.yaml"), 'project_root: "."\n', "utf8");
  await cp(path.join(REPO_ROOT, "lib/personas"), path.join(root, "lib/personas"), { recursive: true });

  const result = runPan(["cursor-sync"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJsonStdout(result.stdout);
  assert.equal(payload.projectRootRel, ".");
  assert.ok(existsSync(path.join(root, ".cursor/agents/intake-analyst.md")));
  assert.ok(existsSync(path.join(root, ".cursor/agents/general-purpose.md")));
  const projection = await readFile(path.join(root, ".cursor/agents/intake-analyst.md"), "utf8");
  assert.match(projection, /lib\/personas\/intake-analyst\.md/);
  const { frontmatter, body } = splitAgentProjection(projection);
  assert.equal(frontmatterHasKey(frontmatter, "tools"), false);
  assert.equal(frontmatterHasKey(frontmatter, "disallowedTools"), false);
  assert.equal(frontmatterHasKey(frontmatter, "metadata"), false);
  assert.match(body, /next-prompt\.md/u);
  assert.match(body, /handoff\.md/u);

  const generalPurpose = await readFile(path.join(root, ".cursor/agents/general-purpose.md"), "utf8");
  const gpParsed = splitAgentProjection(generalPurpose);
  assert.equal(frontmatterHasKey(gpParsed.frontmatter, "tools"), true);
  assert.equal(frontmatterHasKey(gpParsed.frontmatter, "metadata"), true);
  assert.match(gpParsed.body, /next-prompt\.md/u);
});

test("pan cursor-sync writes projections for project_root .pancreator", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-sync-embed-"));
  await writeFile(
    path.join(root, "pancreator.yaml"),
    'project_root: ".pancreator"\nrisk_tier: medium\n',
    "utf8",
  );
  await mkdir(path.join(root, ".pancreator", "lib", "personas"), { recursive: true });
  await cp(
    path.join(REPO_ROOT, "lib/personas/intake-analyst.md"),
    path.join(root, ".pancreator/lib/personas/intake-analyst.md"),
  );

  const result = runPan(["cursor-sync"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJsonStdout(result.stdout);
  assert.equal(payload.projectRootRel, ".pancreator");
  const projection = await readFile(path.join(root, ".cursor/agents/intake-analyst.md"), "utf8");
  assert.match(projection, /\.pancreator\/lib\/personas\/intake-analyst\.md/);
});

test("pan cursor-sync exits 1 when no persona specs exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-sync-empty-"));
  await writeFile(path.join(root, "pancreator.yaml"), 'project_root: "."\n', "utf8");
  await mkdir(path.join(root, "lib/personas"), { recursive: true });

  const result = runPan(["cursor-sync"], root);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /No persona specs found under/);
});

test("pan cursor-sync exits 1 when manifest disallows .cursor/agents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-sync-deny-"));
  await writeFile(path.join(root, "pancreator.yaml"), 'project_root: "."\n', "utf8");
  await mkdir(path.join(root, "lib/memory/handbook"), { recursive: true });
  await writeFile(
    path.join(root, "lib/memory/handbook/embedded-install-manifest.yaml"),
    "allow: []\nharness_root_allow: []\ndeny_prefixes: []\n",
    "utf8",
  );
  await cp(path.join(REPO_ROOT, "lib/personas"), path.join(root, "lib/personas"), { recursive: true });

  const result = runPan(["cursor-sync"], root);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /\.cursor\/agents/);
});

test("sync-cursor-agents.mjs bridge delegates to pan cursor-sync", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-sync-bridge-"));
  await writeFile(path.join(root, "pancreator.yaml"), 'project_root: "."\n', "utf8");
  await cp(path.join(REPO_ROOT, "lib/personas"), path.join(root, "lib/personas"), { recursive: true });

  const bridgeScript = path.join(REPO_ROOT, "lib/internal/tools/sync-cursor-agents.mjs");
  const result = spawnSync(process.execPath, [bridgeScript], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PAN_JSON_FORMAT_ABBREV_LEN: process.env.PAN_JSON_FORMAT_ABBREV_LEN ?? "7",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseJsonStdout(result.stdout);
  assert.equal(payload.command, "cursor-sync");
  assert.ok(existsSync(path.join(root, ".cursor/agents/intake-analyst.md")));
});
