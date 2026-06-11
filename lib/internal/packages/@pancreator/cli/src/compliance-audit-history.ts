import { resolveProjectPath, resolveRepoPath } from "@pancreator/core";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyCliJson } from "./canonical-json-io.js";

export const COMPLIANCE_AUDIT_HISTORY_MAX = 5;
export const COMPLIANCE_AUDIT_HISTORY_SCHEMA_VERSION = "1";
export const COMPLIANCE_AUDIT_HISTORY_REL = path.posix.join(
  "lib",
  "memory",
  "features",
  "quality-governance",
  "compliance-tests",
  "audit-history.json",
);

export interface ComplianceAuditSnapshotEntry {
  path: string;
  exists: boolean;
  sha256: string | null;
  size_bytes: number | null;
}

export interface ComplianceAuditDeltaSummary {
  added: number;
  removed: number;
  modified: number;
  changed_paths: string[];
}

export interface ComplianceAuditFindingSummary {
  total: number;
  block: number;
  major: number;
  minor: number;
  note: number;
}

export interface ComplianceAuditHistoryEntry {
  audit_id: string;
  task_id: string;
  feature_id: string;
  recorded_at: string;
  stage_status: string;
  baseline_audit_id: string | null;
  artifact_paths: {
    compliance_result?: string;
    compliance_audit?: string;
    run_dir?: string;
    index_json?: string;
  };
  scope_snapshot: ComplianceAuditSnapshotEntry[];
  delta_summary: ComplianceAuditDeltaSummary;
  findings_summary: ComplianceAuditFindingSummary;
}

export interface ComplianceAuditHistory {
  schema_version: typeof COMPLIANCE_AUDIT_HISTORY_SCHEMA_VERSION;
  max_entries: number;
  generated_at: string;
  entries: ComplianceAuditHistoryEntry[];
}

interface PersistComplianceAuditArgs {
  repoRoot: string;
  taskId: string;
  featureId: string;
  runDir: string;
  complianceResultRel: string;
  defaultScopePaths: string[];
  now: Date;
}

export interface PersistComplianceAuditResult {
  auditId: string;
  requestedBaselineAuditId: string | null;
  resolvedBaselineAuditId: string | null;
  availableAuditIds: string[];
  deltaSummary: ComplianceAuditDeltaSummary;
  scopeSnapshot: ComplianceAuditSnapshotEntry[];
}

export interface ComplianceAuditPromptContext {
  availableAuditIds: string[];
  defaultBaselineAuditId: string | null;
  deltaSummary: ComplianceAuditDeltaSummary;
}

interface NormalizeHistoryPathsArgs {
  repoRoot: string;
  taskId: string;
  fromRunDir: string;
  toRunDir: string;
}

function blankDelta(): ComplianceAuditDeltaSummary {
  return {
    added: 0,
    removed: 0,
    modified: 0,
    changed_paths: [],
  };
}

