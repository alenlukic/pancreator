import { resolveProjectPath } from "@pancreator/core";
import { rfc3339UtcMs } from "@pancreator/run-logger";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyCliJson } from "./canonical-json-io.js";
import type { FeatureDeliveryState } from "./feature-delivery-run.js";

export interface PreserveFeatureDeliveryFailureContextInput {
  mainRepoRoot: string;
  checkoutRoot: string;
  taskId: string;
  runDir: string;
  state?: FeatureDeliveryState;
  batchId?: string;
  branch?: string;
  error?: string;
  clock?: () => Date;
}

export interface PreserveFeatureDeliveryFailureContextResult {
  preservedRunDir: string | null;
  copiedInboxOutDayDirs: string[];
  manifestRel: string;
}

async function copyTreeIfExists(src: string, dest: string): Promise<boolean> {
  if (!existsSync(src)) {
    return false;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
  return true;
}

function dayDirFromRunDir(runDir: string): string | null {
  const parts = runDir.split("/").filter((segment) => segment.length > 0);
  if (parts.length < 3 || parts[0] !== ".pan" || parts[1] !== "work") {
    return null;
  }
  return parts[2] ?? null;
}

function gateArtifactPaths(runDir: string): string[] {
  return [
    path.posix.join(runDir, "review.md"),
    path.posix.join(runDir, "test-report.md"),
    path.posix.join(runDir, "design-qa-report.md"),
    path.posix.join(runDir, "implementation-report.md"),
    path.posix.join(runDir, "touch-set.json"),
    path.posix.join(runDir, "run.log.jsonl"),
    path.posix.join(runDir, "state.json"),
  ];
}

async function listExistingRelativePaths(repoRoot: string, relPaths: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const rel of relPaths) {
    if (existsSync(resolveProjectPath(repoRoot, ...rel.split("/")))) {
      existing.push(rel);
    }
  }
  return existing;
}

/**
 * Mirrors failure artifacts from an isolated checkout (worktree) onto the main repository
 * so halted batch sub-runs leave review/test reports and halt outboxes on the operator checkout.
 */
export async function preserveFeatureDeliveryFailureContext(
  input: PreserveFeatureDeliveryFailureContextInput,
): Promise<PreserveFeatureDeliveryFailureContextResult> {
  const mainRepoRoot = path.resolve(input.mainRepoRoot);
  const checkoutRoot = path.resolve(input.checkoutRoot);
  const now = input.clock?.() ?? new Date();
  const runDir = input.runDir.replace(/^\.\//u, "");
  const dayDir = dayDirFromRunDir(runDir);

  let preservedRunDir: string | null = null;
  const copiedInboxOutDayDirs: string[] = [];

  const runSrc = resolveProjectPath(checkoutRoot, ...runDir.split("/"));
  const runDest = resolveProjectPath(mainRepoRoot, ...runDir.split("/"));
  if (await copyTreeIfExists(runSrc, runDest)) {
    preservedRunDir = runDir;
  }

  if (dayDir !== null) {
    const outDayRel = path.posix.join("lib", "inbox", "out", dayDir);
    const outSrc = resolveProjectPath(checkoutRoot, ...outDayRel.split("/"));
    const outDest = resolveProjectPath(mainRepoRoot, ...outDayRel.split("/"));
    if (await copyTreeIfExists(outSrc, outDest)) {
      copiedInboxOutDayDirs.push(outDayRel);
    }
  }

  const gateArtifactsOnMain = await listExistingRelativePaths(mainRepoRoot, gateArtifactPaths(runDir));
  const manifestRel = path.posix.join(runDir, "failure-preservation.json");
  const manifest = {
    schemaVersion: 1 as const,
    preservedAtIso: rfc3339UtcMs(now),
    taskId: input.taskId,
    runDir,
    preservedRunDir,
    copiedInboxOutDayDirs,
    gateArtifacts: gateArtifactsOnMain,
    checkoutRoot,
    ...(input.batchId !== undefined ? { batchId: input.batchId } : {}),
    ...(input.branch !== undefined ? { branch: input.branch } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(input.state !== undefined
      ? {
          pipelineStatus: `${input.state.currentStage}/${input.state.status}`,
          featureId: input.state.featureId,
          ...(input.state.automation !== undefined
            ? { cumulativeRetryCount: input.state.automation.cumulativeRetryCount }
            : {}),
        }
      : {}),
  };
  const manifestAbs = resolveProjectPath(mainRepoRoot, ...manifestRel.split("/"));
  await mkdir(path.dirname(manifestAbs), { recursive: true });
  await writeFile(manifestAbs, `${stringifyCliJson(mainRepoRoot, manifest)}\n`, "utf8");

  return { preservedRunDir, copiedInboxOutDayDirs, manifestRel };
}

export function failurePreservationManifestRel(runDir: string): string {
  return path.posix.join(runDir, "failure-preservation.json");
}

export function assertPreservationManifestPresent(repoRoot: string, manifestRel: string): void {
  const abs = resolveProjectPath(repoRoot, ...manifestRel.split("/"));
  if (!existsSync(abs)) {
    throw new Error(
      `Failure preservation manifest is missing at ${manifestRel}; do not release worktree lease until preservation completes.`,
    );
  }
}

/**
 * Copies a mirrored failure run directory into durable recovery storage for post-mortem review.
 */
export async function archiveFailureContextToRecovery(input: {
  mainRepoRoot: string;
  runDir: string;
  taskId: string;
  batchId?: string;
}): Promise<string | null> {
  const recoveryRoot = input.batchId
    ? path.posix.join(".pan/archive/recovery", `batch-${input.batchId}`, input.taskId)
    : path.posix.join(".pan/archive/recovery", input.taskId);
  const src = resolveProjectPath(input.mainRepoRoot, ...input.runDir.split("/"));
  const dest = resolveProjectPath(input.mainRepoRoot, ...recoveryRoot.split("/"));
  if (!existsSync(src)) {
    return null;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
  return recoveryRoot;
}

export async function enrichRetryLimitHaltArtifact(input: {
  repoRoot: string;
  runDir: string;
  outboxRel: string;
}): Promise<void> {
  const abs = resolveProjectPath(input.repoRoot, ...input.outboxRel.split("/"));
  if (!existsSync(abs)) {
    return;
  }
  const gateArtifacts = await listExistingRelativePaths(input.repoRoot, gateArtifactPaths(input.runDir));
  if (gateArtifacts.length === 0) {
    return;
  }
  const sections: string[] = ["", "## Preserved gate artifacts", ""];
  for (const rel of gateArtifacts) {
    sections.push(`- \`${rel}\``);
    const artifactAbs = resolveProjectPath(input.repoRoot, ...rel.split("/"));
    const content = await readFile(artifactAbs, "utf8");
    const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? "";
    if (firstLine.length > 0 && firstLine.length <= 200) {
      sections.push(`  - preview: ${firstLine.trim()}`);
    }
  }
  const existing = await readFile(abs, "utf8");
  if (existing.includes("## Preserved gate artifacts")) {
    return;
  }
  await writeFile(abs, `${existing.trimEnd()}\n${sections.join("\n")}\n`, "utf8");
}

/** Commits all tracked and untracked changes when the checkout has a dirty tree. */
export async function stageAndCommitCheckout(repoRoot: string, message: string): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const root = path.resolve(repoRoot);
  await execFileAsync("git", ["-C", root, "add", "-A"], { encoding: "utf8" });
  const status = await execFileAsync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
  if (status.stdout.trim().length === 0) {
    return false;
  }
  await execFileAsync("git", ["-C", root, "commit", "-m", message], { encoding: "utf8" });
  return true;
}
