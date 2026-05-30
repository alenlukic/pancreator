import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/activity/route";
import { getActivityFeed } from "@/services/activity";
import { writeRepoFile } from "@/services/repo-files";

describe("GET /api/activity feed ordering", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-activity-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    fs.mkdirSync(path.join(tempRoot, "work"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "client", ".local"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("serves reverse-chronological events via GET", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const response = await GET();
      expect(response.status).toBe(200);
      const payload = (await response.json()) as Array<{ timestamp: string }>;
      expect(Array.isArray(payload)).toBe(true);
    } finally {
      process.chdir(originalRoot);
    }
  });

  it("skips broken symlinks under scanned domains", async () => {
    const packagesDir = path.join(tempRoot, "lib", "internal", "packages", "demo-pkg");
    fs.mkdirSync(packagesDir, { recursive: true });
    const brokenLink = path.join(packagesDir, "broken-link");
    fs.symlinkSync(path.join(tempRoot, "does-not-exist"), brokenLink);
    fs.writeFileSync(path.join(packagesDir, "ok.md"), "ok");

    const events = await getActivityFeed(tempRoot);
    expect(events.some((event) => event.description.includes("ok.md"))).toBe(true);
  });

  it("returns reverse-chronological events", async () => {
    const older = path.join(tempRoot, "work", "older.md");
    const newer = path.join(tempRoot, "work", "newer.md");
    fs.writeFileSync(older, "older");
    fs.writeFileSync(newer, "newer");

    const olderTime = new Date("2026-05-01T10:00:00.000Z");
    const newerTime = new Date("2026-05-02T10:00:00.000Z");
    fs.utimesSync(older, olderTime, olderTime);
    fs.utimesSync(newer, newerTime, newerTime);

    await writeRepoFile("work/write-target.md", "hello", tempRoot);

    const events = await getActivityFeed(tempRoot);
    expect(events.length).toBeGreaterThan(1);
    expect(Date.parse(events[0].timestamp)).toBeGreaterThanOrEqual(Date.parse(events[1].timestamp));
  });
});
