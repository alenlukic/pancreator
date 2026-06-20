import { resolveRepoPath } from "@pancreator/core";
import { rfc3339UtcMs } from "@pancreator/run-logger";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { parsePanWorkJsonText } from "./pan-work-artifact.js";
import { stringifyCliJson } from "./canonical-json-io.js";
import { closeOutOfBandWorkspace } from "./close-out-of-band.js";
import {
  archiveExperiencePlanningForClosedFeatureDelivery,
  listActiveExperiencePlanningProtectedInboxPaths,
  sweepExperiencePlanningWorkRetention,
} from "./experience-planning-archival.js";
import {
  archiveInboxPathForSource,
  pruneEmptyInboxQueueTree,
  pruneEmptyQueueParents,
} from "./inbox-archive.js";
import { closeFeatureDeliveryArtifacts, type FeatureDeliveryState } from "./feature-delivery-run.js";
import { ensureOperatorVerificationDoc, operatorVerificationRel } from "./operator-verification.js";
import {
  listCanonicalWorkDayDirs,
  listTaskDirNames,
  scanWorkArchiveHygiene,
  type PointerResolution,
  resolvePointerResolution,
} from "./work-archive-hygiene.js";

export type { PointerResolution };
export { resolvePointerResolution };

const TERMINAL_STAGE = "complete" as const;
const OUT_OF_BAND_MANIFEST = "out-of-band.manifest.json";
const INBOX_IN_PREFIX = "lib/inbox/in/";
const INBOX_OUT_PREFIX = "lib/inbox/out/";
const INBOX_THREADS_PREFIX = "lib/inbox/threads/";
const ARCHIVE_INBOX_OUT_PREFIX = ".pan/archive/inbox/out/";
const ARCHIVE_INBOX_THREADS_PREFIX = ".pan/archive/inbox/threads/";

export interface ArchiveSweepTerminalRun {
  taskId: string;
  dayDir: string;
  featureId: string;
  inboxSourceRel?: string;
  kind: "complete" | "aborted" | "out-of-band" | "orphan";
  runDirRel: string;
}

export interface ArchiveSweepSkip {
  path: string;
  reason: string;
}

export interface ArchiveSweepError {
  path: string;
  message: string;
}

export interface ArchiveSweepResult {
  command: "archive-sweep";
  status: "ok" | "partial";
  closed: string[];
  archived: string[];
  removed: string[];
  skipped: ArchiveSweepSkip[];
  errors: ArchiveSweepError[];
}

function normalizeRel(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\/+/, "");
}

function isActiveFeatureDeliveryRun(state: FeatureDeliveryState): boolean {
  if (state.pipelineId !== "feature-delivery") {
    return false;
  }
  if (state.status === "closed") {
    return false;
  }
  if (state.currentStage === TERMINAL_STAGE || state.currentStage === "aborted") {
    return false;
  }
  return true;
}

async function readStateIfPresent(stateAbs: string): Promise<FeatureDeliveryState | null> {
  try {
    return parsePanWorkJsonText(await readFile(stateAbs, "utf8")) as FeatureDeliveryState;
  } catch {
    return null;
  }
}

function inboxArchiveTarget(sourceRel: string, archivePrefix: string): string {
  const norm = normalizeRel(sourceRel);
  const queuePrefixes = [INBOX_IN_PREFIX, INBOX_OUT_PREFIX, INBOX_THREADS_PREFIX] as const;
  for (const queuePrefix of queuePrefixes) {
    if (norm.startsWith(queuePrefix)) {
      const tail = norm.slice(queuePrefix.length);
      return path.posix.join(archivePrefix.replace(/\/+$/u, ""), tail);
    }
  }
  throw new Error(`Expected path under lib/inbox/{in,out,threads}; got ${sourceRel}`);
}

