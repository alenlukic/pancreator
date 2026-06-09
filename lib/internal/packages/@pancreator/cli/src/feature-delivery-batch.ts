import { asTaskId, resolveProjectPath } from "@pancreator/core";
import { GitWorktreePool } from "@pancreator/worktree";
import { rfc3339UtcMs } from "@pancreator/run-logger";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { quoteJsonString, stringifyCliJson } from "./canonical-json-io.js";
import {
  createMemoryBatchGitOps,
  createNodeBatchGitOps,
  type BatchGitOps,
} from "./feature-delivery-batch-git-ops.js";
import {
  archiveFailureContextToRecovery,
  assertPreservationManifestPresent,
  preserveFeatureDeliveryFailureContext,
  stageAndCommitCheckout,
} from "./feature-delivery-failure-preservation.js";
import { copyInboxDirectiveToCheckout } from "./feature-delivery-worktree.js";
import {
  closeFeatureDeliveryArtifacts,
  runPanCheck,
  startFeatureDelivery,
  type FeatureDeliveryState,
  type PanCheckResult,
  type StartFeatureDeliveryResult,
} from "./feature-delivery-run.js";
import type { FeatureDeliveryTestHooks } from "./feature-delivery-runner.js";
import {
  createFeatureDeliveryBatchProgressReporter,
  type FeatureDeliveryBatchProgressReporter,
} from "./feature-delivery-sdk-progress.js";
import { readCursorInvocationMode } from "./pan-init.js";
import { makeUtcDayBucket, secondsToMidnightUtc, utcHhmm } from "./intake-scaffold.js";

export const BATCH_LEDGER_SCHEMA_VERSION = 1 as const;

export interface BatchRunArgs {
  inboxEntries: string[];
  parallel: number;
  baseRef?: string;
  mergeBranch?: string;
  dryRun: boolean;
}

export interface BatchRunOutcome {
  inboxEntry: string;
  taskId: string;
  branch: string;
  status: "success" | "failed";
  error?: string;
  runDir?: string;
  preservationManifest?: string;
  preservedRunDir?: string;
  recoveryArchiveDir?: string;
}

export interface BatchMergeRecord {
  status: "pending" | "complete" | "conflict" | "skipped";
  mergedBranches?: string[];
  conflictPaths?: string[];
  outboxArtifact?: string;
}

export interface BatchLedger {
  schemaVersion: typeof BATCH_LEDGER_SCHEMA_VERSION;
  batchId: string;
  dayDir: string;
  parallelism: number;
  baseRef: string;
  mergeBranch: string;
  startedAtIso: string;
  completedAtIso?: string;
  runs: BatchRunOutcome[];
  merge: BatchMergeRecord;
}

export interface BatchRunTestHooks extends FeatureDeliveryTestHooks {
  batchGitOps?: BatchGitOps;
  runPanCheck?: (repoRoot: string) => Promise<PanCheckResult>;
  closeArtifacts?: typeof closeFeatureDeliveryArtifacts;
  startFeatureDeliveryFn?: typeof startFeatureDelivery;
  gitCommit?: (repoRoot: string, message: string) => Promise<void>;
  worktreePool?: GitWorktreePool;
}

export interface RunFeatureDeliveryBatchInput {
  repoRoot: string;
  args: BatchRunArgs;
  clock?: () => Date;
  testHooks?: BatchRunTestHooks;
  progress?: FeatureDeliveryBatchProgressReporter;
  writeOut?: (chunk: string) => void;
  writeErr?: (chunk: string) => void;
}

export interface RunFeatureDeliveryBatchResult {
  command: "batch run";
  status: "ok" | "partial" | "failed";
  batchId: string;
  ledgerPath: string;
  exitCode: number;
  mergeStatus: BatchMergeRecord["status"];
  successCount: number;
  failureCount: number;
}

