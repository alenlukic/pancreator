import { asTaskId } from "@tesseract/core";
import { describe, expect, it } from "vitest";

import { loadActiveState, reduceJournalToState } from "./state.js";
import { InMemoryInterventionStore } from "./store.js";
import type { InterventionRecord } from "./types.js";

const tid = asTaskId("feature-1");

function rec(command: InterventionRecord["command"], partial?: Partial<InterventionRecord>): InterventionRecord {
  return {
    taskId: tid,
    command,
    atIso: "2026-04-27T12:00:00.000Z",
    ...partial,
  };
}

describe("reduceJournalToState", () => {
  it("returns running for an empty journal", () => {
    expect(reduceJournalToState([])).toBe("running");
  });

  it("returns paused when the last record is pause", () => {
    expect(reduceJournalToState([rec("pause")])).toBe("paused");
  });

  it("returns resumed when the last record is resume", () => {
    expect(reduceJournalToState([rec("pause"), rec("resume")])).toBe("resumed");
  });

  it("returns aborted when the last record is abort", () => {
    expect(reduceJournalToState([rec("pause"), rec("abort")])).toBe("aborted");
  });

  it("returns resumed when the last record is goto", () => {
    expect(reduceJournalToState([rec("goto", { gotoStage: "plan" })])).toBe("resumed");
  });
});

describe("loadActiveState", () => {
  it("delegates to the store journal", async () => {
    const store = new InMemoryInterventionStore();
    await store.appendRecord(tid, rec("pause"));
    expect(await loadActiveState(store, tid)).toBe("paused");
  });
});
