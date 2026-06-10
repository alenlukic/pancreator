import { describe, expect, it } from "vitest";
import {
  buildRecentActivityPreview,
  classifyHangingTask,
  COMMAND_CENTER_LONG_RUNNING_STAGE_MS,
  COMMAND_CENTER_STALE_HEARTBEAT_MS,
  compareBySeverity,
  featureDisplayLabel,
  featureIdToDisplayLabel,
  hasRetryLimitFailure,
  humanGateSeverity,
  runEventActorLabel,
  runEventDisplayLabel,
  type RunLogEvent,
  type TaskRunStateEnvelope,
} from "@/services/run-state-shared";
import { buildCommandCenterRows, mapComplianceResultsToFindings } from "./command-center-data";

const baseStages = [
  "intake",
  "plan",
  "implement",
  "review",
  "test",
  "report",
  "compliance",
  "ship",
  "index",
  "complete",
].map((name) => ({
  name,
  ownerPersona: "coder",
  humanGate: "",
  nextHumanAction: "",
  nextCommand: "",
  humanAttention: "",
  status: "pending" as const,
}));

function makeTask(overrides: Partial<TaskRunStateEnvelope> = {}): TaskRunStateEnvelope {
  return {
    taskId: "65766_0543_demo-feature",
    featureId: "demo-feature",
    runDir: ".pan/work/demo/65766_0543_demo-feature",
    stages: baseStages.map((stage) =>
      stage.name === "plan"
        ? {
            ...stage,
            humanGate: "human_approval",
            status: "active" as const,
            nextHumanAction: "Ratify plan",
          }
        : stage,
    ),
    runEvents: [
      {
        timestamp: "2026-06-02T12:00:00.000Z",
        event: "tech-lead",
        message: "tech-lead · plan: success",
        stageId: "plan",
      },
    ],
    ...overrides,
  };
}

describe("featureDisplayLabel", () => {
  it("titles from featureId slug instead of raw task id", () => {
    expect(featureIdToDisplayLabel("command-center-operational-state-surface")).toBe(
      "Command Center Operational State Surface",
    );
    expect(featureDisplayLabel(makeTask())).toBe("Demo Feature");
  });
});

describe("compareBySeverity", () => {
  it("sorts Blocking and Critical above Info", () => {
    const ordered = [
      { severity: "Info" as const },
      { severity: "Critical" as const },
      { severity: "Blocking" as const },
      { severity: "Warning" as const },
    ].sort(compareBySeverity);
    expect(ordered.map((row) => row.severity)).toEqual([
      "Critical",
      "Blocking",
      "Warning",
      "Info",
    ]);
  });
});

describe("classifyHangingTask", () => {
  it("detects stale heartbeat when last event exceeds threshold", () => {
    const nowMs = Date.parse("2026-06-02T13:00:00.000Z");
    const task = makeTask({
      runEvents: [
        {
          timestamp: new Date(nowMs - COMMAND_CENTER_STALE_HEARTBEAT_MS - 1000).toISOString(),
          event: "heartbeat",
          message: "heartbeat",
          stageId: "plan",
        },
      ],
    });
    const result = classifyHangingTask(task, nowMs);
    expect(result?.kind).toBe("stale-heartbeat");
  });

  it("detects long-running active stages", () => {
    const nowMs = Date.parse("2026-06-02T13:00:00.000Z");
    const task = makeTask({
      runEvents: [
        {
          timestamp: new Date(nowMs - COMMAND_CENTER_LONG_RUNNING_STAGE_MS - 1000).toISOString(),
          event: "coder",
          message: "coder · plan: running",
          stageId: "plan",
        },
        {
          timestamp: new Date(nowMs - 2 * 60 * 1000).toISOString(),
          event: "heartbeat",
          message: "heartbeat",
          stageId: "plan",
        },
      ],
    });
    const result = classifyHangingTask(task, nowMs);
    expect(result?.kind).toBe("long-running-stage");
  });
});

describe("buildCommandCenterRows", () => {
  it("builds six card regions with needs-you sorted by severity", () => {
    const criticalTask = makeTask({
      taskId: "88888_1200_critical",
      featureId: "critical-feature",
      stages: baseStages.map((stage) =>
        stage.name === "review"
          ? { ...stage, status: "failed" as const }
          : stage.name === "plan"
            ? { ...stage, humanGate: "", status: "complete" as const }
            : stage.name === "implement"
              ? { ...stage, status: "active" as const }
              : stage,
      ),
      runEvents: [
        {
          timestamp: "2026-06-02T12:00:00.000Z",
          event: "must_fix",
          message: "review failed",
          stageId: "review",
          retryBadge: true,
        },
      ],
    });

    const cards = buildCommandCenterRows({
      tasks: [makeTask(), criticalTask],
      complianceFindings: [],
      automationRows: [],
      activityEvents: buildRecentActivityPreview([makeTask()], 10),
      nowMs: Date.parse("2026-06-02T13:00:00.000Z"),
    });

    expect(cards).toHaveLength(6);
    expect(cards.map((card) => card.testId)).toEqual([
      "command-center-needs-you",
      "command-center-running-now",
      "command-center-compliance-issues",
      "command-center-hanging-tasks",
      "command-center-recent-automations",
      "command-center-recent-activity",
    ]);

    const needsYou = cards.find((card) => card.region === "needs-you");
    expect(needsYou?.rows.length).toBeGreaterThan(0);
    expect(needsYou?.rows[0]?.severity).toBe("Critical");
    expect(needsYou?.rows[0]?.primaryCta.label).toBe("Open mission control");
  });

  it("maps failed compliance results to findings rows", () => {
    const findings = mapComplianceResultsToFindings([
      {
        id: "json-formatting",
        pass: false,
        severity: "high",
        blocks: true,
        detail: "Missing artifact in touch-set",
      },
    ]);
    expect(findings[0]?.missingArtifact).toBe(true);
    expect(findings[0]?.severity).toBe("Blocking");
  });
});

