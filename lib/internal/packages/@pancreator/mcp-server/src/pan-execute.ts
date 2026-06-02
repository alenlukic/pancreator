import * as path from "node:path";
import { readFile, readdir } from "node:fs/promises";

import { asTaskId, type TaskId } from "@pancreator/core";
import { FileInbox } from "@pancreator/inbox";
import {
  FsInterventionStore,
  InterventionManager,
  type CheckpointId,
} from "@pancreator/intervention";
import { FileMemoryStore } from "@pancreator/memory";
import { isRunLogRecord } from "@pancreator/run-logger";

import { type DdlToolName } from "./definitions.js";
import {
  findWorkFile,
  listFeatureSummaries,
  queryMemory,
  readWorkspaceStatus,
  showFeature,
} from "./pan-read-handlers.js";

export interface DdlExecutionContext {
  readonly repoRoot: string;
}

export interface DdlDeferredEnvelope {
  readonly status: "deferred";
  readonly verb: string;
  readonly milestone: "M1" | "M2" | "M3";
  readonly tracking_intake: string;
  readonly manual_workaround: string;
}

export class DdlDeferredToolError extends Error {
  readonly envelope: DdlDeferredEnvelope;

  constructor(envelope: DdlDeferredEnvelope) {
    super(JSON.stringify(envelope, null, 2));
    this.name = "DdlDeferredToolError";
    this.envelope = envelope;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function deferredEnvelope(payload: Omit<DdlDeferredEnvelope, "status">): DdlDeferredEnvelope {
  return { status: "deferred", ...payload };
}

/**
 * MCP deferred-tool `tracking_intake` routing: mirror `@pancreator/cli/lib/run.ts`
 * (`defaultDeferredTrackingIntake` uses the same inbox paths keyed by CLI verb /
 * MCP tool).
 */
export function deferredToolTrackingIntake(name: DdlToolName): string {
  if (name === "pan.init") {
    return "lib/inbox/in/172981_05-25-26/64500_0605_pan-init-and-create-pancreator-install-paths.md";
  }
  return "lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md";
}

export function ddlToolEnvelope(name: DdlToolName, milestone: DdlDeferredEnvelope["milestone"]): DdlDeferredEnvelope {
  const workaroundByTool: Record<string, string> = {
    "pan.init":
      "Bootstrap `pan init` remains deferred pending install-path convergence; scaffold the substrate manually via `docs/M1.index.md` and adopt flows until the wired command lands.",
    "pan.run":
      "Only the `feature-delivery` pipeline is executable in bootstrap Phase 4; start runs with `pan feature new <inbox-path>` followed by persona-driven `pan advance` staging.",
    "pan.feature":
      "Expose only `feature new`/`run feature-delivery` via the pan CLI shell today; MCP `pan.feature` stays deferred until the tool schema carries the richer argument surface.",
    "pan.status":
      "Provide a Phase-4 task id to `pan status <task-id>` until aggregate workspace summaries are modeled for the MCP tool.",
    "pan.approve":
      "`pan approve` stays gated on `LocalUserAuthorizer` wiring in Milestone 3 ratification; approve phase exits manually inside the supervising operator session documented in docs/PRD.md.",
    "pan.memory":
      "Prefer reading `lib/memory/handbook/context-economy.md` plus explicit file reads until MemoryRouter/FileMemoryStore CLI bridging is hardened.",
    "pan.contracts":
      "Run compliance descriptors manually under `tests/compliance/` pending the consolidated contract runner surfaced as a CLI verb.",
    "pan.lint":
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

function asToolRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Runs the same handlers that the `pan` CLI uses for `inbox`, `pause`, `resume`, and `abort`.
 * Deferred MCP tools emit `DdlDeferredToolError`, which the MCP stdio mapper surfaces as a non-success tool response carrying the deferral envelope JSON.
 */
export async function executeDdlTool(
  name: DdlToolName,
  args: Record<string, unknown> | undefined,
  ctx: DdlExecutionContext,
): Promise<Record<string, unknown>> {
  const repoRoot = ctx.repoRoot;
  switch (name) {
    case "pan.inbox": {
      const inbox = new FileInbox(repoRoot);
      const entries = await inbox.listIn();
      return { command: "inbox", status: "ok", entries };
    }
    case "pan.pause": {
      const taskId = getString(args, "taskId");
      if (taskId === undefined || taskId === "") {
        throw new Error("taskId is required");
      }
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
      await mgr.pause(asTaskId(taskId));
      return { command: "pause", status: "ok", taskId };
    }
    case "pan.resume": {
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
    case "pan.abort": {
      const taskId = getString(args, "taskId");
      if (taskId === undefined || taskId === "") {
        throw new Error("taskId is required");
      }
      const reason = getString(args, "reason");
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
      await mgr.abort(asTaskId(taskId), reason);
      return { command: "abort", status: "ok", taskId, reason: reason ?? null };
    }
    case "pan.init":
      throw new DdlDeferredToolError(ddlToolEnvelope("pan.init", "M3"));
    case "pan.run":
      throw new DdlDeferredToolError(ddlToolEnvelope("pan.run", "M2"));
    case "pan.feature": {
      const action = getString(args, "action") ?? "list";
      if (action === "list") {
        return asToolRecord(await listFeatureSummaries({ repoRoot }));
      }
      if (action === "show") {
        const featureId = getString(args, "featureId");
        if (featureId === undefined || featureId === "") {
          throw new Error("featureId is required when action is show");
        }
        const result = await showFeature({ repoRoot }, featureId);
        if (result.status === "error") {
          throw new Error(result.error);
        }
        return asToolRecord(result);
      }
      throw new Error(`Unsupported pan.feature action: ${action}`);
    }
    case "pan.status": {
      const taskId = getString(args, "taskId");
      const result = await readWorkspaceStatus({ repoRoot }, taskId);
      if (result.status === "error") {
        throw new Error(result.error);
      }
      return asToolRecord(result);
    }
    case "pan.approve":
      throw new DdlDeferredToolError(ddlToolEnvelope("pan.approve", "M3"));
    case "pan.memory": {
      const query = getString(args, "query");
      if (query === undefined || query === "") {
        throw new Error("query is required");
      }
      return asToolRecord(await queryMemory({ repoRoot }, query));
    }
    case "pan.contracts":
      throw new DdlDeferredToolError(ddlToolEnvelope("pan.contracts", "M2"));
    case "pan.lint":
      throw new DdlDeferredToolError(ddlToolEnvelope("pan.lint", "M1"));
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
 * `memory://` lists `/lib/memory/<area>/` directory names. `inbox://` lists Inbox queue file names.
 * `work-run-log://<taskId>` returns `work/<day>/<taskId>/run.log.jsonl` as text when present.
 */
export async function readPancreatorResource(
  uri: string,
  ctx: DdlExecutionContext,
): Promise<{ mimeType: string; text: string }> {
  const root = path.resolve(ctx.repoRoot);

  if (uri === "memory://") {
    const memoryRoot = path.join(root, "lib", "memory");
    const areas = await listDirNames(memoryRoot);
    const store = new FileMemoryStore(memoryRoot);
    const memoryFileKeyCount = (await store.listKeys("")).length;
    return {
      mimeType: "application/json",
      text: JSON.stringify(
        { areas, root: "/lib/memory/<area>/", memoryFileKeyCount },
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
    const resolved = await findWorkFile(root, taskId, "run.log.jsonl");
    if (resolved === null) {
      throw new Error(
        `Run log not found for task ${taskId} under work/<day>/${taskId}/run.log.jsonl or archive/work/<day>/${taskId}/run.log.jsonl`,
      );
    }
    const text = await readFile(resolved.abs, "utf8");
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
