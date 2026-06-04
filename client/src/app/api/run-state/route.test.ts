import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringifyCompactJson } from "@/lib/json-io";
import { GET } from "@/app/api/run-state/route";
import { getActiveRunState, parseRunLogFile, synthesizeStageCells } from "@/services/run-state";

function writeState(
  root: string,
  dayBucket: string,
  taskId: string,
  overrides: Record<string, unknown> = {},
): void {
  const runDir = path.join(root, "work", dayBucket, taskId);
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
      runDir: `work/${dayBucket}/${taskId}`,
      stateFile: `work/${dayBucket}/${taskId}/state.json`,
      handoffFile: `work/${dayBucket}/${taskId}/handoff.md`,
      runLogFile: `work/${dayBucket}/${taskId}/run.log.jsonl`,
    },
    stages: [
      { id: "intake", persona: "intake-analyst", label: "Intake", status: "complete", humanGate: "human_approval" },
      { id: "plan", persona: "tech-lead", label: "Plan", status: "ready", humanGate: "human_approval" },
      { id: "implement", persona: "coder", label: "Implement", status: "pending" },
      { id: "review", persona: "reviewer", label: "Review", status: "pending" },
      { id: "test", persona: "qa-tester", label: "Test", status: "pending" },
      { id: "report", persona: "tech-writer", label: "Report", status: "pending" },
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
    fs.mkdirSync(path.join(tempRoot, "work"), { recursive: true });
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

  it("returns one envelope with nine stages for an active task", async () => {
    writeState(tempRoot, "172973_06-02-26", "65766_0543_demo-feature");
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const envelopes = await getActiveRunState(tempRoot);
      expect(envelopes).toHaveLength(1);
      expect(envelopes[0].taskId).toBe("65766_0543_demo-feature");
      expect(envelopes[0].decodedTimestamp).toBe("2026-06-02 05:43 UTC");
      expect(envelopes[0].stages).toHaveLength(9);
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
        runDir: "work/172973_06-02-26/65766_0543_pan-stage-feature",
        runLogFile: "work/172973_06-02-26/65766_0543_pan-stage-feature/run.log.jsonl",
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
        "pnpm -w exec pan advance 65766_0543_pan-stage-feature --event must_fix --artifact work/demo/review.md",
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
          runDir: "work/demo",
          runLogFile: "work/demo/run.log.jsonl",
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
    expect(cells.find((stage) => stage.name === "intake")?.nextHumanAction).toBe("Intake ratified");
  });

  it("marks blocked stages as failed with humanAttention", () => {
    const cells = synthesizeStageCells(
      {
        taskId: "65766_0543_blocked-feature",
        status: "ready_for_stage_delegation",
        currentStage: "review",
        nextHumanAction: "Review blocked",
        artifacts: {
          runDir: "work/demo",
          runLogFile: "work/demo/run.log.jsonl",
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
      nextHumanAction: "Address must_fix findings",
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

  it("parses run.log.jsonl in reverse-chronological order", async () => {
    const runDir = path.join(tempRoot, "work", "172973_06-02-26", "65766_0543_log-feature");
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
    const runDir = path.join(tempRoot, "work", "172973_06-02-26", "65766_0543_no-log-feature");
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
    const badDir = path.join(tempRoot, "work", "172973_06-02-26", "65766_0543_bad-json");
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
});