describe("hasRetryLimitFailure", () => {
  it("returns true when active stage failed with retry badge events", () => {
    const task = makeTask({
      stages: baseStages.map((stage) =>
        stage.name === "review"
          ? { ...stage, status: "failed" as const }
          : stage.name === "plan"
            ? { ...stage, humanGate: "", status: "complete" as const }
            : stage,
      ),
      runEvents: [
        {
          timestamp: "2026-06-02T12:00:00.000Z",
          event: "must_fix",
          message: "review failed",
          retryBadge: true,
        },
      ],
    });
    expect(hasRetryLimitFailure(task)).toBe(true);
  });
});

describe("humanGateSeverity", () => {
  it("returns Blocking when human attention is set", () => {
    expect(
      humanGateSeverity({
        taskId: "t",
        runDir: ".pan/work/t",
        stageName: "plan",
        ownerPersona: "tech-lead",
        humanGate: "human_approval",
        status: "active",
        humanAttention: "Ratify plan",
        nextHumanAction: "",
      }),
    ).toBe("Blocking");
  });
});

describe("runEventDisplayLabel", () => {
  it("maps pipeline messages to operator-facing stage labels", () => {
    const event: RunLogEvent = {
      timestamp: "2026-06-02T12:00:00.000Z",
      event: "plan",
      message: "tech-lead · plan: success",
      stageId: "plan",
    };
    expect(runEventDisplayLabel(event)).toBe("Plan stage completed");
    expect(runEventActorLabel(event)).toBe("Tech Lead");
  });

  it("never exposes dot-separated internal event slugs in primary labels", () => {
    const event: RunLogEvent = {
      timestamp: "2026-06-02T12:00:00.000Z",
      event: "cursor.runner",
      message: "coder · cursor.runner: running",
      name: "cursor.runner",
      stageId: "implement",
    };
    const label = runEventDisplayLabel(event);
    expect(label).not.toMatch(/\./u);
    expect(label).toBe("Agent stage run started");
    expect(runEventActorLabel(event)).toBe("Coder");
  });
});

describe("buildRecentActivityPreview", () => {
  it("uses human-readable labels and keeps internal slugs out of row copy", () => {
    const preview = buildRecentActivityPreview(
      [
        makeTask({
          runEvents: [
            {
              timestamp: "2026-06-02T12:00:00.000Z",
              event: "reviewer.complete",
              message: "reviewer · review: success",
              name: "reviewer.complete",
              stageId: "review",
            },
          ],
        }),
      ],
      10,
    );

    expect(preview[0]?.label).toBe("Review stage completed");
    expect(preview[0]?.label).not.toMatch(/\./u);
    expect(preview[0]?.actor).toBe("Reviewer");
  });
});

describe("buildCommandCenterRows activity region", () => {
  it("renders recent activity rows without internal slug suffixes", () => {
    const cards = buildCommandCenterRows({
      tasks: [makeTask()],
      complianceFindings: [],
      automationRows: [],
      activityEvents: buildRecentActivityPreview(
        [
          makeTask({
            runEvents: [
              {
                timestamp: "2026-06-02T12:00:00.000Z",
                event: "cursor.runner",
                message: "coder · implement: running",
                name: "cursor.runner",
                stageId: "implement",
              },
            ],
          }),
        ],
        10,
      ),
      nowMs: Date.parse("2026-06-02T13:00:00.000Z"),
    });

    const activity = cards.find((card) => card.region === "recent-activity");
    expect(activity?.rows[0]?.label).toContain("Implement stage started");
    expect(activity?.rows[0]?.label).not.toMatch(/cursor\.runner/u);
    expect(activity?.rows[0]?.metaHint).toBe("Coder");
    expect(activity?.rows[0]?.overflow.stageName).toBe("implement");
  });

  it("keeps pipeline stage slugs out of default row meta for operational cards", () => {
    const gatedTask = makeTask();
    const runningTask = makeTask({
      taskId: "88888_1200_running",
      featureId: "running-feature",
      stages: baseStages.map((stage) =>
        stage.name === "plan"
          ? { ...stage, humanGate: "", status: "complete" as const }
          : stage.name === "test"
            ? { ...stage, status: "active" as const }
            : stage,
      ),
    });

    const cards = buildCommandCenterRows({
      tasks: [gatedTask, runningTask],
      complianceFindings: [],
      automationRows: [],
      activityEvents: [],
      nowMs: Date.parse("2026-06-02T13:00:00.000Z"),
    });

    const running = cards.find((card) => card.region === "running-now");
    expect(running?.rows[0]?.metaHint).toBeUndefined();
    expect(running?.rows[0]?.overflow.stageName).toBe("test");

    const needsYou = cards.find((card) => card.region === "needs-you");
    expect(needsYou?.rows.every((row) => row.metaHint === undefined)).toBe(true);
    expect(needsYou?.rows[0]?.overflow.stageName).toBe("plan");
  });
});
