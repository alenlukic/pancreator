import { asTaskId } from "@tesseract/core";
import { describe, expect, it } from "vitest";

import { InterventionManager } from "./manager.js";
import { InMemoryInterventionStore } from "./store.js";

describe("InterventionManager", () => {
  it("records pause, resume with checkpoint, abort with reason, and gotoStage", async () => {
    const store = new InMemoryInterventionStore();
    const levers: string[] = [];
    let t = 0;
    const manager = new InterventionManager(
      store,
      () => `2026-04-27T12:00:0${t++}.000Z`,
      {
        persistLever: async (_taskId, lever) => {
          levers.push(lever);
        },
      },
    );
    const taskId = asTaskId("t1");

    await manager.pause(taskId);
    expect(await manager.loadActiveState(taskId)).toBe("paused");

    await manager.resume(taskId, "ck-1");
    const afterResume = await store.readJournal(taskId);
    expect(afterResume[1]?.checkpointId).toBe("ck-1");
    expect(await manager.loadActiveState(taskId)).toBe("resumed");

    await manager.gotoStage(taskId, "review", "ck-2");
    const afterGoto = await store.readJournal(taskId);
    expect(afterGoto[2]?.gotoStage).toBe("review");
    expect(afterGoto[2]?.checkpointId).toBe("ck-2");

    await manager.abort(taskId, "operator");
    const afterAbort = await store.readJournal(taskId);
    expect(afterAbort[3]?.reason).toBe("operator");
    expect(await manager.loadActiveState(taskId)).toBe("aborted");
    expect(levers).toEqual(["pause", "resume", "goto:review", "abort"]);
  });
});
