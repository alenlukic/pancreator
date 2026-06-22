import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createFixture, makeOutput, writeJson } from "../helpers.mjs";
import { assessStage, createRun, decideRun, getRunState, prepareInvocation, submitOutput } from "../../src/lib/engine.mjs";
import { loadWorkflow, stageBySlug } from "../../src/lib/workflow.mjs";

test("full dev workflow persists gates and reaches operator-approved success", () => {
  const root = createFixture();
  const workflow = loadWorkflow(root, "dev");
  const state = createRun(root, { workflowSlug: "dev", requestPath: "request.md", title: "Fixture run" });
  const runId = state.run_id;

  for (const stageSlug of ["intake", "plan", "implement", "review", "test", "ship"]) {
    const prepared = prepareInvocation(root, runId);
    assert.equal(prepared.invocation.stage.slug, stageSlug);
    const stage = stageBySlug(workflow, stageSlug);
    const output = makeOutput(root, prepared.invocation, stage);
    writeJson(path.join(root, prepared.invocation.output.path), output);
    const submitted = submitOutput(root, runId, prepared.invocation.output.path);
    assert.equal(submitted.record.outcome, "success");
    if (stageSlug === "intake") {
      const repeated = submitOutput(root, runId, prepared.invocation.output.path);
      assert.equal(repeated.idempotent, true);
      assert.equal(repeated.record.invocation_id, prepared.invocation.invocation_id);
    }

    if (stageSlug === "intake" || stageSlug === "ship") {
      assert.equal(submitted.state.status, "awaiting_operator");
      decideRun(root, runId, "approve", "fixture approval");
    } else if (stageSlug === "plan") {
      assert.equal(submitted.state.status, "awaiting_supervisor");
      const assessmentPath = submitted.state.pending_action.output_path;
      writeJson(path.join(root, assessmentPath), {
        schema_version: 1,
        assessment_id: randomUUID(),
        invocation_id: prepared.invocation.invocation_id,
        verdict: "pass",
        summary: "Plan is implementation-ready.",
        criteria: stage.criteria.map((criterion) => ({ id: criterion.id, result: "pass", evidence: [prepared.invocation.output.path] }))
      });
      assessStage(root, runId, assessmentPath);
    }
  }

  const final = getRunState(root, runId);
  assert.equal(final.status, "succeeded");
  assert.equal(final.current_stage, null);
  assert.equal(final.stage_history.length, 6);
  assert.ok(final.stage_history.every((item) => item.record_path));
});
