import fs from "node:fs";
import path from "node:path";
import { stringifyCompactJson } from "@/lib/json-io";
import { findRepoRoot } from "./repo-paths";
import type { SuiteId } from "./maintenance-test-run";

export type MaintenanceRunRecord = {
  id: string;
  suite: SuiteId | "pre-close";
  startedAt: string;
  finishedAt?: string;
  exitCode: number | null;
  command: string;
};

function runsDirectory(repoRoot: string): string {
  return path.join(repoRoot, ".pan", "maintenance", "runs");
}

export function ensureMaintenanceRunsDir(repoRoot: string = findRepoRoot()): string {
  const dir = runsDirectory(repoRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const gitkeep = path.join(dir, ".gitkeep");
  if (!fs.existsSync(gitkeep)) {
    fs.writeFileSync(gitkeep, "", "utf8");
  }
  return dir;
}

function runRecordPath(recordId: string, repoRoot: string): string {
  return path.join(ensureMaintenanceRunsDir(repoRoot), `${recordId}.json`);
}

export function saveRunRecord(record: MaintenanceRunRecord, repoRoot: string = findRepoRoot()): void {
  fs.writeFileSync(runRecordPath(record.id, repoRoot), `${stringifyCompactJson(record)}\n`, "utf8");
}

export function listRunRecords(repoRoot: string = findRepoRoot()): MaintenanceRunRecord[] {
  const dir = runsDirectory(repoRoot);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const raw = fs.readFileSync(path.join(dir, name), "utf8");
      return JSON.parse(raw) as MaintenanceRunRecord;
    })
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function createRunRecordId(): string {
  return `${Date.now()}`;
}
