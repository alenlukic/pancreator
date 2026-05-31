import assert from "node:assert/strict";
import test from "node:test";

import {
  VERDICTS,
  computeVerdict,
  evaluateChecklistRules,
  evaluateGreenfieldEvidence,
  evaluateGreenfieldEvidenceFile,
  loadEmbeddedEvidenceExample,
  loadEvidenceFile,
  matchDenyListedPath,
  parseArgs,
  validateDenyListedEvidencePaths,
  validateEvidenceStructure,
} from "../lib/internal/tools/evaluate-greenfield-evidence.mjs";

const FIXTURE_PATH =
  "lib/memory/features/bootstrap-phase-5-m1-exit-close-docs-bootstrap/greenfield-evidence.fixture.json";

const PASSING_ARTIFACT = {
  schema_version: "1",
  artifact_kind: "greenfield-us9-evidence",
  metadata: {
    feature_id: "sample-feature",
    task_id: "12345_0000_sample",
    target_repo: { path: "/tmp/sample-repo" },
    pipeline_id: "init-greenfield",
    captured_at_iso: "2026-05-30T12:00:00.000Z",
    project_root: ".",
  },
  provenance: {
    cli_commands: ["pnpm -w exec pan create-pancreator sample"],
    pipeline_stages_completed: ["scaffold", "spec", "plan"],
  },
  checklist: {
    agents_md_present: true,
    handbook_seeds_present: true,
    persona_roster_present: true,
    feature_spec_authored: true,
    plan_touch_set_authored: true,
    no_overwritten_existing_files: true,
  },
  verdict_preconditions: {
    minimum_stages_completed: 3,
    required_checklist_pass_count: 6,
  },
};

test("parseArgs reads --input flag", () => {
  const parsed = parseArgs(["node", "evaluate-greenfield-evidence.mjs", "--input", FIXTURE_PATH]);
  assert.equal(parsed.inputPath, FIXTURE_PATH);
  assert.equal(parsed.help, false);
});

test("parseArgs sets help for -h", () => {
  const parsed = parseArgs(["node", "evaluate-greenfield-evidence.mjs", "-h"]);
  assert.equal(parsed.help, true);
});

test("loadEvidenceFile loads fixture artifact", () => {
  const artifact = loadEvidenceFile(FIXTURE_PATH);
  assert.equal(artifact.artifact_kind, "greenfield-us9-evidence");
});

test("validateEvidenceStructure rejects non-object input", () => {
  const errors = validateEvidenceStructure(null);
  assert.ok(errors.some((e) => e.includes("JSON object")));
});

test("validateEvidenceStructure accepts passing artifact", () => {
  const errors = validateEvidenceStructure(PASSING_ARTIFACT);
  assert.deepEqual(errors, []);
});

test("evaluateChecklistRules records gaps for incomplete checklist", () => {
  const artifact = JSON.parse(JSON.stringify(PASSING_ARTIFACT));
  artifact.checklist.plan_touch_set_authored = false;
  const result = evaluateChecklistRules(artifact);
  assert.ok(result.gaps.includes("plan_touch_set_authored"));
});

test("computeVerdict maps structure errors to fail", () => {
  const verdict = computeVerdict({
    structureErrors: ["missing field"],
    checklist: { passed: [], failed: [], gaps: [] },
  });
  assert.equal(verdict, VERDICTS.FAIL);
});

test("computeVerdict maps checklist gaps to fail-with-gaps", () => {
  const verdict = computeVerdict({
    structureErrors: [],
    checklist: { passed: ["agents_md_present"], failed: [], gaps: ["plan_touch_set_authored"] },
  });
  assert.equal(verdict, VERDICTS.FAIL_WITH_GAPS);
});

test("computeVerdict maps clean input to pass", () => {
  const verdict = computeVerdict({
    structureErrors: [],
    checklist: { passed: ["agents_md_present"], failed: [], gaps: [] },
  });
  assert.equal(verdict, VERDICTS.PASS);
});

test("evaluateGreenfieldEvidence returns pass for fixture artifact", () => {
  const artifact = loadEvidenceFile(FIXTURE_PATH);
  const result = evaluateGreenfieldEvidence(artifact);
  assert.equal(result.verdict, VERDICTS.PASS);
  assert.deepEqual(result.structureErrors, []);
});

test("evaluateGreenfieldEvidenceFile includes input path", () => {
  const result = evaluateGreenfieldEvidenceFile(FIXTURE_PATH);
  assert.equal(result.inputPath, FIXTURE_PATH);
  assert.equal(result.verdict, VERDICTS.PASS);
});

test("validateEvidenceStructure requires metadata.project_root", () => {
  const artifact = JSON.parse(JSON.stringify(PASSING_ARTIFACT));
  delete artifact.metadata.project_root;
  const errors = validateEvidenceStructure(artifact);
  assert.ok(errors.some((e) => e.includes("project_root")));
});

test("validateDenyListedEvidencePaths rejects archive paths", () => {
  const artifact = JSON.parse(JSON.stringify(PASSING_ARTIFACT));
  artifact.provenance.cli_commands = ["rsync archive/inbox/in/"];
  const errors = validateDenyListedEvidencePaths(artifact);
  assert.ok(errors.length > 0);
});

test("matchDenyListedPath flags lib/internal", () => {
  assert.equal(matchDenyListedPath("lib/internal/foo"), "lib/internal/");
});

test("embedded fixture example passes evaluator", () => {
  const artifact = loadEmbeddedEvidenceExample(FIXTURE_PATH);
  const result = evaluateGreenfieldEvidence(artifact);
  assert.equal(result.verdict, VERDICTS.PASS);
  assert.equal(artifact.metadata.project_root, ".pancreator");
});
