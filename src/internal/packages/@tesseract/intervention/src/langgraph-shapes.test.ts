import { describe, expect, it } from "vitest";

import { commandGoto, interruptSignal, timeTravelTo } from "./langgraph-shapes.js";

describe("langgraph-shaped helpers", () => {
  it("interruptSignal returns the interrupt kind", () => {
    expect(interruptSignal()).toEqual({ kind: "tesseract.langgraph.interrupt" });
  });

  it("commandGoto carries stageId", () => {
    expect(commandGoto("implement")).toEqual({
      kind: "tesseract.langgraph.command.goto",
      stageId: "implement",
    });
  });

  it("timeTravelTo carries checkpointId", () => {
    expect(timeTravelTo("ckpt-7")).toEqual({
      kind: "tesseract.langgraph.time_travel",
      checkpointId: "ckpt-7",
    });
  });
});
