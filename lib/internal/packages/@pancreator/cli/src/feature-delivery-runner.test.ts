import { copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  applySdkRetrySideEffects,
  invokeFeatureDeliveryEnteringStage,
  maybePauseForReportApproval,
  parseReportApprovalArtifact,
  resolveTestStageAdvanceEvent,
  trySdkAutoChainAfterStageWork,
} from "./feature-delivery-runner.js";
import type { FeatureDeliveryRunnerLedger } from "./feature-delivery-runner.js";
import type { PipelineDefinition } from "@pancreator/pipeline";
import type { CursorSdkTransport } from "@pancreator/runner-cursor";

const CANONICAL_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

function sampleLedger(overrides: Partial<FeatureDeliveryRunnerLedger> = {}): FeatureDeliveryRunnerLedger {
  return {
    taskId: "38670_1315_demo-feature",
    featureId: "demo-feature",
    pipelineId: "feature-delivery",
    currentStage: "report",
    status: "ready_for_stage_delegation",
    nextHumanAction: "test",
    artifacts: {
      runDir: "work/172996_05-10-26/38670_1315_demo-feature",
      stateFile: "work/172996_05-10-26/38670_1315_demo-feature/state.json",
      runLogFile: "work/172996_05-10-26/38670_1315_demo-feature/run.log.jsonl",
      nextPromptFile: "work/172996_05-10-26/38670_1315_demo-feature/next-prompt.md",
    },
    automation: { runnerInvocation: "sdk", cumulativeRetryCount: 0 },
    ...overrides,
  };
}

describe("feature-delivery-runner automation", () => {
  it("applySdkRetrySideEffects halts when cumulative retries exceed 3", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-halt-"));
    const state = sampleLedger({
      currentStage: "implement",
      automation: { runnerInvocation: "sdk", cumulativeRetryCount: 3 },
    });
    const summary = await applySdkRetrySideEffects({
      repoRoot: root,
      state,
      event: "must_fix",
      fromStage: "review",
      now: new Date("2026-05-10T14:00:00.000Z"),
    });
    expect(summary).toContain("retry_count=4");
    expect(state.status).toBe("halted");
  });

  it("maybePauseForReportApproval writes an outbox artifact when delivery report exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-report-gate-"));
    const state = sampleLedger();
    const reportRel = path.join(root, "lib", "memory", "features", state.featureId, "delivery-report.md");
    await mkdir(path.dirname(reportRel), { recursive: true });
    await writeFile(reportRel, "# Delivery report", "utf8");
    const outboxRel = await maybePauseForReportApproval({
      repoRoot: root,
      state,
      now: new Date("2026-05-10T14:05:00.000Z"),
    });
    expect(outboxRel).toMatch(/^lib\/inbox\/out\//u);
    expect(state.status).toBe("waiting_for_human_gate");
    expect(state.automation?.reportApprovalPending).toBe(true);
  });

  it("invokeFeatureDeliveryEnteringStage invokes runner for the requested stage, not the pipeline entry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-stage-slice-"));
    const personaDir = path.join(root, "lib", "personas");
    await mkdir(personaDir, { recursive: true });
    await copyFile(
      path.join(CANONICAL_REPO_ROOT, "lib", "personas", "coder.md"),
      path.join(personaDir, "coder.md"),
    );
    const pipeline: PipelineDefinition = {
      id: "feature-delivery",
      stages: [
        { id: "intake", persona: "coder" },
        { id: "implement", persona: "coder" },
      ],
    };
    const state = sampleLedger({
      currentStage: "implement",
      artifacts: {
        runDir: "work/demo/run",
        stateFile: "work/demo/run/state.json",
        runLogFile: "work/demo/run/run.log.jsonl",
        nextPromptFile: "work/demo/run/next-prompt.md",
      },
    });
    const runDir = path.join(root, state.artifacts.runDir);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "next-prompt.md"), "# prompt", "utf8");
    await writeFile(path.join(root, state.artifacts.runLogFile), "", "utf8");

    const transport: CursorSdkTransport = async () => ({ status: "ok", resultText: "ok" });

    await invokeFeatureDeliveryEnteringStage({
      repoRoot: root,
      state,
      pipeline,
      stageId: "implement",
      testHooks: { sdkTransport: transport },
    });

    const logText = await readFile(path.join(root, state.artifacts.runLogFile), "utf8");
    const lastLine = logText.trim().split("\n").at(-1);
    expect(lastLine).toBeDefined();
    const record = JSON.parse(lastLine!) as { pancreator?: { stage_id?: string } };
    expect(record.pancreator?.stage_id).toBe("implement");
  });

  it("trySdkAutoChainAfterStageWork routes plan-invalidating qa_fails to plan", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-qa-plan-"));
    const state = sampleLedger({ currentStage: "test" });
    const testRel = path.posix.join(state.artifacts.runDir, "test-report.md");
    const testAbs = path.join(root, testRel);
    await mkdir(path.dirname(testAbs), { recursive: true });
    await writeFile(
      testAbs,
      "---\nqa_passes: false\nplan_invalidating: true\n---\n",
      "utf8",
    );

    const chainedEvents: string[] = [];
    const pipeline: PipelineDefinition = {
      id: "feature-delivery",
      stages: [{ id: "test" }, { id: "plan" }, { id: "implement" }],
    };
    const chained = await trySdkAutoChainAfterStageWork({
      repoRoot: root,
      state,
      pipeline,
      completedStageId: "test",
      now: new Date("2026-05-10T15:00:00.000Z"),
      advanceFn: async (event) => {
        chainedEvents.push(event);
      },
    });

    expect(chained).toBe(true);
    expect(chainedEvents).toEqual(["qa_fails_plan_invalidating"]);
  });

  it("resolveTestStageAdvanceEvent maps qa_fails to qa_fails_plan_invalidating when verdict requires plan", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-resolve-qa-"));
    const state = sampleLedger({ currentStage: "test" });
    const testRel = path.posix.join(state.artifacts.runDir, "test-report.md");
    const testAbs = path.join(root, testRel);
    await mkdir(path.dirname(testAbs), { recursive: true });
    await writeFile(testAbs, "qa_passes: false\nplan_invalidating: true\n", "utf8");

    const resolved = await resolveTestStageAdvanceEvent(root, state, "qa_fails", testRel);
    expect(resolved).toBe("qa_fails_plan_invalidating");
  });

  it("parseReportApprovalArtifact reads approve and needs_changes decisions", () => {
    const approve = parseReportApprovalArtifact(
      "---\ntask_id: t\ngate: report_approval\ndecision: approve\nrequired_changes: \"\"\n---\n",
    );
    expect(approve?.decision).toBe("approve");
    const needsChanges = parseReportApprovalArtifact(
      "---\ndecision: needs_changes\nrequired_changes: fix tests\ntarget_stage: plan\n---\n",
    );
    expect(needsChanges?.decision).toBe("needs_changes");
    expect(needsChanges?.targetStage).toBe("plan");
  });
});
