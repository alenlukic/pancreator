import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyRepoJson } from "@pancreator/core";

import { WorktreePoolError } from "./errors.js";

export const WORKTREE_POOL_STATE_VERSION = 1 as const;

export interface WorktreeSlotRecord {
  path: string;
  createdAtIso: string;
}

export interface WorktreePoolStateV1 {
  version: typeof WORKTREE_POOL_STATE_VERSION;
  activeTaskId: string | null;
  slots: Record<string, WorktreeSlotRecord>;
}

export function emptyPoolState(): WorktreePoolStateV1 {
  return {
    version: WORKTREE_POOL_STATE_VERSION,
    activeTaskId: null,
    slots: {},
  };
}

function assertPoolShape(parsed: unknown): WorktreePoolStateV1 {
  if (typeof parsed !== "object" || parsed === null) {
    throw new WorktreePoolError("Pool state file does not contain a JSON object.");
  }
  const o = parsed as Record<string, unknown>;
  if (o.version !== WORKTREE_POOL_STATE_VERSION) {
    throw new WorktreePoolError("Pool state file version is not supported.");
  }
  if (o.activeTaskId !== null && typeof o.activeTaskId !== "string") {
    throw new WorktreePoolError("Pool state activeTaskId must be a string or null.");
  }
  if (typeof o.slots !== "object" || o.slots === null || Array.isArray(o.slots)) {
    throw new WorktreePoolError("Pool state slots must be an object.");
  }
  const slots: Record<string, WorktreeSlotRecord> = {};
  for (const [id, rec] of Object.entries(o.slots)) {
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
    throw new WorktreePoolError("Pool state must record at most one worktree slot for MVP.");
  }
  const active = o.activeTaskId as string | null;
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
    version: WORKTREE_POOL_STATE_VERSION,
    activeTaskId: active,
    slots,
  };
}

export async function readPoolState(filePath: string): Promise<WorktreePoolStateV1> {
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
  state: WorktreePoolStateV1,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${stringifyRepoJson(state, process.cwd())}\n`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, filePath);
}
