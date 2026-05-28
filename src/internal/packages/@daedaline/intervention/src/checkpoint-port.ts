import type { TaskId } from "@daedaline/core";

import type { CheckpointId } from "./checkpoint-id.js";

/** Optional saver-aligned checkpoint hook; implemented by CLI wiring to `@daedaline/checkpointer-fs`. */
export interface InterventionCheckpointPort {
  persistLever(
    taskId: TaskId,
    lever: string,
    runLogOffset: number,
    fromCheckpointId?: CheckpointId,
  ): Promise<void>;
}
