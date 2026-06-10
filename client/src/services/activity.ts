import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { findRepoRoot } from "./repo-paths";
import { readWriteLog, type WriteLogEntry } from "./repo-files";
import {
  formatLastEventTime,
  runEventActorLabel,
  runEventDisplayLabel,
  type RunLogEvent,
} from "./run-state-shared";
import { parseRunLogFile } from "./run-state";

export type MutationReceipt = {
  id: string;
  timestamp: string;
  relativeTime: string;
  actor: string;
  verb: string;
  object: string;
  artifactLink?: string;
  surfaceHref?: string;
};

/** @deprecated Use MutationReceipt for operator-facing activity rows. */
export type ActivityEvent = {
  timestamp: string;
  title: string;
  description: string;
};

const DOMAIN_PATHS = [
  "lib/inbox",
  "lib/memory",
  "lib/personas",
  ".pan/work",
  "lib/internal/packages",
] as const;

const MAX_SCAN_DEPTH = 6;
const MAX_RECEIPTS = 40;

function writeLogToReceipts(entries: WriteLogEntry[], nowMs: number): MutationReceipt[] {
  return entries.map((entry) => ({
    id: `write:${entry.timestamp}:${entry.path}`,
    timestamp: entry.timestamp,
    relativeTime: formatLastEventTime(entry.timestamp, nowMs),
    actor: "Operator",
    verb: "Saved",
    object: path.basename(entry.path),
    artifactLink: entry.path,
    surfaceHref: "/activity-log",
  }));
}

function runEventToReceipt(event: RunLogEvent, taskId: string, featureLabel: string, nowMs: number): MutationReceipt {
  const verb = runEventDisplayLabel(event);
  return {
    id: `run:${taskId}:${event.timestamp}:${event.event}`,
    timestamp: event.timestamp,
    relativeTime: formatLastEventTime(event.timestamp, nowMs),
    actor: runEventActorLabel(event),
    verb,
    object: featureLabel,
    artifactLink: event.stageId ? `.pan/work/${taskId}/${event.stageId}` : undefined,
    surfaceHref: `/mission-control?task=${encodeURIComponent(taskId)}`,
  };
}

async function collectRunLogReceipts(repoRoot: string, nowMs: number): Promise<MutationReceipt[]> {
  const workRoot = path.join(repoRoot, ".pan/work");
  if (!fs.existsSync(workRoot)) {
    return [];
  }

  const receipts: MutationReceipt[] = [];
  const dayBuckets = await fsp.readdir(workRoot, { withFileTypes: true });

  for (const dayEntry of dayBuckets) {
    if (!dayEntry.isDirectory()) {
      continue;
    }
    const dayPath = path.join(workRoot, dayEntry.name);
    const taskDirs = await fsp.readdir(dayPath, { withFileTypes: true });
    for (const taskEntry of taskDirs) {
      if (!taskEntry.isDirectory()) {
        continue;
      }
      const runLogPath = path.join(dayPath, taskEntry.name, "run.log.jsonl");
      if (!fs.existsSync(runLogPath)) {
        continue;
      }
      const events = await parseRunLogFile(runLogPath);
      const featureLabel = taskEntry.name.replace(/^\d+_\d+_/u, "").replace(/-/gu, " ");
      for (const event of events.slice(0, 5)) {
        receipts.push(runEventToReceipt(event, taskEntry.name, featureLabel, nowMs));
      }
    }
  }

  return receipts;
}

export async function getActivityFeed(repoRoot: string = findRepoRoot()): Promise<ActivityEvent[]> {
  const receipts = await getMutationReceipts(repoRoot);
  const receiptEvents = receipts.map((receipt) => ({
    timestamp: receipt.timestamp,
    title: `${receipt.verb} ${receipt.object}`,
    description: `${receipt.actor} · ${receipt.relativeTime}`,
  }));
  const fileEvents = await getSupplementaryFileEvents(repoRoot);
  const merged = [...receiptEvents, ...fileEvents];
  const deduped = new Map<string, ActivityEvent>();
  for (const event of merged) {
    deduped.set(`${event.timestamp}:${event.description}`, event);
  }
  return [...deduped.values()].sort(
    (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
  );
}

export async function getMutationReceipts(
  repoRoot: string = findRepoRoot(),
  nowMs: number = Date.now(),
): Promise<MutationReceipt[]> {
  const writeEvents = writeLogToReceipts(await readWriteLog(repoRoot), nowMs);
  const runReceipts = await collectRunLogReceipts(repoRoot, nowMs);

  const merged = [...writeEvents, ...runReceipts];
  const deduped = new Map<string, MutationReceipt>();
  for (const receipt of merged) {
    deduped.set(receipt.id, receipt);
  }

  return [...deduped.values()]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, MAX_RECEIPTS);
}

/** Retained for secondary file-event context; not used as primary Activity Log rows. */
async function collectRecentFileEvents(
  repoRoot: string,
  domainPath: string,
  depth = 0,
): Promise<ActivityEvent[]> {
  if (depth > MAX_SCAN_DEPTH) {
    return [];
  }

  const absolute = path.join(repoRoot, domainPath);
  if (!fs.existsSync(absolute)) {
    return [];
  }

  const entries = await fsp.readdir(absolute, { withFileTypes: true });
  const events: ActivityEvent[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const relativePath = path.posix.join(domainPath, entry.name);
    const entryAbsolute = path.join(absolute, entry.name);

    let stat: fs.Stats;
    try {
      stat = await fsp.lstat(entryAbsolute);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT" || err.code === "ENOTDIR") {
        continue;
      }
      throw error;
    }

    if (stat.isDirectory()) {
      events.push(...(await collectRecentFileEvents(repoRoot, relativePath, depth + 1)));
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    events.push({
      timestamp: stat.mtime.toISOString(),
      title: path.basename(relativePath),
      description: `Updated ${relativePath}`,
    });
  }

  return events;
}

export async function getSupplementaryFileEvents(
  repoRoot: string = findRepoRoot(),
): Promise<ActivityEvent[]> {
  const domainEvents: ActivityEvent[] = [];
  for (const domainPath of DOMAIN_PATHS) {
    domainEvents.push(...(await collectRecentFileEvents(repoRoot, domainPath)));
  }
  return domainEvents
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 20);
}
