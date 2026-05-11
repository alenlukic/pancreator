import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileInbox } from "./file-inbox.js";

describe("FileInbox", () => {
  it("writes to out and lists in", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "inbox-"));
    const inbox = new FileInbox(tmp);
    await inbox.writeOutFile("report.md", "done");
    const out = await readFile(path.join(tmp, "src", "inbox", "out", "report.md"), "utf8");
    expect(out).toBe("done");
    expect(inbox.pathOut("report.md")).toBe(path.join(tmp, "src", "inbox", "out", "report.md"));
    await rm(tmp, { recursive: true, force: true });
  });

  it("rejects multi-segment names", async () => {
    const inbox = new FileInbox("/tmp");
    await expect(inbox.writeOutFile("a/b.md", "x")).rejects.toThrow("single path segment");
  });
});
