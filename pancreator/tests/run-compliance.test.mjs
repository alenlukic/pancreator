import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";

import {
  discoverDescriptorFiles,
  parseArgs,
  resolveRunOutputDir,
  runCompliance,
  runDescriptorAssertion,
  validateDescriptorStructure,
} from "../lib/internal/tools/compliance/run-compliance.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Synthetic work dir for --run-id tests; must not collide with real task ids. */
const SYNTHETIC_TASK_ID = "run_compliance_test_fixture";
const SYNTHETIC_DAY = "99999_test_fixture";
const SYNTHETIC_WORK_DIR = path.join(ROOT, ".pan/work", SYNTHETIC_DAY, SYNTHETIC_TASK_ID);

function setupSyntheticWorkDir() {
  mkdirSync(SYNTHETIC_WORK_DIR, { recursive: true });
}

function teardownSyntheticWorkDir() {
  rmSync(SYNTHETIC_WORK_DIR, { recursive: true, force: true });
  const dayDir = path.join(ROOT, ".pan/work", SYNTHETIC_DAY);
  if (existsSync(dayDir)) {
    rmSync(dayDir, { recursive: true, force: true });
  }
}

test("validateDescriptorStructure rejects missing schema_ref", () => {
  const errors = validateDescriptorStructure({ id: "abc" }, "sample.yaml");
  assert.ok(errors.some((e) => e.includes("schema_ref")));
});

test("discoverDescriptorFiles finds eight canonical descriptors", () => {
  const files = discoverDescriptorFiles();
  assert.equal(files.length, 8);
});

test("runCompliance passes all bootstrap descriptors", async () => {
  const { exitCode, report } = await runCompliance();
  assert.equal(exitCode, 0);
  assert.equal(report.status, "pass");
  assert.equal(report.descriptorsRun, 8);
});

test("runDescriptorAssertion uses pluggable adapter registry", async () => {
  const result = await runDescriptorAssertion({
    id: "json-formatting",
    severity: "high",
  });
  assert.equal(result.pass, true);
});

test("parseArgs accepts --run-id", () => {
  const parsed = parseArgs(["node", "run-compliance.mjs", "--run-id", SYNTHETIC_TASK_ID]);
  assert.equal(parsed.runId, SYNTHETIC_TASK_ID);
});

test("resolveRunOutputDir locates active work directory", () => {
  setupSyntheticWorkDir();
  try {
    const dir = resolveRunOutputDir(SYNTHETIC_TASK_ID);
    assert.equal(dir, SYNTHETIC_WORK_DIR);
  } finally {
    teardownSyntheticWorkDir();
  }
});

test("--run-id emits compliance-result.json under lib/.pan/work", async () => {
  setupSyntheticWorkDir();
  try {
    const { exitCode, report } = await runCompliance(undefined, { runId: SYNTHETIC_TASK_ID });
    assert.equal(exitCode, 0);
    assert.equal(typeof report.resultFile, "string");
    const abs = path.join(ROOT, String(report.resultFile));
    const parsed = JSON.parse(readFileSync(abs, "utf8"));
    assert.equal(parsed.status, "pass");
    assert.match(String(report.resultFile), /compliance-result\.json$/);
  } finally {
    teardownSyntheticWorkDir();
  }
});

test("invalid descriptor filter throws", () => {
  assert.throws(() => discoverDescriptorFiles("missing-descriptor"), /Unknown compliance descriptor/);
});

test("validateDescriptorStructure accepts json-formatting descriptor", () => {
  const raw = readFileSync(path.join(ROOT, "tests/compliance/json-formatting.yaml"), "utf8");
  const descriptor = parseYaml(raw);
  assert.deepEqual(validateDescriptorStructure(descriptor, "json-formatting.yaml"), []);
});
