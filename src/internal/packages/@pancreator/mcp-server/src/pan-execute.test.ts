import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { asTaskId } from "@pancreator/core";
import { interventionJournalPath } from "@pancreator/intervention";
import { describe, expect, it } from "vitest";

import { callDdlToolMcp, readPancreatorResourceMcp } from "./create-mcp-server.js";
import { DdlDeferredToolError, executeDdlTool } from "./pan-execute.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..", "..");

async function mktemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("pan.inbox", () => {
  it("lists src/inbox/in entries for a temp repo", async () => {
    const root = await mktemp("pan-mcp-inbox-");
    const inboxIn = path.join(root, "src", "inbox", "in");
    await fs.mkdir(inboxIn, { recursive: true });
    await fs.writeFile(path.join(inboxIn, "hello.md"), "x", "utf8");

    const out = await callDdlToolMcp("pan.inbox", {}, { repoRoot: root });
    expect(out).toEqual({
      command: "inbox",
      status: "ok",
      entries: ["hello.md"],
    });
  });

  it("lists nested inbox/in paths", async () => {
    const root = await mktemp("pan-mcp-inbox-nested-");
    const deep = path.join(root, "src", "inbox", "in", "172995_01-01-26", "50909_task");
    await fs.mkdir(deep, { recursive: true });
    await fs.writeFile(path.join(deep, "a.md"), "x", "utf8");

    const out = await callDdlToolMcp("pan.inbox", {}, { repoRoot: root });
    expect(out).toEqual({
      command: "inbox",
      status: "ok",
      entries: ["172995_01-01-26/50909_task/a.md"],
    });
  });
});

describe("pan.pause", () => {
  it("appends a journal line under .pan/scheduler/interventions", async () => {
    const root = await mktemp("pan-mcp-pause-");
    const task = "my-task-1";
    const out = await callDdlToolMcp("pan.pause", { taskId: task }, { repoRoot: root });
    expect(out).toEqual({ command: "pause", status: "ok", taskId: task });
    const journal = interventionJournalPath(root, asTaskId(task));
    const text = await fs.readFile(journal, "utf8");
    expect(text).toContain("pause");
  });
});

describe("readPancreatorResource work-run-log", () => {
  it("returns run log file contents from src/work/<taskId>/run.log.jsonl", async () => {
    const root = await mktemp("pan-mcp-runlog-");
    const task = "t-99";
    const p = path.join(root, "work", task, "run.log.jsonl");
    await fs.mkdir(path.dirname(p), { recursive: true });
    const body = `{"line":1}\n`;
    await fs.writeFile(p, body, "utf8");

    const { mimeType, text } = await readPancreatorResourceMcp(
      `work-run-log://${task}`,
      { repoRoot: root },
    );
    expect(mimeType).toBe("application/x-ndjson");
    expect(text).toBe(body);
  });
});

describe("read-only pan.feature / pan.status / pan.memory", () => {
  it("pan.feature list returns typed feature summaries", async () => {
    const out = await callDdlToolMcp("pan.feature", { action: "list" }, { repoRoot: ROOT });
    expect(out.status).toBe("ok");
    expect(out.command).toBe("feature.list");
    expect(Array.isArray(out.features)).toBe(true);
    expect(JSON.stringify(out)).not.toContain('"stub"');
  });

  it("pan.feature show returns spec data or structured not-found", async () => {
    const out = await callDdlToolMcp(
      "pan.feature",
      { action: "show", featureId: "ci-best-practices-batch" },
      { repoRoot: ROOT },
    );
    expect(out.status).toBe("ok");
    expect(out.command).toBe("feature.show");
    expect(out.feature_id).toBe("ci-best-practices-batch");
    expect(JSON.stringify(out)).not.toContain('"stub"');
  });

  it("pan.status returns workspace summary without taskId", async () => {
    const out = await callDdlToolMcp("pan.status", {}, { repoRoot: ROOT });
    expect(out.status).toBe("ok");
    expect(out.command).toBe("status");
    expect(Array.isArray(out.activeTasks)).toBe(true);
    expect(JSON.stringify(out)).not.toContain('"stub"');
  });

  it("pan.memory.query returns typed memory hits", async () => {
    const out = await callDdlToolMcp(
      "pan.memory",
      { query: "context economy" },
      { repoRoot: ROOT },
    );
    expect(out.status).toBe("ok");
    expect(out.command).toBe("memory.query");
    expect(Array.isArray(out.hits)).toBe(true);
    expect(JSON.stringify(out)).not.toContain('"stub"');
  });
});

describe("stdio MCP transport read tools", () => {
  it("does not emit stub envelopes for wired read tools", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const serverEntry = path.join(
      ROOT,
      "src/internal/packages/@pancreator/mcp-server/dist/server.js",
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      cwd: ROOT,
    });
    const client = new Client({ name: "pan-read-tools-test", version: "0.0.0" });
    await client.connect(transport);
    const cases = [
      { name: "pan.feature", arguments: { action: "list" } },
      {
        name: "pan.feature",
        arguments: { action: "show", featureId: "pancreator-cli" },
      },
      { name: "pan.status", arguments: {} },
      { name: "pan.memory", arguments: { query: "handbook" } },
    ] as const;
    for (const call of cases) {
      const result = await client.callTool(call);
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((c: { text?: string }) => ("text" in c && typeof c.text === "string" ? c.text : ""))
        .join("\n");
      expect(text).not.toContain('"status": "stub"');
      expect(text).not.toContain('"status":"stub"');
      const parsed = JSON.parse(text) as { status?: string };
      expect(parsed.status).not.toBe("stub");
    }
    await client.close();
  });
});

describe("deferred pan.* MCP tools", () => {
  it("throw DdlDeferredToolError with the shared deferral envelope schema", async () => {
    const root = await mktemp("pan-mcp-defer-");
    const err = await executeDdlTool("pan.init", {}, { repoRoot: root }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DdlDeferredToolError);
    const typed = err as DdlDeferredToolError;
    expect(typed.envelope.status).toBe("deferred");
    expect(typed.envelope.verb).toBe("pan.init");
    expect(typed.envelope.milestone).toBe("M3");
    expect(typed.envelope.tracking_intake).toBe(
      "src/inbox/in/172981_05-25-26/64500_0605_pan-init-and-create-pancreator-install-paths.md",
    );
    expect(JSON.parse(typed.message).status).toBe("deferred");
  });

  it("routes pan.lint deferral tracking to the batch operator-tooling intake", async () => {
    const root = await mktemp("pan-mcp-defer-lint-");
    const err = await executeDdlTool("pan.lint", {}, { repoRoot: root }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DdlDeferredToolError);
    expect((err as DdlDeferredToolError).envelope.tracking_intake).toBe(
      "src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md",
    );
  });

  it("surface DdlDeferredToolError through callDdlToolMcp", async () => {
    const root = await mktemp("pan-mcp-call-defer-");
    const failed = await callDdlToolMcp("pan.lint", {}, { repoRoot: root }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failed).toBeInstanceOf(DdlDeferredToolError);
  });
});
