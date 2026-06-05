import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Git worktree commands used by `GitWorktreePool`. */
export interface GitOps {
  worktreeAdd(
    repoRoot: string,
    worktreePath: string,
    ref?: string,
    branch?: string,
  ): Promise<void>;
  worktreeRemove(repoRoot: string, worktreePath: string): Promise<void>;
}

function gitRefArg(ref: string | undefined): string[] {
  if (ref === undefined || ref === "") {
    return [];
  }
  return [ref];
}

/** Runs `git worktree add` / `git worktree remove` on the host. */
export function createNodeGitOps(): GitOps {
  return {
    async worktreeAdd(repoRoot, worktreePath, ref, branch) {
      const args = ["-C", repoRoot, "worktree", "add"];
      if (branch !== undefined && branch !== "") {
        args.push("-b", branch);
      }
      args.push(worktreePath, ...gitRefArg(ref));
      await execFileAsync("git", args, { encoding: "utf8" });
    },
    async worktreeRemove(repoRoot, worktreePath) {
      await execFileAsync("git", ["-C", repoRoot, "worktree", "remove", "--force", worktreePath], {
        encoding: "utf8",
      });
    },
  };
}

/** In-memory git ops for tests (no subprocess). */
export function createMemoryGitOps(): GitOps & {
  readonly log: { op: string; path: string; branch?: string; ref?: string }[];
} {
  const log: { op: string; path: string; branch?: string; ref?: string }[] = [];
  return {
    log,
    async worktreeAdd(_repoRoot, worktreePath, ref, branch) {
      log.push({ op: "add", path: worktreePath, branch, ref });
    },
    async worktreeRemove(_repoRoot, worktreePath) {
      log.push({ op: "remove", path: worktreePath });
    },
  };
}
