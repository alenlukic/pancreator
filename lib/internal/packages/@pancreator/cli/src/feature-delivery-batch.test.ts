import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { GitWorktreePool, createMemoryGitOps } from "@pancreator/worktree";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createMemoryBatchGitOps,
  runFeatureDeliveryBatch,
  type BatchRunTestHooks,
} from "./feature-delivery-batch.js";
import type { FeatureDeliveryState, PanCheckResult, StartFeatureDeliveryResult } from "./feature-delivery-run.js";
import { parseAndRun } from "./run.js";
import { stringifyCliJson } from "./canonical-json-io.js";

const CANONICAL_REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

async function seedMinimalBatchRepo(root: string): Promise<void> {
  await mkdir(path.join(root, "lib", "inbox", "in"), { recursive: true });
  await mkdir(path.join(root, "lib", "pipelines"), { recursive: true });
  await mkdir(path.join(root, ".pan", "worktrees"), { recursive: true });
  await copyFile(
    path.join(CANONICAL_REPO_ROOT, "lib", "pipelines", "feature-delivery.yaml"),
    path.join(root, "lib", "pipelines", "feature-delivery.yaml"),
  );
  await writeFile(
    path.join(root, "pancreator.yaml"),
    `project_root: "."
runner:
  cursor:
    invocation: sdk
`,
    "utf8",
  );
}

function passPanCheck(): PanCheckResult {
  return {
    command: "check",
    status: "ok",
    passCount: 1,
    failCount: 0,
    skipCount: 0,
    checks: [],
  };
}

function mockStartResult(
  repoRoot: string,
  inboxEntry: string,
  taskId: string,
  stage: FeatureDeliveryState["currentStage"],
  status: FeatureDeliveryState["status"],
): { result: StartFeatureDeliveryResult; state: FeatureDeliveryState } {
  const dayDir = "172970_06-05-26";
  const runDir = path.posix.join("work", dayDir, taskId);
  const state: FeatureDeliveryState = {
    schemaVersion: "1",
    pipelineId: "feature-delivery",
    taskId,
    featureId: path.posix.basename(inboxEntry, ".md"),
    status,
    currentStage: stage,
    createdAtIso: "2026-06-05T12:00:00.000Z",
    source: {
      inboxEntry,
      inboxPath: path.posix.join("lib", "inbox", "in", inboxEntry),
    },
    artifacts: {
      runDir,
      stateFile: path.posix.join(runDir, "state.json"),
      handoffFile: path.posix.join(runDir, "handoff.md"),
      runLogFile: path.posix.join(runDir, "run.log.jsonl"),
    },
    stages: [],
    transitions: [],
    nextHumanAction: "done",
  };
  return {
    state,
    result: {
      command: "run",
      status: "ok",
      pipelineId: "feature-delivery",
      taskId,
      featureId: state.featureId,
      runDir,
      stateFile: state.artifacts.stateFile,
      handoffFile: state.artifacts.handoffFile,
      runLogFile: state.artifacts.runLogFile,
      nextPromptFile: path.posix.join(runDir, "next-prompt.md"),
      currentStage: "intake",
      nextHumanAction: "done",
    },
  };
}

async function writeMockState(repoRoot: string, state: FeatureDeliveryState): Promise<void> {
  const stateAbs = path.join(repoRoot, state.artifacts.stateFile);
  await mkdir(path.dirname(stateAbs), { recursive: true });
  await writeFile(stateAbs, stringifyCliJson(repoRoot, state), "utf8");
}

const JSON_FORMAT_ABBREV_ENV = "PAN_JSON_FORMAT_ABBREV_LEN";

