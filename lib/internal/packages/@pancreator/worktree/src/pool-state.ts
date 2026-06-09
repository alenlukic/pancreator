import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyRepoJson } from "@pancreator/core";

import { WorktreePoolError } from "./errors.js";

export const WORKTREE_POOL_STATE_VERSION = 2 as const;
export const WORKTREE_POOL_STATE_VERSION_V1 = 1 as const;

export interface WorktreeSlotRecord {
  path: string;
  createdAtIso: string;
  branch?: string;
}

export interface WorktreePoolStateV2 {
  version: typeof WORKTREE_POOL_STATE_VERSION;
  maxConcurrent: number;
  activeTaskIds: string[];
  slots: Record<string, WorktreeSlotRecord>;
}

/** @deprecated v1 shape; readPoolState migrates to v2 on load. */
export interface WorktreePoolStateV1 {
  version: typeof WORKTREE_POOL_STATE_VERSION_V1;
  activeTaskId: string | null;
  slots: Record<string, WorktreeSlotRecord>;
}

export type WorktreePoolState = WorktreePoolStateV2;

export function emptyPoolState(maxConcurrent = 1): WorktreePoolStateV2 {
  return {
    version: WORKTREE_POOL_STATE_VERSION,
    maxConcurrent,
    activeTaskIds: [],
    slots: {},
  };
}

function migrateV1ToV2(v1: WorktreePoolStateV1): WorktreePoolStateV2 {
  const activeTaskIds =
    v1.activeTaskId !== null && v1.slots[v1.activeTaskId] !== undefined ? [v1.activeTaskId] : [];
  return {
    version: WORKTREE_POOL_STATE_VERSION,
    maxConcurrent: 1,
    activeTaskIds,
    slots: { ...v1.slots },
  };
}

function assertV2Shape(parsed: Record<string, unknown>): WorktreePoolStateV2 {
  if (parsed.version !== WORKTREE_POOL_STATE_VERSION) {
    throw new WorktreePoolError("Pool state file version is not supported.");
  }
  if (typeof parsed.maxConcurrent !== "number" || parsed.maxConcurrent < 1) {
    throw new WorktreePoolError("Pool state maxConcurrent must be a positive number.");
  }
  if (!Array.isArray(parsed.activeTaskIds)) {
    throw new WorktreePoolError("Pool state activeTaskIds must be an array.");
  }
  const activeTaskIds = parsed.activeTaskIds as unknown[];
  for (const id of activeTaskIds) {
    if (typeof id !== "string") {
      throw new WorktreePoolError("Pool state activeTaskIds must contain strings.");
    }
  }
  if (typeof parsed.slots !== "object" || parsed.slots === null || Array.isArray(parsed.slots)) {
    throw new WorktreePoolError("Pool state slots must be an object.");
  }
  const slots: Record<string, WorktreeSlotRecord> = {};
  for (const [id, rec] of Object.entries(parsed.slots as Record<string, unknown>)) {
    if (typeof rec !== "object" || rec === null) {
      throw new WorktreePoolError(`Pool state slot ${id} is not an object.`);
    }
    const r = rec as Record<string, unknown>;
    if (typeof r.path !== "string" || typeof r.createdAtIso !== "string") {
      throw new WorktreePoolError(`Pool state slot ${id} is missing path or createdAtIso.`);
    }
    slots[id] = {
      path: r.path,
      createdAtIso: r.createdAtIso,
      ...(typeof r.branch === "string" ? { branch: r.branch } : {}),
    };
  }
  const maxConcurrent = parsed.maxConcurrent as number;
  const active = activeTaskIds as string[];
  if (active.length > maxConcurrent) {
    throw new WorktreePoolError("Pool state activeTaskIds exceeds maxConcurrent.");
  }
  for (const id of active) {
    if (slots[id] === undefined) {
      throw new WorktreePoolError(`Pool state lists active task ${id} without a slot.`);
    }
  }
  return {
    version: WORKTREE_POOL_STATE_VERSION,
    maxConcurrent,
    activeTaskIds: active,
    slots,
  };
}

function assertV1Shape(parsed: Record<string, unknown>): WorktreePoolStateV1 {
  if (parsed.version !== WORKTREE_POOL_STATE_VERSION_V1) {
    throw new WorktreePoolError("Pool state file version is not supported.");
  }
  if (parsed.activeTaskId !== null && typeof parsed.activeTaskId !== "string") {
    throw new WorktreePoolError("Pool state activeTaskId must be a string or null.");
  }
  if (typeof parsed.slots !== "object" || parsed.slots === null || Array.isArray(parsed.slots)) {
    throw new WorktreePoolError("Pool state slots must be an object.");
  }
  const slots: Record<string, WorktreeSlotRecord> = {};
  for (const [id, rec] of Object.entries(parsed.slots as Record<string, unknown>)) {
    if (typeof rec !== "object" || rec === null) {
      throw new WorktreePoolError(`Pool state slot ${id} is not an object.`);
    }
    const r = rec as Record<string, unknown>;
    if (typeof r.path !== "string" || typeof r.createdAtIso !== "string") {
      throw new WorktreePoolError(`Pool state slot ${id} is missing path or createdAtIso.`);
    }
    slots[id] = { path: r.path, createdAtIso: r.createdAtIso };
  }
  const keys = Object.keys(slots);
  if (keys.length > 1) {
    throw new WorktreePoolError("Pool state v1 must record at most one worktree slot.");
  }
  const active = parsed.activeTaskId as string | null;
  if (keys.length === 1) {
    const only = keys[0]!;
    if (active === null || active !== only) {
      throw new WorktreePoolError(
        "Pool state must set activeTaskId to the sole slot task id when one slot exists.",
      );
    }
  }
  if (keys.length === 0 && active !== null) {
    throw new WorktreePoolError("Pool state lists activeTaskId but no slots.");
  }
  return {
    version: WORKTREE_POOL_STATE_VERSION_V1,
    activeTaskId: active,
    slots,
  };
}

function assertPoolShape(parsed: unknown): WorktreePoolStateV2 {
  if (typeof parsed !== "object" || parsed === null) {
    throw new WorktreePoolError("Pool state file does not contain a JSON object.");
  }
  const o = parsed as Record<string, unknown>;
  if (o.version === WORKTREE_POOL_STATE_VERSION_V1) {
    return migrateV1ToV2(assertV1Shape(o));
  }
  return assertV2Shape(o);
}

export async function readPoolState(filePath: string): Promise<WorktreePoolStateV2> {
  try {
    const raw = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new WorktreePoolError("Pool state file is not valid JSON.");
    }
    return assertPoolShape(parsed);
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      return emptyPoolState();
    }
    throw e;
  }
}

export async function writePoolStateAtomic(
  filePath: string,
  state: WorktreePoolStateV2,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const body = `${stringifyRepoJson(state, process.cwd())}\n`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, filePath);
}
