import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { asTaskId } from "@daedaline/core";
import { describe, expect, it } from "vitest";

import { GitWorktreePool } from "./git-worktree-pool.js";
import { createMemoryGitOps } from "./git-ops.js";
import { InvalidWorktreesRootError } from "./errors.js";
import { WorktreePoolLeaseConflictError } from "./errors.js";
import { WorktreeSlotNotFoundError } from "./errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function tmpRepo(): Promise<{ repoRoot: string; cleanup: () => Promise<void> }> {
  const repoRoot = path.join(here, `.tmp-worktree-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(path.join(repoRoot, ".ddl", "worktrees"), { recursive: true });
  return {
    repoRoot,
    cleanup: async () => {
      await rm(repoRoot, { recursive: true, force: true });
    },
  };
}

describe("GitWorktreePool", () => {
  it("enforces single-pipeline lease across different task ids", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      const gitOps = createMemoryGitOps();
      const pool = new GitWorktreePool({ repoRoot, gitOps });
      await pool.acquire(asTaskId("task_a"));
      await expect(pool.acquire(asTaskId("task_b"))).rejects.toThrow(WorktreePoolLeaseConflictError);
    } finally {
      await cleanup();
    }
  });

  it("reuses an existing slot idempotently", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      const gitOps = createMemoryGitOps();
      const pool = new GitWorktreePool({ repoRoot, gitOps });
      const first = await pool.acquire(asTaskId("task_a"));
      const second = await pool.acquire(asTaskId("task_a"));
      expect(second.path).toBe(first.path);
      expect(gitOps.log.filter((l) => l.op === "add")).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("persists pool state for a new pool instance", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      const gitOps = createMemoryGitOps();
      const pool1 = new GitWorktreePool({ repoRoot, gitOps });
      await pool1.acquire(asTaskId("persisted"));
      const pool2 = new GitWorktreePool({ repoRoot, gitOps });
      const listed = await pool2.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.taskId).toBe("persisted");
      const raw = await readFile(path.join(repoRoot, ".ddl", "worktrees", "pool-state.json"), "utf8");
      expect(raw).toContain("persisted");
    } finally {
      await cleanup();
    }
  });

  it("releases a slot and clears lease", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      const gitOps = createMemoryGitOps();
      const pool = new GitWorktreePool({ repoRoot, gitOps });
      await pool.acquire(asTaskId("one"));
      await pool.release(asTaskId("one"));
      expect(await pool.list()).toHaveLength(0);
      await pool.acquire(asTaskId("two"));
      expect(await pool.list()).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("rejects worktrees roots outside .ddl/worktrees", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      expect(
        () =>
          new GitWorktreePool({
            repoRoot,
            worktreesRoot: path.join(repoRoot, "wrong"),
            gitOps: createMemoryGitOps(),
          }),
      ).toThrow(InvalidWorktreesRootError);
    } finally {
      await cleanup();
    }
  });

  it("throws when releasing unknown task", async () => {
    const { repoRoot, cleanup } = await tmpRepo();
    try {
      const pool = new GitWorktreePool({ repoRoot, gitOps: createMemoryGitOps() });
      await expect(pool.release(asTaskId("nope"))).rejects.toThrow(WorktreeSlotNotFoundError);
    } finally {
      await cleanup();
    }
  });
});
