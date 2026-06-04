import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensurePipelineCloseDoc,
  PIPELINE_CLOSE_FILENAME,
  pipelineCloseRel,
  renderPipelineCloseDoc,
} from "./feature-delivery-pipeline-close.js";
import type { FeatureDeliveryState } from "./feature-delivery-run.js";

function sampleState(overrides: Partial<FeatureDeliveryState> = {}): FeatureDeliveryState {
  return {
    schemaVersion: "1",
    pipelineId: "feature-delivery",
    taskId: "38670_1315_demo-feature",
    featureId: "demo-feature",
    status: "complete",
    currentStage: "complete",
    createdAtIso: "2026-05-10T13:15:30.000Z",
    source: {
      inboxEntry: "demo-feature.md",
      inboxPath: "lib/inbox/in/demo-feature.md",
    },
    artifacts: {
      runDir: "work/172996_05-10-26/38670_1315_demo-feature",
      stateFile: "work/172996_05-10-26/38670_1315_demo-feature/state.json",
      handoffFile: "work/172996_05-10-26/38670_1315_demo-feature/handoff.md",
      runLogFile: "work/172996_05-10-26/38670_1315_demo-feature/run.log.jsonl",
    },
    stages: [],
    transitions: [],
    nextHumanAction: "Review pipeline close doc.",
    advanceHistory: [
      {
        atIso: "2026-05-10T13:20:00.000Z",
        kind: "advance",
        from: "index",
        to: "complete",
        event: "artifacts_indexed",
        artifact: "lib/memory/features/demo-feature/index.json",
      },
    ],
    ...overrides,
  };
}

describe("feature-delivery-pipeline-close", () => {
  it("renderPipelineCloseDoc includes outcome, history, and close-artifacts command", () => {
    const state = sampleState();
    const doc = renderPipelineCloseDoc(state, "/tmp/repo", new Date("2026-05-10T14:00:00.000Z"));
    expect(doc).toContain("# Pipeline close — demo-feature");
    expect(doc).toContain("index → complete");
    expect(doc).toContain("artifacts_indexed");
    expect(doc).toContain("pnpm -w exec pan close-artifacts 38670_1315_demo-feature");
  });

  it("ensurePipelineCloseDoc writes once and preserves librarian edits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-pipeline-close-"));
    const state = sampleState();
    const runDir = path.join(root, state.artifacts.runDir);
    await mkdir(runDir, { recursive: true });
    const rel = await ensurePipelineCloseDoc(root, state, new Date("2026-05-10T14:00:00.000Z"));
    expect(rel).toBe(pipelineCloseRel(state));
    const first = await readFile(path.join(root, rel), "utf8");
    expect(first).toContain("Pipeline close");
    await writeFile(path.join(root, rel), "# Librarian override\n", "utf8");
    const second = await ensurePipelineCloseDoc(root, state, new Date("2026-05-10T14:01:00.000Z"));
    expect(second).toBe(rel);
    await expect(readFile(path.join(root, rel), "utf8")).resolves.toBe("# Librarian override\n");
    expect(PIPELINE_CLOSE_FILENAME).toBe("pipeline-close.md");
  });
});
