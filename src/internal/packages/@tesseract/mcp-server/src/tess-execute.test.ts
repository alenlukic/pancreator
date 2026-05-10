import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { asTaskId } from "@tesseract/core";
import { interventionJournalPath } from "@tesseract/intervention";
import { describe, expect, it } from "vitest";

import { callTessToolMcp, readTesseractResourceMcp } from "./create-mcp-server.js";

async function mktemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("tess.inbox", () => {
  it("lists src/inbox/in entries for a temp repo", async () => {
    const root = await mktemp("tess-mcp-inbox-");
    const inboxIn = path.join(root, "inbox", "in");
    await fs.mkdir(inboxIn, { recursive: true });
    await fs.writeFile(path.join(inboxIn, "hello.md"), "x", "utf8");

    const out = await callTessToolMcp("tess.inbox", {}, { repoRoot: root });
    expect(out).toEqual({
      command: "inbox",
      status: "ok",
      entries: ["hello.md"],
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
