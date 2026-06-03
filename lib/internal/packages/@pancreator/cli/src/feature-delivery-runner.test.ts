import { copyFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach, beforeEach } from "vitest";

import {
  applySdkRetrySideEffects,
  invokeFeatureDeliveryEnteringStage,
  maybePauseForReportApproval,
  parseReportApprovalArtifact,
  prepareStageInvocationIndexForSdkEntry,
  resetStageInvocationIndex,
  resolveComplianceStageAdvanceEvent,
  resolveTestStageAdvanceEvent,
  trySdkAutoChainAfterStageWork,
} from "./feature-delivery-runner.js";
import type { FeatureDeliveryRunnerLedger } from "./feature-delivery-runner.js";
import { advanceFeatureDelivery, type FeatureDeliveryState } from "./feature-delivery-run.js";
import type { PipelineDefinition } from "@pancreator/pipeline";
import type { CursorSdkTransport } from "@pancreator/runner-cursor";

const CANONICAL_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");
const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";

let hadAbbrevEnv = false;
let prevAbbrevEnv: string | undefined;

beforeEach(() => {
  hadAbbrevEnv = Object.hasOwn(process.env, JSON_FORMAT_ABBREV_ENV);
  prevAbbrevEnv = process.env[JSON_FORMAT_ABBREV_ENV];
  process.env[JSON_FORMAT_ABBREV_ENV] = "7";
});

afterEach(() => {
  if (hadAbbrevEnv) {
    process.env[JSON_FORMAT_ABBREV_ENV] = prevAbbrevEnv;
  } else {
    delete process.env[JSON_FORMAT_ABBREV_ENV];
  }
});

async function seedEscalationConfig(root: string): Promise<void> {
  await copyFile(
    path.join(CANONICAL_REPO_ROOT, "pancreator-model-escalation.yaml"),
    path.join(root, "pancreator-model-escalation.yaml"),
  );
}

async function seedSdkAdvanceRepo(root: string, runDirRel: string): Promise<void> {
  await seedEscalationConfig(root);
  await writeFile(
    path.join(root, "pancreator.yaml"),
    `project_root: "."
runner:
  cursor:
    invocation: sdk
`,
    "utf8",
  );
  await mkdir(path.join(root, "lib", "pipelines"), { recursive: true });
  await writeFile(
    path.join(root, "lib", "pipelines", "feature-delivery.yaml"),
    `id: feature-delivery
version: "1"
stages:
  - id: intake
    persona: intake-analyst
  - id: plan
    persona: tech-lead
  - id: implement
    persona: coder
  - id: review
    persona: reviewer
  - id: test
    persona: qa-tester
  - id: report
    persona: tech-writer
  - id: compliance
    persona: compliance-auditor
  - id: ship
    persona: supervisor
  - id: index
    persona: librarian
`,
    "utf8",
  );
  const personaDir = path.join(root, "lib", "personas");
  await mkdir(personaDir, { recursive: true });
  for (const persona of [
    "intake-analyst",
    "tech-lead",
    "coder",
    "reviewer",
    "qa-tester",
    "tech-writer",
    "compliance-auditor",
    "supervisor",
    "librarian",
  ] as const) {
    await copyFile(
      path.join(CANONICAL_REPO_ROOT, "lib", "personas", `${persona}.md`),
      path.join(personaDir, `${persona}.md`),
    );
  }
  const runDir = path.join(root, runDirRel);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "handoff.md"), "# handoff\n", "utf8");
  await writeFile(path.join(runDir, "next-prompt.md"), "# prompt\n", "utf8");
  await writeFile(path.join(runDir, "touch-set.json"), "{}\n", "utf8");
  await writeFile(path.join(runDir, "run.log.jsonl"), "", "utf8");
}

