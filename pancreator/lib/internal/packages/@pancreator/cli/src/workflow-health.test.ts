import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildWorkflowHealthSummary,
  resolvePointerResolution,
  workflowHealthRel,
  writeWorkflowHealthArtifact,
} from "./workflow-health.js";

const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";

describe("workflow-health", () => {
  beforeEach(() => {
    process.env[JSON_FORMAT_ABBREV_ENV] = "7";
  });

  afterEach(() => {
    delete process.env[JSON_FORMAT_ABBREV_ENV];
  });
  it("workflowHealthRel returns run-relative path", () => {
    expect(workflowHealthRel(".pan/work/day/task")).toBe(
      ".pan/work/day/task/workflow-health.json",
    );
  });

  it("resolvePointerResolution reports live paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-pointer-live-"));
    const rel = "lib/inbox/in/demo.md";
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), "# demo\n", "utf8");
    const pointer = resolvePointerResolution(root, rel, "Directive");
    expect(pointer.status).toBe("Live");
  });

  it("buildWorkflowHealthSummary marks blocked runs with gate reasons", () => {
    const summary = buildWorkflowHealthSummary({
      repoRoot: "/tmp",
      state: {
        taskId: "task-a",
        featureId: "feature-a",
        artifacts: { runDir: ".pan/work/day/task-a" },
        source: { inboxPath: "lib/inbox/in/missing.md" },
      },
      gateBlockReasons: ["delivery-report.md output manifest missing DOC.OUTPUT_MANIFEST"],
    });
    expect(summary.status).toBe("blocked");
    expect(summary.gate_block_reasons).toHaveLength(1);
  });

  it("buildWorkflowHealthSummary counts remediation transitions from run log ts fields", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-workflow-log-"));
    const runDir = ".pan/work/day/task-c";
    await mkdir(path.join(root, runDir), { recursive: true });
    const runLogRel = path.posix.join(runDir, "run.log.jsonl");
    await writeFile(
      path.join(root, runLogRel),
      [
        '{"ts":"2026-06-19T16:22:30.570Z","name":"pancreator.pipeline.advance","attributes":{"pancreator.transition_event":"review_passes"}}',
        '{"ts":"2026-06-19T16:29:23.802Z","name":"pancreator.pipeline.advance","attributes":{"pancreator.transition_event":"qa_fails"}}',
        '{"ts":"2026-06-19T16:35:56.424Z","name":"pancreator.pipeline.advance","attributes":{"pancreator.transition_event":"review_core_reentry"}}',
      ].join("\n"),
      "utf8",
    );
    const summary = buildWorkflowHealthSummary({
      repoRoot: root,
      state: {
        taskId: "task-c",
        featureId: "feature-c",
        artifacts: { runDir, runLogFile: runLogRel },
      },
    });
    expect(summary.auto_chain_reversal_count).toBe(2);
    expect(summary.last_oversight_check_at).toBe("2026-06-19T16:35:56.424Z");
  });
  it("writeWorkflowHealthArtifact writes JSON with output_manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-workflow-health-"));
    const runDir = ".pan/work/day/task-b";
    await mkdir(path.join(root, runDir), { recursive: true });
    const rel = await writeWorkflowHealthArtifact({
      repoRoot: root,
      state: {
        taskId: "task-b",
        featureId: "feature-b",
        artifacts: { runDir },
      },
    });
    expect(rel).toBe(workflowHealthRel(runDir));
    const raw = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(root, rel), "utf8"),
    );
    expect(raw).toContain('"output_manifest"');
    expect(raw).toContain('"repair_count"');
  });
});
