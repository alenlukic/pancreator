import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  archiveExperiencePlanningForClosedFeatureDelivery,
  archiveExperiencePlanningRun,
  EXPERIENCE_PLANNING_RETENTION_MS,
  sweepExperiencePlanningWorkRetention,
} from "./experience-planning-archival.js";
import { FEATURE_DELIVERY_STATE_SCHEMA_VERSION } from "./feature-delivery-run.js";
import { stringifyCliJson } from "./canonical-json-io.js";

const EP_DAY = "172963_06-12-26";
const EP_TASK = "67478_0515_command-center-post-ship-ux-feedback";
const FD_DAY = "172959_06-16-26";
const FD_TASK = "61720_0651_command-center-post-ship-remediation";

async function mkRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pan-ep-archival-"));
  await mkdir(path.join(root, ".pan", "work"), { recursive: true });
  await mkdir(path.join(root, ".pan", "archive", "work"), { recursive: true });
  await mkdir(path.join(root, "lib", "inbox", "in"), { recursive: true });
  await mkdir(path.join(root, ".pan", "archive", "inbox", "in"), { recursive: true });
  return root;
}

async function seedExperiencePlanningRun(root: string): Promise<string> {
  const runDirRel = `.pan/work/${EP_DAY}/${EP_TASK}`;
  const runAbs = path.join(root, runDirRel);
  await mkdir(runAbs, { recursive: true });
  await writeFile(path.join(runAbs, "planning-brief.md"), "# brief\n", "utf8");
  await writeFile(
    path.join(runAbs, "state.json"),
    stringifyCliJson(root, {
      taskId: EP_TASK,
      featureId: "command-center-post-ship-ux-feedback",
      pipeline: "experience-planning",
      currentStage: "complete",
      status: "complete",
      createdAt: "2026-06-12T05:15:47.800Z",
      completedAt: "2026-06-12T05:42:00.000Z",
      outputs: {
        synthesizedDirective: `lib/inbox/in/${FD_DAY}/62115_0644_command-center-post-ship-remediation.md`,
      },
    }),
    "utf8",
  );
  return runDirRel;
}

async function seedFeatureDeliveryRun(
  root: string,
  options?: {
    archived?: boolean;
    status?: string;
    currentStage?: string;
  },
): Promise<string> {
  const archived = options?.archived ?? false;
  const runDirRel = archived
    ? `.pan/archive/work/${FD_DAY}/${FD_TASK}`
    : `.pan/work/${FD_DAY}/${FD_TASK}`;
  const runAbs = path.join(root, runDirRel);
  await mkdir(runAbs, { recursive: true });
  const inboxSourceRel = `lib/inbox/in/${FD_DAY}/62115_0644_command-center-post-ship-remediation.md`;
  await writeFile(
    path.join(runAbs, "state.json"),
    stringifyCliJson(root, {
      schemaVersion: FEATURE_DELIVERY_STATE_SCHEMA_VERSION,
      pipelineId: "feature-delivery",
      taskId: FD_TASK,
      featureId: "command-center-post-ship-remediation",
      status: options?.status ?? (archived ? "closed" : "complete"),
      currentStage: options?.currentStage ?? "complete",
      createdAtIso: "2026-06-16T06:51:00.000Z",
      source: {
        inboxEntry: "62115_0644_command-center-post-ship-remediation.md",
        inboxPath: inboxSourceRel,
      },
      artifacts: {
        runDir: runDirRel,
        stateFile: `${runDirRel}/state.json`,
        handoffFile: `${runDirRel}/handoff.md`,
        runLogFile: `${runDirRel}/run.log.jsonl`,
        nextPromptFile: `${runDirRel}/next-prompt.md`,
      },
      stages: [],
      transitions: [],
      nextHumanAction: "Done",
    }),
    "utf8",
  );
  return runDirRel;
}

function directiveWithSourceTask(): string {
  return `---
title: "Command Center post-ship remediation"
feature_id: "command-center-post-ship-remediation"
source_pipeline: "experience-planning"
source_task: "${EP_TASK}"
---

# Command Center post-ship remediation
`;
}

