import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach, beforeEach } from "vitest";

import planPartial from "./fixtures/feature-delivery-stages/plan-partial.json" with { type: "json" };
import planComplete from "./fixtures/feature-delivery-stages/plan-complete.json" with { type: "json" };
import {
  invokeFeatureDeliveryEnteringStage,
  MAX_STAGE_REMEDIATION_ATTEMPTS,
  STAGE_REMEDIATION_PERSONA,
} from "./feature-delivery-runner.js";
import type { FeatureDeliveryRunnerLedger } from "./feature-delivery-runner.js";
import type { PipelineDefinition } from "@pancreator/pipeline";
import type { CursorSdkInvokeParams } from "@pancreator/runner-cursor";
import {
  createStageMockTransport,
  type StageFixture,
} from "./fixtures/stage-mock-transport.js";
import { gateFixtureBody } from "./feature-delivery-gate-fixtures.js";

const CANONICAL_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

async function seedEscalationConfig(root: string): Promise<void> {
  await copyFile(
    path.join(CANONICAL_REPO_ROOT, "pancreator-model-escalation.yaml"),
    path.join(root, "pancreator-model-escalation.yaml"),
  );
}

async function seedPersonas(root: string, names: string[]): Promise<void> {
  const personaDir = path.join(root, "lib", "personas");
  await mkdir(personaDir, { recursive: true });
  for (const name of names) {
    await copyFile(
      path.join(CANONICAL_REPO_ROOT, "lib", "personas", `${name}.md`),
      path.join(personaDir, `${name}.md`),
    );
  }
}

function ledgerFromFixture(fixture: StageFixture): FeatureDeliveryRunnerLedger {
  return {
    taskId: fixture.taskId,
    featureId: fixture.featureId,
    pipelineId: "feature-delivery",
    currentStage: fixture.stage,
    status: "ready_for_stage_delegation",
    nextHumanAction: "test",
    artifacts: {
      runDir: fixture.runDir,
      stateFile: `${fixture.runDir}/state.json`,
      runLogFile: `${fixture.runDir}/run.log.jsonl`,
      nextPromptFile: `${fixture.runDir}/next-prompt.md`,
      handoffFile: fixture.handoffFile,
    },
    automation: { runnerInvocation: "sdk", cumulativeRetryCount: 0 },
  };
}

async function seedRun(root: string, fixture: StageFixture, state: FeatureDeliveryRunnerLedger): Promise<void> {
  const runAbs = path.join(root, fixture.runDir);
  await mkdir(runAbs, { recursive: true });
  await writeFile(path.join(runAbs, "next-prompt.md"), fixture.stagePrompt, "utf8");
  await writeFile(path.join(root, state.artifacts.runLogFile), "", "utf8");
}

function countEngineerRuns(logText: string): number {
  return logText
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { name?: string })
    .filter((row) => row.name === STAGE_REMEDIATION_PERSONA).length;
}

describe("feature-delivery SDK stage remediation", () => {
  const pipeline: PipelineDefinition = {
    id: "feature-delivery",
    stages: [{ id: "plan", persona: "tech-lead" }],
  };

  beforeEach(() => {
    process.env.PAN_SDK_SAMPLING_FORCE_OFF = "1";
    process.env.PAN_STAGE_REMEDIATION_FORCE_ON = "1";
  });

  afterEach(() => {
    delete process.env.PAN_SDK_SAMPLING_FORCE_OFF;
    delete process.env.PAN_STAGE_REMEDIATION_FORCE_ON;
  });

  it("remediates partial plan output via pancreator-engineer and resumes the stage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-remediate-"));
    await seedEscalationConfig(root);
    await seedPersonas(root, ["tech-lead", "product-engineer", "design-engineer", STAGE_REMEDIATION_PERSONA]);
    const fixture = planPartial as StageFixture;
    const state = ledgerFromFixture(fixture);
    await seedRun(root, fixture, state);

    await invokeFeatureDeliveryEnteringStage({
      repoRoot: root,
      state,
      pipeline,
      stageId: "plan",
      testHooks: { sdkTransport: createStageMockTransport(root, fixture) },
    });

    expect(state.automation?.stageRemediationCount).toBe(1);
    const logText = await readFile(path.join(root, state.artifacts.runLogFile), "utf8");
    expect(countEngineerRuns(logText)).toBe(1);
    await expect(readFile(path.join(root, fixture.runDir, "plan.md"), "utf8")).resolves.toContain("# Plan");
  });

  it("fails closed when remediation cannot restore required artifacts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-remediate-fail-"));
    await seedEscalationConfig(root);
    await seedPersonas(root, ["tech-lead", "product-engineer", "design-engineer", STAGE_REMEDIATION_PERSONA]);
    const fixture = {
      ...(planPartial as StageFixture),
      writesOnRemediation: [],
    };
    const state = ledgerFromFixture(fixture);
    await seedRun(root, fixture, state);

    await expect(
      invokeFeatureDeliveryEnteringStage({
        repoRoot: root,
        state,
        pipeline,
        stageId: "plan",
        testHooks: { sdkTransport: createStageMockTransport(root, fixture) },
      }),
    ).rejects.toThrow(/plan\.md|incomplete after .* remediation attempt/u);

    const logText = await readFile(path.join(root, state.artifacts.runLogFile), "utf8");
    expect(countEngineerRuns(logText)).toBe(MAX_STAGE_REMEDIATION_ATTEMPTS);
  });

  it("passes complete plan fixture without invoking remediation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-complete-"));
    await seedEscalationConfig(root);
    await seedPersonas(root, ["tech-lead", "product-engineer", "design-engineer", STAGE_REMEDIATION_PERSONA]);
    const fixture = planComplete as StageFixture;
    const state = ledgerFromFixture(fixture);
    await seedRun(root, fixture, state);

    await invokeFeatureDeliveryEnteringStage({
      repoRoot: root,
      state,
      pipeline,
      stageId: "plan",
      testHooks: { sdkTransport: createStageMockTransport(root, fixture) },
    });

    const logText = await readFile(path.join(root, state.artifacts.runLogFile), "utf8");
    expect(countEngineerRuns(logText)).toBe(0);
  });

  it("stage mock transport writes deterministic bytes declared by fixture scripts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-stage-mock-script-"));
    const fixture = planComplete as StageFixture;
    const transport = createStageMockTransport(root, fixture);
    await transport({
      message: "Execute plan",
      persona: {
        name: "tech-lead",
        description: "plan",
        model: "gpt-5.3-codex",
        permissionMode: "default",
        tools: [],
        disallowedTools: [],
        mcpServers: [],
        maxTurns: 1,
        skills: [],
        isolation: "worktree",
        memory: "project",
        effort: "high",
        color: "cyan",
        metadata: {},
      },
      requiredArtifactPaths: fixture.writesOnSuccess.map((entry) => entry.path),
    } as CursorSdkInvokeParams);

    for (const entry of fixture.writesOnSuccess) {
      const body = await readFile(path.join(root, entry.path), "utf8");
      expect(body).toBe(gateFixtureBody(root, entry.path));
    }
  });
});
