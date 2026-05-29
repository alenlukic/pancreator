import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/list/route";

describe("GET /api/list", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "daedaline-list-api-"));
    fs.writeFileSync(path.join(tempRoot, "daedaline.yaml"), "phase: test\n");
    fs.mkdirSync(path.join(tempRoot, "src", "memory"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "src", "memory", "sample.md"), "x");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("requires a path query parameter", async () => {
    const response = await GET(new Request("http://localhost/api/list"));
    expect(response.status).toBe(400);
  });

  it("lists authorized directory entries", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const response = await GET(
        new Request("http://localhost/api/list?path=src/memory"),
      );
      const payload = (await response.json()) as {
        entries: Array<{ path: string; name: string; kind: string }>;
      };
      expect(response.status).toBe(200);
      expect(payload.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "src/memory/sample.md",
            name: "sample.md",
            kind: "file",
          }),
        ]),
      );
    } finally {
      process.chdir(originalRoot);
    }
  });
});
