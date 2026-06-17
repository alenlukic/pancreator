import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { findRepoRoot, isNotesPath } from "./repo-paths";
import type { InboxEntrySnapshot } from "./run-state-shared";

export type { InboxEntrySnapshot } from "./run-state-shared";
export { inboxRunCommand } from "./run-state-shared";

const INBOX_ROOT_REL = "lib/inbox/in";

function deriveSlugFromFilename(fileName: string): string {
  const base = fileName.replace(/\.md$/iu, "");
  const semanticMatch = base.match(/^\d+_\d+_(.+)$/u);
  if (semanticMatch?.[1] !== undefined) {
    return semanticMatch[1];
  }
  return base;
}

function extractTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim() || fallback;
    }
  }
  return fallback;
}

function ageHoursFromMtime(mtimeMs: number, nowMs: number = Date.now()): number {
  const elapsedMs = Math.max(0, nowMs - mtimeMs);
  return Math.floor(elapsedMs / (60 * 60 * 1000));
}

async function walkMarkdownFiles(
  directory: string,
  repoRoot: string,
  entries: InboxEntrySnapshot[],
  nowMs: number,
): Promise<void> {
  const dirEntries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of dirEntries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, "/");

    if (isNotesPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkMarkdownFiles(absolutePath, repoRoot, entries, nowMs);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const stat = await fsp.stat(absolutePath);
    const markdown = await fsp.readFile(absolutePath, "utf8");
    entries.push({
      path: relativePath,
      title: extractTitle(markdown, entry.name),
      slug: deriveSlugFromFilename(entry.name),
      ageHours: ageHoursFromMtime(stat.mtimeMs, nowMs),
    });
  }
}

export async function loadInboxEntries(
  repoRoot: string = findRepoRoot(),
  nowMs: number = Date.now(),
): Promise<InboxEntrySnapshot[]> {
  const inboxRoot = path.join(repoRoot, INBOX_ROOT_REL);
  if (!fs.existsSync(inboxRoot)) {
    return [];
  }

  const entries: InboxEntrySnapshot[] = [];
  await walkMarkdownFiles(inboxRoot, repoRoot, entries, nowMs);
  return entries.sort((left, right) => {
    if (left.ageHours !== right.ageHours) {
      return right.ageHours - left.ageHours;
    }
    return left.path.localeCompare(right.path);
  });
}
