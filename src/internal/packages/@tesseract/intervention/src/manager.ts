import type { TaskId } from "@tesseract/core";

import { loadActiveState } from "./state.js";
import type { InterventionStore } from "./store.js";
import type { CheckpointId } from "./checkpoint-id.js";
import type { InterventionState } from "./types.js";

export class InterventionManager {
  constructor(
    private readonly store: InterventionStore,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async pause(taskId: TaskId): Promise<void> {
    await this.store.appendRecord(taskId, {
      taskId,
      command: "pause",
      atIso: this.clock(),
    });
  }

  async resume(taskId: TaskId, fromCheckpointId?: CheckpointId): Promise<void> {
    await this.store.appendRecord(taskId, {
      taskId,
      command: "resume",
      atIso: this.clock(),
      ...(fromCheckpointId !== undefined ? { checkpointId: fromCheckpointId } : {}),
    });
  }

  async abort(taskId: TaskId, reason?: string): Promise<void> {
    await this.store.appendRecord(taskId, {
      taskId,
      command: "abort",
      atIso: this.clock(),
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  async gotoStage(taskId: TaskId, stageId: string, fromCheckpointId?: CheckpointId): Promise<void> {
    await this.store.appendRecord(taskId, {
      taskId,
      command: "goto",
      atIso: this.clock(),
      gotoStage: stageId,
      ...(fromCheckpointId !== undefined ? { checkpointId: fromCheckpointId } : {}),
    });
  }

  async loadActiveState(taskId: TaskId): Promise<InterventionState> {
    return loadActiveState(this.store, taskId);
  }
}
