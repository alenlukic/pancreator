import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringifyCompactJson } from "@/lib/json-io";
import { GET } from "@/app/api/run-state/route";
import {
  collectHumanGateQueue,
  deriveRunDirFromTaskId,
  excludeReconciledAttentionTasks,
  getActiveRunState,
  loadArchivedTaskIds,
  loadShippedOutcomes,
  parseRunLogFile,
  synthesizeStageCells,
  activeStageElapsedMs,
  newestStageTelemetryChip,
} from "@/services/run-state";
import { stageArtifactPathsForStage } from "@/services/stage-artifact-contract";

function writeState(
  root: string,
  dayBucket: string,
  taskId: string,
  overrides: Record<string, unknown> = {},
): void {
  const runDir = path.join(root, ".pan/work", dayBucket, taskId);
  fs.mkdirSync(runDir, { recursive: true });
  const state = {
    schemaVersion: "1",
    pipelineId: "feature-delivery",
    taskId,
    featureId: "demo-feature",
    status: "ready_for_stage_delegation",
    currentStage: "plan",
    createdAtIso: "2026-06-02T10:00:00.000Z",
    source: { inboxEntry: "demo.md", inboxPath: "lib/inbox/in/demo.md" },
    artifacts: {
      runDir: `.pan/work/${dayBucket}/${taskId}`,
      stateFile: `.pan/work/${dayBucket}/${taskId}/state.json`,
      handoffFile: `.pan/work/${dayBucket}/${taskId}/handoff.md`,
      runLogFile: `.pan/work/${dayBucket}/${taskId}/run.log.jsonl`,
    },
    stages: [
      { id: "intake", persona: "intake-analyst", label: "Intake", status: "complete", humanGate: "human_approval" },
      { id: "plan", persona: "tech-lead", label: "Plan", status: "ready", humanGate: "human_approval" },
      { id: "implement", persona: "coder", label: "Implement", status: "pending" },
      { id: "review", persona: "reviewer", label: "Review", status: "pending" },
      { id: "test", persona: "qa-tester", label: "Test", status: "pending" },
      { id: "report", persona: "tech-writer", label: "Report", status: "pending" },
      { id: "compliance", persona: "supervisor", label: "Compliance", status: "pending" },
      { id: "ship", persona: "supervisor", label: "Ship", status: "pending" },
      { id: "index", persona: "librarian", label: "Index", status: "pending" },
    ],
    transitions: [],
    nextHumanAction: "Ratify the plan before advancing.",
    ...overrides,
  };
  fs.writeFileSync(path.join(runDir, "state.json"), stringifyCompactJson(state));
}

