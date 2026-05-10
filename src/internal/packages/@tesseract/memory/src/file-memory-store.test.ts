import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asFeatureId } from "@tesseract/core";
import { FileMemoryStore } from "./file-memory-store.js";

describe("FileMemoryStore", () => {
  it("round-trips a text key and lists nested keys", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "mem-"));
    const root = path.join(tmp, "memory");
    const mem = new FileMemoryStore(root);
    await mem.set("handbook/alpha.md", "hello");
    expect(await mem.get("handbook/alpha.md")).toBe("hello");
    const keys = await mem.listKeys("handbook");
    expect(keys).toEqual(["handbook/alpha.md"]);
    await mem.remove("handbook/alpha.md");
    expect(await mem.get("handbook/alpha.md")).toBeUndefined();
    await rm(tmp, { recursive: true, force: true });
  });

  it("rejects path-escape keys", async () => {
    const mem = new FileMemoryStore("/abs/memory");
    await expect(mem.get("../outside")).rejects.toThrow("memory root");
  });

  it("reads and writes feature index json", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "mem-"));
    const root = path.join(tmp, "memory");
    const mem = new FileMemoryStore(root);
    const id = asFeatureId("my-feature");
    await mem.writeJsonFeatureIndex(id, { a: 1 });
    const raw = await readFile(
      path.join(root, "features", "my-feature", "index.json"),
      "utf8",
    );
    expect(raw).toContain(`"a": 1`);
    const parsed = await mem.readJsonFeatureIndex(id);
    expect(parsed).toEqual({ a: 1 });
    await rm(tmp, { recursive: true, force: true });
  });
});
