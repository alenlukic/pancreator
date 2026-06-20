import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  projectRootAbs,
  readProjectRoot,
  readProjectRootFromYaml,
  resolveDeliveryOperatingCardRel,
  resolveDeliveryOperationProceduresRel,
  resolveProjectPath,
  resolveRepoPath,
} from "../lib/internal/packages/@pancreator/core/dist/index.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

test("readProjectRootFromYaml defaults to dot", () => {
  assert.equal(readProjectRootFromYaml("risk_tier: medium\n"), ".");
});

test("readProjectRoot returns pancreator for daedaline harness", () => {
  assert.equal(readProjectRoot(REPO_ROOT), "pancreator");
});

test("projectRootAbs resolves embedded project_root", async () => {
  const harness = await mkdtemp(path.join(os.tmpdir(), "harness-embedded-"));
  await writeFile(
    path.join(harness, "pancreator.yaml"),
    'project_root: ".pancreator"\nrisk_tier: medium\n',
    "utf8",
  );
  assert.equal(readProjectRoot(harness), ".pancreator");
  assert.equal(projectRootAbs(harness), path.join(harness, ".pancreator"));
  assert.equal(
    resolveProjectPath(harness, "lib", "inbox", "in"),
    path.join(harness, ".pancreator", "lib", "inbox", "in"),
  );
});

test("resolveRepoPath keeps harness-root pancreator.yaml", async () => {
  const harness = await mkdtemp(path.join(os.tmpdir(), "harness-yaml-"));
  await writeFile(path.join(harness, "pancreator.yaml"), "project_root: .\n", "utf8");
  assert.equal(resolveRepoPath(harness, "pancreator.yaml"), path.join(harness, "pancreator.yaml"));
  assert.equal(resolveRepoPath(harness, ".pan/work/day/task/state.json"), path.join(harness, ".pan/work", "day", "task", "state.json"));
});

test("resolveRepoPath keeps .cursor and delivery cards at harness root on self-host", () => {
  assert.equal(
    resolveRepoPath(REPO_ROOT, ".cursor/agents/coder.md"),
    path.join(REPO_ROOT, ".cursor", "agents", "coder.md"),
  );
  assert.equal(resolveRepoPath(REPO_ROOT, "AGENTS.md"), path.join(REPO_ROOT, "AGENTS.md"));
  assert.equal(resolveRepoPath(REPO_ROOT, "OPERATION.md"), path.join(REPO_ROOT, "OPERATION.md"));
});

test("resolveRepoPath nests delivery cards under embedded project_root", async () => {
  const harness = await mkdtemp(path.join(os.tmpdir(), "harness-embedded-cards-"));
  await writeFile(
    path.join(harness, "pancreator.yaml"),
    'project_root: ".pancreator"\nrisk_tier: medium\n',
    "utf8",
  );
  assert.equal(
    resolveRepoPath(harness, "AGENTS.md"),
    path.join(harness, ".pancreator", "AGENTS.md"),
  );
  assert.equal(
    resolveRepoPath(harness, "OPERATION.md"),
    path.join(harness, ".pancreator", "OPERATION.md"),
  );
  assert.equal(
    resolveRepoPath(harness, ".cursor/hooks.json"),
    path.join(harness, ".cursor", "hooks.json"),
  );
});

test("resolveProjectPath nests .pan under project_root pancreator", () => {
  assert.equal(
    resolveProjectPath(REPO_ROOT, ".pan", "work"),
    path.join(REPO_ROOT, "pancreator", ".pan", "work"),
  );
});

test("resolveDeliveryOperatingCardRel returns AGENTS.md on self-host", () => {
  assert.equal(resolveDeliveryOperatingCardRel(REPO_ROOT), "AGENTS.md");
});

test("resolveDeliveryOperatingCardRel uses embedded AGENTS under .pancreator", async () => {
  const harness = await mkdtemp(path.join(os.tmpdir(), "delivery-card-embedded-"));
  await mkdir(path.join(harness, ".pancreator"), { recursive: true });
  await writeFile(
    path.join(harness, ".pancreator", "pancreator.yaml"),
    'project_root: ".pancreator"\nrisk_tier: medium\n',
    "utf8",
  );
  assert.equal(resolveDeliveryOperatingCardRel(harness), ".pancreator/AGENTS.md");
  assert.equal(resolveDeliveryOperationProceduresRel(harness), ".pancreator/OPERATION.md");
});

test("pan intake new writes under project_root for embedded harness", async () => {
  const harness = await mkdtemp(path.join(os.tmpdir(), "intake-embedded-"));
  await writeFile(
    path.join(harness, "pancreator.yaml"),
    'project_root: ".pancreator"\nrisk_tier: medium\n',
    "utf8",
  );
  await mkdir(path.join(harness, ".pancreator/lib/inbox/in"), { recursive: true });

  const panBin = path.join(
    REPO_ROOT,
    "pancreator/lib/internal/packages/@pancreator/cli/bin/pan.js",
  );
  const result = spawnSync(process.execPath, [panBin, "intake", "new", "embedded-slug"], {
    cwd: harness,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PAN_JSON_FORMAT_ABBREV_LEN: process.env.PAN_JSON_FORMAT_ABBREV_LEN ?? "7",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.match(payload.path, /_embedded-slug\.md$/);
  assert.ok(
    existsSync(path.join(harness, ".pancreator", payload.path)),
    `expected file at .pancreator/${payload.path}`,
  );
});
