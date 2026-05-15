import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { asTaskId } from "@tesseract/core";
import { describe, expect, it } from "vitest";

import { PortRegistryCollisionError } from "./errors.js";
import { PortRegistryEnvIsolation } from "./port-registry-env-isolation.js";
import { readRegistryState } from "./registry-state.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function tmpRepo(): Promise<{ repoRoot: string; cleanup: () => Promise<void> }> {
  const repoRoot = path.join(here, `.tmp-ports-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(path.join(repoRoot, ".tess", "sandboxes"), { recursive: true });
  return {
    repoRoot,
    cleanup: async () => {
      await rm(repoRoot, { recursive: true, force: true });
    },
  };
}

describe("PortRegistryEnvIsolation", () => {
  it("reserves contiguous ports and persists them", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      const reg = new PortRegistryEnvIsolation({ repoRoot, minPort: 3000, maxPort: 3005 });
      const ports = await reg.reserve(asTaskId("a"), 2);
      expect(ports).toEqual([3000, 3001]);
      const reg2 = new PortRegistryEnvIsolation({ repoRoot, minPort: 3000, maxPort: 3005 });
      expect(await reg2.list()).toHaveLength(1);
      const raw = await readFile(path.join(repoRoot, ".tess", "sandboxes", "port-registry.json"), "utf8");
      expect(raw).toContain("3000");
    } finally {
      await cleanup();
    }
  });

  it("returns the same block when reserving again for the same task", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      const reg = new PortRegistryEnvIsolation({ repoRoot, minPort: 4000, maxPort: 4009 });
      const first = await reg.reserve(asTaskId("b"), 2);
      const second = await reg.reserve(asTaskId("b"), 2);
      expect(second).toEqual(first);
    } finally {
      await cleanup();
    }
  });

  it("throws when a different block size is requested while the task still holds ports", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      const reg = new PortRegistryEnvIsolation({ repoRoot, minPort: 5000, maxPort: 5010 });
      await reg.reserve(asTaskId("c"), 2);
      await expect(reg.reserve(asTaskId("c"), 3)).rejects.toThrow(/already holds/);
    } finally {
      await cleanup();
    }
  });

  it("releases ports for reuse", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      const reg = new PortRegistryEnvIsolation({ repoRoot, minPort: 6000, maxPort: 6003 });
      await reg.reserve(asTaskId("d"), 2);
      await reg.release(asTaskId("d"));
      const ports = await reg.reserve(asTaskId("e"), 2);
      expect(ports).toEqual([6000, 6001]);
    } finally {
      await cleanup();
    }
  });

  it("detects duplicate ports across tasks on load", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    const file = path.join(repoRoot, ".tess", "sandboxes", "port-registry.json");
    try {
      const bad = {
        version: 1,
        minPort: 7000,
        maxPort: 7005,
        allocations: { x: [7000, 7001], y: [7001, 7002] },
      };
      await writeFile(file, `${JSON.stringify(bad, null, 2)}\n`, "utf8");
      await expect(readRegistryState(file, 7000, 7005)).rejects.toThrow(PortRegistryCollisionError);
    } finally {
      await cleanup();
    }
  });
});
