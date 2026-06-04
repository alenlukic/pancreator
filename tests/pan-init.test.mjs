import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PAN_BIN = path.join(REPO_ROOT, "lib/internal/packages/@pancreator/cli/bin/pan.js");

async function seedEmbeddedHarness(root) {
  await writeFile(path.join(root, "AGENTS.md"), "# Host operator card\n", "utf8");
  const manifestSrc = path.join(REPO_ROOT, "lib/memory/handbook/embedded-install-manifest.yaml");
  await mkdir(path.join(root, "lib", "memory", "handbook"), { recursive: true });
  await writeFile(
    path.join(root, "lib", "memory", "handbook", "embedded-install-manifest.yaml"),
    await readFile(manifestSrc, "utf8"),
    "utf8",
  );
}

function runPan(args, cwd) {
  const result = spawnSync(process.execPath, [PAN_BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      PAN_JSON_FORMAT_ABBREV_LEN: process.env.PAN_JSON_FORMAT_ABBREV_LEN ?? "7",
    },
  });
  return result;
}

test("pan init embedded apply scaffolds under .pancreator and preserves host AGENTS.md", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "host-embed-"));
  const agentsPath = path.join(root, "AGENTS.md");
  await writeFile(agentsPath, "# Host operator card\n", "utf8");
  const manifestSrc = path.join(REPO_ROOT, "lib/memory/handbook/embedded-install-manifest.yaml");
  await mkdir(path.join(root, "lib", "memory", "handbook"), { recursive: true });
  await writeFile(
    path.join(root, "lib", "memory", "handbook", "embedded-install-manifest.yaml"),
    await readFile(manifestSrc, "utf8"),
    "utf8",
  );

  const result = runPan(["init", "--apply"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.match(result.stdout, /"mode"\s*:\s*"embedded"/);
  assert.equal(await readFile(agentsPath, "utf8"), "# Host operator card\n");
  assert.ok(existsSync(path.join(root, ".pancreator", "lib", "memory", "active", "current.md")));
  const harnessYaml = await readFile(path.join(root, ".pancreator", "pancreator.yaml"), "utf8");
  assert.match(harnessYaml, /project_root:\s*["']?\.pancreator["']?/);
  assert.match(harnessYaml, /invocation:\s*sdk/);
  assert.doesNotMatch(harnessYaml, /completed_phases/);
  assert.ok(existsSync(path.join(root, ".cursor/agents/intake-analyst.md")));
  assert.ok(existsSync(path.join(root, ".pancreator/lib/personas/intake-analyst.md")));
  assert.ok(existsSync(path.join(root, ".pancreator/lib/memory/handbook/context-economy.md")));
  assert.ok(payload.personaSeed?.source === "package");
  assert.ok(payload.handbookSeed?.source === "package");
  assert.ok(typeof payload.cursorSync === "object" && payload.cursorSync.count > 0);
});

test("pan init embedded dry-run records skipped cursor-sync before personas are seeded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "host-embed-dry-"));
  await seedEmbeddedHarness(root);
  const result = runPan(["init", "--dry-run"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.dryRun, true);
  assert.equal(payload.cursorSync, "skipped-no-personas");
});

test("pan init greenfield apply writes project_root dot at harness root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "greenfield-init-"));
  const result = runPan(["init", "--apply"], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"mode"\s*:\s*"greenfield"/);
  const harnessYaml = await readFile(path.join(root, "pancreator.yaml"), "utf8");
  assert.match(harnessYaml, /project_root:\s*["']?\./);
});
