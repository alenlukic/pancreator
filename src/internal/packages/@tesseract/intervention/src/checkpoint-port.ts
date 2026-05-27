import type { TaskId } from "@tesseract/core";

import type { CheckpointId } from "./checkpoint-id.js";

/** Optional saver-aligned checkpoint hook; implemented by CLI wiring to `@tesseract/checkpointer-fs`. */
export interface InterventionCheckpointPort {
  persistLever(
    taskId: TaskId,
    lever: string,
    runLogOffset: number,
    fromCheckpointId?: CheckpointId,
  ): Promise<void>;
}
