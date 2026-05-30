import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileInbox } from "./file-inbox.js";

describe("FileInbox", () => {
  it("writes to out and lists in", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "inbox-"));
    const inbox = new FileInbox(tmp);
    await inbox.writeOutFile("report.md", "done");
    const out = await readFile(path.join(tmp, "lib", "inbox", "out", "report.md"), "utf8");
    expect(out).toBe("done");
    expect(inbox.pathOut("report.md")).toBe(path.join(tmp, "lib", "inbox", "out", "report.md"));
    await rm(tmp, { recursive: true, force: true });
  });

  it("lists nested inbox/in files with POSIX-relative paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "inbox-"));
    const inbox = new FileInbox(tmp);
    const nestedDir = path.join(tmp, "lib", "inbox", "in", "172995_01-01-26", "50909_task");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(path.join(nestedDir, "a.md"), "x", "utf8");
    const entries = await inbox.listIn();
    expect(entries).toContain("172995_01-01-26/50909_task/a.md");
    const body = await inbox.readInFile("172995_01-01-26/50909_task/a.md");
    expect(body).toBe("x");
    await rm(tmp, { recursive: true, force: true });
  });

  it("rejects path traversal", async () => {
    const inbox = new FileInbox("/tmp");
    await expect(inbox.writeOutFile("../escape.md", "x")).rejects.toThrow(/dot segments|queue root/u);
  });
});
