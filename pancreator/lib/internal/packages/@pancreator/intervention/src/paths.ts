import path from "node:path";

import { quoteJsonString, resolveProjectPath, type TaskId } from "@pancreator/core";

import {
  InterventionJournalPathError,
  InvalidTaskIdForJournalError,
} from "./errors.js";

/** Returns `.pan/scheduler/interventions` under the configured project root. */
export function defaultInterventionsDir(repoRoot: string): string {
  return resolveProjectPath(repoRoot, ".pan", "scheduler", "interventions");
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
      `Task id ${quoteJsonString(taskId)} is not safe for a journal file name.`,
    );
  }
}

/** Resolves the append-only journal path for `taskId`. */
export function interventionJournalPath(repoRoot: string, taskId: TaskId): string {
  assertSafeTaskIdForPath(taskId);
  return path.join(defaultInterventionsDir(repoRoot), `${taskId}.jsonl`);
}

/** Ensures `journalFilePath` resolves inside `repoRoot/.pan/scheduler/interventions`. */
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
