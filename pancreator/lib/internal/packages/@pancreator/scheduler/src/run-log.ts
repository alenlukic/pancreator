import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { stringifyCompactJson } from "@pancreator/core";

import { releaseLock } from "./lock.js";
import { assertPathInScheduler, defaultRunsDir, runLogFilePath } from "./paths.js";

export type RunTrigger = "manual" | "scheduled";

export type RunStatus = "running" | "success" | "error" | "skipped" | "aborted";

export type RunExecutionMode = "dry-run" | "live";

export type RunRecord = {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  trigger: RunTrigger;
  stdoutSummary: string;
  stderrSummary: string;
  taskId?: string;
  executionMode?: RunExecutionMode;
};

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function parseRunRecordLine(line: string, lineIndex: number): RunRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new Error(`Run log line ${lineIndex}: JSON parse failed.`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`Run log line ${lineIndex}: record is not an object.`);
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.runId !== "string" ||
    typeof record.startedAt !== "string" ||
    typeof record.status !== "string" ||
    typeof record.trigger !== "string" ||
    typeof record.stdoutSummary !== "string" ||
    typeof record.stderrSummary !== "string"
  ) {
    throw new Error(`Run log line ${lineIndex}: missing required run-log fields.`);
  }
  const out: RunRecord = {
    runId: record.runId,
    startedAt: record.startedAt,
    status: record.status as RunStatus,
    trigger: record.trigger as RunTrigger,
    stdoutSummary: record.stdoutSummary,
    stderrSummary: record.stderrSummary,
  };
  if (typeof record.finishedAt === "string") {
    out.finishedAt = record.finishedAt;
  }
  if (typeof record.taskId === "string") {
    out.taskId = record.taskId;
  }
  if (record.executionMode === "dry-run" || record.executionMode === "live") {
    out.executionMode = record.executionMode;
  }
  return out;
}

/** Materializes `.pan/scheduler/runs/` with `.gitkeep` when absent. */
export async function ensureRunsDir(repoRoot: string): Promise<string> {
  const dir = defaultRunsDir(repoRoot);
  await fsp.mkdir(dir, { recursive: true });
  const gitkeep = path.join(dir, ".gitkeep");
  if (!fs.existsSync(gitkeep)) {
    await fsp.writeFile(gitkeep, "", "utf8");
  }
  return dir;
}

/** Appends one JSONL run record for `automationId`. */
export async function appendRunRecord(
  repoRoot: string,
  automationId: string,
  record: RunRecord,
): Promise<void> {
  await ensureRunsDir(repoRoot);
  const file = runLogFilePath(repoRoot, automationId);
  assertPathInScheduler(repoRoot, file);
  await fsp.appendFile(file, `${stringifyCompactJson(record)}\n`, "utf8");
}

/** Reads all run records for `automationId` in file order. */
export async function readRunRecords(repoRoot: string, automationId: string): Promise<RunRecord[]> {
  const file = runLogFilePath(repoRoot, automationId);
  assertPathInScheduler(repoRoot, file);
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch (error: unknown) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  return lines.map((line, index) => parseRunRecordLine(line, index + 1));
}

/** Returns run records newest-first. */
export async function readRunRecordsNewestFirst(
  repoRoot: string,
  automationId: string,
): Promise<RunRecord[]> {
  const records = await readRunRecords(repoRoot, automationId);
  return [...records].reverse();
}

/** Updates the run record matching `runId` in place by rewriting the JSONL file. */
export async function updateRunRecord(
  repoRoot: string,
  automationId: string,
  runId: string,
  patch: Partial<RunRecord>,
): Promise<RunRecord | null> {
  const records = await readRunRecords(repoRoot, automationId);
  const index = records.findIndex((record) => record.runId === runId);
  if (index < 0) {
    return null;
  }
  const updated: RunRecord = { ...records[index]!, ...patch, runId };
  records[index] = updated;
  const file = runLogFilePath(repoRoot, automationId);
  assertPathInScheduler(repoRoot, file);
  const body = records.map((record) => stringifyCompactJson(record)).join("\n");
  await fsp.writeFile(file, body.length > 0 ? `${body}\n` : "", "utf8");
  return updated;
}

/** Updates the latest run record with matching `taskId` to `aborted`. */
export async function abortRunByTaskId(
  repoRoot: string,
  automationId: string,
  taskId: string,
  finishedAt: string,
): Promise<RunRecord | null> {
  const records = await readRunRecords(repoRoot, automationId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    if (record.taskId === taskId && record.status === "running") {
      const updated = await updateRunRecord(repoRoot, automationId, record.runId, {
        status: "aborted",
        finishedAt,
      });
      if (updated) {
        await releaseLock(repoRoot, automationId, record.runId);
      }
      return updated;
    }
  }
  return null;
}

/** Scans all automation run logs and aborts the matching running record. */
export async function abortSchedulerRunByTaskId(
  repoRoot: string,
  taskId: string,
  finishedAt: string,
): Promise<RunRecord | null> {
  const runsDir = defaultRunsDir(repoRoot);
  if (!fs.existsSync(runsDir)) {
    return null;
  }
  const entries = await fsp.readdir(runsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const automationId = entry.name.slice(0, -".jsonl".length);
    const updated = await abortRunByTaskId(repoRoot, automationId, taskId, finishedAt);
    if (updated) {
      return updated;
    }
  }
  return null;
}
