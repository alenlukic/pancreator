import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { stringifyCompactJson } from "@/lib/json-io";
import { findRepoRoot, isNotesPath, PathAccessError, resolveRepoPath } from "./repo-paths";

export type WriteLogEntry = {
  path: string;
  bytes_written: number;
  timestamp: string;
};

export type RepoListEntry = {
  path: string;
  name: string;
  kind: "file" | "directory";
};

function writeLogPath(repoRoot: string): string {
  return path.join(repoRoot, "client", ".local", "write-log.jsonl");
}

export async function readRepoFile(
  repoRelativePath: string,
  repoRoot: string = findRepoRoot(),
): Promise<string> {
  const absolutePath = resolveRepoPath(repoRelativePath, repoRoot);
  if (!fs.existsSync(absolutePath)) {
    throw new PathAccessError("File not found", 404);
  }
  const stat = await fsp.stat(absolutePath);
  if (!stat.isFile()) {
    throw new PathAccessError("Path is not a file", 400);
  }
  return fsp.readFile(absolutePath, "utf8");
}

export async function writeRepoFile(
  repoRelativePath: string,
  content: string,
  repoRoot: string = findRepoRoot(),
): Promise<WriteLogEntry> {
  const absolutePath = resolveRepoPath(repoRelativePath, repoRoot);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  const buffer = Buffer.from(content, "utf8");
  await fsp.writeFile(absolutePath, buffer);

  const entry: WriteLogEntry = {
    path: repoRelativePath.replace(/\\/g, "/"),
    bytes_written: buffer.byteLength,
    timestamp: new Date().toISOString(),
  };

  console.log(stringifyCompactJson({ event: "repo_file_write", ...entry }));

  const logPath = writeLogPath(repoRoot);
  await fsp.mkdir(path.dirname(logPath), { recursive: true });
  await fsp.appendFile(logPath, `${stringifyCompactJson(entry)}\n`, "utf8");

  return entry;
}

export async function listRepoDirectory(
  repoRelativePath: string,
  repoRoot: string = findRepoRoot(),
): Promise<RepoListEntry[]> {
  const absolutePath = resolveRepoPath(repoRelativePath, repoRoot);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }
  const stat = await fsp.stat(absolutePath);
  if (!stat.isDirectory()) {
    throw new PathAccessError("Path is not a directory", 400);
  }

  const entries = await fsp.readdir(absolutePath, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => {
      const relativePath = path.posix.join(repoRelativePath.replace(/\\/g, "/"), entry.name);
      if (isNotesPath(relativePath)) {
        return null;
      }
      return {
        path: relativePath,
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
      } satisfies RepoListEntry;
    })
    .filter((entry): entry is RepoListEntry => entry !== null)
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    });
}

export async function readWriteLog(repoRoot: string = findRepoRoot()): Promise<WriteLogEntry[]> {
  const logPath = writeLogPath(repoRoot);
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const raw = await fsp.readFile(logPath, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WriteLogEntry);
}
