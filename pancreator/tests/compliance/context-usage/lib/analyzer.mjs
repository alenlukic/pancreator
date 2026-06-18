import fs from "node:fs";
import path from "node:path";

import {
  findForbiddenPaths,
  findMissingRequiredReads,
  normalizePath,
  stripTempSandboxPrefix,
} from "./paths.mjs";
import { stringifyRepoJson } from "../../../../lib/internal/tools/format/canonical-json-format.mjs";
import { getTaskSpec } from "./tasks.mjs";

const DISCOVERY_TOOL_NAMES = new Set(["glob", "Glob", "grep", "Grep", "search", "Search"]);

/**
 * @param {string} relPath
 */
function normalizeObservedPath(relPath) {
  return stripTempSandboxPrefix(normalizePath(relPath));
}

/**
 * @param {unknown} record
 */
function isDiscoveryToolCall(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  const name = String(/** @type {Record<string, unknown>} */ (record).name ?? "");
  return DISCOVERY_TOOL_NAMES.has(name);
}

/**
 * @param {{
 *   taskId: string;
 *   summary: {
 *     tool_paths?: string[];
 *     turn_count?: number;
 *     trace_records?: Array<Record<string, unknown>>;
 *   };
 * }} input
 */
export function classifyPolicyViolations(input) {
  const spec = getTaskSpec(input.taskId);
  const toolPaths = (input.summary.tool_paths ?? []).map(normalizeObservedPath);
  /** @type {Array<Record<string, unknown>>} */
  const violations = [];

  for (const forbidden of findForbiddenPaths(toolPaths, spec.forbiddenPathPatterns)) {
    violations.push({
      kind: "forbidden_path_read",
      path: forbidden,
      message: `Read forbidden path: ${forbidden}`,
    });
  }

  if (toolPaths.some((p) => /^lib\/inbox\/notes\//i.test(p))) {
    violations.push({
      kind: "inbox_notes_read",
      path: toolPaths.find((p) => /^lib\/inbox\/notes\//i.test(p)),
      message: "Read under lib/inbox/notes/ is prohibited",
    });
  }

  const allowlistSet = new Set(spec.readAllowlist.map(normalizePath));
  for (const observed of toolPaths) {
    const allowed = [...allowlistSet].some(
      (allowedPath) => observed === allowedPath || observed.endsWith(`/${allowedPath}`),
    );
    if (!allowed && !spec.decoyPaths.map(normalizePath).includes(observed)) {
      violations.push({
        kind: "allowlist_breach",
        path: observed,
        message: `Read outside allowlist: ${observed}`,
      });
    }
  }

  const missing = findMissingRequiredReads(toolPaths, spec.requiredReadPaths);
  for (const index of missing) {
    violations.push({
      kind: "missing_required_read",
      path: spec.requiredReadPaths[index],
      message: `Missing required read: ${spec.requiredReadPaths[index]}`,
    });
  }

  const records = input.summary.trace_records ?? [];
  if (spec.readAllowlist.length > 0) {
    for (const record of records) {
      if (record.type === "tool_call" && isDiscoveryToolCall(record)) {
        violations.push({
          kind: "discovery_under_allowlist",
          tool: record.name,
          message: "Discovery tool used while explicit read allowlist exists",
        });
        break;
      }
    }
  }

  return violations;
}

/**
 * Raw read paths in event order from trace records (not de-duplicated).
 * @param {Array<Record<string, unknown>> | undefined} records
 * @returns {string[]}
 */
function rawReadPathsFromTraceRecords(records) {
  if (!records?.length) {
    return [];
  }
  /** @type {string[]} */
  const paths = [];
  for (const record of records) {
    if (record.type !== "tool_call") {
      continue;
    }
    const name = String(record.name ?? "");
    if (!/^read$/iu.test(name)) {
      continue;
    }
    const recordPaths = /** @type {unknown} */ (record.paths);
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

/**
 * @param {{
 *   taskId: string;
 *   summary: {
 *     tool_paths?: string[];
 *     turn_count?: number;
 *     trace_records?: Array<Record<string, unknown>>;
 *   };
 * }} input
 */
export function classifyInefficiencies(input) {
  const spec = getTaskSpec(input.taskId);
  const toolPaths = (input.summary.tool_paths ?? []).map(normalizeObservedPath);
  const rawReadPaths = rawReadPathsFromTraceRecords(input.summary.trace_records);
  const duplicateScanPaths =
    rawReadPaths.length > 0 ? rawReadPaths : toolPaths;
  /** @type {Array<Record<string, unknown>>} */
  const inefficiencies = [];

  const seen = new Set();
  for (const p of duplicateScanPaths) {
    if (seen.has(p)) {
      inefficiencies.push({
        kind: "duplicate_read",
        path: p,
        message: `Duplicate read: ${p}`,
      });
    }
    seen.add(p);
  }

  for (const decoy of spec.decoyPaths.map(normalizePath)) {
    if (toolPaths.includes(decoy)) {
      inefficiencies.push({
        kind: "decoy_read",
        path: decoy,
        message: `Decoy file read: ${decoy}`,
      });
    }
  }

  const turnCount = Number(input.summary.turn_count ?? 0);
  if (turnCount > spec.maxTurns) {
    inefficiencies.push({
      kind: "excess_turns",
      turn_count: turnCount,
      max_turns: spec.maxTurns,
      message: `Turn count ${turnCount} exceeds max ${spec.maxTurns}`,
    });
  }

  return inefficiencies;
}

/**
 * When multiple trace summaries exist per run index (e.g. after re-calibration),
 * keep the lexicographically latest filename so analyze uses the newest run only.
 * @param {{ name: string; summary: Record<string, unknown> }[]} entries
 */
export function selectLatestSummariesByRunIndex(entries) {
  /** @type {Map<number, { name: string; summary: Record<string, unknown> }>} */
  const byRun = new Map();
  for (const entry of entries) {
    const runIndex = Number(entry.summary.run_index ?? 0);
    const prev = byRun.get(runIndex);
    if (!prev || entry.name > prev.name) {
      byRun.set(runIndex, entry);
    }
  }
  return [...byRun.values()]
    .sort((a, b) => Number(a.summary.run_index) - Number(b.summary.run_index))
    .map((entry) => entry.summary);
}

/**
 * @param {Record<string, unknown>} summary
 */
export function analyzeTraceSummary(summary) {
  const taskId = String(summary.task_id ?? "");
  const input = {
    taskId,
    summary: {
      tool_paths: /** @type {string[] | undefined} */ (summary.tool_paths),
      turn_count: Number(summary.turn_count ?? 0),
      trace_records: /** @type {Array<Record<string, unknown>> | undefined} */ (
        summary.trace_records
      ),
    },
  };
  return {
    task_id: taskId,
    model: String(summary.model ?? ""),
    run_index: Number(summary.run_index ?? 0),
    policy_violations: classifyPolicyViolations(input),
    inefficiencies: classifyInefficiencies(input),
  };
}

/**
 * @param {string} findingsDir
 * @param {string} combo
 * @param {ReturnType<typeof analyzeTraceSummary>[]} findings
 */
export function writeFindings(findingsDir, combo, findings) {
  fs.mkdirSync(findingsDir, { recursive: true });
  const outPath = path.join(findingsDir, `${combo}.json`);
  const payload = {
    schema_version: 1,
    combo,
    generated_at: new Date().toISOString(),
    runs: findings,
    policy_violation_count: findings.reduce((n, f) => n + f.policy_violations.length, 0),
    inefficiency_count: findings.reduce((n, f) => n + f.inefficiencies.length, 0),
  };
  fs.writeFileSync(outPath, stringifyRepoJson(payload));
  return outPath;
}
