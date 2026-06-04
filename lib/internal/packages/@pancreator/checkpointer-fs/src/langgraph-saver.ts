import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  getCheckpointId,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { asTaskId, stringifyCompactJson, stringifyRepoJson, type TaskId } from "@pancreator/core";

import { isCheckpointEnvelopeV1, type CheckpointEnvelopeV1 } from "./envelope.js";

const WRITES_DIR = "_writes";

interface StoredWrites {
  readonly taskId: string;
  readonly checkpointId: string;
  readonly writes: CheckpointPendingWrite[];
}

export interface PancreatorCheckpointMetadata extends CheckpointMetadata {
  run_log_offset?: number;
  worktree_commit?: string;
  intervention_lever?: string;
}

function threadIdFromConfig(config: RunnableConfig): TaskId {
  const threadId = config.configurable?.thread_id;
  if (typeof threadId !== "string" || threadId.trim() === "") {
    throw new Error("FsLangGraphCheckpointSaver: configurable.thread_id is required");
  }
  return asTaskId(threadId);
}

function checkpointNs(config: RunnableConfig): string {
  const ns = config.configurable?.checkpoint_ns;
  return typeof ns === "string" ? ns : "";
}

function envelopePath(root: string, taskId: TaskId, checkpointId: string): string {
  return join(root, taskId, `${checkpointId}.json`);
}

function writesPath(root: string, taskId: TaskId, checkpointId: string): string {
  return join(root, taskId, WRITES_DIR, `${checkpointId}.json`);
}

function envelopeFromPut(
  taskId: TaskId,
  seq: number,
  checkpoint: Checkpoint,
  metadata: PancreatorCheckpointMetadata,
): CheckpointEnvelopeV1 {
  const runLogOffset = metadata.run_log_offset ?? 0;
  return {
    v: 1,
    task_id: taskId,
    seq,
    created_ts: checkpoint.ts,
    metadata: {
      run_log_offset: runLogOffset,
      ...(metadata.worktree_commit !== undefined ? { worktree_commit: metadata.worktree_commit } : {}),
      ...(metadata.intervention_lever !== undefined ? { intervention_lever: metadata.intervention_lever } : {}),
    },
    channel_values: {
      langgraph_checkpoint: checkpoint,
      checkpoint_id: checkpoint.id,
      langgraph_metadata: metadata,
    },
  };
}

function checkpointFromEnvelope(envelope: CheckpointEnvelopeV1): Checkpoint | undefined {
  const cv = envelope.channel_values;
  if (cv === null || typeof cv !== "object") return undefined;
  const lg = (cv as Record<string, unknown>).langgraph_checkpoint;
  if (lg === null || typeof lg !== "object") return undefined;
  return lg as Checkpoint;
}

function metadataFromEnvelope(envelope: CheckpointEnvelopeV1): PancreatorCheckpointMetadata {
  const cv = envelope.channel_values;
  if (cv !== null && typeof cv === "object") {
    const stored = (cv as Record<string, unknown>).langgraph_metadata;
    if (stored !== null && typeof stored === "object") {
      return stored as PancreatorCheckpointMetadata;
    }
  }
  return {
    source: "update",
    step: 0,
    parents: {},
    run_log_offset: envelope.metadata.run_log_offset,
    ...(envelope.metadata.worktree_commit !== undefined
      ? { worktree_commit: envelope.metadata.worktree_commit }
      : {}),
  };
}

/**
 * LangGraph {@link BaseCheckpointSaver} backed by on-disk envelopes under `root/<task_id>/`.
 */
export class FsLangGraphCheckpointSaver extends BaseCheckpointSaver<number> {
  constructor(readonly root: string) {
    super();
  }

