import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringifyCompactJson } from "@/lib/json-io";
import { GET } from "@/app/api/activity/route";
import { getActivityFeed, getMutationReceipts } from "@/services/activity";
import { writeRepoFile } from "@/services/repo-files";

describe("GET /api/activity feed ordering", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pancreator-activity-"));
    fs.writeFileSync(path.join(tempRoot, "pancreator.yaml"), "phase: test\n");
    fs.mkdirSync(path.join(tempRoot, ".pan/work"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "client", ".local"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("serves mutation receipts via GET", async () => {
    const originalRoot = process.cwd();
    process.chdir(tempRoot);
    try {
      const response = await GET();
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { receipts: Array<{ timestamp: string; actor: string; verb: string; object: string }> };
      expect(Array.isArray(payload.receipts)).toBe(true);
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

  it.each([
    { designSteps: false, label: "designSteps disabled" },
    { designSteps: true, label: "designSteps enabled" },
  ])(
    "emits run receipts with day-bucketed artifact paths when $label",
    async ({ designSteps }) => {
      const dayBucket = "172965_06-10-26";
      const taskId = "65766_0543_demo-feature";
      const runDir = path.join(tempRoot, ".pan", "work", dayBucket, taskId);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "state.json"),
        stringifyCompactJson({
          featureId: "demo-feature",
          options: { designSteps },
        }),
      );
      fs.writeFileSync(
        path.join(runDir, "run.log.jsonl"),
        `${stringifyCompactJson({
          ts: "2026-06-02T12:00:00.000Z",
          name: "pancreator.pipeline.advance",
          pancreator: { stage_id: "plan", persona: "tech-lead", outcome: "success" },
        })}\n`,
      );

      const receipts = await getMutationReceipts(tempRoot);
      const planReceipt = receipts.find((receipt) => receipt.id.startsWith(`run:${taskId}:`));
      expect(planReceipt?.artifactLink).toBe(`.pan/work/${dayBucket}/${taskId}/product-plan.md`);
    },
  );

  it("returns reverse-chronological events", async () => {
    const older = path.join(tempRoot, ".pan/work", "older.md");
    const newer = path.join(tempRoot, ".pan/work", "newer.md");
    fs.writeFileSync(older, "older");
    fs.writeFileSync(newer, "newer");

    const olderTime = new Date("2026-05-01T10:00:00.000Z");
    const newerTime = new Date("2026-05-02T10:00:00.000Z");
    fs.utimesSync(older, olderTime, olderTime);
    fs.utimesSync(newer, newerTime, newerTime);

    await writeRepoFile(".pan/work/write-target.md", "hello", tempRoot);

    const events = await getActivityFeed(tempRoot);
    expect(events.length).toBeGreaterThan(1);
    expect(Date.parse(events[0].timestamp)).toBeGreaterThanOrEqual(Date.parse(events[1].timestamp));
  });
});
