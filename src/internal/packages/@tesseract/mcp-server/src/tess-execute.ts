import * as path from "node:path";
import { readFile, readdir } from "node:fs/promises";

import { asTaskId, type TaskId } from "@tesseract/core";
import { FileInbox } from "@tesseract/inbox";
import {
  FsInterventionStore,
  InterventionManager,
  type CheckpointId,
} from "@tesseract/intervention";
import { FileMemoryStore } from "@tesseract/memory";
import { isRunLogRecord } from "@tesseract/run-logger";

import { type TessToolName } from "./definitions.js";

export interface TessExecutionContext {
  readonly repoRoot: string;
}

function stubPayload(command: string, summary: string): Record<string, unknown> {
  return { command, status: "stub", summary };
}

function getString(
  args: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (args === undefined) {
    return undefined;
  }
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * Runs the same handlers that the `tess` CLI uses for `inbox`, `pause`, `resume`, and `abort`.
 * Other tools return `{ status: \"stub\", summary }` JSON payloads.
 */
export async function executeTessTool(
  name: TessToolName,
  args: Record<string, unknown> | undefined,
  ctx: TessExecutionContext,
): Promise<Record<string, unknown>> {
  const repoRoot = ctx.repoRoot;
  switch (name) {
    case "tess.inbox": {
      const inbox = new FileInbox(repoRoot);
      const entries = await inbox.listIn();
      return { command: "inbox", status: "ok", entries };
    }
    case "tess.pause": {
      const taskId = getString(args, "taskId");
      if (taskId === undefined || taskId === "") {
        throw new Error("taskId is required");
      }
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
      await mgr.pause(asTaskId(taskId));
      return { command: "pause", status: "ok", taskId };
    }
    case "tess.resume": {
      const taskId = getString(args, "taskId");
      if (taskId === undefined || taskId === "") {
        throw new Error("taskId is required");
      }
      const checkpoint = getString(args, "checkpoint") as CheckpointId | undefined;
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
      await mgr.resume(asTaskId(taskId), checkpoint);
      return {
        command: "resume",
        status: "ok",
        taskId,
        checkpointId: checkpoint ?? null,
      };
    }
    case "tess.abort": {
      const taskId = getString(args, "taskId");
      if (taskId === undefined || taskId === "") {
        throw new Error("taskId is required");
      }
      const reason = getString(args, "reason");
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
      await mgr.abort(asTaskId(taskId), reason);
      return { command: "abort", status: "ok", taskId, reason: reason ?? null };
    }
    case "tess.init":
      return stubPayload("init", "Greenfield and adopt flows land in Phase 4+.");
    case "tess.run":
      return stubPayload("run", "Pipeline execution wires through Phase 4+.");
    case "tess.feature":
      return stubPayload(
        "feature",
        "Feature workspace commands land with the delivery pipeline.",
      );
    case "tess.status":
      return stubPayload("status", "Status aggregation lands with the scheduler.");
    case "tess.approve":
      return stubPayload("approve", "Authorizer integration lands in M3+.");
    case "tess.memory":
      return stubPayload(
        "memory",
        "MemoryRouter CLI lands with FileMemoryStore hardening.",
      );
    case "tess.contracts":
      return stubPayload("contracts", "Contract runner CLI surfaces land in Phase 4+.");
    case "tess.lint":
      return stubPayload(
        "lint",
        "ESLint and policy bundles invoke from CI today; CLI wiring expands later.",
      );
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}

async function listDirNames(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir);
    return names.filter((n) => !n.startsWith(".")).sort();
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw e;
  }
}

async function listInboxNestedFiles(absRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string, dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return;
      }
      throw e;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) {
        continue;
      }
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(r, abs);
      } else {
        out.push(r.split(path.sep).join("/"));
      }
    }
  }
  await walk("", absRoot);
  return out.sort();
}

/**
 * `memory://` lists `/src/memory/<area>/` directory names. `inbox://` lists Inbox queue file names.
 * `work-run-log://<taskId>` returns `src/work/<taskId>/run.log.jsonl` as text when present.
 */
export async function readTesseractResource(
  uri: string,
  ctx: TessExecutionContext,
): Promise<{ mimeType: string; text: string }> {
  const root = path.resolve(ctx.repoRoot);

  if (uri === "memory://") {
    const memoryRoot = path.join(root, "memory");
    const areas = await listDirNames(memoryRoot);
    const store = new FileMemoryStore(memoryRoot);
    const memoryFileKeyCount = (await store.listKeys("")).length;
    return {
      mimeType: "application/json",
      text: JSON.stringify(
        { areas, root: "/src/memory/<area>/", memoryFileKeyCount },
        null,
        2,
      ),
    };
  }

  if (uri === "inbox://") {
    const inbox = new FileInbox(root);
    const [inFiles, outFiles, threadFiles] = await Promise.all([
      listInboxNestedFiles(inbox.pathIn()),
      listInboxNestedFiles(inbox.pathOut()),
      listInboxNestedFiles(inbox.pathThreads()),
    ]);
    return {
      mimeType: "application/json",
      text: JSON.stringify(
        { in: inFiles, out: outFiles, threads: threadFiles },
        null,
        2,
      ),
    };
  }

  const runLogMatch = /^work-run-log:\/\/([^/]+)\/?$/.exec(uri);
  if (runLogMatch) {
    const taskId: TaskId = asTaskId(runLogMatch[1] as string);
    const p = path.join(root, "work", taskId, "run.log.jsonl");
    const text = await readFile(p, "utf8");
    const first = text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (first !== undefined) {
      try {
        const rec = JSON.parse(first) as unknown;
        void isRunLogRecord(rec);
      } catch {
        /* first line is not JSON; the file is still returned */
      }
    }
    return { mimeType: "application/x-ndjson", text };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}
