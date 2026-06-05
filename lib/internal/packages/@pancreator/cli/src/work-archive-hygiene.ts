import { resolveProjectPath } from "@pancreator/core";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Minimal feature-delivery ledger fields used by hygiene scans. */
interface FeatureDeliveryState {
  pipelineId: string;
  taskId: string;
  featureId: string;
  currentStage: string;
  status: string;
  source: { inboxPath: string };
  artifacts: { runDir: string };
}

const TERMINAL_STAGE = "complete" as const;
const WORK_DAY_DIR_PATTERN = /^\d{6}_\d{2}-\d{2}-\d{2}$/u;
const OUT_OF_BAND_MANIFEST = "out-of-band.manifest.json";
const COMPLIANCE_AUDIT_FILENAME = "compliance-audit.md";
const COMPLIANCE_RESULT_FILENAME = "compliance-result.json";

export type WorkArchiveHygieneIssueCode =
  | "pending_close_artifacts"
  | "inbox_source_still_active"
  | "duplicate_complete_run"
  | "dual_work_archive_state"
  | "orphan_work_dir"
  | "closed_run_still_active";

export interface WorkArchiveHygieneIssue {
  code: WorkArchiveHygieneIssueCode;
  path: string;
  taskId?: string;
  featureId?: string;
  detail: string;
  remediation: string;
}

export interface WorkArchiveHygieneScanResult {
  issues: WorkArchiveHygieneIssue[];
  pendingCloseCount: number;
}

interface WorkRunRecord {
  taskId: string;
  dayDir: string;
  runDirRel: string;
  state: FeatureDeliveryState;
}

