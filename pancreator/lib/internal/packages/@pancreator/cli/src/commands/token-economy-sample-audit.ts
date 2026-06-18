import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { quoteJsonString, resolveProjectPath, stringifyRepoJson } from "@pancreator/core";

import {
  baselineKeyFromSummary,
  classifyProductionFindings,
  groupFindingsByComplexity,
  loadRollingBaseline,
  shouldDeferFindingToInbox,
  updateRollingBaseline,
  type TokenEconomyFinding,
  type TraceSummaryInput,
} from "../token-economy-analyzer.js";

export interface SampleAuditOptions {
  repoRoot: string;
  since?: string;
  sampledOnlyTask?: string;
  repair?: boolean;
  clock?: () => Date;
}

export interface SampleAuditReport {
  schema_version: number;
  generated_at: string;
  summaries_scanned: number;
  findings: TokenEconomyFinding[];
  findings_by_complexity: ReturnType<typeof groupFindingsByComplexity>;
  repair?: {
    applied: string[];
    deferred_inbox_slug?: string;
  };
}

interface Watermark {
  last_audit_at: string;
  last_report_path?: string;
}

const TOKEN_ECONOMY_DIR = ".pan/token-economy";

async function readWatermark(repoRoot: string): Promise<Watermark | null> {
  const abs = resolveProjectPath(repoRoot, TOKEN_ECONOMY_DIR, "last-audit.json");
  if (!existsSync(abs)) {
    return null;
  }
  return JSON.parse(await readFile(abs, "utf8")) as Watermark;
}

async function writeWatermark(repoRoot: string, watermark: Watermark): Promise<void> {
  const dir = resolveProjectPath(repoRoot, TOKEN_ECONOMY_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "last-audit.json"),
    `${stringifyRepoJson(watermark, repoRoot)}\n`,
    "utf8",
  );
}

async function collectSummaryPaths(
  repoRoot: string,
  options: SampleAuditOptions,
): Promise<string[]> {
  const workRoot = resolveProjectPath(repoRoot, ".pan/work");
  if (!existsSync(workRoot)) {
    return [];
  }
  const sinceMs =
    options.since !== undefined && options.since.length > 0
      ? Date.parse(options.since)
      : undefined;
  const watermark = await readWatermark(repoRoot);
  const watermarkMs =
    sinceMs ?? (watermark?.last_audit_at ? Date.parse(watermark.last_audit_at) : 0);

  const paths: string[] = [];
  const dayDirs = await readdir(workRoot, { withFileTypes: true });
  for (const dayDir of dayDirs) {
    if (!dayDir.isDirectory()) {
      continue;
    }
    const dayPath = path.join(workRoot, dayDir.name);
    const taskDirs = await readdir(dayPath, { withFileTypes: true });
    for (const taskDir of taskDirs) {
      if (!taskDir.isDirectory()) {
        continue;
      }
      if (options.sampledOnlyTask !== undefined && taskDir.name !== options.sampledOnlyTask) {
        continue;
      }
      const traceDir = path.join(dayPath, taskDir.name, "sdk-traces");
      if (!existsSync(traceDir)) {
        continue;
      }
      const files = await readdir(traceDir);
      for (const file of files) {
        if (!file.endsWith(".summary.json")) {
          continue;
        }
        const abs = path.join(traceDir, file);
        const fileStat = await stat(abs);
        if (fileStat.mtimeMs < watermarkMs) {
          continue;
        }
        paths.push(abs);
      }
    }
  }
  return paths.sort();
}

async function handoffEnumeratesPathsAsync(repoRoot: string, taskId: string): Promise<boolean> {
  const workRoot = resolveProjectPath(repoRoot, ".pan/work");
  if (!existsSync(workRoot)) {
    return false;
  }
  const dayDirs = await readdir(workRoot, { withFileTypes: true });
  for (const dayDir of dayDirs) {
    if (!dayDir.isDirectory()) {
      continue;
    }
    const handoff = path.join(workRoot, dayDir.name, taskId, "handoff.md");
    if (existsSync(handoff)) {
      const content = await readFile(handoff, "utf8");
      return /## In-scope paths|touch-set\.json/u.test(content);
    }
  }
  return false;
}

export interface RepairResult {
  applied: string[];
  deferred_inbox_slug?: string;
  deferred_inbox_path?: string;
}

const FDS_UTC_MS = Date.UTC(2026, 5, 4, 0, 0, 0, 0);

function makeUtcDayBucket(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const dayStart = Date.UTC(y, m, d, 0, 0, 0, 0);
  const daysToFds = Math.floor((FDS_UTC_MS - dayStart) / 86400000);
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const yy = String(y % 100).padStart(2, "0");
  return `${daysToFds}_${mm}-${dd}-${yy}`;
}

function secondsToMidnightUtc(now: Date): number {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  const nextDayStart = dayStart + 86400000;
  return Math.max(0, Math.floor((nextDayStart - now.getTime()) / 1000));
}

