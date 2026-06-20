import { findHarnessRoot as resolveHarnessRoot } from "@pancreator/core";
import fs from "node:fs";
import path from "node:path";

export class PathAccessError extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "PathAccessError";
    this.status = status;
  }
}

const NOTES_PREFIX = "lib/inbox/notes";

/** Outermost harness root for `@pancreator/core` and scheduler path resolution. */
export function findHarnessRoot(startDir: string = process.cwd()): string {
  const candidates = [startDir];
  if (path.basename(startDir) === "client") {
    candidates.push(path.dirname(startDir));
  }

  for (const candidate of candidates) {
    try {
      return resolveHarnessRoot(candidate);
    } catch {
      // try next candidate
    }
  }

  throw new Error("Harness root not found");
}

/** Directory containing live `pancreator.yaml` for direct project file access. */
export function findRepoRoot(startDir: string = process.cwd()): string {
  const candidates = [startDir];
  if (path.basename(startDir) === "client") {
    candidates.push(path.dirname(startDir));
  }

  for (const candidate of candidates) {
    try {
      return walkUpToRepoRoot(candidate);
    } catch {
      // try next candidate
    }
  }

  throw new Error("Repository root not found");
}

function walkUpToRepoRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "pancreator.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Repository root not found");
    }
    dir = parent;
  }
}

function normalizeRepoRelativePath(repoRelativePath: string): string {
  return repoRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isNotesPath(normalizedPath: string): boolean {
  return normalizedPath === NOTES_PREFIX || normalizedPath.startsWith(`${NOTES_PREFIX}/`);
}

function assertWithinRoot(resolvedPath: string, repoRoot: string): void {
  const rootReal = fs.realpathSync(repoRoot);
  const parentDir = path.dirname(resolvedPath);
  const parentReal = fs.existsSync(parentDir)
    ? fs.realpathSync(parentDir)
    : parentDir;

  const relative = path.relative(rootReal, parentReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathAccessError("Symlink escape denied");
  }

  if (fs.existsSync(resolvedPath)) {
    const fileReal = fs.realpathSync(resolvedPath);
    const fileRelative = path.relative(rootReal, fileReal);
    if (fileRelative.startsWith("..") || path.isAbsolute(fileRelative)) {
      throw new PathAccessError("Symlink escape denied");
    }
  }
}

export function resolveRepoPath(
  repoRelativePath: string,
  repoRoot: string = findRepoRoot(),
): string {
  const normalized = normalizeRepoRelativePath(repoRelativePath);

  if (!normalized) {
    throw new PathAccessError("Path is required", 400);
  }

  if (normalized.includes("\0")) {
    throw new PathAccessError("Invalid path");
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new PathAccessError("Path traversal denied");
  }

  if (isNotesPath(normalized)) {
    throw new PathAccessError("Operator sandbox denied");
  }

  const absolute = path.resolve(repoRoot, normalized);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathAccessError("Path traversal denied");
  }

  assertWithinRoot(absolute, repoRoot);
  return absolute;
}

export function isRepoRelativePathAllowed(repoRelativePath: string): boolean {
  try {
    resolveRepoPath(repoRelativePath);
    return true;
  } catch {
    return false;
  }
}