async function safeReaddir(abs: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    return await readdir(abs);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function listTaskDirNames(dayAbs: string): Promise<string[]> {
  const names = await safeReaddir(dayAbs);
  const taskDirs: string[] = [];
  for (const name of names) {
    try {
      const entryStat = await stat(path.join(dayAbs, name));
      if (entryStat.isDirectory()) {
        taskDirs.push(name);
      }
    } catch {
      /* skip */
    }
  }
  return taskDirs;
}

export async function listCanonicalWorkDayDirs(workRootAbs: string): Promise<string[]> {
  const names = await safeReaddir(workRootAbs);
  const dayDirs: string[] = [];
  for (const name of names) {
    if (!WORK_DAY_DIR_PATTERN.test(name)) {
      continue;
    }
    try {
      const entryStat = await stat(path.join(workRootAbs, name));
      if (entryStat.isDirectory()) {
        dayDirs.push(name);
      }
    } catch {
      /* skip broken entries */
    }
  }
  return dayDirs;
}

async function readStateIfPresent(stateAbs: string): Promise<FeatureDeliveryState | null> {
  try {
    const parsed = JSON.parse(await readFile(stateAbs, "utf8")) as FeatureDeliveryState;
    if (parsed.pipelineId !== "feature-delivery") {
      return null;
    }
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isValidOutOfBandManifest(taskAbs: string): boolean {
  const manifestPath = path.join(taskAbs, OUT_OF_BAND_MANIFEST);
  if (!existsSync(manifestPath)) {
    return false;
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { reason?: unknown };
    return typeof manifest.reason === "string" && manifest.reason.trim().length >= 12;
  } catch {
    return false;
  }
}

function isValidComplianceAuditWorkspace(taskAbs: string): boolean {
  return (
    existsSync(path.join(taskAbs, COMPLIANCE_AUDIT_FILENAME)) &&
    existsSync(path.join(taskAbs, COMPLIANCE_RESULT_FILENAME))
  );
}

/** Active work/<day>/<task-id>/ without feature-delivery state.json may still be intentional. */
export function isExemptOrphanWorkDirectory(taskDirAbs: string): boolean {
  return isValidOutOfBandManifest(taskDirAbs) || isValidComplianceAuditWorkspace(taskDirAbs);
}

async function resolveCanonicalTaskId(
  repoRoot: string,
  featureId: string,
  candidates: string[],
): Promise<string> {
  const indexRel = path.posix.join("lib", "memory", "features", featureId, "index.json");
  const indexAbs = resolveProjectPath(repoRoot, indexRel);
  if (existsSync(indexAbs)) {
    try {
      const index = JSON.parse(await readFile(indexAbs, "utf8")) as { task_id?: string };
      if (typeof index.task_id === "string" && candidates.includes(index.task_id)) {
        return index.task_id;
      }
    } catch {
      /* fall through */
    }
  }
  return [...candidates].sort((a, b) => b.localeCompare(a))[0]!;
}

async function listWorkRunRecords(repoRoot: string, rootKind: "work" | "archive"): Promise<WorkRunRecord[]> {
  const rootRel = rootKind === "work" ? "work" : path.posix.join("archive", "work");
  const rootAbs = resolveProjectPath(repoRoot, rootRel);
  const records: WorkRunRecord[] = [];
  const dayDirs = await listCanonicalWorkDayDirs(rootAbs);
  for (const dayDir of dayDirs) {
    const dayAbs = path.join(rootAbs, dayDir);
    const taskDirs = await listTaskDirNames(dayAbs);
    for (const taskId of taskDirs) {
      const stateAbs = path.join(dayAbs, taskId, "state.json");
      const state = await readStateIfPresent(stateAbs);
      if (state === null) {
        continue;
      }
      records.push({
        taskId,
        dayDir,
        runDirRel: path.posix.join(rootRel, dayDir, taskId),
        state,
      });
    }
  }
  return records;
}

/**
 * Read-only scan for inconsistent active/archived work directories.
 */
export async function scanWorkArchiveHygiene(repoRootInput: string): Promise<WorkArchiveHygieneScanResult> {
  const repoRoot = path.resolve(repoRootInput);
  const issues: WorkArchiveHygieneIssue[] = [];
  const workRootAbs = resolveProjectPath(repoRoot, "work");
  const workRuns = await listWorkRunRecords(repoRoot, "work");
  const archiveRuns = await listWorkRunRecords(repoRoot, "archive");
  const archiveByTaskId = new Map(archiveRuns.map((record) => [record.taskId, record]));

  for (const record of workRuns) {
    const { state, taskId, runDirRel } = record;
    const archivePeer = archiveByTaskId.get(taskId);

    if (archivePeer !== undefined && state.status !== "closed") {
      issues.push({
        code: "dual_work_archive_state",
        path: runDirRel,
        taskId,
        featureId: state.featureId,
        detail: `Both ${runDirRel} and ${archivePeer.runDirRel} exist while state status is ${state.status}.`,
        remediation:
          "Do not manually mv work directories. If archive is premature, roll back the archive move; otherwise run pnpm -w exec pan close-artifacts <task-id>.",
      });
    }

    if (state.status === "closed" && state.artifacts.runDir.startsWith("work/")) {
      issues.push({
        code: "closed_run_still_active",
        path: runDirRel,
        taskId,
        featureId: state.featureId,
        detail: `Ledger is closed but runDir still points at active work/: ${state.artifacts.runDir}.`,
        remediation: `pnpm -w exec pan close-artifacts ${taskId}`,
      });
    }

    if (
      state.currentStage === TERMINAL_STAGE &&
      state.status === "complete" &&
      state.artifacts.runDir.startsWith("work/")
    ) {
      issues.push({
        code: "pending_close_artifacts",
        path: runDirRel,
        taskId,
        featureId: state.featureId,
        detail: "Feature-delivery reached complete/complete but close-artifacts has not archived the run.",
        remediation: `pnpm -w exec pan close-artifacts ${taskId}`,
      });
      const inboxSourceRel = state.source.inboxPath.replace(/\\/gu, "/").replace(/^\/+/, "");
      const inboxSourceAbs = resolveProjectPath(repoRoot, inboxSourceRel);
      if (existsSync(inboxSourceAbs)) {
        issues.push({
          code: "inbox_source_still_active",
          path: inboxSourceRel,
          taskId,
          featureId: state.featureId,
          detail: `Source inbox directive remains under lib/inbox/in/ for completed task ${taskId}.`,
          remediation: `pnpm -w exec pan close-artifacts ${taskId}`,
        });
      }
    }
  }

  const completeInWork = workRuns.filter(
    (record) =>
      record.state.currentStage === TERMINAL_STAGE &&
      record.state.status === "complete" &&
      record.state.artifacts.runDir.startsWith("work/"),
  );
  const byFeatureDay = new Map<string, WorkRunRecord[]>();
  for (const record of completeInWork) {
    const key = `${record.dayDir}::${record.state.featureId}`;
    const group = byFeatureDay.get(key) ?? [];
    group.push(record);
    byFeatureDay.set(key, group);
  }
  for (const [, group] of byFeatureDay) {
    if (group.length < 2) {
      continue;
    }
    const taskIds = group.map((record) => record.taskId);
    const canonicalTaskId = await resolveCanonicalTaskId(repoRoot, group[0]!.state.featureId, taskIds);
    for (const duplicate of group.filter((record) => record.taskId !== canonicalTaskId)) {
      issues.push({
        code: "duplicate_complete_run",
        path: duplicate.runDirRel,
        taskId: duplicate.taskId,
        featureId: duplicate.state.featureId,
        detail: `Superseded complete run for feature ${duplicate.state.featureId}; canonical task is ${canonicalTaskId}.`,
        remediation: `After pnpm -w exec pan close-artifacts ${canonicalTaskId}, run pnpm -w exec pan close-artifacts ${duplicate.taskId} to archive the superseded work directory.`,
      });
    }
  }

  const dayDirs = await listCanonicalWorkDayDirs(workRootAbs);
  for (const dayDir of dayDirs) {
    const dayAbs = path.join(workRootAbs, dayDir);
    const taskDirs = await listTaskDirNames(dayAbs);
    for (const taskId of taskDirs) {
      const taskAbs = path.join(workRootAbs, dayDir, taskId);
      const taskRel = path.posix.join("work", dayDir, taskId);
      const stateAbs = path.join(taskAbs, "state.json");
      if (existsSync(stateAbs)) {
        continue;
      }
      if (isExemptOrphanWorkDirectory(taskAbs)) {
        continue;
      }
      issues.push({
        code: "orphan_work_dir",
        path: taskRel,
        taskId,
        detail:
          "work/<day>/<task-id>/ lacks state.json and is not an exempt manual workspace (out-of-band.manifest.json or compliance-audit artifacts).",
        remediation:
          "Archive under archive/work, add out-of-band.manifest.json (reason >= 12 characters), or retain a completed compliance-audit.md plus compliance-result.json pair from /compliance-auditor.",
      });
    }
  }

  const pendingCloseCount = issues.filter((issue) => issue.code === "pending_close_artifacts").length;
  return { issues, pendingCloseCount };
}

export function formatWorkArchiveHygieneRemediation(issues: WorkArchiveHygieneIssue[]): string {
  if (issues.length === 0) {
    return "No work/archive hygiene issues detected.";
  }
  return issues.map((issue) => `${issue.code} @ ${issue.path}: ${issue.remediation}`).join("; ");
}
