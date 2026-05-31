import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  projectRootAbs,
  readProjectRoot,
  readProjectRootFromYaml,
  resolveProjectPath,
  resolveRepoPath,
} from "../lib/internal/packages/@pancreator/core/dist/index.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

test("readProjectRootFromYaml defaults to dot", () => {
  assert.equal(readProjectRootFromYaml("risk_tier: medium\n"), ".");
});

test("readProjectRoot returns dot for daedaline harness", () => {
  assert.equal(readProjectRoot(REPO_ROOT), ".");
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
  assert.equal(resolveRepoPath(harness, "work/day/task/state.json"), path.join(harness, "work", "day", "task", "state.json"));
});