async function archiveInboxFile(
  repoRoot: string,
  sourceRel: string,
  archivePrefix: string,
  archived: string[],
): Promise<void> {
  const targetRel = inboxArchiveTarget(sourceRel, archivePrefix);
  const sourceAbs = resolveRepoPath(repoRoot, sourceRel);
  const targetAbs = resolveRepoPath(repoRoot, targetRel);
  if (!existsSync(sourceAbs)) {
    return;
  }
  if (existsSync(targetAbs)) {
    const { rm } = await import("node:fs/promises");
    await rm(sourceAbs, { force: true });
    archived.push(targetRel);
    return;
  }
  await movePath(repoRoot, sourceRel, targetRel);
  archived.push(targetRel);
}

async function archiveAllInboxQueues(
  repoRoot: string,
  activeInboxPaths: ReadonlySet<string>,
  archived: string[],
): Promise<void> {
  for (const fileRel of await listInboxFiles(repoRoot, INBOX_OUT_PREFIX)) {
    await archiveInboxFile(repoRoot, fileRel, ARCHIVE_INBOX_OUT_PREFIX, archived);
  }
  await pruneEmptyInboxQueueTree(repoRoot, "lib/inbox/out");

  for (const fileRel of await listInboxFiles(repoRoot, INBOX_THREADS_PREFIX)) {
    const norm = normalizeRel(fileRel);
    if (activeInboxPaths.has(norm)) {
      continue;
    }
    await archiveInboxFile(repoRoot, fileRel, ARCHIVE_INBOX_THREADS_PREFIX, archived);
  }
  await pruneEmptyInboxQueueTree(repoRoot, "lib/inbox/threads");

  for (const fileRel of await listInboxFiles(repoRoot, INBOX_IN_PREFIX)) {
    const norm = normalizeRel(fileRel);
    if (activeInboxPaths.has(norm)) {
      continue;
    }
    await archiveInboxFile(repoRoot, fileRel, ".pan/archive/inbox/in/", archived);
  }
  await pruneEmptyInboxQueueTree(repoRoot, "lib/inbox/in");
}

async function movePath(repoRoot: string, sourceRel: string, targetRel: string): Promise<boolean> {
  const sourceAbs = resolveRepoPath(repoRoot, sourceRel);
  const targetAbs = resolveRepoPath(repoRoot, targetRel);
  if (!existsSync(sourceAbs)) {
    return false;
  }
  if (existsSync(targetAbs)) {
    throw new Error(`Archive target already exists: ${targetRel}`);
  }
  await mkdir(path.dirname(targetAbs), { recursive: true });
  await rename(sourceAbs, targetAbs);
  return true;
}

