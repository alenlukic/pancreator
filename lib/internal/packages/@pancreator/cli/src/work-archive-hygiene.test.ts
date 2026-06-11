import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stringifyCliJson } from "./canonical-json-io.js";
import { durableFeatureIndexRel } from "./feature-delivery-stage-artifacts.js";
import { scanWorkArchiveHygiene } from "./work-archive-hygiene.js";

const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";

const tempRoots: string[] = [];
let hadAbbrevEnv = false;
let prevAbbrevEnv: string | undefined;

beforeEach(() => {
  hadAbbrevEnv = Object.hasOwn(process.env, JSON_FORMAT_ABBREV_ENV);
  prevAbbrevEnv = process.env[JSON_FORMAT_ABBREV_ENV];
  process.env[JSON_FORMAT_ABBREV_ENV] = "7";
});

afterEach(async () => {
  if (hadAbbrevEnv) {
    process.env[JSON_FORMAT_ABBREV_ENV] = prevAbbrevEnv;
  } else {
    delete process.env[JSON_FORMAT_ABBREV_ENV];
  }
  const { rm } = await import("node:fs/promises");
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function mkRepo(): Promise<string> {
  const root = await fsMkdtemp();
  tempRoots.push(root);
  await mkdir(path.join(root, ".pan/work"), { recursive: true });
  await mkdir(path.join(root, ".pan/archive", "work"), { recursive: true });
  await mkdir(path.join(root, "lib", "inbox", "in"), { recursive: true });
  return root;
}

async function fsMkdtemp(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(os.tmpdir(), "work-archive-hygiene-"));
}

async function writeCompleteRun(
  root: string,
  dayDir: string,
  taskId: string,
  featureId: string,
  inboxRel: string,
): Promise<void> {
  const runDir = path.join(root, ".pan/work", dayDir, taskId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(runDir, "state.json"),
    stringifyCliJson(root, {
      pipelineId: "feature-delivery",
      taskId,
      featureId,
      currentStage: "complete",
      status: "complete",
      source: { inboxPath: inboxRel },
      artifacts: { runDir: path.posix.join(".pan/work", dayDir, taskId) },
    }),
    "utf8",
  );
  const inboxTail = inboxRel.replace(/^lib\/inbox\/in\//, "");
  await mkdir(path.dirname(path.join(root, "lib", "inbox", "in", inboxTail)), { recursive: true });
  await writeFile(path.join(root, "lib", "inbox", "in", inboxTail), "# Directive", "utf8");
}

describe("scanWorkArchiveHygiene", () => {
  it("flags complete runs that remain under .pan/work/", async () => {
    const root = await mkRepo();
    const dayDir = "172971_06-04-26";
    const taskId = "10000_1200_demo-feature";
    const inboxRel = `lib/inbox/in/${dayDir}/demo-feature.md`;
    await writeCompleteRun(root, dayDir, taskId, "demo-feature", inboxRel);

    const result = await scanWorkArchiveHygiene(root);
    expect(result.pendingCloseCount).toBe(1);
    expect(result.issues.some((issue) => issue.code === "pending_close_artifacts" && issue.taskId === taskId)).toBe(
      true,
    );
    expect(result.issues.some((issue) => issue.code === "inbox_source_still_active")).toBe(true);
  });

  it("flags duplicate complete runs and prefers feature index task_id as canonical", async () => {
    const root = await mkRepo();
    const dayDir = "172971_06-04-26";
    const inboxRel = `lib/inbox/in/${dayDir}/shared.md`;
    const indexRel = durableFeatureIndexRel("demo-feature");
    await mkdir(path.dirname(path.join(root, indexRel)), { recursive: true });
    await writeFile(
      path.join(root, indexRel),
      stringifyCliJson(root, { task_id: "20000_1300_demo-feature" }),
      "utf8",
    );
    await writeCompleteRun(root, dayDir, "20000_1300_demo-feature", "demo-feature", inboxRel);
    await writeCompleteRun(root, dayDir, "30000_1400_demo-feature", "demo-feature", inboxRel);

    const result = await scanWorkArchiveHygiene(root);
    const duplicate = result.issues.find((issue) => issue.code === "duplicate_complete_run");
    expect(duplicate?.taskId).toBe("30000_1400_demo-feature");
    expect(duplicate?.remediation).toContain("20000_1300_demo-feature");
  });

  it("accepts compliance-audit workspaces without state.json", async () => {
    const root = await mkRepo();
    const taskDir = path.join(root, ".pan/work", "172971_06-04-26", "80200_1640_retire-governed-commit");
    await mkdir(taskDir, { recursive: true });
    await writeFile(path.join(taskDir, "compliance-audit.md"), "# Audit\n", "utf8");
    await writeFile(
      path.join(taskDir, "compliance-result.json"),
      stringifyCliJson(root, { compliance_passes: true }),
      "utf8",
    );

    const result = await scanWorkArchiveHygiene(root);
    expect(result.issues.some((issue) => issue.code === "orphan_work_dir")).toBe(false);
  });

  it("accepts batch ledger directories without state.json", async () => {
    const root = await mkRepo();
    const taskDir = path.join(root, ".pan/work", "172971_06-04-26", "batch-58309_0748_batch");
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      path.join(taskDir, "batch.json"),
      stringifyCliJson(root, { schemaVersion: 1, batchId: "58309_0748_batch", runs: [] }),
      "utf8",
    );

    const result = await scanWorkArchiveHygiene(root);
    expect(result.issues.some((issue) => issue.code === "orphan_work_dir")).toBe(false);
  });

  it("accepts out-of-band work directories without state.json", async () => {
    const root = await mkRepo();
    const taskDir = path.join(root, ".pan/work", "172971_06-04-26", "99999_manual_audit");
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      path.join(taskDir, "out-of-band.manifest.json"),
      stringifyCliJson(root, { reason: "Manual compliance audit workspace retained for operator review." }),
      "utf8",
    );

    const result = await scanWorkArchiveHygiene(root);
    expect(result.issues.some((issue) => issue.code === "orphan_work_dir")).toBe(false);
  });
});
