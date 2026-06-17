import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { stringifyCompactJson } from "@pancreator/core";

import { assertPathInScheduler, defaultLocksDir, lockFilePath } from "./paths.js";

type LockState = {
  runIds: string[];
};

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function ensureLocksDir(repoRoot: string): Promise<string> {
  const dir = defaultLocksDir(repoRoot);
  await fsp.mkdir(dir, { recursive: true });
  const gitkeep = path.join(dir, ".gitkeep");
  if (!fs.existsSync(gitkeep)) {
    await fsp.writeFile(gitkeep, "", "utf8");
  }
  return dir;
}

async function readLockState(repoRoot: string, automationId: string): Promise<LockState> {
  const file = lockFilePath(repoRoot, automationId);
  assertPathInScheduler(repoRoot, file);
  try {
    const raw = await fsp.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as LockState).runIds)
    ) {
      return { runIds: [...(parsed as LockState).runIds] };
    }
    return { runIds: [] };
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return { runIds: [] };
    }
    throw error;
  }
}

async function writeLockState(
  repoRoot: string,
  automationId: string,
  state: LockState,
): Promise<void> {
  await ensureLocksDir(repoRoot);
  const file = lockFilePath(repoRoot, automationId);
  assertPathInScheduler(repoRoot, file);
  await fsp.writeFile(file, stringifyCompactJson(state), "utf8");
}

export type AcquireLockResult =
  | { acquired: true; runId: string }
  | { acquired: false; reason: string };

/** Acquires a concurrency slot when active runs are below `maxConcurrent`. */
export async function acquireLock(
  repoRoot: string,
  automationId: string,
  runId: string,
  maxConcurrent: number,
): Promise<AcquireLockResult> {
  const state = await readLockState(repoRoot, automationId);
  if (state.runIds.length >= maxConcurrent) {
    return {
      acquired: false,
      reason: `maxConcurrent ${maxConcurrent} reached`,
    };
  }
  state.runIds.push(runId);
  await writeLockState(repoRoot, automationId, state);
  return { acquired: true, runId };
}

/** Releases a previously acquired lock slot. */
export async function releaseLock(
  repoRoot: string,
  automationId: string,
  runId: string,
): Promise<void> {
  const state = await readLockState(repoRoot, automationId);
  const next = state.runIds.filter((id) => id !== runId);
  if (next.length === state.runIds.length) {
    return;
  }
  await writeLockState(repoRoot, automationId, { runIds: next });
}

/** Returns the number of active lock slots for `automationId`. */
export async function activeLockCount(repoRoot: string, automationId: string): Promise<number> {
  const state = await readLockState(repoRoot, automationId);
  return state.runIds.length;
}
