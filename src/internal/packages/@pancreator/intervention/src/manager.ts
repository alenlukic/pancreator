import type { TaskId } from "@pancreator/core";

import type { InterventionCheckpointPort } from "./checkpoint-port.js";
import { loadActiveState } from "./state.js";
import type { InterventionStore } from "./store.js";
import type { CheckpointId } from "./checkpoint-id.js";
import type { InterventionState } from "./types.js";

export class InterventionManager {
  constructor(
    private readonly store: InterventionStore,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly checkpointPort?: InterventionCheckpointPort,
  ) {}

  async pause(taskId: TaskId, runLogOffset = 0): Promise<void> {
    await this.store.appendRecord(taskId, {
      taskId,
      command: "pause",
      atIso: this.clock(),
    });
    await this.checkpointPort?.persistLever(taskId, "pause", runLogOffset);
  }

  async resume(taskId: TaskId, fromCheckpointId?: CheckpointId, runLogOffset = 0): Promise<void> {
    await this.store.appendRecord(taskId, {
      taskId,
      command: "resume",
      atIso: this.clock(),
      ...(fromCheckpointId !== undefined ? { checkpointId: fromCheckpointId } : {}),
    });
    await this.checkpointPort?.persistLever(taskId, "resume", runLogOffset, fromCheckpointId);
  }

  async abort(taskId: TaskId, reason?: string, runLogOffset = 0): Promise<void> {
    await this.store.appendRecord(taskId, {
      taskId,
      command: "abort",
      atIso: this.clock(),
      ...(reason !== undefined ? { reason } : {}),
    });
    await this.checkpointPort?.persistLever(taskId, "abort", runLogOffset);
  }

  async gotoStage(
    taskId: TaskId,
    stageId: string,
    fromCheckpointId?: CheckpointId,
    runLogOffset = 0,
  ): Promise<void> {
    await this.store.appendRecord(taskId, {
      taskId,
      command: "goto",
      atIso: this.clock(),
      gotoStage: stageId,
      ...(fromCheckpointId !== undefined ? { checkpointId: fromCheckpointId } : {}),
    });
    await this.checkpointPort?.persistLever(taskId, `goto:${stageId}`, runLogOffset, fromCheckpointId);
  }

  async loadActiveState(taskId: TaskId): Promise<InterventionState> {
    return loadActiveState(this.store, taskId);
  }
}
