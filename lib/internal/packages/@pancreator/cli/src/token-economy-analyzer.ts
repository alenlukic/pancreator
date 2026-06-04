import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyRepoJson } from "@pancreator/core";

export const PRODUCTION_FORBIDDEN_READ_PREFIXES = [
  "docs/PRD.md",
  "docs/BOOTSTRAP.md",
  "archive/work/",
  "lib/inbox/notes/",
] as const;

export const PRODUCTION_FORBIDDEN_READ_EXACT = ["lib/inbox/"] as const;

const DISCOVERY_TOOL_NAMES = new Set(["glob", "Glob", "grep", "Grep", "search", "Search"]);

export type FindingComplexity = "low" | "medium" | "high";

export interface TokenEconomyFinding {
  kind: string;
  complexity: FindingComplexity;
  message: string;
  path?: string;
  persona?: string;
  stage?: string;
  model?: string;
}

export interface TraceSummaryInput {
  task_id: string;
  model?: string;
  stage_id?: string;
  persona?: string;
  tool_paths?: string[];
  turn_count?: number;
  metrics?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  trace_records?: Array<Record<string, unknown>>;
}

export interface BaselineKey {
  persona: string;
  stage: string;
  model: string;
}

export interface RollingBaseline {
  persona: string;
  stage: string;
  model: string;
  sample_count: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  avg_turn_count: number;
  updated_at: string;
}

function normalizeObservedPath(relPath: string): string {
  return relPath.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/^\/+/u, "");
}

function isForbiddenPath(observed: string): string | null {
  const p = normalizeObservedPath(observed);
  for (const prefix of PRODUCTION_FORBIDDEN_READ_PREFIXES) {
    if (p === prefix || p.startsWith(prefix)) {
      return prefix;
    }
  }
  for (const exact of PRODUCTION_FORBIDDEN_READ_EXACT) {
    if (p === exact || p.startsWith(exact)) {
      return exact;
    }
  }
  return null;
}

function rawReadPathsFromTraceRecords(
  records: Array<Record<string, unknown>> | undefined,
): string[] {
  if (!records?.length) {
    return [];
  }
  const paths: string[] = [];
  for (const record of records) {
    if (record.type !== "tool_call") {
      continue;
    }
    const name = String(record.name ?? "");
    if (!/^read$/iu.test(name)) {
      continue;
    }
    const recordPaths = record.paths;
    if (Array.isArray(recordPaths)) {
      for (const p of recordPaths) {
        if (typeof p === "string" && p.trim()) {
          paths.push(normalizeObservedPath(p));
        }
      }
    }
  }
  return paths;
}

function isDiscoveryToolCall(record: Record<string, unknown>): boolean {
  const name = String(record.name ?? "");
  return DISCOVERY_TOOL_NAMES.has(name);
}

export function baselineKeyFromSummary(summary: TraceSummaryInput): BaselineKey {
  return {
    persona: summary.persona ?? "unknown",
    stage: summary.stage_id ?? "unknown",
    model: summary.model ?? "unknown",
  };
}

export function baselineFileName(key: BaselineKey): string {
  const slug = `${key.persona}__${key.stage}__${key.model}`.replace(/[^a-zA-Z0-9._-]+/gu, "_");
  return `${slug}.json`;
}

export async function loadRollingBaseline(
  baselinesDir: string,
  key: BaselineKey,
): Promise<RollingBaseline | null> {
  const abs = path.join(baselinesDir, baselineFileName(key));
  try {
    const raw = await readFile(abs, "utf8");
    return JSON.parse(raw) as RollingBaseline;
  } catch {
    return null;
  }
}

export async function updateRollingBaseline(
  baselinesDir: string,
  summary: TraceSummaryInput,
): Promise<RollingBaseline> {
  const key = baselineKeyFromSummary(summary);
  const existing = await loadRollingBaseline(baselinesDir, key);
  const inputTokens = Number(summary.metrics?.input_tokens ?? 0);
  const outputTokens = Number(summary.metrics?.output_tokens ?? 0);
  const turnCount = Number(summary.turn_count ?? 0);
  const count = (existing?.sample_count ?? 0) + 1;
  const avg = (prev: number, next: number) =>
    existing === null ? next : (prev * (count - 1) + next) / count;
  const baseline: RollingBaseline = {
    persona: key.persona,
    stage: key.stage,
    model: key.model,
    sample_count: count,
    avg_input_tokens: avg(existing?.avg_input_tokens ?? 0, inputTokens),
    avg_output_tokens: avg(existing?.avg_output_tokens ?? 0, outputTokens),
    avg_turn_count: avg(existing?.avg_turn_count ?? 0, turnCount),
    updated_at: new Date().toISOString(),
  };
  const abs = path.join(baselinesDir, baselineFileName(key));
  const repoRoot = path.resolve(baselinesDir, "..", "..", "..");
  await writeFile(abs, `${stringifyRepoJson(baseline, repoRoot)}\n`, "utf8");
  return baseline;
}

