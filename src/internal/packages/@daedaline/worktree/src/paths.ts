import path from "node:path";

import { InvalidWorktreePathError, InvalidWorktreesRootError } from "./errors.js";

/** Returns the canonical `.ddl/worktrees` directory for a repository root. */
export function defaultWorktreesRoot(repoRoot: string): string {
  return path.resolve(repoRoot, ".ddl", "worktrees");
}

/** Ensures `worktreesRoot` resolves to `repoRoot/.ddl/worktrees`. */
export function assertCanonicalWorktreesRoot(repoRoot: string, worktreesRoot: string): void {
  const expected = defaultWorktreesRoot(repoRoot);
  const actual = path.resolve(worktreesRoot);
  if (actual !== expected) {
    throw new InvalidWorktreesRootError(
      `Worktrees root ${actual} is not ${expected}.`,
    );
  }
}

/** Ensures `targetPath` resolves to the root itself or a path beneath it. */
export function assertPathUnderWorktreesRoot(worktreesRoot: string, targetPath: string): void {
  const root = path.resolve(worktreesRoot);
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new InvalidWorktreePathError(`Path ${target} is outside worktrees root ${root}.`);
  }
}

/** Ensures `targetPath` is a strict child directory of `worktreesRoot` (not the root itself). */
export function assertPathInsideWorktreesRoot(worktreesRoot: string, targetPath: string): void {
  const root = path.resolve(worktreesRoot);
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new InvalidWorktreePathError(
      `Path ${target} is not a strict subdirectory of ${root}.`,
    );
  }
}