async function archiveAbortedFeatureDeliveryRun(
  repoRoot: string,
  state: FeatureDeliveryState,
  now: Date,
  protectedInboxPaths: ReadonlySet<string>,
): Promise<string> {
  const runDirRel = normalizeRel(state.artifacts.runDir);
  const parts = runDirRel.split("/");
  const dayDir = parts[2]!;
  const taskId = state.taskId;
  const archiveRunRel = path.posix.join(".pan/archive/work", dayDir, taskId);
  const activeAbs = resolveRepoPath(repoRoot, runDirRel);
  const archiveAbs = resolveRepoPath(repoRoot, archiveRunRel);
  if (!existsSync(activeAbs)) {
    if (existsSync(archiveAbs)) {
      return archiveRunRel;
    }
    throw new Error(`Missing active run directory ${runDirRel}`);
  }
  if (existsSync(archiveAbs)) {
    throw new Error(`Archive run directory already exists: ${archiveRunRel}`);
  }

  const inboxSourceRel = normalizeRel(state.source.inboxPath);
  if (
    inboxSourceRel.startsWith(INBOX_IN_PREFIX) &&
    !protectedInboxPaths.has(inboxSourceRel) &&
    existsSync(resolveRepoPath(repoRoot, inboxSourceRel))
  ) {
    const inboxArchiveRel = archiveInboxPathForSource(inboxSourceRel, dayDir);
    await movePath(repoRoot, inboxSourceRel, inboxArchiveRel);
    await pruneEmptyQueueParents(repoRoot, path.posix.dirname(inboxSourceRel), "lib/inbox/in");
  }

  await mkdir(path.dirname(archiveAbs), { recursive: true });
  await rename(activeAbs, archiveAbs);
  await pruneEmptyQueueParents(repoRoot, path.posix.dirname(runDirRel), ".pan/work");

  state.status = "closed";
  state.currentStage = TERMINAL_STAGE;
  state.artifacts = {
    ...state.artifacts,
    runDir: archiveRunRel,
    stateFile: path.posix.join(archiveRunRel, "state.json"),
    handoffFile: path.posix.join(archiveRunRel, "handoff.md"),
    runLogFile: path.posix.join(archiveRunRel, "run.log.jsonl"),
    nextPromptFile: path.posix.join(archiveRunRel, "next-prompt.md"),
    operatorVerificationFile: path.posix.join(archiveRunRel, "operator-verification.md"),
  };
  state.advanceHistory = [
    ...(state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(now),
      kind: "close",
      from: "aborted",
      to: TERMINAL_STAGE,
      event: "archive_sweep_aborted",
      artifact: archiveRunRel,
      reason: "Automated archive-sweep for aborted feature-delivery run.",
    },
  ];
  await writeFile(
    path.join(archiveAbs, "state.json"),
    stringifyCliJson(repoRoot, state),
    "utf8",
  );
  return archiveRunRel;
}

async function archiveOrphanWorkDirectory(repoRoot: string, runDirRel: string): Promise<string> {
  const norm = normalizeRel(runDirRel);
  const parts = norm.split("/");
  if (parts.length !== 4 || parts[0] !== ".pan" || parts[1] !== "work") {
    throw new Error(`Expected .pan/work/<day>/<task-id>; got ${runDirRel}`);
  }
  const archiveRunRel = path.posix.join(".pan/archive/work", parts[2]!, parts[3]!);
  await movePath(repoRoot, norm, archiveRunRel);
  await pruneEmptyQueueParents(repoRoot, path.posix.dirname(norm), ".pan/work");
  return archiveRunRel;
}

async function listInboxFiles(repoRoot: string, queuePrefix: string): Promise<string[]> {
  const rootAbs = resolveRepoPath(repoRoot, queuePrefix.replace(/\/+$/u, ""));
  if (!existsSync(rootAbs)) {
    return [];
  }
  const files: string[] = [];

  async function walk(abs: string, relParts: string[]): Promise<void> {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === ".gitkeep") {
        continue;
      }
      const rel = path.posix.join(queuePrefix.replace(/\/+$/u, ""), ...relParts, entry.name);
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        await walk(childAbs, [...relParts, entry.name]);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  await walk(rootAbs, []);
  return files;
}

