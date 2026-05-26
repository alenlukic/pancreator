import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { asTaskId } from "@tesseract/core";
import { interventionJournalPath } from "@tesseract/intervention";
import { describe, expect, it } from "vitest";

import { callTessToolMcp, readTesseractResourceMcp } from "./create-mcp-server.js";
import { TessDeferredToolError, executeTessTool } from "./tess-execute.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..", "..");

async function mktemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("tess.inbox", () => {
  it("lists src/inbox/in entries for a temp repo", async () => {
    const root = await mktemp("tess-mcp-inbox-");
    const inboxIn = path.join(root, "src", "inbox", "in");
    await fs.mkdir(inboxIn, { recursive: true });
    await fs.writeFile(path.join(inboxIn, "hello.md"), "x", "utf8");

    const out = await callTessToolMcp("tess.inbox", {}, { repoRoot: root });
    expect(out).toEqual({
      command: "inbox",
      status: "ok",
      entries: ["hello.md"],
    });
  });

  it("lists nested inbox/in paths", async () => {
    const root = await mktemp("tess-mcp-inbox-nested-");
    const deep = path.join(root, "src", "inbox", "in", "172995_01-01-26", "50909_task");
    await fs.mkdir(deep, { recursive: true });
    await fs.writeFile(path.join(deep, "a.md"), "x", "utf8");

    const out = await callTessToolMcp("tess.inbox", {}, { repoRoot: root });
    expect(out).toEqual({
      command: "inbox",
      status: "ok",
      entries: ["172995_01-01-26/50909_task/a.md"],
    });
  });
});

describe("tess.pause", () => {
  it("appends a journal line under .tess/scheduler/interventions", async () => {
    const root = await mktemp("tess-mcp-pause-");
    const task = "my-task-1";
    const out = await callTessToolMcp("tess.pause", { taskId: task }, { repoRoot: root });
    expect(out).toEqual({ command: "pause", status: "ok", taskId: task });
    const journal = interventionJournalPath(root, asTaskId(task));
    const text = await fs.readFile(journal, "utf8");
    expect(text).toContain("pause");
  });
});

describe("readTesseractResource work-run-log", () => {
  it("returns run log file contents from src/work/<taskId>/run.log.jsonl", async () => {
    const root = await mktemp("tess-mcp-runlog-");
    const task = "t-99";
    const p = path.join(root, "work", task, "run.log.jsonl");
    await fs.mkdir(path.dirname(p), { recursive: true });
    const body = `{"line":1}\n`;
    await fs.writeFile(p, body, "utf8");

    const { mimeType, text } = await readTesseractResourceMcp(
      `work-run-log://${task}`,
      { repoRoot: root },
    );
    expect(mimeType).toBe("application/x-ndjson");
    expect(text).toBe(body);
  });
});

describe("read-only tess.feature / tess.status / tess.memory", () => {
  it("tess.feature list returns typed feature summaries", async () => {
    const out = await callTessToolMcp("tess.feature", { action: "list" }, { repoRoot: ROOT });
    expect(out.status).toBe("ok");
    expect(out.command).toBe("feature.list");
    expect(Array.isArray(out.features)).toBe(true);
    expect(JSON.stringify(out)).not.toContain('"stub"');
  });

  it("tess.feature show returns spec data or structured not-found", async () => {
    const out = await callTessToolMcp(
      "tess.feature",
      { action: "show", featureId: "ci-best-practices-batch" },
      { repoRoot: ROOT },
    );
    expect(out.status).toBe("ok");
    expect(out.command).toBe("feature.show");
    expect(out.feature_id).toBe("ci-best-practices-batch");
    expect(JSON.stringify(out)).not.toContain('"stub"');
  });

  it("tess.status returns workspace summary without taskId", async () => {
    const out = await callTessToolMcp("tess.status", {}, { repoRoot: ROOT });
    expect(out.status).toBe("ok");
    expect(out.command).toBe("status");
    expect(Array.isArray(out.activeTasks)).toBe(true);
    expect(JSON.stringify(out)).not.toContain('"stub"');
  });

  it("tess.memory.query returns typed memory hits", async () => {
    const out = await callTessToolMcp(
      "tess.memory",
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
      "src/internal/packages/@tesseract/mcp-server/dist/server.js",
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      cwd: ROOT,
    });
    const client = new Client({ name: "tess-read-tools-test", version: "0.0.0" });
    await client.connect(transport);
    const cases = [
      { name: "tess.feature", arguments: { action: "list" } },
      {
        name: "tess.feature",
        arguments: { action: "show", featureId: "tesseract-cli" },
      },
      { name: "tess.status", arguments: {} },
      { name: "tess.memory", arguments: { query: "handbook" } },
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

describe("deferred tess.* MCP tools", () => {
  it("throw TessDeferredToolError with the shared deferral envelope schema", async () => {
    const root = await mktemp("tess-mcp-defer-");
    const err = await executeTessTool("tess.init", {}, { repoRoot: root }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TessDeferredToolError);
    const typed = err as TessDeferredToolError;
    expect(typed.envelope.status).toBe("deferred");
    expect(typed.envelope.verb).toBe("tess.init");
    expect(typed.envelope.milestone).toBe("M3");
    expect(typed.envelope.tracking_intake).toBe(
      "src/inbox/in/172981_05-25-26/64500_0605_tess-init-and-create-tesseract-install-paths.md",
    );
    expect(JSON.parse(typed.message).status).toBe("deferred");
  });

  it("routes tess.lint deferral tracking to the batch operator-tooling intake", async () => {
    const root = await mktemp("tess-mcp-defer-lint-");
    const err = await executeTessTool("tess.lint", {}, { repoRoot: root }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TessDeferredToolError);
    expect((err as TessDeferredToolError).envelope.tracking_intake).toBe(
      "src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md",
    );
  });

  it("surface TessDeferredToolError through callTessToolMcp", async () => {
    const root = await mktemp("tess-mcp-call-defer-");
    const failed = await callTessToolMcp("tess.lint", {}, { repoRoot: root }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failed).toBeInstanceOf(TessDeferredToolError);
  });
});