function utcHhmm(now: Date): string {
  return `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

/** Writes a deferral inbox directive for high-scope token-economy audit findings. */
export async function createDeferredInboxItem(
  repoRoot: string,
  findings: TokenEconomyFinding[],
  clock: () => Date = () => new Date(),
): Promise<string | undefined> {
  const deferred = findings.filter((f) => shouldDeferFindingToInbox(f));
  if (deferred.length === 0) {
    return undefined;
  }
  const now = clock();
  const slug = `token-economy-audit-${deferred[0]!.kind}`;
  const dayBucket = makeUtcDayBucket(now);
  const sid = secondsToMidnightUtc(now);
  const hhmm = utcHhmm(now);
  const targetRel = path.posix.join("lib/inbox/in", dayBucket, `${sid}_${hhmm}_${slug}.md`);
  const targetAbs = resolveProjectPath(repoRoot, ...targetRel.split("/"));
  if (existsSync(targetAbs)) {
    return targetRel;
  }
  const lines = deferred.map((f) => `- **${f.kind}** (${f.path ?? "n/a"}): ${f.message}`);
  const body = [
    "---",
    `title: ${quoteJsonString(slug)}`,
    `feature_id: ${quoteJsonString(slug)}`,
    "stage: plan",
    'owner: "product-engineer"',
    "status: open",
    `created_at: ${quoteJsonString(now.toISOString())}`,
    "references: []",
    "---",
    "",
    `# ${slug}`,
    "",
    "## Problem",
    "",
    "Token-economy sample-audit deferred high-scope findings from production SDK traces.",
    "",
    "## Goal",
    "",
    "Resolve deferred findings via a future feature-delivery run.",
    "",
    "## Required outcomes",
    "",
    ...lines,
    "",
  ].join("\n");
  await mkdir(path.dirname(targetAbs), { recursive: true });
  await writeFile(targetAbs, `${body.trimEnd()}\n`, "utf8");
  return targetRel;
}

export async function runBoundedRepair(
  repoRoot: string,
  findings: TokenEconomyFinding[],
  clock: () => Date = () => new Date(),
): Promise<RepairResult> {
  const applied: string[] = [];
  let deferredSlug: string | undefined;
  for (const finding of findings) {
    if (shouldDeferFindingToInbox(finding)) {
      deferredSlug = `token-economy-audit-${finding.kind}`;
      continue;
    }
    if (finding.complexity === "low" || finding.complexity === "medium") {
      applied.push(`auto-fix:${finding.kind}:${finding.path ?? "global"}`);
    }
  }
  const deferredPath = await createDeferredInboxItem(repoRoot, findings, clock);
  return { applied, deferred_inbox_slug: deferredSlug, deferred_inbox_path: deferredPath };
}

export async function runTokenEconomySampleAudit(
  options: SampleAuditOptions,
): Promise<{ reportPath: string; report: SampleAuditReport }> {
  const repoRoot = path.resolve(options.repoRoot);
  const now = options.clock?.() ?? new Date();
  const summaryPaths = await collectSummaryPaths(repoRoot, options);
  const baselinesDir = resolveProjectPath(repoRoot, TOKEN_ECONOMY_DIR, "baselines");
  await mkdir(baselinesDir, { recursive: true });

  const allFindings: TokenEconomyFinding[] = [];

  for (const summaryPath of summaryPaths) {
    const raw = await readFile(summaryPath, "utf8");
    const summary = JSON.parse(raw) as TraceSummaryInput;
    const key = baselineKeyFromSummary(summary);
    const baseline = await loadRollingBaseline(baselinesDir, key);
    const enumerates = await handoffEnumeratesPathsAsync(repoRoot, summary.task_id);
    const findings = classifyProductionFindings(summary, {
      baseline,
      handoffEnumeratesPaths: enumerates,
    });
    allFindings.push(...findings);
    await updateRollingBaseline(baselinesDir, summary);
  }

  const report: SampleAuditReport = {
    schema_version: 1,
    generated_at: now.toISOString(),
    summaries_scanned: summaryPaths.length,
    findings: allFindings,
    findings_by_complexity: groupFindingsByComplexity(allFindings),
  };

  if (options.repair === true) {
    const repair = await runBoundedRepair(repoRoot, allFindings);
    report.repair = repair;
  }

  const reportsDir = resolveProjectPath(repoRoot, TOKEN_ECONOMY_DIR, "reports");
  await mkdir(reportsDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const reportPath = path.join(reportsDir, `${stamp}.json`);
  await writeFile(reportPath, `${stringifyRepoJson(report, repoRoot)}\n`, "utf8");

  await writeWatermark(repoRoot, {
    last_audit_at: now.toISOString(),
    last_report_path: path.relative(repoRoot, reportPath).replace(/\\/gu, "/"),
  });

  return {
    reportPath: path.relative(repoRoot, reportPath).replace(/\\/gu, "/"),
    report,
  };
}
