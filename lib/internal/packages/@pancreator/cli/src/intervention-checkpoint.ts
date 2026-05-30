import { randomUUID } from "node:crypto";
import path from "node:path";

import type { RunnableConfig } from "@langchain/core/runnables";
import { copyCheckpoint, emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import type { TaskId } from "@pancreator/core";
import {
  FsLangGraphCheckpointSaver,
  type PancreatorCheckpointMetadata,
} from "@pancreator/checkpointer-fs";
import type { CheckpointId, InterventionCheckpointPort } from "@pancreator/intervention";

export function createInterventionCheckpointPort(repoRoot: string): InterventionCheckpointPort {
  const saver = new FsLangGraphCheckpointSaver(path.join(repoRoot, "lib", "memory", "checkpoints"));
  return {
    async persistLever(
      taskId: TaskId,
      lever: string,
      runLogOffset: number,
      fromCheckpointId?: CheckpointId,
    ): Promise<void> {
      const cp = copyCheckpoint(emptyCheckpoint());
      cp.id = randomUUID();
      cp.ts = new Date().toISOString();
      cp.channel_values = { intervention_lever: lever };
      const config: RunnableConfig = { configurable: { thread_id: taskId } };
      if (fromCheckpointId) {
        (config.configurable as Record<string, string>).checkpoint_id = fromCheckpointId;
      }
      const metadata: PancreatorCheckpointMetadata = {
        source: "update",
        step: 0,
        parents: {},
        run_log_offset: runLogOffset,
        intervention_lever: lever,
      };
      await saver.put(config, cp, metadata, {});
    },
  };
}
