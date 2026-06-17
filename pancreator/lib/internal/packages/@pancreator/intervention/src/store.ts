import fs from "node:fs/promises";
import path from "node:path";

import { stringifyCompactJson, type TaskId } from "@pancreator/core";

import { MalformedJournalLineError } from "./errors.js";
import {
  assertJournalPathInScheduler,
  interventionJournalPath,
} from "./paths.js";
import type { InterventionRecord } from "./types.js";

export interface InterventionStore {
  appendRecord(taskId: TaskId, record: InterventionRecord): Promise<void>;
  readJournal(taskId: TaskId): Promise<readonly InterventionRecord[]>;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function parseRecordLine(line: string, lineIndex: number): InterventionRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new MalformedJournalLineError(`Line ${lineIndex}: JSON parse failed.`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new MalformedJournalLineError(`Line ${lineIndex}: record is not an object.`);
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o.taskId !== "string" || typeof o.command !== "string" || typeof o.atIso !== "string") {
    throw new MalformedJournalLineError(`Line ${lineIndex}: missing taskId, command, or atIso.`);
  }
  if (!["pause", "resume", "abort", "goto"].includes(o.command)) {
    throw new MalformedJournalLineError(`Line ${lineIndex}: invalid command.`);
  }
  const record: InterventionRecord = {
    taskId: o.taskId as TaskId,
    command: o.command as InterventionRecord["command"],
    atIso: o.atIso,
  };
  if (typeof o.checkpointId === "string") {
    record.checkpointId = o.checkpointId;
  }
  if (typeof o.gotoStage === "string") {
    record.gotoStage = o.gotoStage;
  }
  if (typeof o.reason === "string") {
    record.reason = o.reason;
  }
  return record;
}

/** Append-only JSONL store under `.pan/scheduler/interventions/<taskId>.jsonl`. */
export class FsInterventionStore implements InterventionStore {
  constructor(private readonly repoRoot: string) {}

  async appendRecord(taskId: TaskId, record: InterventionRecord): Promise<void> {
    const file = interventionJournalPath(this.repoRoot, taskId);
    assertJournalPathInScheduler(this.repoRoot, file);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${stringifyCompactJson(record)}\n`, "utf8");
  }

  async readJournal(taskId: TaskId): Promise<readonly InterventionRecord[]> {
    const file = interventionJournalPath(this.repoRoot, taskId);
    assertJournalPathInScheduler(this.repoRoot, file);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return [];
      }
      throw error;
    }
    const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
    return lines.map((line, i) => parseRecordLine(line, i + 1));
  }
}

/** In-memory journal for tests and in-process drivers without disk I/O. */
export class InMemoryInterventionStore implements InterventionStore {
  private readonly journals = new Map<string, InterventionRecord[]>();

  async appendRecord(taskId: TaskId, record: InterventionRecord): Promise<void> {
    const key = taskId as string;
    const prev = this.journals.get(key) ?? [];
    this.journals.set(key, [...prev, record]);
  }

  async readJournal(taskId: TaskId): Promise<readonly InterventionRecord[]> {
    return [...(this.journals.get(taskId as string) ?? [])];
  }
}