function blankFindings(): ComplianceAuditFindingSummary {
  return { total: 0, block: 0, major: 0, minor: 0, note: 0 };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function maybeIso(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) {
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function normalizeRepoRelativePath(value: string): string | null {
  const raw = value.replace(/\\/gu, "/").trim();
  if (
    raw.length === 0 ||
    raw.startsWith("/") ||
    raw.includes("\0") ||
    raw.toLowerCase() === "local diff" ||
    raw.toLowerCase() === "local-diff"
  ) {
    return null;
  }
  const noLeading = raw.replace(/^\.\/+/u, "");
  const parts = noLeading.split("/").filter((segment) => segment.length > 0);
  if (parts.length === 0 || parts.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return parts.join("/");
}

function hashUtf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function snapshotPath(repoRoot: string, rel: string): Promise<ComplianceAuditSnapshotEntry> {
  const abs = resolveRepoPath(repoRoot, rel);
  if (!existsSync(abs)) {
    return { path: rel, exists: false, sha256: null, size_bytes: null };
  }
  const info = await stat(abs);
  if (!info.isFile()) {
    return { path: rel, exists: true, sha256: null, size_bytes: null };
  }
  const content = await readFile(abs, "utf8");
  return {
    path: rel,
    exists: true,
    sha256: hashUtf8(content),
    size_bytes: Buffer.byteLength(content, "utf8"),
  };
}

function snapshotPathSync(repoRoot: string, rel: string): ComplianceAuditSnapshotEntry {
  const abs = resolveRepoPath(repoRoot, rel);
  if (!existsSync(abs)) {
    return { path: rel, exists: false, sha256: null, size_bytes: null };
  }
  const content = readFileSync(abs, "utf8");
  return {
    path: rel,
    exists: true,
    sha256: hashUtf8(content),
    size_bytes: Buffer.byteLength(content, "utf8"),
  };
}

function dedupePaths(paths: readonly string[]): string[] {
  const ordered = new Set<string>();
  for (const pathValue of paths) {
    const normalized = normalizeRepoRelativePath(pathValue);
    if (normalized !== null) {
      ordered.add(normalized);
    }
  }
  return [...ordered];
}

async function buildSnapshot(repoRoot: string, paths: readonly string[]): Promise<ComplianceAuditSnapshotEntry[]> {
  const deduped = dedupePaths(paths).sort((a, b) => a.localeCompare(b));
  const out: ComplianceAuditSnapshotEntry[] = [];
  for (const rel of deduped) {
    out.push(await snapshotPath(repoRoot, rel));
  }
  return out;
}

function buildSnapshotSync(repoRoot: string, paths: readonly string[]): ComplianceAuditSnapshotEntry[] {
  const deduped = dedupePaths(paths).sort((a, b) => a.localeCompare(b));
  return deduped.map((rel) => snapshotPathSync(repoRoot, rel));
}

function compareSnapshots(
  baseline: readonly ComplianceAuditSnapshotEntry[],
  current: readonly ComplianceAuditSnapshotEntry[],
): ComplianceAuditDeltaSummary {
  const baselineMap = new Map<string, ComplianceAuditSnapshotEntry>();
  for (const item of baseline) {
    baselineMap.set(item.path, item);
  }
  const currentMap = new Map<string, ComplianceAuditSnapshotEntry>();
  for (const item of current) {
    currentMap.set(item.path, item);
  }

  let added = 0;
  let removed = 0;
  let modified = 0;
  const changed = new Set<string>();

  for (const [pathValue, item] of currentMap) {
    const previous = baselineMap.get(pathValue);
    if (previous === undefined) {
      added += 1;
      changed.add(pathValue);
      continue;
    }
    if (
      previous.exists !== item.exists ||
      previous.sha256 !== item.sha256 ||
      previous.size_bytes !== item.size_bytes
    ) {
      modified += 1;
      changed.add(pathValue);
    }
  }
  for (const pathValue of baselineMap.keys()) {
    if (!currentMap.has(pathValue)) {
      removed += 1;
      changed.add(pathValue);
    }
  }

  return {
    added,
    removed,
    modified,
    changed_paths: [...changed].sort((a, b) => a.localeCompare(b)),
  };
}

function parseScopePathsFromComplianceRecord(
  parsed: Record<string, unknown>,
  fallbackScopePaths: readonly string[],
): string[] {
  const scope = asRecord(parsed.scope);
  const inputs = scope?.inputsAudited;
  if (!Array.isArray(inputs)) {
    return dedupePaths(fallbackScopePaths);
  }
  const fromRecord = inputs
    .map((item) => (typeof item === "string" ? item : null))
    .filter((item): item is string => item !== null);
  if (fromRecord.length === 0) {
    return dedupePaths(fallbackScopePaths);
  }
  return dedupePaths(fromRecord);
}

function parseFindingsSummary(parsed: Record<string, unknown>): ComplianceAuditFindingSummary {
  const findings = parsed.findings;
  if (!Array.isArray(findings)) {
    return blankFindings();
  }
  const summary = blankFindings();
  summary.total = findings.length;
  for (const finding of findings) {
    const severity = asString(asRecord(finding)?.severity)?.toLowerCase();
    if (severity === "block") summary.block += 1;
    if (severity === "major") summary.major += 1;
    if (severity === "minor") summary.minor += 1;
    if (severity === "note") summary.note += 1;
  }
  return summary;
}

function parseStageStatus(parsed: Record<string, unknown>): string {
  const status =
    asString(parsed.stageStatus) ??
    asString(parsed.stage_status) ??
    asString(parsed.status) ??
    asString(parsed.recommendedEvent);
  if (status !== null) {
    return status;
  }
  const passes = parsed.compliance_passes;
  if (typeof passes === "boolean") {
    return passes ? "passed" : "failed";
  }
  return "unknown";
}

function parseRecordedAt(parsed: Record<string, unknown>, fallback: Date): string {
  return (
    maybeIso(parsed.recorded_at) ??
    maybeIso(parsed.recordedAt) ??
    maybeIso(parsed.auditedAt) ??
    maybeIso(parsed.audited_at) ??
    fallback.toISOString()
  );
}

function extractTaskIdFromPath(rel: string): string | null {
  const match = rel.match(/\/(\d+_\d{4}_[a-z0-9][a-z0-9_-]*)\//u);
  return match?.[1] ?? null;
}

function makeAuditId(taskId: string, recordedAtIso: string): string {
  const compact = recordedAtIso.replace(/[-:TZ.]/gu, "").slice(0, 14);
  return `${taskId}-${compact}`;
}

function resolveRequestedBaseline(
  parsed: Record<string, unknown>,
  currentEntries: readonly ComplianceAuditHistoryEntry[],
): {
  requestedBaselineAuditId: string | null;
  resolvedBaselineAuditId: string | null;
  baselineEntry: ComplianceAuditHistoryEntry | null;
} {
  const requested =
    asString(parsed.baseline_audit_id) ??
    asString(asRecord(parsed.audit_focus)?.requested_baseline_audit_id);
  if (requested !== null) {
    const selected = currentEntries.find((entry) => entry.audit_id === requested) ?? null;
    if (selected !== null) {
      return {
        requestedBaselineAuditId: requested,
        resolvedBaselineAuditId: selected.audit_id,
        baselineEntry: selected,
      };
    }
  }
  const previous = currentEntries[0] ?? null;
  return {
    requestedBaselineAuditId: requested,
    resolvedBaselineAuditId: previous?.audit_id ?? null,
    baselineEntry: previous,
  };
}

function sortEntriesNewest(entries: ComplianceAuditHistoryEntry[]): ComplianceAuditHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const left = Date.parse(a.recorded_at);
    const right = Date.parse(b.recorded_at);
    if (!Number.isNaN(left) && !Number.isNaN(right) && right !== left) {
      return right - left;
    }
    return b.audit_id.localeCompare(a.audit_id);
  });
}

function normalizedHistory(raw: unknown): ComplianceAuditHistory {
  const rec = asRecord(raw);
  const entriesRaw = Array.isArray(rec?.entries) ? rec.entries : [];
  const entries: ComplianceAuditHistoryEntry[] = [];
  for (const entryUnknown of entriesRaw) {
    const entryRec = asRecord(entryUnknown);
    if (entryRec === null) {
      continue;
    }
    const auditId = asString(entryRec.audit_id);
    const taskId = asString(entryRec.task_id);
    const featureId = asString(entryRec.feature_id);
    const recordedAt = maybeIso(entryRec.recorded_at);
    if (auditId === null || taskId === null || featureId === null || recordedAt === null) {
      continue;
    }
    const artifactPathsRec = asRecord(entryRec.artifact_paths) ?? {};
    const snapshotRaw = Array.isArray(entryRec.scope_snapshot) ? entryRec.scope_snapshot : [];
    const snapshot: ComplianceAuditSnapshotEntry[] = [];
    for (const itemUnknown of snapshotRaw) {
      const itemRec = asRecord(itemUnknown);
      const itemPath = asString(itemRec?.path);
      if (itemRec === null || itemPath === null) {
        continue;
      }
      snapshot.push({
        path: itemPath,
        exists: itemRec.exists === true,
        sha256: itemRec.sha256 === null ? null : asString(itemRec.sha256),
        size_bytes: typeof itemRec.size_bytes === "number" ? itemRec.size_bytes : null,
      });
    }
    const deltaRec = asRecord(entryRec.delta_summary);
    const findingsRec = asRecord(entryRec.findings_summary);
    entries.push({
      audit_id: auditId,
      task_id: taskId,
      feature_id: featureId,
      recorded_at: recordedAt,
      stage_status: asString(entryRec.stage_status) ?? "unknown",
      baseline_audit_id: asString(entryRec.baseline_audit_id),
      artifact_paths: {
        ...(asString(artifactPathsRec.compliance_result) !== null
          ? { compliance_result: asString(artifactPathsRec.compliance_result)! }
          : {}),
        ...(asString(artifactPathsRec.compliance_audit) !== null
          ? { compliance_audit: asString(artifactPathsRec.compliance_audit)! }
          : {}),
        ...(asString(artifactPathsRec.run_dir) !== null ? { run_dir: asString(artifactPathsRec.run_dir)! } : {}),
        ...(asString(artifactPathsRec.index_json) !== null
          ? { index_json: asString(artifactPathsRec.index_json)! }
          : {}),
      },
      scope_snapshot: snapshot,
      delta_summary: {
        added: typeof deltaRec?.added === "number" ? deltaRec.added : 0,
        removed: typeof deltaRec?.removed === "number" ? deltaRec.removed : 0,
        modified: typeof deltaRec?.modified === "number" ? deltaRec.modified : 0,
        changed_paths: Array.isArray(deltaRec?.changed_paths)
          ? deltaRec.changed_paths
              .map((item) => (typeof item === "string" ? item : null))
              .filter((item): item is string => item !== null)
          : [],
      },
      findings_summary: {
        total: typeof findingsRec?.total === "number" ? findingsRec.total : 0,
        block: typeof findingsRec?.block === "number" ? findingsRec.block : 0,
        major: typeof findingsRec?.major === "number" ? findingsRec.major : 0,
        minor: typeof findingsRec?.minor === "number" ? findingsRec.minor : 0,
        note: typeof findingsRec?.note === "number" ? findingsRec.note : 0,
      },
    });
  }
  const sorted = sortEntriesNewest(entries).slice(0, COMPLIANCE_AUDIT_HISTORY_MAX);
  return {
    schema_version: COMPLIANCE_AUDIT_HISTORY_SCHEMA_VERSION,
    max_entries: COMPLIANCE_AUDIT_HISTORY_MAX,
    generated_at: maybeIso(rec?.generated_at) ?? new Date(0).toISOString(),
    entries: sorted,
  };
}

function relFromFeatureIndex(indexRel: string, maybeRel: string | null): string | null {
  const normalized = maybeRel === null ? null : normalizeRepoRelativePath(maybeRel);
  if (normalized === null) {
    return null;
  }
  if (normalized.startsWith(".pan/work/") || normalized.startsWith(".pan/archive/") || normalized.startsWith("lib/")) {
    return normalized;
  }
  return path.posix.join(path.posix.dirname(indexRel), normalized);
}

function parseAuditPathsFromMarkdown(content: string): string[] {
  const matches = content.matchAll(/`([^`\n]+)`/gu);
  const out: string[] = [];
  for (const match of matches) {
    const value = match[1];
    const normalized = normalizeRepoRelativePath(value);
    if (normalized !== null) {
      out.push(normalized);
    }
  }
  return dedupePaths(out);
}

async function buildBackfillEntries(repoRoot: string): Promise<ComplianceAuditHistoryEntry[]> {
  const featuresRoot = resolveProjectPath(repoRoot, "lib", "memory", "features");
  if (!existsSync(featuresRoot)) {
    return [];
  }
  const categories = (await readdir(featuresRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const rows: ComplianceAuditHistoryEntry[] = [];
  for (const category of categories) {
    const categoryRoot = path.join(featuresRoot, category);
    const featureDirs = (await readdir(categoryRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const featureDir of featureDirs) {
      const indexRel = path.posix.join("lib", "memory", "features", category, featureDir, "index.json");
      const indexAbs = resolveRepoPath(repoRoot, indexRel);
      if (!existsSync(indexAbs)) {
        continue;
      }

      let parsedIndex: Record<string, unknown>;
      try {
        parsedIndex = JSON.parse(await readFile(indexAbs, "utf8")) as Record<string, unknown>;
      } catch {
        continue;
      }

      const featureId = asString(parsedIndex.feature_id) ?? featureDir;
      const taskIdFromIndex = asString(parsedIndex.task_id);
      const artifactIndex = asRecord(parsedIndex.artifact_index);
      const pipelineArtifacts = asRecord(artifactIndex?.pipeline_artifacts);
      const complianceResultRel = relFromFeatureIndex(
        indexRel,
        asString(asRecord(pipelineArtifacts?.compliance_result)?.path),
      );
      const complianceAuditRel = relFromFeatureIndex(
        indexRel,
        asString(asRecord(pipelineArtifacts?.compliance_audit)?.path),
      );
      const runDirRel = relFromFeatureIndex(indexRel, asString(asRecord(pipelineArtifacts?.work_dir)?.path));
      const candidateRel = complianceResultRel ?? complianceAuditRel;
      if (candidateRel === null) {
        continue;
      }
      const candidateAbs = resolveRepoPath(repoRoot, candidateRel);
      if (!existsSync(candidateAbs)) {
        continue;
      }

      let recordedAt = maybeIso(parsedIndex.indexed_at) ?? new Date(0).toISOString();
      let stageStatus = "unknown";
      let findings = blankFindings();
      let scopePaths: string[] = [];
      let taskId = taskIdFromIndex ?? extractTaskIdFromPath(candidateRel) ?? "unknown-task";

      if (candidateRel.endsWith(".json")) {
        try {
          const parsedResult = JSON.parse(await readFile(candidateAbs, "utf8")) as Record<string, unknown>;
          recordedAt = parseRecordedAt(parsedResult, new Date(recordedAt));
          stageStatus = parseStageStatus(parsedResult);
          findings = parseFindingsSummary(parsedResult);
          scopePaths = parseScopePathsFromComplianceRecord(parsedResult, []);
          taskId = asString(parsedResult.taskId) ?? asString(parsedResult.task_id) ?? taskId;
        } catch {
          // Leave fallback metadata.
        }
      } else {
        const markdown = await readFile(candidateAbs, "utf8");
        const statInfo = await stat(candidateAbs);
        recordedAt = new Date(statInfo.mtimeMs).toISOString();
        stageStatus = /compliance_passes:\s*true/iu.test(markdown) ? "passed" : "unknown";
        scopePaths = parseAuditPathsFromMarkdown(markdown);
      }

      const snapshot = await buildSnapshot(repoRoot, scopePaths);
      rows.push({
        audit_id: makeAuditId(taskId, recordedAt),
        task_id: taskId,
        feature_id: featureId,
        recorded_at: recordedAt,
        stage_status: stageStatus,
        baseline_audit_id: null,
        artifact_paths: {
          ...(complianceResultRel !== null ? { compliance_result: complianceResultRel } : {}),
          ...(complianceAuditRel !== null ? { compliance_audit: complianceAuditRel } : {}),
          ...(runDirRel !== null ? { run_dir: runDirRel } : {}),
          index_json: indexRel,
        },
        scope_snapshot: snapshot,
        delta_summary: blankDelta(),
        findings_summary: findings,
      });
    }
  }

  const sorted = sortEntriesNewest(rows).slice(0, COMPLIANCE_AUDIT_HISTORY_MAX);
  for (let index = 0; index < sorted.length; index += 1) {
    const older = sorted[index + 1] ?? null;
    sorted[index] = {
      ...sorted[index],
      baseline_audit_id: older?.audit_id ?? null,
      delta_summary:
        older === null ? blankDelta() : compareSnapshots(older.scope_snapshot, sorted[index].scope_snapshot),
    };
  }
  return sorted;
}

async function ensureHistoryLoaded(
  repoRoot: string,
  options?: { seedBackfill?: boolean },
): Promise<ComplianceAuditHistory> {
  const seedBackfill = options?.seedBackfill ?? true;
  const historyAbs = resolveRepoPath(repoRoot, COMPLIANCE_AUDIT_HISTORY_REL);
  if (existsSync(historyAbs)) {
    const parsed = JSON.parse(await readFile(historyAbs, "utf8")) as unknown;
    return normalizedHistory(parsed);
  }
  const initialEntries = seedBackfill ? await buildBackfillEntries(repoRoot) : [];
  const history: ComplianceAuditHistory = {
    schema_version: COMPLIANCE_AUDIT_HISTORY_SCHEMA_VERSION,
    max_entries: COMPLIANCE_AUDIT_HISTORY_MAX,
    generated_at: new Date().toISOString(),
    entries: initialEntries,
  };
  await saveComplianceAuditHistory(repoRoot, history);
  return history;
}

async function saveComplianceAuditHistory(repoRoot: string, history: ComplianceAuditHistory): Promise<void> {
  const historyAbs = resolveRepoPath(repoRoot, COMPLIANCE_AUDIT_HISTORY_REL);
  await mkdir(path.dirname(historyAbs), { recursive: true });
  const payload: ComplianceAuditHistory = {
    schema_version: COMPLIANCE_AUDIT_HISTORY_SCHEMA_VERSION,
    max_entries: COMPLIANCE_AUDIT_HISTORY_MAX,
    generated_at: history.generated_at,
    entries: sortEntriesNewest([...history.entries]).slice(0, COMPLIANCE_AUDIT_HISTORY_MAX),
  };
  await writeFile(historyAbs, stringifyCliJson(repoRoot, payload), "utf8");
}

function complianceAuditIds(entries: readonly ComplianceAuditHistoryEntry[]): string[] {
  return entries.map((entry) => entry.audit_id).slice(0, COMPLIANCE_AUDIT_HISTORY_MAX);
}

function parseComplianceRecordForUpdate(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function defaultEntryScope(stateScopePaths: readonly string[]): string[] {
  return dedupePaths(stateScopePaths);
}

function readScopePathsFromResult(
  parsed: Record<string, unknown>,
  fallbackScopePaths: readonly string[],
): string[] {
  return parseScopePathsFromComplianceRecord(parsed, fallbackScopePaths);
}

function mergedAuditFocus(
  parsed: Record<string, unknown>,
  input: {
    requestedBaselineAuditId: string | null;
    resolvedBaselineAuditId: string | null;
    availableAuditIds: string[];
    deltaSummary: ComplianceAuditDeltaSummary;
  },
): Record<string, unknown> {
  const existing = asRecord(parsed.audit_focus) ?? {};
  return {
    ...existing,
    mode: input.requestedBaselineAuditId === null ? "previous-default" : "selected",
    requested_baseline_audit_id: input.requestedBaselineAuditId,
    resolved_baseline_audit_id: input.resolvedBaselineAuditId,
    available_audit_ids: input.availableAuditIds,
    delta_summary: input.deltaSummary,
  };
}

export async function persistComplianceAuditHistoryForResult(
  args: PersistComplianceAuditArgs,
): Promise<PersistComplianceAuditResult> {
  const history = await ensureHistoryLoaded(args.repoRoot, { seedBackfill: true });
  const complianceAbs = resolveRepoPath(args.repoRoot, args.complianceResultRel);
  const rawCompliance = await readFile(complianceAbs, "utf8");
  const parsed = parseComplianceRecordForUpdate(rawCompliance);
  if (parsed === null) {
    throw new Error(`${args.complianceResultRel} must be JSON to persist compliance audit history.`);
  }

  const baseline = resolveRequestedBaseline(parsed, history.entries);
  const scopePaths = readScopePathsFromResult(parsed, defaultEntryScope(args.defaultScopePaths));
  const scopeSnapshot = await buildSnapshot(args.repoRoot, scopePaths);
  const deltaSummary = compareSnapshots(baseline.baselineEntry?.scope_snapshot ?? [], scopeSnapshot);
  const recordedAt = parseRecordedAt(parsed, args.now);
  const taskId = asString(parsed.taskId) ?? asString(parsed.task_id) ?? args.taskId;
  const featureId = asString(parsed.featureId) ?? asString(parsed.feature_id) ?? args.featureId;
  const requestedAuditId = asString(parsed.audit_id);
  const auditId = requestedAuditId ?? makeAuditId(taskId, recordedAt);
  const findingsSummary = parseFindingsSummary(parsed);
  const stageStatus = parseStageStatus(parsed);

  const upsertEntry: ComplianceAuditHistoryEntry = {
    audit_id: auditId,
    task_id: taskId,
    feature_id: featureId,
    recorded_at: recordedAt,
    stage_status: stageStatus,
    baseline_audit_id: baseline.resolvedBaselineAuditId,
    artifact_paths: {
      compliance_result: args.complianceResultRel,
      run_dir: args.runDir,
    },
    scope_snapshot: scopeSnapshot,
    delta_summary: deltaSummary,
    findings_summary: findingsSummary,
  };

  const remaining = history.entries.filter((entry) => entry.audit_id !== auditId);
  const nextEntries = sortEntriesNewest([upsertEntry, ...remaining]).slice(0, COMPLIANCE_AUDIT_HISTORY_MAX);
  const availableAuditIds = complianceAuditIds(nextEntries);
  const resultPayload: PersistComplianceAuditResult = {
    auditId,
    requestedBaselineAuditId: baseline.requestedBaselineAuditId,
    resolvedBaselineAuditId: baseline.resolvedBaselineAuditId,
    availableAuditIds,
    deltaSummary,
    scopeSnapshot,
  };

  parsed.audit_id = auditId;
  parsed.baseline_audit_id = baseline.resolvedBaselineAuditId;
  parsed.delta_paths = deltaSummary.changed_paths;
  parsed.audit_focus = mergedAuditFocus(parsed, {
    requestedBaselineAuditId: baseline.requestedBaselineAuditId,
    resolvedBaselineAuditId: baseline.resolvedBaselineAuditId,
    availableAuditIds,
    deltaSummary,
  });

  await writeFile(complianceAbs, stringifyCliJson(args.repoRoot, parsed), "utf8");
  await saveComplianceAuditHistory(args.repoRoot, {
    schema_version: COMPLIANCE_AUDIT_HISTORY_SCHEMA_VERSION,
    max_entries: COMPLIANCE_AUDIT_HISTORY_MAX,
    generated_at: args.now.toISOString(),
    entries: nextEntries,
  });
  return resultPayload;
}

function remapRunScopedPath(pathValue: string, fromRunDir: string, toRunDir: string): string {
  if (pathValue === fromRunDir) {
    return toRunDir;
  }
  if (pathValue.startsWith(`${fromRunDir}/`)) {
    return `${toRunDir}${pathValue.slice(fromRunDir.length)}`;
  }
  return pathValue;
}

export async function normalizeComplianceAuditHistoryForArchivedRun(
  args: NormalizeHistoryPathsArgs,
): Promise<void> {
  const historyAbs = resolveRepoPath(args.repoRoot, COMPLIANCE_AUDIT_HISTORY_REL);
  if (!existsSync(historyAbs)) {
    return;
  }
  const parsed = normalizedHistory(JSON.parse(await readFile(historyAbs, "utf8")) as unknown);
  let changed = false;
  const nextEntries = parsed.entries.map((entry) => {
    if (entry.task_id !== args.taskId) {
      return entry;
    }
    const next: ComplianceAuditHistoryEntry = {
      ...entry,
      artifact_paths: { ...entry.artifact_paths },
      scope_snapshot: entry.scope_snapshot.map((item) => ({ ...item })),
      delta_summary: {
        ...entry.delta_summary,
        changed_paths: [...entry.delta_summary.changed_paths],
      },
    };
    const remap = (value: string | undefined): string | undefined => {
      if (value === undefined) {
        return undefined;
      }
      const rewritten = remapRunScopedPath(value, args.fromRunDir, args.toRunDir);
      if (rewritten !== value) {
        changed = true;
      }
      return rewritten;
    };
    next.artifact_paths.run_dir = remap(next.artifact_paths.run_dir);
    next.artifact_paths.compliance_result = remap(next.artifact_paths.compliance_result);
    next.artifact_paths.compliance_audit = remap(next.artifact_paths.compliance_audit);
    for (const key of ["run_dir", "compliance_result", "compliance_audit", "index_json"] as const) {
      if (next.artifact_paths[key] === undefined) {
        delete next.artifact_paths[key];
      }
    }
    next.scope_snapshot = next.scope_snapshot.map((item) => {
      const rewritten = remapRunScopedPath(item.path, args.fromRunDir, args.toRunDir);
      if (rewritten !== item.path) {
        changed = true;
      }
      return { ...item, path: rewritten };
    });
    next.delta_summary.changed_paths = next.delta_summary.changed_paths.map((pathValue) => {
      const rewritten = remapRunScopedPath(pathValue, args.fromRunDir, args.toRunDir);
      if (rewritten !== pathValue) {
        changed = true;
      }
      return rewritten;
    });
    return next;
  });

  if (!changed) {
    return;
  }
  await saveComplianceAuditHistory(args.repoRoot, {
    schema_version: COMPLIANCE_AUDIT_HISTORY_SCHEMA_VERSION,
    max_entries: COMPLIANCE_AUDIT_HISTORY_MAX,
    generated_at: new Date().toISOString(),
    entries: nextEntries,
  });
}

export async function ensureComplianceAuditHistoryBackfilled(repoRoot: string): Promise<ComplianceAuditHistory> {
  return ensureHistoryLoaded(repoRoot, { seedBackfill: true });
}

export function complianceAuditPromptContext(args: {
  repoRoot: string;
  defaultScopePaths: readonly string[];
}): ComplianceAuditPromptContext | null {
  const historyAbs = resolveRepoPath(args.repoRoot, COMPLIANCE_AUDIT_HISTORY_REL);
  if (!existsSync(historyAbs)) {
    return null;
  }
  let parsed: ComplianceAuditHistory;
  try {
    parsed = normalizedHistory(JSON.parse(readFileSync(historyAbs, "utf8")) as unknown);
  } catch {
    return null;
  }
  const availableAuditIds = complianceAuditIds(parsed.entries);
  const baseline = parsed.entries[0] ?? null;
  const currentSnapshot = buildSnapshotSync(args.repoRoot, args.defaultScopePaths);
  const deltaSummary = compareSnapshots(baseline?.scope_snapshot ?? [], currentSnapshot);
  return {
    availableAuditIds,
    defaultBaselineAuditId: baseline?.audit_id ?? null,
    deltaSummary,
  };
}
