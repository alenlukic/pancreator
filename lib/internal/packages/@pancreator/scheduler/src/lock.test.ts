import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireLock, activeLockCount, releaseLock } from "./lock.js";

describe("lock", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-lock-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("acquires and releases lock slots", async () => {
    const first = await acquireLock(tempRoot, "hourly-coder", "run-1", 2);
    expect(first).toEqual({ acquired: true, runId: "run-1" });
    expect(await activeLockCount(tempRoot, "hourly-coder")).toBe(1);

    const second = await acquireLock(tempRoot, "hourly-coder", "run-2", 2);
    expect(second.acquired).toBe(true);

    const saturated = await acquireLock(tempRoot, "hourly-coder", "run-3", 2);
    expect(saturated).toEqual({
      acquired: false,
      reason: "maxConcurrent 2 reached",
    });

    await releaseLock(tempRoot, "hourly-coder", "run-1");
    expect(await activeLockCount(tempRoot, "hourly-coder")).toBe(1);
  });
});