describe("GET /api/run-state", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-run-state-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    fs.mkdirSync(path.join(tempRoot, ".pan/work"), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns an empty array when no active tasks exist", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const response = await GET();
      expect(response.status).toBe(200);
      const payload = (await response.json()) as unknown[];
      expect(payload).toEqual([]);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("returns one envelope with ten stages including compliance for an active task", async () => {
    writeState(tempRoot, "172973_06-02-26", "65766_0543_demo-feature");
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const envelopes = await getActiveRunState(tempRoot);
      expect(envelopes).toHaveLength(1);
      expect(envelopes[0].taskId).toBe("65766_0543_demo-feature");
      expect(envelopes[0].featureId).toBe("demo-feature");
      expect(envelopes[0].decodedTimestamp).toBe("2026-06-02 05:43 UTC");
      expect(envelopes[0].stages).toHaveLength(10);
      expect(envelopes[0].stages.map((stage) => stage.name)).toContain("compliance");
      expect(envelopes[0].stages[1]).toMatchObject({
        name: "plan",
        ownerPersona: "tech-lead",
        status: "active",
        humanGate: "human_approval",
      });
      expect(envelopes[0].stages[1].nextHumanAction).toContain("Ratify");
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("populates decodedTimestamp from countdown run directory tokens", async () => {
    writeState(tempRoot, "172996_05-10-26", "38670_1315_demo-feature");
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const envelopes = await getActiveRunState(tempRoot);
      expect(envelopes).toHaveLength(1);
      expect(envelopes[0].decodedTimestamp).toBe("2026-05-10 13:15 UTC");
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("honors pan status currentStage when it differs from state.json", () => {
    const state = {
      taskId: "65766_0543_pan-stage-feature",
      status: "ready_for_stage_delegation",
      currentStage: "plan",
      nextHumanAction: "Stale plan action",
      artifacts: {
        runDir: ".pan/work/172973_06-02-26/65766_0543_pan-stage-feature",
        runLogFile: ".pan/work/172973_06-02-26/65766_0543_pan-stage-feature/run.log.jsonl",
      },
      stages: [
        { id: "intake", persona: "intake-analyst", status: "complete", humanGate: "human_approval" },
        { id: "plan", persona: "tech-lead", status: "complete", humanGate: "human_approval" },
        { id: "implement", persona: "coder", status: "ready" },
        { id: "review", persona: "reviewer", status: "pending" },
        { id: "test", persona: "qa-tester", status: "pending" },
        { id: "report", persona: "tech-writer", status: "pending" },
        { id: "ship", persona: "supervisor", status: "pending" },
        { id: "index", persona: "librarian", status: "pending" },
      ],
    };
    const cells = synthesizeStageCells(state, {
      taskId: "65766_0543_pan-stage-feature",
      currentStage: "implement",
      nextHumanAction: "Resume implement fixes.",
      nextCommand:
        "pnpm -w exec pan advance 65766_0543_pan-stage-feature --event must_fix --artifact .pan/work/demo/review.md",
    });
    const implement = cells.find((stage) => stage.name === "implement");
    const plan = cells.find((stage) => stage.name === "plan");
    expect(implement).toMatchObject({
      status: "active",
      nextHumanAction: "Resume implement fixes.",
    });
    expect(implement?.nextCommand).toContain("must_fix");
    expect(plan?.status).toBe("complete");
    expect(plan?.nextHumanAction).toBe("");
  });

  it("surfaces humanAttention on completed stages", () => {
    const cells = synthesizeStageCells(
      {
        taskId: "65766_0543_attention-feature",
        status: "ready_for_stage_delegation",
        currentStage: "plan",
        nextHumanAction: "Plan action",
        artifacts: {
          runDir: ".pan/work/demo",
          runLogFile: ".pan/work/demo/run.log.jsonl",
        },
        stages: [
          {
            id: "intake",
            persona: "intake-analyst",
            status: "complete",
            humanGate: "human_approval",
            humanAttention: "Intake ratified",
          },
          { id: "plan", persona: "tech-lead", status: "ready", humanGate: "human_approval" },
          { id: "implement", persona: "coder", status: "pending" },
          { id: "review", persona: "reviewer", status: "pending" },
          { id: "test", persona: "qa-tester", status: "pending" },
          { id: "report", persona: "tech-writer", status: "pending" },
          { id: "ship", persona: "supervisor", status: "pending" },
          { id: "index", persona: "librarian", status: "pending" },
        ],
      },
      null,
    );
    const intake = cells.find((stage) => stage.name === "intake");
    expect(intake?.humanAttention).toBe("Intake ratified");
    expect(intake?.nextHumanAction).toBe("");
  });

  it("keeps humanAttention separate from nextCommand on active stages", () => {
    const cells = synthesizeStageCells(
      {
        taskId: "65766_0543_active-attention-feature",
        status: "ready_for_stage_delegation",
        currentStage: "plan",
        nextHumanAction: "Ratify the plan.",
        artifacts: {
          runDir: ".pan/work/demo",
          runLogFile: ".pan/work/demo/run.log.jsonl",
        },
        stages: [
          { id: "intake", persona: "intake-analyst", status: "complete" },
          {
            id: "plan",
            persona: "tech-lead",
            status: "ready",
            humanGate: "human_approval",
            humanAttention: "Persisted operator note",
          },
          { id: "implement", persona: "coder", status: "pending" },
          { id: "review", persona: "reviewer", status: "pending" },
          { id: "test", persona: "qa-tester", status: "pending" },
          { id: "report", persona: "tech-writer", status: "pending" },
          { id: "ship", persona: "supervisor", status: "pending" },
          { id: "index", persona: "librarian", status: "pending" },
        ],
      },
      {
        taskId: "65766_0543_active-attention-feature",
        currentStage: "plan",
        nextHumanAction: "Ratify the plan.",
        nextCommand: "pnpm -w exec pan advance demo --artifact plan.md",
      },
    );
    const plan = cells.find((stage) => stage.name === "plan");
    expect(plan).toMatchObject({
      status: "active",
      nextHumanAction: "Ratify the plan.",
      nextCommand: "pnpm -w exec pan advance demo --artifact plan.md",
      humanAttention: "Persisted operator note",
    });
  });

  it("marks blocked stages as failed with humanAttention", () => {
    const cells = synthesizeStageCells(
      {
        taskId: "65766_0543_blocked-feature",
        status: "ready_for_stage_delegation",
        currentStage: "review",
        nextHumanAction: "Review blocked",
        artifacts: {
          runDir: ".pan/work/demo",
          runLogFile: ".pan/work/demo/run.log.jsonl",
        },
        stages: [
          { id: "intake", persona: "intake-analyst", status: "complete" },
          { id: "plan", persona: "tech-lead", status: "complete" },
          { id: "implement", persona: "coder", status: "complete" },
          {
            id: "review",
            persona: "reviewer",
            status: "blocked",
            humanAttention: "Address must_fix findings",
          },
          { id: "test", persona: "qa-tester", status: "pending" },
          { id: "report", persona: "tech-writer", status: "pending" },
          { id: "ship", persona: "supervisor", status: "pending" },
          { id: "index", persona: "librarian", status: "pending" },
        ],
      },
      null,
    );
    expect(cells.find((stage) => stage.name === "review")).toMatchObject({
      status: "failed",
      humanAttention: "Address must_fix findings",
      nextHumanAction: "",
    });
  });

  it("enriches envelopes with runDir and inboxSource metadata", async () => {
    writeState(tempRoot, "172973_06-02-26", "65766_0543_metadata-feature", {
      source: {
        inboxEntry: "demo.md",
        inboxPath: "lib/inbox/in/demo.md",
      },
    });
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const envelopes = await getActiveRunState(tempRoot);
      expect(envelopes[0]).toMatchObject({
        taskId: "65766_0543_metadata-feature",
        runDir: ".pan/work/172973_06-02-26/65766_0543_metadata-feature",
        inboxSource: "lib/inbox/in/demo.md",
      });
      expect(deriveRunDirFromTaskId("65766_0543_metadata-feature", envelopes)).toBe(
        ".pan/work/172973_06-02-26/65766_0543_metadata-feature",
      );
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("collects human gate queue entries across active runs", () => {
    const queue = collectHumanGateQueue([
      {
        taskId: "task-a",
        runDir: ".pan/work/day-a/task-a",
        stages: [
          {
            name: "plan",
            ownerPersona: "tech-lead",
            humanGate: "human_approval",
            nextHumanAction: "Ratify plan",
            nextCommand: "",
            humanAttention: "",
            status: "active",
          },
        ],
        runEvents: [],
      },
      {
        taskId: "task-b",
        runDir: ".pan/work/day-b/task-b",
        stages: [
          {
            name: "review",
            ownerPersona: "reviewer",
            humanGate: "human_approval",
            nextHumanAction: "",
            nextCommand: "",
            humanAttention: "",
            status: "pending",
          },
        ],
        runEvents: [],
      },
    ]);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      taskId: "task-a",
      stageName: "plan",
      humanGate: "human_approval",
    });
  });

  it("keeps humanGate on completed stages", async () => {
    writeState(tempRoot, "172973_06-02-26", "65766_0543_complete-gate-feature");
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const envelopes = await getActiveRunState(tempRoot);
      const intake = envelopes[0].stages.find((stage) => stage.name === "intake");
      expect(intake).toMatchObject({
        status: "complete",
        humanGate: "human_approval",
      });
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("emits sourceWarning when pan status is unavailable", async () => {
    writeState(tempRoot, "172973_06-02-26", "65766_0543_warn-feature");
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const envelopes = await getActiveRunState(tempRoot);
      expect(envelopes[0].sourceWarning).toMatch(/pan status unavailable/u);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("parses escalation, retry, and deferral telemetry from run.log.jsonl", async () => {
    const runDir = path.join(tempRoot, ".pan/work", "172973_06-02-26", "65766_0543_telemetry-feature");
    fs.mkdirSync(runDir, { recursive: true });
    writeState(tempRoot, "172973_06-02-26", "65766_0543_telemetry-feature");
    const logPath = path.join(runDir, "run.log.jsonl");
    fs.writeFileSync(
      logPath,
      [
        stringifyCompactJson({
          ts: "2026-06-02T12:00:00.000Z",
          name: "cursor.runner.escalation",
          pancreator: { stage_id: "implement", outcome: "success" },
          attributes: { escalation: "composer-2.5[fast=false]" },
        }),
        stringifyCompactJson({
          ts: "2026-06-02T11:00:00.000Z",
          name: "pancreator.pipeline.advance",
          pancreator: { stage_id: "review", outcome: "success" },
          attributes: { "pancreator.transition_event": "must_fix" },
        }),
        stringifyCompactJson({
          ts: "2026-06-02T10:00:00.000Z",
          name: "pancreator.pipeline.defer",
          pancreator: { stage_id: "test", outcome: "success" },
          status: { code: "OK", message: "deferred to operator" },
        }),
      ].join("\n"),
    );

    const events = await parseRunLogFile(logPath);
    expect(events[0]).toMatchObject({
      escalationLabel: "composer-2.5[fast=false]",
      stageId: "implement",
    });
    expect(events[1]).toMatchObject({ retryBadge: true, stageId: "review" });
    expect(events[2]).toMatchObject({ deferralBadge: true, stageId: "test" });

    const chip = newestStageTelemetryChip(events, "implement");
    expect(chip).toMatchObject({ kind: "escalation", label: "composer-2.5[fast=false]" });

    const elapsed = activeStageElapsedMs(
      events,
      "implement",
      Date.parse("2026-06-02T12:02:14.000Z"),
    );
    expect(elapsed).toBe(134_000);
  });

  it("resolves stage artifact paths for plan and implement stages", () => {
    const input = {
      featureId: "demo-feature",
      runDir: ".pan/work/day/task",
    };
    expect(stageArtifactPathsForStage(input, "plan")).toEqual([
      ".pan/work/day/task/plan.md",
      ".pan/work/day/task/adr-draft.md",
      ".pan/work/day/task/touch-set.json",
      ".pan/work/day/task/handoff.md",
    ]);
    expect(stageArtifactPathsForStage(input, "implement")).toEqual([
      ".pan/work/day/task/implementation-report.md",
    ]);
    expect(stageArtifactPathsForStage({ ...input, designSteps: true }, "plan")).toContain(
      "lib/memory/features/demo-feature/ux-spec.md",
    );
  });

  it("synthesizes compliance between report and ship", () => {
    const cells = synthesizeStageCells(
      {
        taskId: "65766_0543_compliance-order",
        status: "ready_for_stage_delegation",
        currentStage: "report",
        nextHumanAction: "Write delivery report",
        artifacts: {
          runDir: ".pan/work/demo",
          runLogFile: ".pan/work/demo/run.log.jsonl",
        },
        stages: [
          { id: "intake", persona: "intake-analyst", status: "complete" },
          { id: "plan", persona: "tech-lead", status: "complete" },
          { id: "implement", persona: "coder", status: "complete" },
          { id: "review", persona: "reviewer", status: "complete" },
          { id: "test", persona: "qa-tester", status: "complete" },
          { id: "report", persona: "tech-writer", status: "ready" },
          { id: "compliance", persona: "supervisor", status: "pending" },
          { id: "ship", persona: "supervisor", status: "pending" },
          { id: "index", persona: "librarian", status: "pending" },
        ],
      },
      null,
    );
    const names = cells.map((stage) => stage.name);
    expect(names.indexOf("compliance")).toBe(names.indexOf("report") + 1);
    expect(names.indexOf("ship")).toBe(names.indexOf("compliance") + 1);
  });

  it("parses run.log.jsonl in reverse-chronological order", async () => {
    const runDir = path.join(tempRoot, ".pan/work", "172973_06-02-26", "65766_0543_log-feature");
    fs.mkdirSync(runDir, { recursive: true });
    writeState(tempRoot, "172973_06-02-26", "65766_0543_log-feature");
    const logPath = path.join(runDir, "run.log.jsonl");
    fs.writeFileSync(
      logPath,
      [
        stringifyCompactJson({
          ts: "2026-06-01T10:00:00.000Z",
          name: "older-event",
          pancreator: { stage_id: "intake", outcome: "success", persona: "intake-analyst" },
        }),
        stringifyCompactJson({
          ts: "2026-06-02T12:00:00.000Z",
          name: "newer-event",
          pancreator: { stage_id: "plan", outcome: "success", persona: "tech-lead" },
        }),
      ].join("\n"),
    );

    const events = await parseRunLogFile(logPath);
    expect(events[0].event).toBe("newer-event");
    expect(events[1].event).toBe("older-event");
  });

  it("returns an explicit empty run-log entry when run.log.jsonl is missing", async () => {
    writeState(tempRoot, "172973_06-02-26", "65766_0543_no-log-feature");
    const runDir = path.join(tempRoot, ".pan/work", "172973_06-02-26", "65766_0543_no-log-feature");
    fs.rmSync(path.join(runDir, "run.log.jsonl"), { force: true });

    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const envelopes = await getActiveRunState(tempRoot);
      expect(envelopes[0].runEvents[0].message).toMatch(/No run\.log\.jsonl entries/u);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("skips non-feature-delivery and unreadable state files", async () => {
    writeState(tempRoot, "172973_06-02-26", "65766_0543_other-pipeline", {
      pipelineId: "other-pipeline",
    });
    writeState(tempRoot, "172973_06-02-26", "65766_0543_active-feature");
    const badDir = path.join(tempRoot, ".pan/work", "172973_06-02-26", "65766_0543_bad-json");
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, "state.json"), "{not-json");

    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const envelopes = await getActiveRunState(tempRoot);
      expect(envelopes.map((entry) => entry.taskId)).toEqual(["65766_0543_active-feature"]);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("skips terminal tasks", async () => {
    writeState(tempRoot, "172973_06-02-26", "65766_0543_done-feature", { status: "complete", currentStage: "complete" });
    writeState(tempRoot, "172973_06-02-26", "65766_0543_active-feature");

    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const envelopes = await getActiveRunState(tempRoot);
      expect(envelopes.map((entry) => entry.taskId)).toEqual(["65766_0543_active-feature"]);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("returns attention view with reconciliation metadata", async () => {
    writeState(tempRoot, "172973_06-02-26", "65766_0543_demo-feature");
    const featureDir = path.join(tempRoot, "lib", "memory", "features", "demo-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, "index.json"),
      stringifyCompactJson({
        feature_id: "demo-feature",
        title: "Demo Feature",
        task_id: "99999_0101_shipped-demo",
        status: "indexed",
        indexed_at: "2026-06-02T12:00:00.000Z",
      }),
    );

    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const response = await GET(new Request("http://localhost/api/run-state?view=attention"));
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        tasks: Array<{ taskId: string }>;
        reconciliation: { shippedOutcomes: Array<{ taskId: string }> };
      };
      expect(payload.tasks.some((task) => task.taskId === "65766_0543_demo-feature")).toBe(true);
      expect(payload.reconciliation.shippedOutcomes[0]?.taskId).toBe("99999_0101_shipped-demo");
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("loads archived task ids from .pan/archive/work", async () => {
    const archiveDir = path.join(tempRoot, ".pan", "archive", "work", "172973_06-02-26", "88888_0101_archived");
    fs.mkdirSync(archiveDir, { recursive: true });
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const archived = await loadArchivedTaskIds(tempRoot);
      expect(archived.has("88888_0101_archived")).toBe(true);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("excludes archived and shipped tasks from attention reconciliation", () => {
    const envelopes = [
      {
        taskId: "65766_0543_demo-feature",
        runDir: ".pan/work/demo/65766_0543_demo-feature",
        stages: [{ name: "complete", ownerPersona: "librarian", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "complete" as const }],
        runEvents: [],
      },
      {
        taskId: "88888_0101_active",
        runDir: ".pan/work/demo/88888_0101_active",
        stages: [{ name: "plan", ownerPersona: "tech-lead", humanGate: "", nextHumanAction: "", nextCommand: "", humanAttention: "", status: "active" as const }],
        runEvents: [],
      },
    ];
    const filtered = excludeReconciledAttentionTasks(
      envelopes,
      new Set(["65766_0543_demo-feature"]),
      new Set(["88888_0101_other"]),
    );
    expect(filtered.map((task) => task.taskId)).toEqual(["88888_0101_active"]);
  });

  it("loads shipped outcomes from indexed feature folders", async () => {
    const featureDir = path.join(tempRoot, "lib", "memory", "features", "demo-feature");
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, "index.json"),
      stringifyCompactJson({
        feature_id: "demo-feature",
        title: "Demo Feature",
        task_id: "65766_0543_demo-feature",
        status: "indexed",
        indexed_at: "2026-06-02T12:00:00.000Z",
      }),
    );
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const outcomes = await loadShippedOutcomes(tempRoot, 3);
      expect(outcomes[0]?.featureId).toBe("demo-feature");
      expect(outcomes[0]?.title).toBe("Demo Feature");
    } finally {
      process.chdir(originalRoot);
    }
  });
});
