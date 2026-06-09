import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BatchGitOps {
  resolveHead(repoRoot: string): Promise<string>;
  createBranch(repoRoot: string, branchName: string, baseRef: string): Promise<void>;
  mergeNoFf(
    repoRoot: string,
    branchName: string,
  ): Promise<{ status: "ok" } | { status: "conflict"; paths: string[] }>;
  commit(repoRoot: string, message: string): Promise<void>;
}

export function createNodeBatchGitOps(): BatchGitOps {
  return {
    async resolveHead(repoRoot) {
      const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
        encoding: "utf8",
      });
      if (result.status !== 0) {
        throw new Error(result.stderr || "git rev-parse HEAD failed.");
      }
      return result.stdout.trim();
    },
    async createBranch(repoRoot, branchName, baseRef) {
      await execFileAsync("git", ["-C", repoRoot, "checkout", "-B", branchName, baseRef], {
        encoding: "utf8",
      });
    },
    async mergeNoFf(repoRoot, branchName) {
      const result = spawnSync("git", ["-C", repoRoot, "merge", "--no-ff", branchName], {
        encoding: "utf8",
      });
      if (result.status === 0) {
        return { status: "ok" };
      }
      const statusResult = spawnSync("git", ["-C", repoRoot, "diff", "--name-only", "--diff-filter=U"], {
        encoding: "utf8",
      });
      const paths =
        statusResult.status === 0
          ? statusResult.stdout
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
          : [];
      if (paths.length === 0) {
        throw new Error(result.stderr || `git merge --no-ff ${branchName} failed.`);
      }
      return { status: "conflict", paths };
    },
    async commit(repoRoot, message) {
      await execFileAsync("git", ["-C", repoRoot, "commit", "-am", message], { encoding: "utf8" });
    },
  };
}

export function createMemoryBatchGitOps(): BatchGitOps & {
  readonly log: Array<{ op: string; branch?: string; message?: string }>;
  conflictOnBranch?: string;
} {
  const log: Array<{ op: string; branch?: string; message?: string }> = [];
  const ops: BatchGitOps & {
    readonly log: typeof log;
    conflictOnBranch?: string;
  } = {
    log,
    conflictOnBranch: undefined,
    async resolveHead() {
      return "HEAD";
    },
    async createBranch(_repoRoot, branchName) {
      log.push({ op: "createBranch", branch: branchName });
    },
    async mergeNoFf(_repoRoot, branchName) {
      log.push({ op: "mergeNoFf", branch: branchName });
      if (ops.conflictOnBranch === branchName || ops.conflictOnBranch === "*") {
        return { status: "conflict", paths: ["conflict.txt"] };
      }
      return { status: "ok" };
    },
    async commit(_repoRoot, message) {
      log.push({ op: "commit", message });
    },
  };
  return ops;
}
