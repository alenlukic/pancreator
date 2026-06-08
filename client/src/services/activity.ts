import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { findRepoRoot } from "./repo-paths";
import { readWriteLog, type WriteLogEntry } from "./repo-files";

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
const MAX_DOMAIN_EVENTS = 40;

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
      events.push(
        ...(await collectRecentFileEvents(repoRoot, relativePath, depth + 1)),
      );
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

function writeLogToEvents(entries: WriteLogEntry[]): ActivityEvent[] {
  return entries.map((entry) => ({
    timestamp: entry.timestamp,
    title: `Saved ${path.basename(entry.path)}`,
    description: `Wrote ${entry.bytes_written} bytes to ${entry.path}`,
  }));
}

export async function getActivityFeed(repoRoot: string = findRepoRoot()): Promise<ActivityEvent[]> {
  const writeEvents = writeLogToEvents(await readWriteLog(repoRoot));
  const domainEvents: ActivityEvent[] = [];

  for (const domainPath of DOMAIN_PATHS) {
    domainEvents.push(...(await collectRecentFileEvents(repoRoot, domainPath)));
  }

  const merged = [...writeEvents, ...domainEvents];
  const deduped = new Map<string, ActivityEvent>();
  for (const event of merged) {
    const key = `${event.timestamp}:${event.description}`;
    deduped.set(key, event);
  }

  return [...deduped.values()]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, MAX_DOMAIN_EVENTS);
}