describe("experience-planning archival", () => {
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
      await import("node:fs/promises").then((fsp) =>
        fsp.rm(root, { recursive: true, force: true }),
      );
    }
  });

  it("archives linked experience-planning work when feature-delivery inbox closes", async () => {
    const epRunDirRel = await seedExperiencePlanningRun(root);
    const directiveRel = `lib/inbox/in/${FD_DAY}/62115_0644_command-center-post-ship-remediation.md`;
    await mkdir(path.join(root, "lib", "inbox", "in", FD_DAY), { recursive: true });
    await writeFile(path.join(root, directiveRel), directiveWithSourceTask(), "utf8");

    const archived = await archiveExperiencePlanningForClosedFeatureDelivery(
      root,
      `.pan/archive/inbox/in/${FD_DAY}/62115_0644_command-center-post-ship-remediation.md`,
    );

    expect(archived).toEqual([`.pan/archive/work/${EP_DAY}/${EP_TASK}`]);
    expect(existsSync(path.join(root, epRunDirRel))).toBe(false);
    expect(existsSync(path.join(root, ".pan/archive/work", EP_DAY, EP_TASK))).toBe(true);
  });

  it("archives linked experience-planning work during retention sweep after FD archival", async () => {
    const epRunDirRel = await seedExperiencePlanningRun(root);
    await seedFeatureDeliveryRun(root, { archived: true, status: "closed" });

    const result = await sweepExperiencePlanningWorkRetention(root, {
      clock: () => new Date("2026-06-20T00:00:00.000Z"),
    });

    expect(result.archived).toEqual([`.pan/archive/work/${EP_DAY}/${EP_TASK}`]);
    expect(result.removed).toEqual([]);
    expect(existsSync(path.join(root, epRunDirRel))).toBe(false);
  });

  it("keeps linked experience-planning work while feature-delivery is still active", async () => {
    const epRunDirRel = await seedExperiencePlanningRun(root);
    await seedFeatureDeliveryRun(root, { archived: false, status: "complete" });

    const result = await sweepExperiencePlanningWorkRetention(root, {
      clock: () => new Date("2026-06-20T00:00:00.000Z"),
    });

    expect(result.archived).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(existsSync(path.join(root, epRunDirRel))).toBe(true);
  });

  it("removes stale experience-planning work after seven days without feature-delivery", async () => {
    const epRunDirRel = await seedExperiencePlanningRun(root);
    const staleAt = new Date(
      Date.parse("2026-06-12T05:42:00.000Z") +
        EXPERIENCE_PLANNING_RETENTION_MS +
        60_000,
    );

    const result = await sweepExperiencePlanningWorkRetention(root, {
      clock: () => staleAt,
    });

    expect(result.archived).toEqual([]);
    expect(result.removed).toEqual([epRunDirRel]);
    expect(existsSync(path.join(root, epRunDirRel))).toBe(false);
  });

  it("keeps recent experience-planning work without feature-delivery until retention expires", async () => {
    const epRunDirRel = await seedExperiencePlanningRun(root);

    const result = await sweepExperiencePlanningWorkRetention(root, {
      clock: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    expect(result.archived).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(existsSync(path.join(root, epRunDirRel))).toBe(true);
  });

  it("archives experience-planning runs idempotently when already archived", async () => {
    const runDirRel = await seedExperiencePlanningRun(root);
    const first = await archiveExperiencePlanningRun(
      root,
      runDirRel,
      "first archive",
      new Date("2026-06-16T00:00:00.000Z"),
    );
    const second = await archiveExperiencePlanningRun(
      root,
      runDirRel,
      "second archive",
      new Date("2026-06-16T01:00:00.000Z"),
    );

    expect(first).toBe(`.pan/archive/work/${EP_DAY}/${EP_TASK}`);
    expect(second).toBe(`.pan/archive/work/${EP_DAY}/${EP_TASK}`);
  });
});
