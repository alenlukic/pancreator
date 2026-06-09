import { asTaskId, resolveProjectPath } from "@pancreator/core";
import { GitWorktreePool } from "@pancreator/worktree";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  closeFeatureDeliveryArtifacts,
  resolveFeatureDeliveryTaskId,
  runPanCheck,
  startFeatureDelivery,
  type FeatureDeliveryState,
  type StartFeatureDeliveryInput,
  type StartFeatureDeliveryResult,
} from "./feature-delivery-run.js";
import type { FeatureDeliveryTestHooks } from "./feature-delivery-runner.js";
import { secondsToMidnightUtc, utcHhmm } from "./intake-scaffold.js";
import { createNodeBatchGitOps, type BatchGitOps } from "./feature-delivery-batch-git-ops.js";
import {
  preserveFeatureDeliveryFailureContext,
  stageAndCommitCheckout,
} from "./feature-delivery-failure-preservation.js";

export const FEATURE_DELIVERY_WORKTREE_ISOLATION_ERROR =
  "Feature-delivery MUST run on an isolated git worktree under .pan/worktrees/. Use `pnpm -w exec pan run feature-delivery` or `pan batch run` — never `startFeatureDelivery` on the main checkout.";

function worktreesRootForMain(mainRepoRoot: string): string {
  return path.resolve(mainRepoRoot, ".pan", "worktrees");
}

/** Returns the repository root (parent of `.pan/`) for any checkout, including worktree slots. */
export function resolveMainRepositoryRoot(checkoutRoot: string): string {
  const resolved = path.resolve(checkoutRoot);
  const segments = resolved.split(path.sep);
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (segments[i] === ".pan" && segments[i + 1] === "worktrees") {
      return segments.slice(0, i).join(path.sep);
    }
  }
  return resolved;
}