  private async nextSeq(taskId: TaskId): Promise<number> {
    let names: string[];
    try {
      names = await readdir(join(this.root, taskId));
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return 0;
      throw e;
    }
    const seqs = names
      .filter((n) => n.endsWith(".json") && n !== WRITES_DIR)
      .map((n) => Number.parseInt(n.replace(/\.json$/, ""), 10))
      .filter((n) => Number.isSafeInteger(n))
      .filter((n) => n >= 0);
    if (seqs.length === 0) return 0;
    return Math.max(...seqs) + 1;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const taskId = threadIdFromConfig(config);
    const checkpointId = getCheckpointId(config);
    if (!checkpointId) {
      for await (const t of this.list(config, { limit: 1 })) {
        return t;
      }
      return undefined;
    }
    const target = envelopePath(this.root, taskId, checkpointId);
    let raw: string;
    try {
      raw = await readFile(target, "utf8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return undefined;
      throw e;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isCheckpointEnvelopeV1(parsed)) return undefined;
    const checkpoint = checkpointFromEnvelope(parsed);
    if (!checkpoint) return undefined;
    let pendingWrites: CheckpointPendingWrite[] | undefined;
    try {
      const wraw = await readFile(writesPath(this.root, taskId, checkpointId), "utf8");
      const stored = JSON.parse(wraw) as StoredWrites;
      pendingWrites = stored.writes;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
    }
    return {
      config: {
        configurable: {
          thread_id: taskId,
          checkpoint_ns: checkpointNs(config),
          checkpoint_id: checkpointId,
        },
      },
      checkpoint,
      metadata: metadataFromEnvelope(parsed),
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const taskId = threadIdFromConfig(config);
    const { limit, before, filter } = options ?? {};
    let names: string[];
    try {
      names = await readdir(join(this.root, taskId));
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;
      throw e;
    }
    const ids = names
      .filter((n) => n.endsWith(".json") && !n.startsWith("_"))
      .map((n) => n.replace(/\.json$/, ""))
      .sort((a, b) => b.localeCompare(a));
    let remaining = limit ?? Number.POSITIVE_INFINITY;
    for (const checkpointId of ids) {
      if (before?.configurable?.checkpoint_id && checkpointId >= before.configurable.checkpoint_id) {
        continue;
      }
      const tuple = await this.getTuple({
        configurable: {
          thread_id: taskId,
          checkpoint_id: checkpointId,
          checkpoint_ns: checkpointNs(config),
        },
      });
      if (!tuple) continue;
      if (filter) {
        const md = tuple.metadata ?? {};
        if (!Object.entries(filter).every(([k, v]) => (md as Record<string, unknown>)[k] === v)) {
          continue;
        }
      }
      yield tuple;
      remaining -= 1;
      if (remaining <= 0) break;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const taskId = threadIdFromConfig(config);
    const checkpointId = checkpoint.id;
    const seq = await this.nextSeq(taskId);
    const ddlMeta = metadata as PancreatorCheckpointMetadata;
    const envelope = envelopeFromPut(taskId, seq, copyCheckpoint(checkpoint), ddlMeta);
    const target = envelopePath(this.root, taskId, checkpointId);
    await mkdir(join(this.root, taskId), { recursive: true });
    await writeFile(target, `${stringifyRepoJson(envelope, process.cwd())}\n`, "utf8");
    return {
      configurable: {
        thread_id: taskId,
        checkpoint_ns: checkpointNs(config),
        checkpoint_id: checkpointId,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const thread = threadIdFromConfig(config);
    const checkpointId = getCheckpointId(config);
    if (!checkpointId) {
      throw new Error("FsLangGraphCheckpointSaver.putWrites: checkpoint_id is required");
    }
    const pending: CheckpointPendingWrite[] = writes.map(([channel, value]) => [
      taskId,
      channel,
      value,
    ]);
    const target = writesPath(this.root, thread, checkpointId);
    await mkdir(join(this.root, thread, WRITES_DIR), { recursive: true });
    const stored: StoredWrites = { taskId, checkpointId, writes: pending };
    await writeFile(target, `${stringifyCompactJson(stored)}\n`, "utf8");
  }

  async deleteThread(threadId: string): Promise<void> {
    await rm(join(this.root, threadId), { recursive: true, force: true });
  }
}
