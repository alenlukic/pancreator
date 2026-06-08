import { resolveRepoPath } from "@pancreator/core";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { extractTouchSetPaths } from "./context-review.js";
import { loadFeatureDeliveryStateForTask } from "./feature-delivery-run.js";
import { stringifyCliJson } from "./canonical-json-io.js";

export function sandboxDirRel(taskId: string): string {
  return path.posix.join(".sandbox", taskId);
}

export function sandboxManifestRel(taskId: string): string {
  return path.posix.join(sandboxDirRel(taskId), "manifest.json");
}

function assertSafeRepoRelative(rel: string): string {
  const norm = rel.replace(/\\/gu, "/").replace(/^\/+/u, "");
  if (norm === "" || norm.includes("\0") || norm.split("/").some((part) => part === "..")) {
    throw new Error(`Path MUST be a safe repo-relative path: ${rel}.`);
  }
  return norm;
}

async function copyPathIntoSandbox(input: {
  repoRoot: string;
  taskId: string;
  sourceRel: string;
  sandboxRootAbs: string;
}): Promise<{ sourceRel: string; destRel: string; kind: "file" | "directory" | "missing" }> {
  const sourceRel = assertSafeRepoRelative(input.sourceRel);
  const sourceAbs = resolveRepoPath(input.repoRoot, sourceRel);
  const destAbs = path.join(input.sandboxRootAbs, sourceRel);
  const destRel = path.posix.join(sandboxDirRel(input.taskId), sourceRel);

  if (!existsSync(sourceAbs)) {
    return { sourceRel, destRel, kind: "missing" };
  }

  const info = await stat(sourceAbs);
  await mkdir(path.dirname(destAbs), { recursive: true });
  await cp(sourceAbs, destAbs, { recursive: true, force: true });
  return { sourceRel, destRel, kind: info.isDirectory() ? "directory" : "file" };
}

export interface PrepareSandboxInput {
  repoRoot: string;
  taskId: string;
  clock?: () => Date;
}

export interface PrepareSandboxResult {
  command: "sandbox prepare";
  status: "ok";
  taskId: string;
  runDir: string;
  sandboxDir: string;
  manifestFile: string;
  copied: Array<{ sourceRel: string; destRel: string; kind: "file" | "directory" | "missing" }>;
}

export async function prepareSandbox(input: PrepareSandboxInput): Promise<PrepareSandboxResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.clock?.() ?? new Date();
  const { state } = await loadFeatureDeliveryStateForTask(repoRoot, input.taskId);
  const sandboxRel = sandboxDirRel(state.taskId);
  const sandboxAbs = resolveRepoPath(repoRoot, sandboxRel);
  await mkdir(sandboxAbs, { recursive: true });

  const touchSetAbs = resolveRepoPath(
    repoRoot,
    path.posix.join(state.artifacts.runDir, "touch-set.json"),
  );
  let touchSetPaths: string[] = [];
  try {
    touchSetPaths = extractTouchSetPaths(await readFile(touchSetAbs, "utf8"));
  } catch {
    touchSetPaths = [];
  }

  const copied: PrepareSandboxResult["copied"] = [];
  for (const sourceRel of touchSetPaths) {
    copied.push(
      await copyPathIntoSandbox({
        repoRoot,
        taskId: state.taskId,
        sourceRel,
        sandboxRootAbs: sandboxAbs,
      }),
    );
  }

  const manifestRel = sandboxManifestRel(state.taskId);
  const manifest = {
    taskId: state.taskId,
    featureId: state.featureId,
    runDir: state.artifacts.runDir,
    preparedAt: now.toISOString(),
    copiedPaths: copied,
  };
  await writeFile(
    resolveRepoPath(repoRoot, manifestRel),
    stringifyCliJson(repoRoot, manifest),
    "utf8",
  );

  return {
    command: "sandbox prepare",
    status: "ok",
    taskId: state.taskId,
    runDir: state.artifacts.runDir,
    sandboxDir: sandboxRel,
    manifestFile: manifestRel,
    copied,
  };
}