/** True when `checkoutRoot` is a strict child of `mainRepoRoot/.pan/worktrees/`. */
export function isFeatureDeliveryWorktreeCheckout(mainRepoRoot: string, checkoutRoot: string): boolean {
  const main = path.resolve(mainRepoRoot);
  const checkout = path.resolve(checkoutRoot);
  const worktreesRoot = worktreesRootForMain(main);
  const rel = path.relative(worktreesRoot, checkout);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Repo checkout root containing `.pan/` for a feature-delivery state file path. */
export function checkoutRootFromStateFile(stateFileAbs: string): string {
  const panDir = path.resolve(stateFileAbs, "..", "..", "..", "..");
  return path.dirname(panDir);
}

export function singleRunBranchName(taskId: string): string {
  return `pan/run/${taskId}`;
}

export function assertFeatureDeliveryWorktreeCheckout(
  repoRoot: string,
  testHooks?: FeatureDeliveryTestHooks,
): void {
  if (testHooks?.bypassWorktreeIsolation) {
    return;
  }
  const mainRoot = resolveMainRepositoryRoot(repoRoot);
  if (!isFeatureDeliveryWorktreeCheckout(mainRoot, repoRoot)) {
    throw new Error(FEATURE_DELIVERY_WORKTREE_ISOLATION_ERROR);
  }
}

export async function copyInboxDirectiveToCheckout(
  mainRepoRoot: string,
  checkoutRoot: string,
  inboxRel: string,
): Promise<void> {
  const src = resolveProjectPath(mainRepoRoot, "lib", "inbox", "in", ...inboxRel.split("/"));
  const dest = resolveProjectPath(checkoutRoot, "lib", "inbox", "in", ...inboxRel.split("/"));
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
}

async function stateFileExists(candidate: string): Promise<boolean> {
  try {
    await readFile(candidate, "utf8");
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

async function listWorktreeCheckoutRoots(mainRepoRoot: string): Promise<string[]> {
  const main = path.resolve(mainRepoRoot);
  const worktreesRoot = worktreesRootForMain(main);
  if (!existsSync(worktreesRoot)) {
    return [];
  }
  const entries = await safeReaddir(worktreesRoot);
  return entries
    .filter((entry) => entry !== "pool-state.json")
    .map((entry) => path.join(worktreesRoot, entry))
    .filter((slotPath) => existsSync(slotPath));
}

/** Resolves the checkout root (main or worktree slot) that owns a task's state.json. */
export async function resolveFeatureDeliveryCheckoutRoot(
  repoRootInput: string,
  taskId: string,
): Promise<string> {
  const mainRoot = resolveMainRepositoryRoot(repoRootInput);
  const checkoutRoots = [mainRoot, ...await listWorktreeCheckoutRoots(mainRoot)];
  const matches: Array<{ abs: string; rel: string; checkoutRoot: string; rootKind: ".pan/work" | ".pan/archive" }> = [];

  for (const checkoutRoot of checkoutRoots) {
    const roots = [
      { abs: resolveProjectPath(checkoutRoot, ".pan/work"), rel: path.posix.join(".pan/work") },
      {
        abs: resolveProjectPath(checkoutRoot, ".pan/archive", "work"),
        rel: path.posix.join(".pan/archive", "work"),
      },
    ];
    for (const root of roots) {
      const dayDirs = await safeReaddir(root.abs);
      for (const day of dayDirs) {
        const candidate = path.join(root.abs, day, taskId, "state.json");
        if (await stateFileExists(candidate)) {
          matches.push({
            abs: candidate,
            rel: path.posix.join(root.rel, day, taskId, "state.json"),
            checkoutRoot,
            rootKind: root.rel === ".pan/work" ? ".pan/work" : ".pan/archive",
          });
        }
      }
    }
  }

  if (matches.length === 0) {
    await resolveFeatureDeliveryTaskId(mainRoot, taskId);
    throw new Error(`No feature-delivery state.json found for task ${taskId}.`);
  }

  const workMatches = matches.filter((match) => match.rootKind === ".pan/work");
  const archiveMatches = matches.filter((match) => match.rootKind === ".pan/archive");

  let chosen = workMatches[0] ?? archiveMatches[0]!;
  if (workMatches.length > 0 && archiveMatches.length > 0) {
    const workState = JSON.parse(await readFile(workMatches[0]!.abs, "utf8")) as FeatureDeliveryState;
    chosen = workState.status !== "closed" ? workMatches[0]! : archiveMatches[0]!;
  } else if (workMatches.length > 1) {
    chosen = workMatches[0]!;
  }

  const main = resolveMainRepositoryRoot(chosen.checkoutRoot);
  if (
    !isFeatureDeliveryWorktreeCheckout(main, chosen.checkoutRoot) &&
    chosen.rootKind === ".pan/work" &&
    existsSync(worktreesRootForMain(main))
  ) {
    const state = JSON.parse(await readFile(chosen.abs, "utf8")) as FeatureDeliveryState;
    const archivalStatus =
      state.status === "complete" || state.status === "closed" || state.currentStage === "complete";
    if (!archivalStatus) {
      throw new Error(
        `Task ${taskId} state lives on the main checkout (${chosen.checkoutRoot}). ` +
          "Feature-delivery requires worktree isolation — abort or archive the stale run before starting a new one.",
      );
    }
  }

  return chosen.checkoutRoot;
}

export interface RunIsolatedFeatureDeliveryInput extends StartFeatureDeliveryInput {
  baseRef?: string;
  gitOps?: BatchGitOps;
  worktreePool?: GitWorktreePool;
}

export interface RunIsolatedFeatureDeliveryResult extends StartFeatureDeliveryResult {
  worktreePath: string;
  branch: string;
  mainRepoRoot: string;
}

async function readSubRunState(
  checkoutRoot: string,
  startResult: StartFeatureDeliveryResult,
): Promise<FeatureDeliveryState> {
  const stateAbs = resolveProjectPath(checkoutRoot, startResult.stateFile);
  return JSON.parse(await readFile(stateAbs, "utf8")) as FeatureDeliveryState;
}

async function postCloseIsolatedRun(input: {
  checkoutRoot: string;
  taskId: string;
  branch: string;
  gitOps: BatchGitOps;
  pipelineCompleteMessage: string;
  closeMessage: string;
  clock?: () => Date;
}): Promise<void> {
  await input.gitOps.commit(input.checkoutRoot, input.pipelineCompleteMessage);
  const check = await runPanCheck(input.checkoutRoot);
  if (check.status !== "ok" || check.failCount > 0) {
    throw new Error(
      `Pre-close validation failed (${check.failCount} failing check(s)). Implementation committed on branch ${input.branch}; repair-state and re-run pan check before close-artifacts.`,
    );
  }
  await closeFeatureDeliveryArtifacts({
    repoRoot: input.checkoutRoot,
    taskId: input.taskId,
    clock: input.clock,
  });
  await input.gitOps.commit(input.checkoutRoot, input.closeMessage);
}

/**
 * Starts feature-delivery on an isolated git worktree. SDK runs auto-chain inside the worktree;
 * on `complete`, runs pre-close validation, close-artifacts, and commits on the worktree branch.
 * Failed or halted runs keep the worktree lease for repair-state.
 */
export async function runIsolatedFeatureDelivery(
  input: RunIsolatedFeatureDeliveryInput,
  command: "run" | "feature new" = "run",
): Promise<RunIsolatedFeatureDeliveryResult> {
  const mainRepoRoot = path.resolve(input.repoRoot);
  const gitOps = input.gitOps ?? createNodeBatchGitOps();
  const inboxRel = input.inboxEntry.trim().replace(/^lib\/inbox\/in\//u, "");
  const now = input.clock?.() ?? new Date();
  let taskId = input.taskId;
  if (taskId === undefined) {
    const inboxAbs = resolveProjectPath(mainRepoRoot, "lib", "inbox", "in", ...inboxRel.split("/"));
    const directive = await readFile(inboxAbs, "utf8");
    const title = directive.match(/^#\s+(.+)$/mu)?.[1];
    const slug = (title ?? path.posix.basename(inboxRel, path.posix.extname(inboxRel)))
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80);
    taskId = `${secondsToMidnightUtc(now)}_${utcHhmm(now)}_${slug}`;
  }
  const branch = singleRunBranchName(taskId);
  if (input.testHooks?.bypassWorktreeIsolation) {
    const startResult = await startFeatureDelivery(
      {
        ...input,
        repoRoot: mainRepoRoot,
        inboxEntry: inboxRel,
        taskId,
        testHooks: input.testHooks,
      },
      command,
    );
    return {
      ...startResult,
      worktreePath: mainRepoRoot,
      branch,
      mainRepoRoot,
    };
  }

  const baseRef = input.baseRef ?? (await gitOps.resolveHead(mainRepoRoot));

  const pool =
    input.worktreePool ??
    input.testHooks?.worktreePool ??
    new GitWorktreePool({ repoRoot: mainRepoRoot, maxConcurrent: 1 });
  const lease = await pool.acquire(asTaskId(taskId), { ref: baseRef, branch });

  let finalizeLease: "release" | "suspend" | false = false;
  try {
    await copyInboxDirectiveToCheckout(mainRepoRoot, lease.path, inboxRel);
    const startResult = await startFeatureDelivery(
      {
        ...input,
        repoRoot: lease.path,
        inboxEntry: inboxRel,
        taskId,
        testHooks: input.testHooks,
      },
      command,
    );

    const state = await readSubRunState(lease.path, startResult);
    if (state.status === "complete" && state.currentStage === "complete") {
      await postCloseIsolatedRun({
        checkoutRoot: lease.path,
        taskId: startResult.taskId,
        branch,
        gitOps,
        pipelineCompleteMessage: `isolated run: pipeline complete for ${startResult.taskId}`,
        closeMessage: `isolated run: close-artifacts for ${startResult.taskId}`,
        clock: input.clock,
      });
      finalizeLease = "release";
    } else if (state.status === "closed") {
      finalizeLease = "release";
    } else {
      await preserveFeatureDeliveryFailureContext({
        mainRepoRoot,
        checkoutRoot: lease.path,
        taskId: startResult.taskId,
        runDir: startResult.runDir,
        state,
        branch,
        clock: input.clock,
      });
      try {
        await stageAndCommitCheckout(lease.path, `isolated run: failure context for ${startResult.taskId}`);
      } catch {
        // Filesystem mirror on main is authoritative when git commit fails.
      }
      finalizeLease = "suspend";
    }

    return {
      ...startResult,
      worktreePath: lease.path,
      branch,
      mainRepoRoot,
    };
  } finally {
    if (finalizeLease === "release") {
      await pool.release(asTaskId(taskId));
    } else if (finalizeLease === "suspend") {
      await pool.suspendLease(asTaskId(taskId));
    }
  }
}
