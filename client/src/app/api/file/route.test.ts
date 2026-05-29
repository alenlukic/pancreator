import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/file/route";
import { readRepoFile, writeRepoFile } from "@/services/repo-files";
import { resolveRepoPath } from "@/services/repo-paths";

describe("/api/file", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "daedaline-file-api-"));
    fs.writeFileSync(path.join(tempRoot, "daedaline.yaml"), "phase: test\n");
    fs.mkdirSync(path.join(tempRoot, "src", "memory"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "src", "memory", "sample.md"), "initial");
    fs.mkdirSync(path.join(tempRoot, "client", ".local"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("reads authorized UTF-8 content via GET", async () => {
    const content = await readRepoFile("src/memory/sample.md", tempRoot);
    expect(content).toBe("initial");

    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const response = await GET(
        new Request("http://localhost/api/file?path=src/memory/sample.md"),
      );
      const payload = (await response.json()) as { content: string };
      expect(response.status).toBe(200);
      expect(payload.content).toBe("initial");
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("writes authorized UTF-8 content via POST", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const response = await POST(
        new Request("http://localhost/api/file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "src/memory/sample.md", content: "updated" }),
        }),
      );
      expect(response.status).toBe(200);
      expect(fs.readFileSync(resolveRepoPath("src/memory/sample.md", tempRoot), "utf8")).toBe(
        "updated",
      );
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("denies path traversal", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const response = await GET(
        new Request("http://localhost/api/file?path=../../etc/passwd"),
      );
      expect(response.status).toBe(403);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("logs structured write metadata", async () => {
    const entry = await writeRepoFile("src/memory/sample.md", "logged", tempRoot);
    expect(entry.path).toBe("src/memory/sample.md");
    expect(entry.bytes_written).toBe(Buffer.byteLength("logged", "utf8"));
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
