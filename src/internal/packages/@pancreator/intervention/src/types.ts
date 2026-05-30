import type { TaskId } from "@pancreator/core";

import type { CheckpointId } from "./checkpoint-id.js";

export type InterventionState = "running" | "paused" | "aborted" | "resumed";

export type InterventionCommand = "pause" | "resume" | "abort" | "goto";

export interface InterventionRecord {
  taskId: TaskId;
  command: InterventionCommand;
  atIso: string;
  checkpointId?: CheckpointId;
  gotoStage?: string;
  reason?: string;
}
