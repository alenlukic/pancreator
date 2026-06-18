import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FEATURE_DELIVERY_STATE_SCHEMA_VERSION } from "./feature-delivery-run.js";
import { runArchiveSweep } from "./archive-sweep.js";
import { stringifyCliJson } from "./canonical-json-io.js";

const DAY = "172996_05-10-26";
const TASK = "99999_aborted_demo";

async function mkRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pan-archive-sweep-"));
  await mkdir(path.join(root, ".pan", "work", DAY), { recursive: true });
  await mkdir(path.join(root, "lib", "inbox", "in", DAY), { recursive: true });
  await mkdir(path.join(root, "lib", "inbox", "out", DAY), { recursive: true });
  await mkdir(path.join(root, "lib", "inbox", "threads", DAY, "demo-feature"), { recursive: true });
  return root;
}

describe("runArchiveSweep", () => {
  let root = "";
  let hadAbbrevEnv: boolean;
  let prevAbbrevEnv: string | undefined;

  beforeEach(async () => {
    hadAbbrevEnv = Object.hasOwn(process.env, "PAN_JSON_FORMAT_ABBREV_LEN");
    prevAbbrevEnv = process.env.PAN_JSON_FORMAT_ABBREV_LEN;
    process.env.PAN_JSON_FORMAT_ABBREV_LEN = "7";
    root = await mkRepo();
  });

  afterEach(async () => {
    if (hadAbbrevEnv) {
      process.env.PAN_JSON_FORMAT_ABBREV_LEN = prevAbbrevEnv;
    } else {
      delete process.env.PAN_JSON_FORMAT_ABBREV_LEN;
    }
    if (root.length > 0) {
      await import("node:fs/promises").then((fsp) => fsp.rm(root, { recursive: true, force: true }));
    }
  });

  it("archives aborted runs and related inbox out/threads surfaces", async () => {
    const runDirRel = `.pan/work/${DAY}/${TASK}`;
    const runAbs = path.join(root, runDirRel);
    await mkdir(runAbs, { recursive: true });
    const inboxSourceRel = `lib/inbox/in/${DAY}/${TASK}.md`;
    await writeFile(path.join(root, inboxSourceRel), "# Aborted demo\n", "utf8");
    await writeFile(
      path.join(runAbs, "state.json"),
      stringifyCliJson(root, {
        schemaVersion: FEATURE_DELIVERY_STATE_SCHEMA_VERSION,
        pipelineId: "feature-delivery",
        taskId: TASK,
        featureId: "demo-feature",
        status: "halted",
        currentStage: "aborted",
        createdAtIso: "2026-05-10T13:15:30.000Z",
        source: { inboxEntry: `${TASK}.md`, inboxPath: inboxSourceRel },
        artifacts: {
          runDir: runDirRel,
          stateFile: `${runDirRel}/state.json`,
          handoffFile: `${runDirRel}/handoff.md`,
          runLogFile: `${runDirRel}/run.log.jsonl`,
          nextPromptFile: `${runDirRel}/next-prompt.md`,
        },
        stages: [],
        transitions: [],
        nextHumanAction: "Aborted",
      }),
      "utf8",
    );
    const outRel = `lib/inbox/out/${DAY}/10000_demo-feature-delivery-report.md`;
    await writeFile(
      path.join(root, outRel),
      `---\ntask_id: ${TASK}\nfeature_id: demo-feature\n---\n`,
      "utf8",
    );
    const threadRel = `lib/inbox/threads/${DAY}/demo-feature/10001_round-01.md`;
    await writeFile(path.join(root, threadRel), "# thread\n", "utf8");

    const result = await runArchiveSweep(root, { clock: () => new Date("2026-05-10T14:00:00.000Z") });

    expect(result.status).toBe("ok");
    expect(result.closed).toContain(TASK);
    expect(existsSync(path.join(root, runDirRel))).toBe(false);
    expect(existsSync(path.join(root, ".pan/archive/work", DAY, TASK))).toBe(true);
    expect(existsSync(path.join(root, inboxSourceRel))).toBe(false);
    expect(existsSync(path.join(root, ".pan/archive/inbox/in", DAY, `${TASK}.md`))).toBe(true);
    expect(existsSync(path.join(root, outRel))).toBe(false);
    expect(existsSync(path.join(root, ".pan/archive/inbox/out", DAY, path.basename(outRel)))).toBe(true);
    expect(existsSync(path.join(root, threadRel))).toBe(false);
    expect(
      existsSync(path.join(root, ".pan/archive/inbox/threads", DAY, "demo-feature", "10001_round-01.md")),
    ).toBe(true);
    expect(existsSync(path.join(root, "lib/inbox/out", DAY))).toBe(false);
    expect(existsSync(path.join(root, "lib/inbox/threads", DAY))).toBe(false);
    expect(existsSync(path.join(root, "lib/inbox/in", DAY))).toBe(false);
  });

  it("archives orphan work directories", async () => {
    const runDirRel = `.pan/work/${DAY}/88888_orphan_workspace`;
    await mkdir(path.join(root, runDirRel), { recursive: true });
    await writeFile(path.join(root, runDirRel, "notes.txt"), "scratch", "utf8");

    const result = await runArchiveSweep(root);

    expect(result.status).toBe("ok");
    expect(result.archived).toContain(`.pan/archive/work/${DAY}/88888_orphan_workspace`);
    expect(existsSync(path.join(root, runDirRel))).toBe(false);
  });

  it("skips active in-progress runs and preserves their inbox sources", async () => {
    const runDirRel = `.pan/work/${DAY}/77777_active_run`;
    const runAbs = path.join(root, runDirRel);
    await mkdir(runAbs, { recursive: true });
    const inboxSourceRel = `lib/inbox/in/${DAY}/active.md`;
    await writeFile(path.join(root, inboxSourceRel), "# active\n", "utf8");
    await writeFile(
      path.join(runAbs, "state.json"),
      stringifyCliJson(root, {
        schemaVersion: FEATURE_DELIVERY_STATE_SCHEMA_VERSION,
        pipelineId: "feature-delivery",
        taskId: "77777_active_run",
        featureId: "demo-feature",
        status: "ready_for_stage_delegation",
        currentStage: "implement",
        createdAtIso: "2026-05-10T13:15:30.000Z",
        source: { inboxEntry: "active.md", inboxPath: inboxSourceRel },
        artifacts: {
          runDir: runDirRel,
          stateFile: `${runDirRel}/state.json`,
          handoffFile: `${runDirRel}/handoff.md`,
          runLogFile: `${runDirRel}/run.log.jsonl`,
          nextPromptFile: `${runDirRel}/next-prompt.md`,
        },
        stages: [],
        transitions: [],
        nextHumanAction: "Implement",
      }),
      "utf8",
    );

    const result = await runArchiveSweep(root);

    expect(result.skipped.some((entry) => entry.path === "77777_active_run")).toBe(true);
    expect(existsSync(runAbs)).toBe(true);
    expect(existsSync(path.join(root, inboxSourceRel))).toBe(true);
  });

  it("preserves inbox items for active experience-planning runs", async () => {
    const epDay = "172957_06-18-26";
    const epTask = "72323_0354_command-center-home-ux-remediation";
    const runDirRel = `.pan/work/${epDay}/${epTask}`;
    const runAbs = path.join(root, runDirRel);
    await mkdir(runAbs, { recursive: true });
    const sourceInRel = `lib/inbox/in/${epDay}/${epTask}.md`;
    const synthesizedInRel = `lib/inbox/in/${epDay}/72063_0358_command-center-home-ux-remediation-fd.md`;
    const threadRel = `lib/inbox/threads/${epDay}/command-center-home-ux-remediation/operator-review-round.md`;
    await mkdir(path.dirname(path.join(root, sourceInRel)), { recursive: true });
    await mkdir(path.dirname(path.join(root, synthesizedInRel)), { recursive: true });
    await mkdir(path.dirname(path.join(root, threadRel)), { recursive: true });
    await writeFile(path.join(root, sourceInRel), "# source brief\n", "utf8");
    await writeFile(path.join(root, synthesizedInRel), "# synthesized fd\n", "utf8");
    await writeFile(path.join(root, threadRel), "# operator review\n", "utf8");
    await writeFile(
      path.join(runAbs, "state.json"),
      stringifyCliJson(root, {
        taskId: epTask,
        pipeline: "experience-planning",
        status: "complete",
        createdAt: "2026-06-18T03:54:36.387Z",
        completedAt: "2026-06-18T04:15:00.000Z",
        source: { inboxPath: sourceInRel },
        outputs: {
          synthesizedDirective: synthesizedInRel,
          operatorReview: threadRel,
        },
      }),
      "utf8",
    );

    const result = await runArchiveSweep(root, {
      clock: () => new Date("2026-06-18T12:00:00.000Z"),
    });

    expect(result.status).toBe("ok");
    expect(existsSync(path.join(root, sourceInRel))).toBe(true);
    expect(existsSync(path.join(root, synthesizedInRel))).toBe(true);
    expect(existsSync(path.join(root, threadRel))).toBe(true);
    expect(existsSync(runAbs)).toBe(true);
  });

  it("archives unrelated inbox out and threads files", async () => {
    const outRel = `lib/inbox/out/${DAY}/unrelated-delivery-report.md`;
    const threadRel = `lib/inbox/threads/${DAY}/other-feature/round-01.md`;
    const inRel = `lib/inbox/in/${DAY}/unrelated-spec.md`;
    await mkdir(path.dirname(path.join(root, threadRel)), { recursive: true });
    await writeFile(path.join(root, outRel), "# out\n", "utf8");
    await writeFile(path.join(root, threadRel), "# thread\n", "utf8");
    await writeFile(path.join(root, inRel), "# in\n", "utf8");

    const result = await runArchiveSweep(root);

    expect(result.status).toBe("ok");
    expect(existsSync(path.join(root, outRel))).toBe(false);
    expect(existsSync(path.join(root, threadRel))).toBe(false);
    expect(existsSync(path.join(root, inRel))).toBe(false);
    expect(existsSync(path.join(root, ".pan/archive/inbox/out", DAY, "unrelated-delivery-report.md"))).toBe(true);
    expect(
      existsSync(path.join(root, ".pan/archive/inbox/threads", DAY, "other-feature", "round-01.md")),
    ).toBe(true);
    expect(existsSync(path.join(root, ".pan/archive/inbox/in", DAY, "unrelated-spec.md"))).toBe(true);
  });
});
