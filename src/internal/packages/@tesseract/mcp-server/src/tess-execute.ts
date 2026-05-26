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

export interface TessDeferredEnvelope {
  readonly status: "deferred";
  readonly verb: string;
  readonly milestone: "M1" | "M2" | "M3";
  readonly tracking_intake: string;
  readonly manual_workaround: string;
}

export class TessDeferredToolError extends Error {
  readonly envelope: TessDeferredEnvelope;

  constructor(envelope: TessDeferredEnvelope) {
    super(JSON.stringify(envelope, null, 2));
    this.name = "TessDeferredToolError";
    this.envelope = envelope;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function deferredEnvelope(payload: Omit<TessDeferredEnvelope, "status">): TessDeferredEnvelope {
  return { status: "deferred", ...payload };
}

/**
 * MCP deferred-tool `tracking_intake` routing: mirror `@tesseract/cli/src/run.ts`
 * (`defaultDeferredTrackingIntake` uses the same inbox paths keyed by CLI verb /
 * MCP tool).
 */
export function deferredToolTrackingIntake(name: TessToolName): string {
  if (name === "tess.init") {
    return "src/inbox/in/172981_05-25-26/64500_0605_tess-init-and-create-tesseract-install-paths.md";
  }
  return "src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md";
}

export function tessToolEnvelope(name: TessToolName, milestone: TessDeferredEnvelope["milestone"]): TessDeferredEnvelope {
  const workaroundByTool: Record<string, string> = {
    "tess.init":
      "Bootstrap `tess init` remains deferred pending install-path convergence; scaffold the substrate manually via `docs/M1.index.md` and adopt flows until the wired command lands.",
    "tess.run":
      "Only the `feature-delivery` pipeline is executable in bootstrap Phase 4; start runs with `tess feature new <inbox-path>` followed by persona-driven `tess advance` staging.",
    "tess.feature":
      "Expose only `feature new`/`run feature-delivery` via the tess CLI shell today; MCP `tess.feature` stays deferred until the tool schema carries the richer argument surface.",
    "tess.status":
      "Provide a Phase-4 task id to `tess status <task-id>` until aggregate workspace summaries are modeled for the MCP tool.",
    "tess.approve":
      "`tess approve` stays gated on `LocalUserAuthorizer` wiring in Milestone 3 ratification; approve phase exits manually inside the supervising operator session documented in docs/PRD.md.",
    "tess.memory":
      "Prefer reading `src/memory/handbook/context-economy.md` plus explicit file reads until MemoryRouter/FileMemoryStore CLI bridging is hardened.",
    "tess.contracts":
      "Run compliance descriptors manually under `tests/compliance/` pending the consolidated contract runner surfaced as a CLI verb.",
    "tess.lint":
      "Run `pnpm lint` and the Phase-0 scaffold checks referenced in CI until this verb wraps ESLint/policy bundles uniformly.",
  };
  return deferredEnvelope({
    verb: name,
    milestone,
    tracking_intake: deferredToolTrackingIntake(name),
    manual_workaround:
      workaroundByTool[name] ??
      "Follow the workaround text in docs/PRD.md for this MCP tool until parity wiring completes.",
  });
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
 * Deferred MCP tools emit `TessDeferredToolError`, which the MCP stdio mapper surfaces as a non-success tool response carrying the deferral envelope JSON.
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
      throw new TessDeferredToolError(tessToolEnvelope("tess.init", "M3"));
    case "tess.run":
      throw new TessDeferredToolError(tessToolEnvelope("tess.run", "M2"));
    case "tess.feature":
      throw new TessDeferredToolError(tessToolEnvelope("tess.feature", "M2"));
    case "tess.status":
      throw new TessDeferredToolError(tessToolEnvelope("tess.status", "M2"));
    case "tess.approve":
      throw new TessDeferredToolError(tessToolEnvelope("tess.approve", "M3"));
    case "tess.memory":
      throw new TessDeferredToolError(tessToolEnvelope("tess.memory", "M2"));
    case "tess.contracts":
      throw new TessDeferredToolError(tessToolEnvelope("tess.contracts", "M2"));
    case "tess.lint":
      throw new TessDeferredToolError(tessToolEnvelope("tess.lint", "M1"));
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