describe("feature-delivery-batch", () => {
  const fixedClock = () => new Date("2026-06-05T12:00:00.000Z");

  beforeEach(() => {
    process.env[JSON_FORMAT_ABBREV_ENV] = "7";
  });

  afterEach(() => {
    delete process.env[JSON_FORMAT_ABBREV_ENV];
  });

  it("dry-run prints plan without creating worktree slots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-batch-dry-run-"));
    await seedMinimalBatchRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "a.md"), "# Feature A", "utf8");
    await writeFile(path.join(root, "lib", "inbox", "in", "b.md"), "# Feature B", "utf8");
    const err: string[] = [];
    const code = await parseAndRun(["batch", "run", "--dry-run", "a.md", "b.md"], {
      repoRoot: root,
      writeErr: (chunk) => err.push(chunk),
      clock: fixedClock,
    });
    expect(code).toBe(0);
    expect(err.join("")).toContain("parallelism: 1");
    expect(err.join("")).toContain("a.md");
    expect(err.join("")).toContain("b.md");
    const worktrees = path.join(root, ".pan", "worktrees");
    const entries = existsSync(worktrees) ? await import("node:fs/promises").then((m) => m.readdir(worktrees)) : [];
    expect(entries.filter((name) => name !== "pool-state.json")).toHaveLength(0);
  });

  it("continues after a halted first sub-run and merges only successful branches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-batch-sequential-"));
    await seedMinimalBatchRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "a.md"), "# Feature A", "utf8");
    await writeFile(path.join(root, "lib", "inbox", "in", "b.md"), "# Feature B", "utf8");

    const gitOps = createMemoryBatchGitOps();
    const memoryGitOps = createMemoryGitOps();
    const pool = new GitWorktreePool({ repoRoot: root, gitOps: memoryGitOps, maxConcurrent: 1 });
    let call = 0;
    const hooks: BatchRunTestHooks = {
      worktreePool: pool,
      batchGitOps: gitOps,
      runPanCheck: async () => passPanCheck(),
      closeArtifacts: async () =>
        ({ command: "close-artifacts", status: "ok", taskId: "t", featureId: "f" }) as Awaited<
          ReturnType<NonNullable<BatchRunTestHooks["closeArtifacts"]>>
        >,
      gitCommit: async () => undefined,
      startFeatureDeliveryFn: async (input) => {
        call += 1;
        const taskId = input.taskId ?? path.posix.basename(input.inboxEntry, ".md");
        const stage = call === 1 ? "review" : "complete";
        const status = call === 1 ? "halted" : "complete";
        const mocked = mockStartResult(input.repoRoot, input.inboxEntry, taskId, stage, status);
        await writeMockState(input.repoRoot, mocked.state);
        return mocked.result;
      },
    };

    const code = await parseAndRun(["batch", "run", "a.md", "b.md"], {
      repoRoot: root,
      clock: fixedClock,
      batchTestHooks: hooks,
    });
    expect(code).toBe(1);
    expect(call).toBe(2);
    expect(gitOps.log.filter((entry) => entry.op === "mergeNoFf")).toHaveLength(1);
  });

  it("runs at most two sub-runs concurrently for --parallel 2", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-batch-parallel-"));
    await seedMinimalBatchRepo(root);
    for (const name of ["a.md", "b.md", "c.md"]) {
      await writeFile(path.join(root, "lib", "inbox", "in", name), `# ${name}`, "utf8");
    }

    let inFlight = 0;
    let maxInFlight = 0;
    const gitOps = createMemoryBatchGitOps();
    const pool = new GitWorktreePool({ repoRoot: root, gitOps: createMemoryGitOps(), maxConcurrent: 2 });
    const hooks: BatchRunTestHooks = {
      worktreePool: pool,
      batchGitOps: gitOps,
      runPanCheck: async () => passPanCheck(),
      closeArtifacts: async () =>
        ({ command: "close-artifacts", status: "ok", taskId: "t", featureId: "f" }) as Awaited<
          ReturnType<NonNullable<BatchRunTestHooks["closeArtifacts"]>>
        >,
      gitCommit: async () => undefined,
      startFeatureDeliveryFn: async (input) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        const taskId = input.taskId ?? path.posix.basename(input.inboxEntry, ".md");
        const mocked = mockStartResult(input.repoRoot, input.inboxEntry, taskId, "complete", "complete");
        await writeMockState(input.repoRoot, mocked.state);
        return mocked.result;
      },
    };

    const code = await parseAndRun(["batch", "run", "--parallel", "2", "a.md", "b.md", "c.md"], {
      repoRoot: root,
      clock: fixedClock,
      batchTestHooks: hooks,
    });
    expect(code).toBe(0);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("records merge conflicts in batch.json and writes an outbox artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-batch-merge-conflict-"));
    await seedMinimalBatchRepo(root);
    await writeFile(path.join(root, "lib", "inbox", "in", "a.md"), "# Feature A", "utf8");

    const gitOps = createMemoryBatchGitOps();
    gitOps.conflictOnBranch = "*";
    const pool = new GitWorktreePool({ repoRoot: root, gitOps: createMemoryGitOps(), maxConcurrent: 1 });
    const hooks: BatchRunTestHooks = {
      worktreePool: pool,
      batchGitOps: gitOps,
      runPanCheck: async () => passPanCheck(),
      closeArtifacts: async () =>
        ({ command: "close-artifacts", status: "ok", taskId: "t", featureId: "f" }) as Awaited<
          ReturnType<NonNullable<BatchRunTestHooks["closeArtifacts"]>>
        >,
      gitCommit: async () => undefined,
      startFeatureDeliveryFn: async (input) => {
        const taskId = input.taskId ?? "feature-a";
        const mocked = mockStartResult(input.repoRoot, input.inboxEntry, taskId, "complete", "complete");
        await writeMockState(input.repoRoot, mocked.state);
        return mocked.result;
      },
    };

    const code = await parseAndRun(["batch", "run", "a.md"], {
      repoRoot: root,
      clock: fixedClock,
      batchTestHooks: hooks,
    });
    expect(code).toBe(1);

    const batchDir = path.join(root, "work", "172970_06-05-26");
    const batchFolders = (await import("node:fs/promises").then((m) => m.readdir(batchDir))).filter((name) =>
      name.startsWith("batch-"),
    );
    expect(batchFolders).toHaveLength(1);
    const ledgerPath = path.join(batchDir, batchFolders[0]!, "batch.json");
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      merge: { status: string; conflictPaths?: string[]; outboxArtifact?: string };
    };
    expect(ledger.merge.status).toBe("conflict");
    expect(ledger.merge.conflictPaths).toEqual(["conflict.txt"]);
    expect(ledger.merge.outboxArtifact).toMatch(/^lib\/inbox\/out\/\d+_\d{4}_batch-merge-conflict-/u);
    const outboxAbs = path.join(root, ledger.merge.outboxArtifact ?? "");
    expect(existsSync(outboxAbs)).toBe(true);
  });

  it("runFeatureDeliveryBatch rejects non-sdk invocation mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-batch-sdk-required-"));
    await seedMinimalBatchRepo(root);
    await writeFile(
      path.join(root, "pancreator.yaml"),
      `project_root: "."
runner:
  cursor:
    invocation: manual
`,
      "utf8",
    );
    await writeFile(path.join(root, "lib", "inbox", "in", "a.md"), "# Feature A", "utf8");
    await expect(
      runFeatureDeliveryBatch({
        repoRoot: root,
        args: { inboxEntries: ["a.md"], parallel: 1, dryRun: false, baseRef: "HEAD" },
        clock: fixedClock,
        testHooks: { batchGitOps: createMemoryBatchGitOps() },
      }),
    ).rejects.toThrow(/requires runner\.cursor\.invocation: sdk/u);
  });
});
