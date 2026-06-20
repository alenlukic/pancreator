import { resolveProjectPath, resolveRepoPath } from "@pancreator/core";
import { existsSync } from "node:fs";
import { readdir, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";

const INBOX_IN_PREFIX = "lib/inbox/in/";
const ARCHIVE_IN_PREFIX = ".pan/archive/inbox/in/";
const WORK_DAY_DIR_PATTERN = /^\d{6}_\d{2}-\d{2}-\d{2}$/u;

/** Ignorable junk files that may remain in otherwise-empty queue directories. */
const IGNORABLE_DIR_ENTRIES = new Set([".gitkeep", ".DS_Store", "Thumbs.db"]);

export function isWorkStyleDayDir(value: string): boolean {
  return WORK_DAY_DIR_PATTERN.test(value);
}

/**
 * Canonical archive target for an active inbox directive.
 * Preserves the inbound day bucket and archives as a day-bucket leaf (no task-id nesting).
 */
export function archiveInboxPathForSource(sourceRel: string, fallbackDayDir?: string): string {
  const norm = sourceRel.replace(/\\/gu, "/").replace(/^\/+/, "");
  if (!norm.startsWith(INBOX_IN_PREFIX)) {
    throw new Error(`inbox source MUST be under ${INBOX_IN_PREFIX}; got ${sourceRel}.`);
  }
  const tail = norm.slice(INBOX_IN_PREFIX.length);
  if (tail.length === 0 || tail.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`inbox source has an invalid relative tail: ${sourceRel}.`);
  }
  const parts = tail.split("/");
  const basename = path.posix.basename(tail);
  let inboxDayDir: string | undefined;
  if (parts.length >= 1 && isWorkStyleDayDir(parts[0]!)) {
    inboxDayDir = parts[0];
  } else if (fallbackDayDir !== undefined && isWorkStyleDayDir(fallbackDayDir)) {
    inboxDayDir = fallbackDayDir;
  }
  if (inboxDayDir === undefined) {
    throw new Error(
      `inbox source ${sourceRel} lacks a work-style day bucket; pass fallbackDayDir from the run ledger.`,
    );
  }
  return path.posix.join(".pan/archive", "inbox", "in", inboxDayDir, basename);
}

/**
 * When a superseded run shares an inbox directive already archived, locate the existing path.
 * Prefers canonical day-bucket leaves; falls back to legacy per-task nested archives.
 */
function normalizeInboxRel(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\/+/, "");
}

function pushInboxPathCandidate(candidates: string[], value: unknown): void {
  if (typeof value === "string" && value.trim().length > 0) {
    candidates.push(normalizeInboxRel(value));
    return;
  }
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>)["path"] === "string") {
    candidates.push(normalizeInboxRel((value as Record<string, unknown>)["path"] as string));
  }
}

export function inboxEntryFromPath(inboxPath: string): string {
  const norm = normalizeInboxRel(inboxPath);
  if (!norm.startsWith(INBOX_IN_PREFIX)) {
    throw new Error(`inbox source MUST be under ${INBOX_IN_PREFIX}; got ${inboxPath}.`);
  }
  const tail = norm.slice(INBOX_IN_PREFIX.length);
  if (tail.length === 0) {
    throw new Error(`inbox source has an invalid relative tail: ${inboxPath}.`);
  }
  return tail;
}

async function findActiveInboxByBasename(
  repoRoot: string,
  basename: string,
): Promise<string | null> {
  const inboxRootAbs = resolveProjectPath(repoRoot, "lib", "inbox", "in");
  if (!existsSync(inboxRootAbs)) {
    return null;
  }

  async function walk(dirAbs: string, dirRel: string): Promise<string | null> {
    const entries = await safeReaddir(dirAbs);
    for (const entryName of entries) {
      if (entryName.startsWith(".")) {
        continue;
      }
      const childAbs = path.join(dirAbs, entryName);
      const childRel = path.posix.join(dirRel, entryName);
      let childStat;
      try {
        childStat = await stat(childAbs);
      } catch {
        continue;
      }
      if (childStat.isDirectory()) {
        const nested = await walk(childAbs, childRel);
        if (nested !== null) {
          return nested;
        }
        continue;
      }
      if (entryName === basename) {
        return childRel;
      }
    }
    return null;
  }

  return walk(inboxRootAbs, INBOX_IN_PREFIX.replace(/\/+$/u, ""));
}

/**
 * Resolves a live inbox directive when state still points at a renamed or moved path.
 * Prefers the declared path, then explicit candidates (for example feature index lineage),
 * then a basename search under lib/inbox/in.
 */
