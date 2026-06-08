import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { prepareSandbox, sandboxDirRel, sandboxManifestRel } from "./sandbox-prepare.js";

const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";

describe("sandbox-prepare", () => {
  it("copies touch-set paths and writes manifest", async () => {
    const prevAbbrev = process.env[JSON_FORMAT_ABBREV_ENV];
    process.env[JSON_FORMAT_ABBREV_ENV] = "7";
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-sandbox-prepare-"));
    const taskId = "38670_1315_demo-feature";
    const dayDir = "172996_05-10-26";
    const runDirRel = `work/${dayDir}/${taskId}`;
    const runAbs = path.join(root, runDirRel);
    const sourceRel = "lib/personas/context-reviewer.md";
    await mkdir(path.dirname(path.join(root, sourceRel)), { recursive: true });
    await writeFile(path.join(root, sourceRel), "# Context reviewer\n", "utf8");
    await mkdir(runAbs, { recursive: true });
    await writeFile(path.join(runAbs, "touch-set.json"), `{"paths":["${sourceRel}"]}\n`, "utf8");
    await writeFile(
      path.join(runAbs, "state.json"),
      `{
  "schemaVersion": "1",
  "pipelineId": "feature-delivery",
  "taskId": "${taskId}",
  "featureId": "demo-feature",
  "currentStage": "test",
  "artifacts": {
    "runDir": "${runDirRel}",
    "handoffFile": "${runDirRel}/handoff.md",
    "stateFile": "${runDirRel}/state.json"
  }
}
`,
      "utf8",
    );

    const fixed = new Date("2026-06-07T12:00:00.000Z");
    const result = await prepareSandbox({
      repoRoot: root,
      taskId,
      clock: () => fixed,
    });

    expect(result.sandboxDir).toBe(sandboxDirRel(taskId));
    expect(result.manifestFile).toBe(sandboxManifestRel(taskId));
    expect(result.copied).toHaveLength(1);
    expect(result.copied[0]?.kind).toBe("file");

    const copied = await readFile(path.join(root, sandboxDirRel(taskId), sourceRel), "utf8");
    expect(copied).toContain("Context reviewer");

    const manifestRaw = await readFile(path.join(root, result.manifestFile), "utf8");
    expect(manifestRaw).toContain(`"taskId": "${taskId}"`);
    expect(manifestRaw).toContain(fixed.toISOString());

    if (prevAbbrev === undefined) {
      delete process.env[JSON_FORMAT_ABBREV_ENV];
    } else {
      process.env[JSON_FORMAT_ABBREV_ENV] = prevAbbrev;
    }
  });
});
