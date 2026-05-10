import path from "node:path";

import type { TaskId } from "@tesseract/core";

import {
  InterventionJournalPathError,
  InvalidTaskIdForJournalError,
} from "./errors.js";

/** Returns `.tess/scheduler/interventions` under `repoRoot`. */
export function defaultInterventionsDir(repoRoot: string): string {
  return path.resolve(repoRoot, ".tess", "scheduler", "interventions");
}

/** Rejects task identifiers that would escape the interventions directory. */
export function assertSafeTaskIdForPath(taskId: string): void {
  if (
    taskId === "" ||
    taskId.includes("/") ||
    taskId.includes("\\") ||
    taskId.includes("..")
  ) {
    throw new InvalidTaskIdForJournalError(
      `Task id ${JSON.stringify(taskId)} is not safe for a journal file name.`,
    );
  }
}

/** Resolves the append-only journal path for `taskId`. */
export function interventionJournalPath(repoRoot: string, taskId: TaskId): string {
  assertSafeTaskIdForPath(taskId);
  return path.join(defaultInterventionsDir(repoRoot), `${taskId}.jsonl`);
}

/** Ensures `journalFilePath` resolves inside `repoRoot/.tess/scheduler/interventions`. */
export function assertJournalPathInScheduler(repoRoot: string, journalFilePath: string): void {
  const interventionsDir = defaultInterventionsDir(repoRoot);
  const resolved = path.resolve(journalFilePath);
  const rel = path.relative(interventionsDir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new InterventionJournalPathError(
      `Journal path ${resolved} is outside interventions directory ${interventionsDir}.`,
    );
  }
}
