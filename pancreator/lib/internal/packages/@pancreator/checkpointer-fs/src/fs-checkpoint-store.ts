import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { asTaskId, stringifyRepoJson, type TaskId } from "@pancreator/core";
import { isCheckpointEnvelopeV1, type CheckpointEnvelopeV1 } from "./envelope.js";

export class FsCheckpointStore {
  /**
   * @param root - Absolute or relative path to the checkpoints root (for example `lib/memory/checkpoints` in the repo).
   */
  constructor(readonly root: string) {}

  private taskDir(taskId: TaskId): string {
    return join(this.root, taskId);
  }

  private pathFor(taskId: TaskId, seq: number): string {
    return join(this.taskDir(taskId), `${seq}.json`);
  }

  /**
   * Writes one checkpoint file atomically (write file in place; callers rely on one writer per path).
   */
  async put(envelope: CheckpointEnvelopeV1): Promise<void> {
    if (!isCheckpointEnvelopeV1(envelope)) {
      throw new TypeError("FsCheckpointStore.put: envelope is not CheckpointEnvelopeV1");
    }
    const dir = this.taskDir(asTaskId(envelope.task_id));
    await mkdir(dir, { recursive: true });
    const target = this.pathFor(asTaskId(envelope.task_id), envelope.seq);
    await writeFile(target, `${stringifyRepoJson(envelope, process.cwd())}\n`, "utf8");
  }

  /**
   * Reads one checkpoint or returns null if missing.
   */
  async get(taskId: TaskId, seq: number): Promise<CheckpointEnvelopeV1 | null> {
    const target = this.pathFor(taskId, seq);
    try {
      const raw = await readFile(target, "utf8");
      const value = JSON.parse(raw) as unknown;
      return isCheckpointEnvelopeV1(value) ? value : null;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return null;
      throw e;
    }
  }

  /**
   * Lists numeric `seq` values present on disk for a task, ascending.
   */
  async listSeq(taskId: TaskId): Promise<number[]> {
    let names: string[];
    try {
      names = await readdir(this.taskDir(taskId));
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return [];
      throw e;
    }
    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => Number.parseInt(n.replace(/\.json$/, ""), 10))
      .filter((n) => Number.isSafeInteger(n))
      .sort((a, b) => a - b);
  }
}
