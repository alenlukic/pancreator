import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyCheckpoint, emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import { asTaskId } from "@daedaline/core";

import {
  FsLangGraphCheckpointSaver,
  type DaedalineCheckpointMetadata,
} from "./langgraph-saver.js";

let base: string;
beforeEach(() => {
  base = join(tmpdir(), `lg-ckpt-${Date.now()}-${Math.random().toString(16).slice(2)}`);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("FsLangGraphCheckpointSaver BaseCheckpointSaver conformance", () => {
  it("put, getTuple, and list round-trip checkpoint metadata", async () => {
    const saver = new FsLangGraphCheckpointSaver(base);
    const threadId = asTaskId("task-conformance-1");
    const writeConfig = { configurable: { thread_id: threadId, checkpoint_ns: "" } };
    const cp = copyCheckpoint(emptyCheckpoint());
    cp.id = "00000001-0000-4000-8000-000000000001";
    cp.ts = "2026-05-26T12:00:00.000Z";
    cp.channel_values = { messages: ["hello"] };
    const metadata: DaedalineCheckpointMetadata = {
      source: "input",
      step: -1,
      parents: {},
      run_log_offset: 42,
      worktree_commit: "abc123",
    };
    const putConfig = await saver.put(writeConfig, cp, metadata, {});
    expect(putConfig.configurable?.checkpoint_id).toBe(cp.id);

    const tuple = await saver.getTuple({
      configurable: { thread_id: threadId, checkpoint_id: cp.id },
    });
    const stored = tuple?.metadata as DaedalineCheckpointMetadata | undefined;
    expect(tuple?.checkpoint.id).toBe(cp.id);
    expect(stored?.run_log_offset).toBe(42);
    expect(stored?.worktree_commit).toBe("abc123");

    const listed: string[] = [];
    for await (const t of saver.list({ configurable: { thread_id: threadId } })) {
      listed.push(t.checkpoint.id);
    }
    expect(listed).toContain(cp.id);
  });

  it("putWrites stores pending writes retrievable via getTuple", async () => {
    const saver = new FsLangGraphCheckpointSaver(base);
    const threadId = asTaskId("task-writes-1");
    const cp = copyCheckpoint(emptyCheckpoint());
    cp.id = "00000002-0000-4000-8000-000000000002";
    const writeMetadata: DaedalineCheckpointMetadata = {
      source: "loop",
      step: 0,
      parents: {},
      run_log_offset: 0,
    };
    const config = await saver.put(
      { configurable: { thread_id: threadId } },
      cp,
      writeMetadata,
      {},
    );
    await saver.putWrites(config, [["channel", { x: 1 }]], "task-a");
    const tuple = await saver.getTuple(config);
    expect(tuple?.pendingWrites).toHaveLength(1);
    expect(tuple?.pendingWrites?.[0]?.[1]).toBe("channel");
  });

  it("deleteThread removes all checkpoints for a thread", async () => {
    const saver = new FsLangGraphCheckpointSaver(base);
    const threadId = asTaskId("task-delete-1");
    const cp = copyCheckpoint(emptyCheckpoint());
    cp.id = "00000003-0000-4000-8000-000000000003";
    const deleteMetadata: DaedalineCheckpointMetadata = {
      source: "input",
      step: -1,
      parents: {},
      run_log_offset: 0,
    };
    await saver.put({ configurable: { thread_id: threadId } }, cp, deleteMetadata, {});
    await saver.deleteThread(threadId);
    const tuple = await saver.getTuple({
      configurable: { thread_id: threadId, checkpoint_id: cp.id },
    });
    expect(tuple).toBeUndefined();
  });
});
