import type { TaskId } from "@pancreator/core";

/**
 * Checkpoint file envelope stored under `/src/memory/checkpoints/<task_id>/<seq>.json` per the run-log and PRD mapping.
 * LangGraph `BaseCheckpointSaver` mapping is a later integration step; this is the on-disk contract shape.
 */
export interface CheckpointMetadata {
  run_log_offset: number;
  /** Git commit for worktree-bound stages (LangGraph metadata extension). */
  worktree_commit?: string;
  [key: string]: unknown;
}

export interface CheckpointEnvelopeV1 {
  v: 1;
  task_id: TaskId;
  seq: number;
  created_ts: string;
  metadata: CheckpointMetadata;
  /** Opaque graph channel payload (LangGraph wiring deferred). */
  channel_values: unknown;
}

export function isCheckpointEnvelopeV1(value: unknown): value is CheckpointEnvelopeV1 {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.task_id === "string" &&
    typeof o.seq === "number" &&
    typeof o.created_ts === "string" &&
    typeof o.metadata === "object" &&
    o.metadata !== null &&
    typeof (o.metadata as CheckpointMetadata).run_log_offset === "number" &&
    "channel_values" in o
  );
}