export function classifyProductionFindings(
  summary: TraceSummaryInput,
  options: {
    baseline?: RollingBaseline | null;
    handoffEnumeratesPaths?: boolean;
    inflationFactor?: number;
  } = {},
): TokenEconomyFinding[] {
  const findings: TokenEconomyFinding[] = [];
  const toolPaths = (summary.tool_paths ?? []).map(normalizeObservedPath);
  const rawReads = rawReadPathsFromTraceRecords(summary.trace_records);
  const duplicateScan = rawReads.length > 0 ? rawReads : toolPaths;

  for (const observed of toolPaths) {
    const forbidden = isForbiddenPath(observed);
    if (forbidden !== null) {
      findings.push({
        kind: "forbidden_path_read",
        complexity: "high",
        path: observed,
        message: `Read forbidden path: ${observed}`,
        persona: summary.persona,
        stage: summary.stage_id,
        model: summary.model,
      });
    }
  }

  const seen = new Set<string>();
  for (const p of duplicateScan) {
    if (seen.has(p)) {
      findings.push({
        kind: "duplicate_read",
        complexity: "medium",
        path: p,
        message: `Duplicate read: ${p}`,
        persona: summary.persona,
        stage: summary.stage_id,
        model: summary.model,
      });
    }
    seen.add(p);
  }

  if (options.handoffEnumeratesPaths === true) {
    for (const record of summary.trace_records ?? []) {
      if (record.type === "tool_call" && isDiscoveryToolCall(record)) {
        findings.push({
          kind: "discovery_when_handoff_lists_paths",
          complexity: "low",
          message: "Discovery tool used when handoff or next-prompt already enumerates in-scope paths",
          persona: summary.persona,
          stage: summary.stage_id,
          model: summary.model,
        });
        break;
      }
    }
  }

  const baseline = options.baseline;
  const factor = options.inflationFactor ?? 1.5;
  if (baseline !== undefined && baseline !== null && baseline.sample_count >= 2) {
    const inputTokens = Number(summary.metrics?.input_tokens ?? 0);
    const outputTokens = Number(summary.metrics?.output_tokens ?? 0);
    const turnCount = Number(summary.turn_count ?? 0);
    if (inputTokens > baseline.avg_input_tokens * factor) {
      findings.push({
        kind: "token_inflation_input",
        complexity: "medium",
        message: `Input tokens ${inputTokens} exceed baseline ${baseline.avg_input_tokens.toFixed(0)} by factor ${factor}`,
        persona: summary.persona,
        stage: summary.stage_id,
        model: summary.model,
      });
    }
    if (turnCount > baseline.avg_turn_count * factor) {
      findings.push({
        kind: "turn_inflation",
        complexity: "medium",
        message: `Turn count ${turnCount} exceeds baseline ${baseline.avg_turn_count.toFixed(1)} by factor ${factor}`,
        persona: summary.persona,
        stage: summary.stage_id,
        model: summary.model,
      });
    }
    if (outputTokens > baseline.avg_output_tokens * factor) {
      findings.push({
        kind: "token_inflation_output",
        complexity: "low",
        message: `Output tokens ${outputTokens} exceed baseline ${baseline.avg_output_tokens.toFixed(0)} by factor ${factor}`,
        persona: summary.persona,
        stage: summary.stage_id,
        model: summary.model,
      });
    }
  }

  return findings;
}

export function groupFindingsByComplexity(
  findings: TokenEconomyFinding[],
): Record<FindingComplexity, TokenEconomyFinding[]> {
  const groups: Record<FindingComplexity, TokenEconomyFinding[]> = {
    low: [],
    medium: [],
    high: [],
  };
  for (const finding of findings) {
    groups[finding.complexity].push(finding);
  }
  return groups;
}

const HIGH_SCOPE_KINDS = new Set([
  "forbidden_path_read",
  "handbook_scope",
  "pipeline_semantics",
  "ci_gating",
]);

export function repairComplexityForFinding(finding: TokenEconomyFinding): FindingComplexity {
  if (HIGH_SCOPE_KINDS.has(finding.kind)) {
    return "high";
  }
  return finding.complexity;
}

export function shouldDeferFindingToInbox(finding: TokenEconomyFinding): boolean {
  return repairComplexityForFinding(finding) === "high";
}