function mockStageArtifactBody(rel: string): string {
  const base = path.posix.basename(rel);
  if (base === "plan.md") return "# Plan\n\n## Scope\n\nBody.\n";
  if (base === "implementation-report.md") return "# Implementation report\n\n## Summary\n\nBody.\n";
  if (base === "review.md") return "review_passes: true\n";
  if (base === "test-report.md") return "qa_passes: true\n";
  if (base === "compliance-result.json") {
    return `${JSON.stringify(
      {
        compliance_passes: true,
        final_gate: {
          "pnpm lint": 0,
          "pnpm typecheck": 0,
          "pnpm test": 0,
          "node --test tests/*.test.mjs": 0,
        },
      },
      null,
      2,
    )}\n`;
  }
  return "mock-artifact\n";
}

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
  it("applySdkRetrySideEffects halts when cumulative retries exceed the budget", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-halt-"));
    const state = sampleLedger({
      currentStage: "implement",
      automation: { runnerInvocation: "sdk", cumulativeRetryCount: 5 },
    });
    const summary = await applySdkRetrySideEffects({
      repoRoot: root,
      state,
      event: "must_fix",
      fromStage: "review",
      now: new Date("2026-05-10T14:00:00.000Z"),
    });
    expect(summary).toContain("retry_count=6");
    expect(state.status).toBe("halted");
  });

  it("applySdkRetrySideEffects does not consume retry budget for compliance_spot_fix", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-no-retry-spot-fix-"));
    const state = sampleLedger({
      currentStage: "compliance",
      automation: { runnerInvocation: "sdk", cumulativeRetryCount: 2 },
    });
    const summary = await applySdkRetrySideEffects({
      repoRoot: root,
      state,
      event: "compliance_spot_fix",
      fromStage: "compliance",
      now: new Date("2026-05-10T14:00:00.000Z"),
    });
    expect(summary).toBeNull();
    expect(state.automation?.cumulativeRetryCount).toBe(2);
    expect(state.status).toBe("ready_for_stage_delegation");
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
    await seedEscalationConfig(root);
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

    const transport: CursorSdkTransport = async (params) => {
      const cwd = params.cwd ?? root;
      const required =
        params.requiredArtifactPaths ??
        (params.artifactPath !== undefined ? [params.artifactPath] : []);
      for (const rel of required) {
        const abs = path.join(cwd, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, mockStageArtifactBody(rel), "utf8");
      }
      return { status: "ok", resultText: "ok" };
    };

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

  it("resolveTestStageAdvanceEvent maps qa_passes to qa_spot_fix when report is spot-fixable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-resolve-qa-spot-fix-"));
    const state = sampleLedger({ currentStage: "test" });
    const testRel = path.posix.join(state.artifacts.runDir, "test-report.md");
    const testAbs = path.join(root, testRel);
    await mkdir(path.dirname(testAbs), { recursive: true });
    await writeFile(testAbs, "qa_passes: false\nspot_fixable: true\n", "utf8");

    const resolved = await resolveTestStageAdvanceEvent(root, state, "qa_passes", testRel);
    expect(resolved).toBe("qa_spot_fix");
  });

  it("resolveComplianceStageAdvanceEvent maps failing final gate to compliance_spot_fix", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-resolve-compliance-"));
    const state = sampleLedger({ currentStage: "compliance" });
    const complianceRel = path.posix.join(state.artifacts.runDir, "compliance-result.json");
    const complianceAbs = path.join(root, complianceRel);
    await mkdir(path.dirname(complianceAbs), { recursive: true });
    await writeFile(
      complianceAbs,
      JSON.stringify({
        compliance_passes: true,
        final_gate: {
          "pnpm lint": 0,
          "pnpm typecheck": 0,
          "pnpm test": 0,
          "node --test tests/*.test.mjs": 1,
        },
      }),
      "utf8",
    );

    const resolved = await resolveComplianceStageAdvanceEvent(
      root,
      state,
      "compliance_passes",
      complianceRel,
    );
    expect(resolved).toBe("compliance_spot_fix");
  });

  it("prepareStageInvocationIndexForSdkEntry tracks per-stage visit counts independently", () => {
    const state = sampleLedger();
    expect(prepareStageInvocationIndexForSdkEntry(state, "implement", "sdk")).toBe(0);
    expect(prepareStageInvocationIndexForSdkEntry(state, "implement", "sdk")).toBe(1);
    expect(prepareStageInvocationIndexForSdkEntry(state, "review", "sdk")).toBe(0);
    expect(prepareStageInvocationIndexForSdkEntry(state, "review", "sdk")).toBe(1);
    expect(state.automation?.stageInvocationIndexByStage).toEqual({
      implement: 2,
      review: 2,
    });
    resetStageInvocationIndex(state);
    expect(state.automation?.stageInvocationIndex).toBe(0);
    expect(state.automation?.stageInvocationIndexByStage).toEqual({});
    expect(prepareStageInvocationIndexForSdkEntry(state, "review", "sdk")).toBe(0);
  });

  it("invokeFeatureDeliveryEnteringStage uses escalated model on second loopback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-escalate-loop-"));
    await seedEscalationConfig(root);
    await writeFile(
      path.join(root, "pancreator-model-escalation.yaml"),
      `active_config: default
configs:
  default:
    personas:
      coder:
        default: composer-2.5[fast=false]
        1: gpt-5.2-codex[reasoning=high,fast=false]
`,
      "utf8",
    );
    const personaDir = path.join(root, "lib", "personas");
    await mkdir(personaDir, { recursive: true });
    await copyFile(
      path.join(CANONICAL_REPO_ROOT, "lib", "personas", "coder.md"),
      path.join(personaDir, "coder.md"),
    );
    const pipeline: PipelineDefinition = {
      id: "feature-delivery",
      stages: [{ id: "implement", persona: "coder" }],
    };
    const state = sampleLedger({
      currentStage: "implement",
      automation: {
        runnerInvocation: "sdk",
        cumulativeRetryCount: 1,
        stageInvocationIndexByStage: { implement: 1 },
      },
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
    await writeFile(
      path.join(root, state.artifacts.stateFile),
      `${JSON.stringify({ automation: state.automation }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(root, state.artifacts.runLogFile), "", "utf8");

    const captured: string[] = [];
    const transport: CursorSdkTransport = async (params) => {
      captured.push(params.modelOverride ?? params.persona.model);
      const cwd = params.cwd ?? root;
      const required =
        params.requiredArtifactPaths ??
        (params.artifactPath !== undefined ? [params.artifactPath] : []);
      for (const rel of required) {
        const abs = path.join(cwd, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, mockStageArtifactBody(rel), "utf8");
      }
      return { status: "ok", resultText: "ok" };
    };

    prepareStageInvocationIndexForSdkEntry(state, "implement", "sdk");

    await invokeFeatureDeliveryEnteringStage({
      repoRoot: root,
      state,
      pipeline,
      stageId: "implement",
      testHooks: { sdkTransport: transport },
    });

    expect(captured).toEqual(["gpt-5.2-codex[reasoning=high,fast=false]"]);
    const persisted = JSON.parse(
      await readFile(path.join(root, state.artifacts.stateFile), "utf8"),
    ) as {
      automation?: {
        stageInvocationIndex?: number;
        stageInvocationIndexByStage?: Record<string, number>;
      };
    };
    expect(persisted.automation?.stageInvocationIndex).toBe(1);
    expect(persisted.automation?.stageInvocationIndexByStage?.implement).toBe(2);
  });

  it("second review SDK entry escalates reviewer tier after must_fix cycle", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-escalate-review-"));
    await seedEscalationConfig(root);
    const personaDir = path.join(root, "lib", "personas");
    await mkdir(personaDir, { recursive: true });
    await copyFile(
      path.join(CANONICAL_REPO_ROOT, "lib", "personas", "reviewer.md"),
      path.join(personaDir, "reviewer.md"),
    );
    const pipeline: PipelineDefinition = {
      id: "feature-delivery",
      stages: [{ id: "review", persona: "reviewer" }],
    };
    const state = sampleLedger({
      currentStage: "review",
      artifacts: {
        runDir: "work/demo/run",
        stateFile: "work/demo/run/state.json",
        runLogFile: "work/demo/run/run.log.jsonl",
        nextPromptFile: "work/demo/run/next-prompt.md",
      },
      automation: {
        runnerInvocation: "sdk",
        cumulativeRetryCount: 1,
        stageInvocationIndex: 0,
        stageInvocationIndexByStage: { implement: 2, review: 1 },
      },
    });
    const runDir = path.join(root, state.artifacts.runDir);
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "next-prompt.md"), "# prompt", "utf8");
    await writeFile(
      path.join(root, state.artifacts.stateFile),
      `${JSON.stringify({ automation: state.automation }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(root, state.artifacts.runLogFile), "", "utf8");

    const captured: string[] = [];
    const transport: CursorSdkTransport = async (params) => {
      captured.push(params.modelOverride ?? params.persona.model);
      const cwd = params.cwd ?? root;
      const required =
        params.requiredArtifactPaths ??
        (params.artifactPath !== undefined ? [params.artifactPath] : []);
      for (const rel of required) {
        const abs = path.join(cwd, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, mockStageArtifactBody(rel), "utf8");
      }
      return { status: "ok", resultText: "ok" };
    };

    prepareStageInvocationIndexForSdkEntry(state, "review", "sdk");

    await invokeFeatureDeliveryEnteringStage({
      repoRoot: root,
      state,
      pipeline,
      stageId: "review",
      testHooks: { sdkTransport: transport },
    });

    expect(captured).toEqual(["gpt-5.4[context=272k,reasoning=extra-high,fast=false]"]);
  });

  it("preserves per-stage counts after successful implement advance to review", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-runner-reset-success-"));
    const runDirRel = "work/172996_05-10-26/38670_1315_demo-feature";
    await seedSdkAdvanceRepo(root, runDirRel);
    const stateFileRel = `${runDirRel}/state.json`;
    const implementationReportRel = `${runDirRel}/implementation-report.md`;
    await writeFile(path.join(root, implementationReportRel), "# Implementation report\n", "utf8");

    const state: FeatureDeliveryState = {
      schemaVersion: "1",
      pipelineId: "feature-delivery",
      taskId: "38670_1315_demo-feature",
      featureId: "demo-feature",
      status: "ready_for_stage_delegation",
      currentStage: "implement",
      createdAtIso: "2026-05-10T13:15:30.000Z",
      source: { inboxEntry: "demo-feature.md", inboxPath: "lib/inbox/in/demo-feature.md" },
      artifacts: {
        runDir: runDirRel,
        stateFile: stateFileRel,
        handoffFile: `${runDirRel}/handoff.md`,
        runLogFile: `${runDirRel}/run.log.jsonl`,
        nextPromptFile: `${runDirRel}/next-prompt.md`,
      },
      stages: [
        { id: "implement", persona: "coder", label: "Implement", status: "ready" },
        { id: "review", persona: "reviewer", label: "Review", status: "pending" },
      ],
      transitions: [
        {
          from: "implement",
          on: "implementation_complete",
          to: "review",
          humanAttention: "Reviewer receives only the handoff, touch-set, diff, and validation output.",
        },
      ],
      nextHumanAction: "Complete implementation",
      automation: {
        runnerInvocation: "sdk",
        cumulativeRetryCount: 0,
        stageInvocationIndex: 1,
        stageInvocationIndexByStage: { implement: 2 },
      },
      advanceHistory: [
        {
          atIso: "2026-05-10T14:00:00.000Z",
          kind: "advance",
          from: "review",
          to: "implement",
          event: "must_fix",
          artifact: `${runDirRel}/review.md`,
        },
      ],
    };
    await writeFile(path.join(root, stateFileRel), `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const transport: CursorSdkTransport = async (params) => {
      const cwd = params.cwd ?? root;
      const required =
        params.requiredArtifactPaths ??
        (params.artifactPath !== undefined ? [params.artifactPath] : []);
      for (const rel of required) {
        const abs = path.join(cwd, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, mockStageArtifactBody(rel), "utf8");
      }
      return { status: "ok", resultText: "ok" };
    };

    await advanceFeatureDelivery({
      repoRoot: root,
      taskId: state.taskId,
      artifact: implementationReportRel,
      testHooks: { sdkTransport: transport },
    });

    const persisted = JSON.parse(await readFile(path.join(root, stateFileRel), "utf8")) as {
      automation?: {
        stageInvocationIndex?: number;
        stageInvocationIndexByStage?: Record<string, number>;
      };
      currentStage?: string;
    };
    expect(persisted.currentStage).toBe("review");
    expect(persisted.automation?.stageInvocationIndexByStage?.implement).toBe(2);
    expect(persisted.automation?.stageInvocationIndexByStage?.review).toBe(1);
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