async function collectTerminalRuns(repoRoot: string): Promise<{
  activeTaskIds: Set<string>;
  activeInboxPaths: Set<string>;
  terminalRuns: ArchiveSweepTerminalRun[];
  orphanDirs: string[];
}> {
  const activeTaskIds = new Set<string>();
  const activeInboxPaths = new Set<string>();
  const terminalRuns: ArchiveSweepTerminalRun[] = [];
  const orphanDirs: string[] = [];
  const workRootAbs = resolveRepoPath(repoRoot, ".pan/work");
  const dayDirs = await listCanonicalWorkDayDirs(workRootAbs);

  for (const dayDir of dayDirs) {
    const dayAbs = path.join(workRootAbs, dayDir);
    for (const taskId of await listTaskDirNames(dayAbs)) {
      const runDirRel = path.posix.join(".pan/work", dayDir, taskId);
      const taskAbs = path.join(dayAbs, taskId);
      const stateAbs = path.join(taskAbs, "state.json");
      const state = await readStateIfPresent(stateAbs);
      if (state === null) {
        if (taskId.startsWith("batch-") && existsSync(path.join(taskAbs, "batch.json"))) {
          continue;
        }
        if (existsSync(path.join(taskAbs, OUT_OF_BAND_MANIFEST))) {
          terminalRuns.push({
            taskId,
            dayDir,
            featureId: taskId,
            kind: "out-of-band",
            runDirRel,
          });
          continue;
        }
        orphanDirs.push(runDirRel);
        continue;
      }
      if (state.pipelineId === "feature-delivery" && isActiveFeatureDeliveryRun(state)) {
        activeTaskIds.add(taskId);
        activeInboxPaths.add(normalizeRel(state.source.inboxPath));
        continue;
      }
      if (
        state.pipelineId === "feature-delivery" &&
        state.currentStage === TERMINAL_STAGE &&
        (state.status === "complete" || state.status === "complete_with_attention")
      ) {
        terminalRuns.push({
          taskId,
          dayDir,
          featureId: state.featureId,
          inboxSourceRel: normalizeRel(state.source.inboxPath),
          kind: "complete",
          runDirRel,
        });
        continue;
      }
      if (state.pipelineId === "feature-delivery" && state.currentStage === "aborted") {
        terminalRuns.push({
          taskId,
          dayDir,
          featureId: state.featureId,
          inboxSourceRel: normalizeRel(state.source.inboxPath),
          kind: "aborted",
          runDirRel,
        });
        continue;
      }
      if (state.status === "closed" && state.artifacts.runDir.startsWith(".pan/work/")) {
        terminalRuns.push({
          taskId,
          dayDir,
          featureId: state.featureId,
          inboxSourceRel: normalizeRel(state.source.inboxPath),
          kind: "complete",
          runDirRel,
        });
      }
    }
  }

  return { activeTaskIds, activeInboxPaths, terminalRuns, orphanDirs };
}

function orderCompleteRuns(completeRuns: ArchiveSweepTerminalRun[]): ArchiveSweepTerminalRun[] {
  const byFeature = new Map<string, ArchiveSweepTerminalRun[]>();
  for (const run of completeRuns) {
    const group = byFeature.get(run.featureId) ?? [];
    group.push(run);
    byFeature.set(run.featureId, group);
  }
  const ordered: ArchiveSweepTerminalRun[] = [];
  for (const [, group] of byFeature) {
    if (group.length === 1) {
      ordered.push(group[0]!);
      continue;
    }
    const sorted = [...group].sort((left, right) => right.taskId.localeCompare(left.taskId));
    ordered.push(...sorted);
  }
  return ordered;
}

