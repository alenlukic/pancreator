import { describe, expect, it } from "vitest";
import type { TaskRunStateEnvelope } from "@/services/run-state-shared";
import { buildTaskOverflow, gateQueueEntryLabel } from "./command-center-row-helpers";

const baseTask: TaskRunStateEnvelope = {
  taskId: "65766_0543_demo-feature",
  featureId: "demo-feature",
  runDir: ".pan/work/demo/65766_0543_demo-feature",
  inboxSource: "lib/inbox/in/demo.md",
  stages: [],
  runEvents: [],
};

describe("buildTaskOverflow", () => {
  it("maps task fields into overflow actions without exposing them on the primary row", () => {
    const overflow = buildTaskOverflow({
      ...baseTask,
      stages: [
        {
          name: "plan",
          ownerPersona: "tech-lead",
          humanGate: "human_approval",
          nextHumanAction: "Ratify plan",
          nextCommand: "pnpm -w exec pan advance 65766_0543_demo-feature --artifact touch-set.json",
          humanAttention: "",
          status: "active",
        },
      ],
    });

    expect(overflow.taskId).toBe("65766_0543_demo-feature");
    expect(overflow.runDir).toBe(".pan/work/demo/65766_0543_demo-feature");
    expect(overflow.inboxSource).toBe("lib/inbox/in/demo.md");
    expect(overflow.runCommand).toContain("pan advance");
  });
});

describe("gateQueueEntryLabel", () => {
  it("returns a human-readable label instead of raw task id", () => {
    expect(
      gateQueueEntryLabel(
        {
          taskId: "65766_0543_demo-feature",
          runDir: baseTask.runDir,
          stageName: "plan",
          ownerPersona: "tech-lead",
          humanGate: "human_approval",
          status: "active",
          humanAttention: "",
          nextHumanAction: "",
          inboxSource: baseTask.inboxSource,
        },
        [baseTask],
      ),
    ).toBe("Demo Feature");
  });

  it("falls back to generic copy when the task is missing", () => {
    expect(
      gateQueueEntryLabel(
        {
          taskId: "missing-task",
          runDir: ".pan/work/missing",
          stageName: "plan",
          ownerPersona: "tech-lead",
          humanGate: "human_approval",
          status: "active",
          humanAttention: "",
          nextHumanAction: "",
        },
        [],
      ),
    ).toBe("Feature delivery run");
  });
});
