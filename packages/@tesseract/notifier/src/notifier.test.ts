import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createConsoleNotifier, createInboxNotifier } from "./index.js";

describe("createConsoleNotifier", () => {
  it("prints the summary and optional body", async () => {
    const lines: string[] = [];
    const n = createConsoleNotifier({ log: (s) => lines.push(s) });
    await n.notify({ summary: "Hi", body: "Details" });
    expect(lines.join("\n")).toContain("Hi");
    expect(lines.join("\n")).toContain("Details");
  });
});

describe("createInboxNotifier", () => {
  it("writes an outbox file using a sink", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "nb-"));
    const outDir = path.join(tmp, "out");
    await mkdir(outDir, { recursive: true });
    const n = createInboxNotifier({
      writeOutFile: async (name, content) => {
        await writeFile(path.join(outDir, name), content, "utf8");
      },
    });
    await n.notify({ summary: "Ship", body: "ready" });
    const names = await readdir(outDir);
    expect(names.length).toBe(1);
    const body = await readFile(path.join(outDir, names[0]), "utf8");
    expect(body).toContain("Ship");
    expect(body).toContain("ready");
    await rm(tmp, { recursive: true, force: true });
  });
});