export async function runArchiveSweep(
  repoRootInput: string,
  options?: { clock?: () => Date },
): Promise<ArchiveSweepResult> {
  const repoRoot = path.resolve(repoRootInput);
  const now = options?.clock?.() ?? new Date();
  const closed: string[] = [];
  const archived: string[] = [];
  const removed: string[] = [];
  const skipped: ArchiveSweepSkip[] = [];
  const errors: ArchiveSweepError[] = [];

  const { activeTaskIds, activeInboxPaths, terminalRuns, orphanDirs } = await collectTerminalRuns(repoRoot);
  for (const inboxPath of await listActiveExperiencePlanningProtectedInboxPaths(repoRoot)) {
    activeInboxPaths.add(inboxPath);
  }

  for (const taskId of activeTaskIds) {
    skipped.push({
      path: taskId,
      reason: "Active in-progress feature-delivery run",
    });
  }

  const completeRuns = orderCompleteRuns(terminalRuns.filter((run) => run.kind === "complete"));
  const abortedRuns = terminalRuns.filter((run) => run.kind === "aborted");
  const outOfBandRuns = terminalRuns.filter((run) => run.kind === "out-of-band");

  for (const run of completeRuns) {
    try {
      const verificationRel = operatorVerificationRel({ artifacts: { runDir: run.runDirRel } });
      if (!existsSync(resolveRepoPath(repoRoot, verificationRel))) {
        await ensureOperatorVerificationDoc(
          repoRoot,
          { taskId: run.taskId, featureId: run.featureId, artifacts: { runDir: run.runDirRel } },
          now,
        );
      }
      const result = await closeFeatureDeliveryArtifacts({
        repoRoot,
        taskId: run.taskId,
        clock: () => now,
      });
      closed.push(run.taskId);
      archived.push(result.archivedRunDir);
      if (result.archivedInboxPath) {
        archived.push(result.archivedInboxPath);
      }
      if (result.archivedExperiencePlanningRuns) {
        archived.push(...result.archivedExperiencePlanningRuns);
      }
    } catch (error) {
      errors.push({
        path: run.runDirRel,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const run of abortedRuns) {
    try {
      const stateFile = path.join(resolveRepoPath(repoRoot, run.runDirRel), "state.json");
      const state = await readStateIfPresent(stateFile);
      if (state === null) {
        throw new Error("Missing state.json for aborted run");
      }
      const archiveRunRel = await archiveAbortedFeatureDeliveryRun(
        repoRoot,
        state,
        now,
        activeInboxPaths,
      );
      closed.push(run.taskId);
      archived.push(archiveRunRel);
      const epArchived = await archiveExperiencePlanningForClosedFeatureDelivery(
        repoRoot,
        normalizeRel(state.source.inboxPath),
        now,
      );
      archived.push(...epArchived);
    } catch (error) {
      errors.push({
        path: run.runDirRel,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const run of outOfBandRuns) {
    try {
      const manifestAbs = path.join(resolveRepoPath(repoRoot, run.runDirRel), OUT_OF_BAND_MANIFEST);
      const manifest = JSON.parse(await readFile(manifestAbs, "utf8")) as { feature_id?: string; reason?: string };
      const featureId =
        typeof manifest.feature_id === "string" && manifest.feature_id.trim().length > 0
          ? manifest.feature_id.trim()
          : run.taskId;
      const reason =
        typeof manifest.reason === "string" && manifest.reason.trim().length >= 12
          ? manifest.reason.trim()
          : "Automated archive-sweep for out-of-band workspace.";
      const result = await closeOutOfBandWorkspace({
        repoRoot,
        runDirRel: run.runDirRel,
        featureId,
        reason,
        scaffoldVerification: true,
      });
      closed.push(run.taskId);
      archived.push(result.archivedRunDir);
      if (result.inboxArchivedPath) {
        archived.push(result.inboxArchivedPath);
      }
    } catch (error) {
      errors.push({
        path: run.runDirRel,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const runDirRel of orphanDirs) {
    if (outOfBandRuns.some((run) => run.runDirRel === runDirRel)) {
      continue;
    }
    try {
      const archiveRunRel = await archiveOrphanWorkDirectory(repoRoot, runDirRel);
      archived.push(archiveRunRel);
    } catch (error) {
      errors.push({
        path: runDirRel,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await archiveAllInboxQueues(repoRoot, activeInboxPaths, archived);
  } catch (error) {
    errors.push({
      path: "lib/inbox",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const hygiene = await scanWorkArchiveHygiene(repoRoot);
  for (const issue of hygiene.issues) {
    if (issue.code === "orphan_work_dir" || issue.code === "pending_close_artifacts") {
      errors.push({ path: issue.path, message: issue.detail });
    }
  }

  try {
    const retention = await sweepExperiencePlanningWorkRetention(repoRoot, {
      clock: () => now,
    });
    archived.push(...retention.archived);
    removed.push(...retention.removed);
  } catch (error) {
    errors.push({
      path: ".pan/work",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    command: "archive-sweep",
    status: errors.length > 0 ? "partial" : "ok",
    closed,
    archived: [...new Set(archived)],
    removed: [...new Set(removed)],
    skipped,
    errors,
  };
}
