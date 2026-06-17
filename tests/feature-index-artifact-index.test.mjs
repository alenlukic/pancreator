import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

/** @param {string} rel */
function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

/** @param {string} rel */
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

/** @param {unknown} value */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function artifactPath(value) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (isObject(value) && typeof value.path === "string" && value.path.length > 0) {
    return value.path;
  }
  return null;
}

/** @param {Record<string, unknown>} artifactIndex @param {string} key */
function pathFromIndex(artifactIndex, key) {
  return artifactPath(artifactIndex[key]);
}

const ARTIFACT_INDEX_KEYS = [
  "run_dir",
  "spec",
  "acceptance_criteria_product",
  "acceptance_criteria_design",
  "acceptance_criteria_tech",
  "touch_set",
  "manual_qa_test_cases",
  "implementation_report",
  "review",
  "test_report",
  "design_qa_report",
  "delivery_report",
  "compliance_result",
  "ship_ratification",
  "operator_verification",
  "pipeline_close",
  "run_log",
  "state",
  "compliance_audit_history",
  "qa_logs_dir",
];

/** @param {Record<string, unknown>} artifactIndex @param {string} label */
function assertFlatArtifactIndex(artifactIndex, label) {
  for (const key of ARTIFACT_INDEX_KEYS) {
    assert.ok(pathFromIndex(artifactIndex, key), `${label} missing artifact_index.${key}`);
  }
  for (const [key, value] of Object.entries(artifactIndex)) {
    assert.ok(
      artifactPath(value) !== null,
      `${label} artifact_index.${key} MUST be a repo-relative path string`,
    );
  }
}

/** @param {string} rel @param {string} label */
function assertPathsExist(rel, label) {
  const abs = path.join(ROOT, rel);
  assert.ok(fs.existsSync(abs), `${label} path MUST exist: ${rel}`);
}

test("command-center-post-ship-remediation index links all evidence and audit artifacts", () => {
  const rel =
    "lib/memory/features/command-center/command-center-post-ship-remediation/index.json";
  const index = readJson(rel);
  assert.equal(index.feature_id, "command-center-post-ship-remediation");
  assert.ok(isObject(index.artifact_index), "indexed feature MUST declare artifact_index");

  const artifactIndex = /** @type {Record<string, unknown>} */ (index.artifact_index);
  assertFlatArtifactIndex(artifactIndex, rel);

  for (const key of ARTIFACT_INDEX_KEYS) {
    const artifactRel = pathFromIndex(artifactIndex, key);
    assert.ok(artifactRel);
    assertPathsExist(artifactRel, rel);
  }

  const auditId = index.validation
    ?.flatMap((entry) => Object.values(entry))
    .find((value) => isObject(value) && typeof value.audit_id === "string")?.audit_id;
  assert.ok(auditId, "validation MUST record compliance audit_id");
  const auditHistory = readJson(
    "lib/memory/features/quality-governance/compliance-tests/audit-history.json",
  );
  const entry = auditHistory.entries?.find((row) => row.audit_id === auditId);
  assert.ok(entry, "validation audit_id MUST resolve in compliance audit history");
});

test("feature indexes with artifact_index conform to the flat evidence pointer contract", () => {
  const featuresRoot = path.join(ROOT, "lib", "memory", "features");
  for (const category of fs.readdirSync(featuresRoot, { withFileTypes: true })) {
    if (!category.isDirectory() || category.name.startsWith(".")) continue;
    const categoryRoot = path.join(featuresRoot, category.name);
    for (const feature of fs.readdirSync(categoryRoot, { withFileTypes: true })) {
      if (!feature.isDirectory() || feature.name.startsWith(".")) continue;
      const indexRel = path.posix.join(
        "lib",
        "memory",
        "features",
        category.name,
        feature.name,
        "index.json",
      );
      if (!exists(indexRel)) continue;
      const index = readJson(indexRel);
      if (!isObject(index.artifact_index)) continue;
      assertFlatArtifactIndex(
        /** @type {Record<string, unknown>} */ (index.artifact_index),
        indexRel,
      );
    }
  }
});
