import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";

import { preserveFeatureDeliveryFailureContext } from "./feature-delivery-failure-preservation.js";
import type { FeatureDeliveryState } from "./feature-delivery-run.js";

describe("feature-delivery-failure-preservation", () => {
  beforeEach(() => {
    process.env[JSON_FORMAT_ABBREV_ENV] = "7";
  });

  afterEach(() => {
    delete process.env[JSON_FORMAT_ABBREV_ENV];
  });

  it("mirrors run artifacts and halt outbox from worktree to main checkout", async () => {
    const main = await mkdtemp(path.join(os.tmpdir(), "pan-failure-main-"));
    const worktree = await mkdtemp(path.join(os.tmpdir(), "pan-failure-wt-"));
    const taskId = "61497_0655_cockpit-v2-unified-work-intake-and-kickoff-flow";
    const dayDir = "172966_06-09-26";
    const runDir = path.posix.join(".pan/work", dayDir, taskId);
    const runAbs = path.join(worktree, ...runDir.split("/"));
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "review.md"), "review_passes: false\n", "utf8");
    await writeFile(
      path.join(runAbs, "state.json"),
      JSON.stringify({ status: "halted", currentStage: "review" }),
      "utf8",
    );
    const outDayRel = path.posix.join("lib", "inbox", "out", dayDir);
    const haltRel = path.posix.join(outDayRel, "54816_0846_feature-delivery-retry-halt.md");
    await mkdir(path.join(worktree, outDayRel), { recursive: true });
    await writeFile(path.join(worktree, haltRel), "gate: retry_limit_halt\n", "utf8");

    const state = {
      schemaVersion: "1",
      pipelineId: "feature-delivery",
      taskId,
      featureId: "cockpit-v2-unified-work-intake-and-kickoff-flow",
      status: "halted",
      currentStage: "review",
      createdAtIso: "2026-06-09T08:46:00.000Z",
      source: { inboxEntry: "kickoff.md", inboxPath: "lib/inbox/in/kickoff.md" },
      artifacts: {
        runDir,
        stateFile: path.posix.join(runDir, "state.json"),
        handoffFile: path.posix.join(runDir, "handoff.md"),
        runLogFile: path.posix.join(runDir, "run.log.jsonl"),
      },
      stages: [],
      transitions: [],
      nextHumanAction: "repair",
    } as FeatureDeliveryState;

    const result = await preserveFeatureDeliveryFailureContext({
      mainRepoRoot: main,
      checkoutRoot: worktree,
      taskId,
      runDir,
      state,
      batchId: "58309_0748_batch",
      branch: "pan/batch-58309_0748_batch/" + taskId,
      error: "retry limit",
      clock: () => new Date("2026-06-09T08:46:00.000Z"),
    });

    expect(result.preservedRunDir).toBe(runDir);
    expect(existsSync(path.join(main, runDir, "review.md"))).toBe(true);
    expect(existsSync(path.join(main, haltRel))).toBe(true);
    expect(existsSync(path.join(main, result.manifestRel))).toBe(true);
    const manifestText = await readFile(path.join(main, result.manifestRel), "utf8");
    expect(manifestText).toContain(taskId);
    expect(manifestText).toContain("58309_0748_batch");
    expect(manifestText).toContain(path.posix.join(runDir, "review.md"));
  });
});