function normalizeInboxEntry(entry: string): string {
  const trimmed = entry.trim().replace(/^lib\/inbox\/in\//u, "");
  if (trimmed.length === 0 || trimmed.includes("..")) {
    throw new Error(`Invalid inbox entry: ${entry}`);
  }
  return trimmed;
}

function makeBatchId(now: Date): string {
  return `${secondsToMidnightUtc(now)}_${utcHhmm(now)}_batch`;
}

function defaultMergeBranch(batchId: string): string {
  return `pan/batch-${batchId}/integration`;
}

function runBranchName(batchId: string, taskId: string): string {
  return `pan/batch-${batchId}/${taskId}`;
}

function sanitizeFeatureSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/u, "")
    .replace(/^\d+_\d+_/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  if (slug.length === 0) {
    throw new Error("feature id MUST contain at least one alphanumeric character.");
  }
  return slug;
}

function deriveFeatureId(inboxEntry: string, directive: string): string {
  const title = directive.match(/^#\s+(.+)$/mu)?.[1];
  return sanitizeFeatureSlug(title ?? path.posix.basename(inboxEntry, path.posix.extname(inboxEntry)));
}

function makeSubRunTaskId(now: Date, featureId: string): string {
  return `${secondsToMidnightUtc(now)}_${utcHhmm(now)}_${featureId}`;
}

async function resolveSubRunTaskId(
  repoRoot: string,
  inboxEntry: string,
  now: Date,
): Promise<string> {
  const inboxAbs = resolveProjectPath(repoRoot, "lib", "inbox", "in", ...inboxEntry.split("/"));
  const directive = await readFile(inboxAbs, "utf8");
  return makeSubRunTaskId(now, deriveFeatureId(inboxEntry, directive));
}

export { createMemoryBatchGitOps, createNodeBatchGitOps, type BatchGitOps } from "./feature-delivery-batch-git-ops.js";

async function writeBatchLedger(repoRoot: string, ledgerRel: string, ledger: BatchLedger): Promise<void> {
  const abs = resolveProjectPath(repoRoot, ...ledgerRel.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${stringifyCliJson(repoRoot, ledger)}\n`, "utf8");
}

function mergeConflictOutboxName(now: Date, batchId: string): string {
  return `${secondsToMidnightUtc(now)}_${utcHhmm(now)}_batch-merge-conflict-${batchId}.md`;
}

async function writeMergeConflictOutbox(
  repoRoot: string,
  now: Date,
  batchId: string,
  ledger: BatchLedger,
): Promise<string> {
  const basename = mergeConflictOutboxName(now, batchId);
  const rel = path.posix.join("lib", "inbox", "out", basename);
  const abs = resolveProjectPath(repoRoot, ...rel.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  const body = [
    "---",
    `title: "Batch merge conflict (${batchId})"`,
    `batch_id: ${quoteJsonString(batchId)}`,
    `created_at: ${quoteJsonString(rfc3339UtcMs(now))}`,
    "---",
    "",
    "# Batch merge conflict",
    "",
    `Batch \`${batchId}\` stopped during merge into \`${ledger.mergeBranch}\`.`,
    "",
    "## Conflict paths",
    "",
    ...(ledger.merge.conflictPaths ?? []).map((p) => `- ${p}`),
    "",
    "## Successful runs",
    "",
    ...ledger.runs
      .filter((run) => run.status === "success")
      .map((run) => `- ${run.taskId} (${run.branch})`),
    "",
  ].join("\n");
  await writeFile(abs, body, "utf8");
  return rel;
}

function formatDryRunPlan(input: {
  batchId: string;
  args: BatchRunArgs;
  baseRef: string;
  mergeBranch: string;
  branches: string[];
}): string {
  const lines = [
    `batchId: ${input.batchId}`,
    `parallelism: ${input.args.parallel}`,
    `baseRef: ${input.baseRef}`,
    `mergeBranch: ${input.mergeBranch}`,
    "inbox order:",
    ...input.args.inboxEntries.map((entry, index) => `  ${index + 1}. ${entry} → ${input.branches[index]}`),
  ];
  return lines.join("\n");
}

async function readSubRunState(
  worktreeRoot: string,
  startResult: StartFeatureDeliveryResult,
): Promise<FeatureDeliveryState> {
  const stateAbs = resolveProjectPath(worktreeRoot, ...startResult.stateFile.split("/"));
  const raw = await readFile(stateAbs, "utf8");
  return JSON.parse(raw) as FeatureDeliveryState;
}

async function mirrorFailedSubRunContext(input: {
  repoRoot: string;
  leasePath: string;
  startResult: StartFeatureDeliveryResult;
  state: FeatureDeliveryState;
  taskId: string;
  branch: string;
  batchId: string;
  error: string;
  clock?: () => Date;
}): Promise<Pick<BatchRunOutcome, "preservationManifest" | "preservedRunDir" | "recoveryArchiveDir">> {
  const preservation = await preserveFeatureDeliveryFailureContext({
    mainRepoRoot: input.repoRoot,
    checkoutRoot: input.leasePath,
    taskId: input.taskId,
    runDir: input.startResult.runDir,
    state: input.state,
    batchId: input.batchId,
    branch: input.branch,
    error: input.error,
    clock: input.clock,
  });
  if (preservation.manifestRel.length > 0) {
    assertPreservationManifestPresent(input.repoRoot, preservation.manifestRel);
  }
  const recoveryArchiveDir =
    preservation.preservedRunDir === null
      ? undefined
      : (await archiveFailureContextToRecovery({
          mainRepoRoot: input.repoRoot,
          runDir: preservation.preservedRunDir,
          taskId: input.taskId,
          batchId: input.batchId,
        })) ?? undefined;
  try {
    await stageAndCommitCheckout(
      input.leasePath,
      `batch ${input.batchId}: failure context for ${input.taskId}`,
    );
  } catch {
    // Filesystem mirror on main is authoritative when git commit fails.
  }
  return {
    preservationManifest: preservation.manifestRel,
    preservedRunDir: preservation.preservedRunDir ?? undefined,
    recoveryArchiveDir,
  };
}

export async function runFeatureDeliveryBatch(
  input: RunFeatureDeliveryBatchInput,
): Promise<RunFeatureDeliveryBatchResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.clock?.() ?? new Date();
  const writeOut = input.writeOut ?? ((chunk: string) => process.stdout.write(chunk));
  const writeErr = input.writeErr ?? ((chunk: string) => process.stderr.write(chunk));
  const progress =
    input.progress ??
    createFeatureDeliveryBatchProgressReporter({ writeErr, now: () => now });
  const args: BatchRunArgs = {
    ...input.args,
    inboxEntries: input.args.inboxEntries.map(normalizeInboxEntry),
  };
  if (args.inboxEntries.length === 0) {
    throw new Error("batch run requires at least one inbox entry.");
  }
  if (args.parallel < 1) {
    throw new Error("--parallel must be at least 1.");
  }

  const batchId = makeBatchId(now);
  const dayDir = makeUtcDayBucket(now);
  const ledgerRel = path.posix.join(".pan/work", dayDir, `batch-${batchId}`, "batch.json");
  const gitOps = input.testHooks?.batchGitOps ?? createNodeBatchGitOps();
  const mergeBranch = args.mergeBranch ?? defaultMergeBranch(batchId);
  const branches = await Promise.all(
    args.inboxEntries.map(async (entry) => {
      const taskId = await resolveSubRunTaskId(repoRoot, entry, now);
      return runBranchName(batchId, taskId);
    }),
  );

  if (args.dryRun) {
    const baseRef = args.baseRef ?? "HEAD";
    const plan = formatDryRunPlan({ batchId, args, baseRef, mergeBranch, branches });
    writeErr(`${plan}\n`);
    writeOut(
      `${stringifyCliJson(repoRoot, {
        command: "batch run",
        status: "ok",
        dryRun: true,
        batchId,
        parallelism: args.parallel,
        baseRef,
        mergeBranch,
        inboxEntries: args.inboxEntries,
        branches,
      })}\n`,
    );
    return {
      command: "batch run",
      status: "ok",
      batchId,
      ledgerPath: ledgerRel,
      exitCode: 0,
      mergeStatus: "skipped",
      successCount: 0,
      failureCount: 0,
    };
  }

  const invocation = await readCursorInvocationMode(repoRoot);
  if (invocation !== "sdk") {
    throw new Error("batch run requires runner.cursor.invocation: sdk in pancreator.yaml.");
  }

  const baseRef = args.baseRef ?? (await gitOps.resolveHead(repoRoot));

  const ledger: BatchLedger = {
    schemaVersion: BATCH_LEDGER_SCHEMA_VERSION,
    batchId,
    dayDir,
    parallelism: args.parallel,
    baseRef,
    mergeBranch,
    startedAtIso: rfc3339UtcMs(now),
    runs: [],
    merge: { status: "pending" },
  };
  await writeBatchLedger(repoRoot, ledgerRel, ledger);

  progress.emit({
    kind: "batch_enter",
    batchId,
    parallelism: args.parallel,
    atIso: rfc3339UtcMs(now),
  });

  const pool =
    input.testHooks?.worktreePool ??
    new GitWorktreePool({ repoRoot, maxConcurrent: args.parallel });
  const startFn = input.testHooks?.startFeatureDeliveryFn ?? startFeatureDelivery;
  const panCheckFn = input.testHooks?.runPanCheck ?? runPanCheck;
  const closeFn = input.testHooks?.closeArtifacts ?? closeFeatureDeliveryArtifacts;
  const commitFn = input.testHooks?.gitCommit ?? gitOps.commit.bind(gitOps);

  let nextIndex = 0;
  let activeCount = 0;
  const pending = new Set<Promise<void>>();

  const runOne = async (inboxEntry: string, branch: string): Promise<void> => {
    let taskId = "";
    let leasePath: string | undefined;
    let leaseTaskId: ReturnType<typeof asTaskId> | undefined;
    let startResult: StartFeatureDeliveryResult | undefined;
    let finalizeLease: "release" | "suspend" | false = false;
    try {
      const runNow = input.clock?.() ?? new Date();
      taskId = await resolveSubRunTaskId(repoRoot, inboxEntry, runNow);
      const lease = await pool.acquire(asTaskId(taskId), {
        ref: baseRef,
        branch,
      });
      leaseTaskId = lease.taskId;
      leasePath = lease.path;
      progress.emit({
        kind: "batch_run_start",
        batchId,
        taskId,
        inboxEntry,
        branch,
        atIso: rfc3339UtcMs(runNow),
      });

      await copyInboxDirectiveToCheckout(repoRoot, lease.path, inboxEntry);

      startResult = await startFn(
        {
          repoRoot: lease.path,
          inboxEntry,
          taskId,
          clock: input.clock,
          testHooks: input.testHooks,
        },
        "run",
      );
      taskId = startResult.taskId;
      const state = await readSubRunState(lease.path, startResult);

      if (state.currentStage !== "complete" || state.status !== "complete") {
        const error = `Sub-run ended at ${state.currentStage}/${state.status}.`;
        finalizeLease = "suspend";
        const preservation = await mirrorFailedSubRunContext({
          repoRoot,
          leasePath: lease.path,
          startResult,
          state,
          taskId,
          branch,
          batchId,
          error,
          clock: input.clock,
        });
        ledger.runs.push({
          inboxEntry,
          taskId,
          branch,
          status: "failed",
          error,
          runDir: startResult.runDir,
          ...preservation,
        });
        progress.emit({
          kind: "batch_run_failed",
          batchId,
          taskId,
          inboxEntry,
          error,
          atIso: rfc3339UtcMs(input.clock?.() ?? new Date()),
        });
        return;
      }

      // Commit pipeline-complete implementation before pre-close gates so failed pan check
      // does not discard uncommitted work when the worktree lease is released.
      await commitFn(lease.path, `batch ${batchId}: pipeline complete for ${taskId}`);

      const check = await panCheckFn(lease.path);
      if (check.status !== "ok" || check.failCount > 0) {
        const error = `Pre-close validation failed (${check.failCount} failing check(s)). Implementation committed on branch ${branch}; repair-state and re-run pan check before close-artifacts.`;
        finalizeLease = "suspend";
        const preservation = await mirrorFailedSubRunContext({
          repoRoot,
          leasePath: lease.path,
          startResult,
          state,
          taskId,
          branch,
          batchId,
          error,
          clock: input.clock,
        });
        ledger.runs.push({
          inboxEntry,
          taskId,
          branch,
          status: "failed",
          error,
          runDir: startResult.runDir,
          ...preservation,
        });
        progress.emit({
          kind: "batch_run_failed",
          batchId,
          taskId,
          inboxEntry,
          error,
          atIso: rfc3339UtcMs(input.clock?.() ?? new Date()),
        });
        return;
      }

      await closeFn({ repoRoot: lease.path, taskId, clock: input.clock });
      await commitFn(lease.path, `batch ${batchId}: close-artifacts for ${taskId}`);
      finalizeLease = "release";

      ledger.runs.push({
        inboxEntry,
        taskId,
        branch,
        status: "success",
        runDir: startResult.runDir,
      });
      progress.emit({
        kind: "batch_run_complete",
        batchId,
        taskId,
        inboxEntry,
        branch,
        atIso: rfc3339UtcMs(input.clock?.() ?? new Date()),
      });
    } catch (error) {
      finalizeLease = "suspend";
      const message = error instanceof Error ? error.message : String(error);
      const failedTaskId =
        taskId.length > 0 ? taskId : path.posix.basename(inboxEntry, path.posix.extname(inboxEntry));
      let preservation: Pick<BatchRunOutcome, "preservationManifest" | "preservedRunDir"> = {};
      if (leasePath !== undefined && startResult !== undefined) {
        try {
          const state = await readSubRunState(leasePath, startResult);
          preservation = await mirrorFailedSubRunContext({
            repoRoot,
            leasePath,
            startResult,
            state,
            taskId: failedTaskId,
            branch,
            batchId,
            error: message,
            clock: input.clock,
          });
        } catch {
          // Best-effort preservation; never mask the original batch error.
        }
      }
      ledger.runs.push({
        inboxEntry,
        taskId: failedTaskId,
        branch,
        status: "failed",
        error: message,
        ...(startResult !== undefined ? { runDir: startResult.runDir } : {}),
        ...preservation,
      });
      progress.emit({
        kind: "batch_run_failed",
        batchId,
        taskId: taskId.length > 0 ? taskId : undefined,
        inboxEntry,
        error: message,
        atIso: rfc3339UtcMs(input.clock?.() ?? new Date()),
      });
    } finally {
      if (leaseTaskId !== undefined) {
        if (finalizeLease === "release") {
          await pool.release(leaseTaskId);
        } else if (finalizeLease === "suspend") {
          await pool.suspendLease(leaseTaskId);
        }
      }
      activeCount -= 1;
      await writeBatchLedger(repoRoot, ledgerRel, ledger);
    }
  };

  await new Promise<void>((resolve, reject) => {
    const pump = (): void => {
      while (activeCount < args.parallel && nextIndex < args.inboxEntries.length) {
        const inboxEntry = args.inboxEntries[nextIndex]!;
        const branch = branches[nextIndex]!;
        nextIndex += 1;
        activeCount += 1;
        const job = runOne(inboxEntry, branch)
          .catch((error) => {
            reject(error);
          })
          .finally(() => {
            pending.delete(job);
            progress.emit({
              kind: "batch_slot_free",
              batchId,
              atIso: rfc3339UtcMs(input.clock?.() ?? new Date()),
            });
            if (nextIndex >= args.inboxEntries.length && activeCount === 0) {
              resolve();
              return;
            }
            pump();
          });
        pending.add(job);
      }
      if (nextIndex >= args.inboxEntries.length && activeCount === 0) {
        resolve();
      }
    };
    pump();
  });

  const successes = ledger.runs.filter((run) => run.status === "success");
  const failures = ledger.runs.filter((run) => run.status === "failed");

  if (successes.length === 0) {
    ledger.merge = { status: "skipped" };
    ledger.completedAtIso = rfc3339UtcMs(input.clock?.() ?? new Date());
    await writeBatchLedger(repoRoot, ledgerRel, ledger);
    progress.emit({
      kind: "batch_complete",
      batchId,
      atIso: rfc3339UtcMs(input.clock?.() ?? new Date()),
    });
    return {
      command: "batch run",
      status: failures.length > 0 ? "partial" : "ok",
      batchId,
      ledgerPath: ledgerRel,
      exitCode: failures.length > 0 ? 1 : 0,
      mergeStatus: "skipped",
      successCount: 0,
      failureCount: failures.length,
    };
  }

  progress.emit({
    kind: "batch_merge_start",
    batchId,
    mergeBranch,
    atIso: rfc3339UtcMs(input.clock?.() ?? new Date()),
  });

  await gitOps.createBranch(repoRoot, mergeBranch, baseRef);
  const mergedBranches: string[] = [];
  let exitCode = 0;

  for (let i = 0; i < args.inboxEntries.length; i += 1) {
    const inboxEntry = args.inboxEntries[i]!;
    const branch = branches[i]!;
    const outcome = ledger.runs.find((run) => run.inboxEntry === inboxEntry && run.status === "success");
    if (outcome === undefined) {
      continue;
    }
    const mergeResult = await gitOps.mergeNoFf(repoRoot, branch);
    if (mergeResult.status === "conflict") {
      ledger.merge = {
        status: "conflict",
        mergedBranches,
        conflictPaths: mergeResult.paths,
      };
      const outboxRel = await writeMergeConflictOutbox(repoRoot, input.clock?.() ?? new Date(), batchId, ledger);
      ledger.merge.outboxArtifact = outboxRel;
      ledger.completedAtIso = rfc3339UtcMs(input.clock?.() ?? new Date());
      await writeBatchLedger(repoRoot, ledgerRel, ledger);
      progress.emit({
        kind: "batch_complete",
        batchId,
        atIso: rfc3339UtcMs(input.clock?.() ?? new Date()),
      });
      writeOut(
        `${stringifyCliJson(repoRoot, {
          command: "batch run",
          status: "failed",
          batchId,
          ledgerPath: ledgerRel,
          mergeStatus: "conflict",
          conflictPaths: mergeResult.paths,
          outboxArtifact: outboxRel,
        })}\n`,
      );
      return {
        command: "batch run",
        status: "failed",
        batchId,
        ledgerPath: ledgerRel,
        exitCode: 1,
        mergeStatus: "conflict",
        successCount: successes.length,
        failureCount: failures.length,
      };
    }
    mergedBranches.push(branch);
  }

  ledger.merge = { status: "complete", mergedBranches };
  ledger.completedAtIso = rfc3339UtcMs(input.clock?.() ?? new Date());
  await writeBatchLedger(repoRoot, ledgerRel, ledger);
  progress.emit({
    kind: "batch_complete",
    batchId,
    atIso: rfc3339UtcMs(input.clock?.() ?? new Date()),
  });

  if (failures.length > 0) {
    exitCode = 1;
  }

  writeOut(
    `${stringifyCliJson(repoRoot, {
      command: "batch run",
      status: failures.length > 0 ? "partial" : "ok",
      batchId,
      ledgerPath: ledgerRel,
      mergeStatus: "complete",
      successCount: successes.length,
      failureCount: failures.length,
      mergedBranches,
    })}\n`,
  );

  return {
    command: "batch run",
    status: failures.length > 0 ? "partial" : "ok",
    batchId,
    ledgerPath: ledgerRel,
    exitCode,
    mergeStatus: "complete",
    successCount: successes.length,
    failureCount: failures.length,
  };
}
