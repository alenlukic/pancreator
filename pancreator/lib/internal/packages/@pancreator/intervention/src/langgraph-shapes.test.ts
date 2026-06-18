import { describe, expect, it } from "vitest";

import { commandGoto, interruptSignal, timeTravelTo } from "./langgraph-shapes.js";

describe("langgraph-shaped helpers", () => {
  it("interruptSignal returns the interrupt kind", () => {
    expect(interruptSignal()).toEqual({ kind: "pancreator.langgraph.interrupt" });
  });

  it("commandGoto carries stageId", () => {
    expect(commandGoto("implement")).toEqual({
      kind: "pancreator.langgraph.command.goto",
      stageId: "implement",
    });
  });

  it("timeTravelTo carries checkpointId", () => {
    expect(timeTravelTo("ckpt-7")).toEqual({
      kind: "pancreator.langgraph.time_travel",
      checkpointId: "ckpt-7",
    });
  });
});