export async function resolveLiveInboxSourcePath(
  repoRoot: string,
  declaredRel: string,
  extraCandidates: string[] = [],
): Promise<string | null> {
  const declared = normalizeInboxRel(declaredRel);
  if (existsSync(resolveRepoPath(repoRoot, declared))) {
    return declared;
  }

  const seen = new Set<string>();
  for (const candidate of [declared, ...extraCandidates.map(normalizeInboxRel)]) {
    if (candidate.length === 0 || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (!candidate.startsWith(INBOX_IN_PREFIX)) {
      continue;
    }
    if (existsSync(resolveRepoPath(repoRoot, candidate))) {
      return candidate;
    }
  }

  return findActiveInboxByBasename(repoRoot, path.posix.basename(declared));
}

export function collectFeatureIndexInboxCandidates(
  indexRecord: Record<string, unknown>,
): string[] {
  const candidates: string[] = [];
  pushInboxPathCandidate(candidates, indexRecord["source_inbox_item"]);
  pushInboxPathCandidate(candidates, indexRecord["source_inbox_item_prior"]);
  const intake = indexRecord["intake"];
  if (intake && typeof intake === "object") {
    pushInboxPathCandidate(candidates, (intake as Record<string, unknown>)["source_inbox_item"]);
  }
  const artifactIndex = indexRecord["artifact_index"];
  if (artifactIndex && typeof artifactIndex === "object") {
    const lineage = (artifactIndex as Record<string, unknown>)["lineage"];
    if (lineage && typeof lineage === "object") {
      pushInboxPathCandidate(
        candidates,
        (lineage as Record<string, unknown>)["source_inbox_item"],
      );
    }
  }
  return [...new Set(candidates)];
}

export async function findExistingArchivedInboxPath(
  repoRoot: string,
  inboxSourceRel: string,
  fallbackDayDir?: string,
): Promise<{ rel: string; abs: string } | null> {
  const canonicalRel = archiveInboxPathForSource(inboxSourceRel, fallbackDayDir);
  const canonicalAbs = resolveRepoPath(repoRoot, canonicalRel);
  if (existsSync(canonicalAbs)) {
    return { rel: canonicalRel, abs: canonicalAbs };
  }

  const norm = inboxSourceRel.replace(/\\/gu, "/").replace(/^\/+/, "");
  const tail = norm.startsWith(INBOX_IN_PREFIX) ? norm.slice(INBOX_IN_PREFIX.length) : norm;
  const parts = tail.split("/");
  const basename = path.posix.basename(tail);
  const dayDir =
    parts.length >= 1 && isWorkStyleDayDir(parts[0]!)
      ? parts[0]!
      : fallbackDayDir !== undefined && isWorkStyleDayDir(fallbackDayDir)
        ? fallbackDayDir
        : null;
  if (dayDir === null) {
    return null;
  }

  const dayArchiveRoot = resolveProjectPath(repoRoot, ".pan/archive", "inbox", "in", dayDir);
  if (!existsSync(dayArchiveRoot)) {
    return null;
  }
  for (const peerTaskId of await safeReaddir(dayArchiveRoot)) {
    const nestedCandidateAbs = path.join(dayArchiveRoot, peerTaskId, basename);
    if (!existsSync(nestedCandidateAbs)) {
      continue;
    }
    return {
      rel: path.posix.join(ARCHIVE_IN_PREFIX, dayDir, peerTaskId, basename),
      abs: nestedCandidateAbs,
    };
  }
  return null;
}

async function safeReaddir(abs: string): Promise<string[]> {
  try {
    return await readdir(abs);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isIgnorableEntry(name: string): boolean {
  return IGNORABLE_DIR_ENTRIES.has(name);
}

async function directoryIsEffectivelyEmpty(abs: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(abs);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
  const meaningful = entries.filter((name) => !name.startsWith(".") || isIgnorableEntry(name));
  return meaningful.every((name) => isIgnorableEntry(name));
}

async function removeIgnorableEntries(abs: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(abs);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!isIgnorableEntry(name)) {
      continue;
    }
    try {
      await rm(path.join(abs, name), { force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Walks upward from startDirRel removing empty parents until queueRootRel is reached.
 * Treats .gitkeep, .DS_Store, and Thumbs.db as ignorable junk.
 */
export async function pruneEmptyQueueParents(
  repoRoot: string,
  startDirRel: string,
  queueRootRel: string,
): Promise<string[]> {
  const removed: string[] = [];
  const queueRootNorm = queueRootRel.replace(/\\/gu, "/").replace(/^\/+/, "").replace(/\/+$/u, "");
  let currentRel = startDirRel.replace(/\\/gu, "/").replace(/^\/+/, "").replace(/\/+$/u, "");

  while (currentRel.length > 0 && currentRel !== queueRootNorm && currentRel.startsWith(`${queueRootNorm}/`)) {
    const abs = resolveRepoPath(repoRoot, currentRel);
    if (!existsSync(abs)) {
      currentRel = path.posix.dirname(currentRel);
      continue;
    }
    if (!(await directoryIsEffectivelyEmpty(abs))) {
      break;
    }
    await removeIgnorableEntries(abs);
    try {
      await rmdir(abs);
      removed.push(currentRel);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT" || err.code === "ENOTEMPTY" || err.code === "EEXIST") {
        break;
      }
      if (err.code === "ENOTDIR") {
        throw new Error(`Expected directory while pruning closure residue: ${currentRel}.`);
      }
      throw error;
    }
    currentRel = path.posix.dirname(currentRel);
  }
  return removed;
}

/**
 * Removes every empty directory under a queue root (bottom-up), never the queue root itself.
 */
export async function pruneEmptyInboxQueueTree(
  repoRoot: string,
  queueRootRel: string,
): Promise<string[]> {
  const removed: string[] = [];
  const queueRootNorm = queueRootRel.replace(/\\/gu, "/").replace(/^\/+/, "").replace(/\/+$/u, "");
  const rootAbs = resolveRepoPath(repoRoot, queueRootNorm);
  if (!existsSync(rootAbs)) {
    return removed;
  }

  async function pruneSubtree(abs: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const childAbs = path.join(abs, entry.name);
      const childRel = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) {
        await pruneSubtree(childAbs, childRel);
      }
    }
    if (rel === queueRootNorm || !(await directoryIsEffectivelyEmpty(abs))) {
      return;
    }
    await removeIgnorableEntries(abs);
    try {
      await rmdir(abs);
      removed.push(rel);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOTEMPTY" && err.code !== "ENOENT") {
        throw error;
      }
    }
  }

  await pruneSubtree(rootAbs, queueRootNorm);
  return removed;
}
