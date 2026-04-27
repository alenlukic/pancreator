import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readUtf8ForDualAnchor } from "./dual-anchor-reader.js";

describe("readUtf8ForDualAnchor", () => {
  it("reads a file under the repository root", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "repo-"));
    await writeFile(path.join(tmp, "AGENTS.md"), "root-doc", "utf8");
    const read = readUtf8ForDualAnchor(tmp);
    expect(await read("/AGENTS.md")).toBe("root-doc");
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns undefined for a path outside the root", async () => {
    const read = readUtf8ForDualAnchor("/tmp");
    expect(await read("/etc/passwd")).toBeUndefined();
  });
});
