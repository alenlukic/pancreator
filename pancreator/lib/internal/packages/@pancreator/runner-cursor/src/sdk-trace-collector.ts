import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  abbreviateHashes,
  formatCanonicalJson,
  resolveAbbrevLen,
  stringifyCompactJson,
} from "@pancreator/core";

function stringifyTraceSummary(repoRoot: string, value: unknown): string {
  const len = resolveAbbrevLen(repoRoot);
  const abbreviated = abbreviateHashes(value, len);
  return `${formatCanonicalJson(abbreviated, 0)}\n`;
}

export interface UsageMetrics {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  duration_ms: number;
  turn_count: number;
  tool_read_count: number;
}

export class TurnEndedUsageMissingError extends Error {
  override readonly name = "TurnEndedUsageMissingError";
  readonly event: unknown;

  constructor(event?: unknown) {
    super(
      "[sdk-trace] turn-ended event missing `usage`. Re-run with debug stream to inspect the SDK stream.",
    );
    this.event = event;
  }
}

export class UsageCaptureMissingError extends Error {
  override readonly name = "UsageCaptureMissingError";

  constructor() {
    super(
      "[sdk-trace] no turn-ended usage captured. SDK emits token usage on agent.send({ onDelta }) with type turn-ended.",
    );
  }
}

const READ_TOOL_NAME = /^read$/iu;

function isConcreteReadPath(maybePath: string): boolean {
  if (!maybePath || /[*?{}[\]]/u.test(maybePath)) {
    return false;
  }
  const normalized = maybePath.replace(/\\/gu, "/");
  if (normalized.endsWith("/")) {
    return false;
  }
  const leaf = normalized.split("/").pop() ?? "";
  if (!leaf.includes(".")) {
    return false;
  }
  return true;
}

export function extractReadPathsFromToolEvent(event: unknown): string[] {
  if (!event || typeof event !== "object") {
    return [];
  }
  const e = event as Record<string, unknown>;
  const name = String(e.name ?? "");
  if (!READ_TOOL_NAME.test(name)) {
    return [];
  }
  const paths: string[] = [];
  const args = e.args ?? e.input;
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    if (typeof a.path === "string" && isConcreteReadPath(a.path)) {
      paths.push(a.path);
    }
  }
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args) as { path?: string };
      if (typeof parsed.path === "string" && isConcreteReadPath(parsed.path)) {
        paths.push(parsed.path);
      }
    } catch {
      // ignore non-JSON args
    }
  }
  return paths;
}

export function repoRelativePath(absPath: string, repoRoot?: string): string {
  const root = repoRoot ?? process.cwd();
  const rel = path.relative(root, absPath);
  return rel.replace(/\\/gu, "/");
}

export function createEmptyMetrics(): UsageMetrics {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    total_tokens: 0,
    duration_ms: 0,
    turn_count: 0,
    tool_read_count: 0,
  };
}

export function normalizeUsageFields(usage: Record<string, unknown>): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  const input = Number(usage.input_tokens ?? usage.inputTokens ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0;
  const cacheRead = Number(usage.cache_read_tokens ?? usage.cacheReadTokens ?? 0) || 0;
  const cacheWrite = Number(usage.cache_write_tokens ?? usage.cacheWriteTokens ?? 0) || 0;
  return { input, output, cacheRead, cacheWrite };
}

export function addUsageToMetrics(metrics: UsageMetrics, usage: Record<string, unknown>): void {
  const { input, output, cacheRead, cacheWrite } = normalizeUsageFields(usage);
  metrics.input_tokens += input;
  metrics.output_tokens += output;
  metrics.cache_read_tokens += cacheRead;
  metrics.cache_write_tokens += cacheWrite;
  metrics.total_tokens += input + output + cacheRead + cacheWrite;
}

const TOOL_CALL_DEDUPE_STATE = new WeakMap<string[], { seenReadPaths: Set<string> }>();

function getToolCallState(toolPaths: string[]): { seenReadPaths: Set<string> } {
  let state = TOOL_CALL_DEDUPE_STATE.get(toolPaths);
  if (!state) {
    state = { seenReadPaths: new Set() };
    TOOL_CALL_DEDUPE_STATE.set(toolPaths, state);
  }
  return state;
}

/** Redact likely secret substrings from trace record payloads. */
export function redactTraceRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      out[key] = value
        .replace(/sk-[a-zA-Z0-9]{20,}/gu, "[REDACTED]")
        .replace(/CURSOR_API_KEY[=:]\s*\S+/giu, "CURSOR_API_KEY=[REDACTED]");
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactTraceRecord(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function processStreamEvent(
  event: unknown,
  metrics: UsageMetrics,
  toolPaths: string[],
  options: { debugStream?: boolean } = {},
): void {
  if (!event || typeof event !== "object") {
    return;
  }
  const e = event as Record<string, unknown>;
  const type = String(e.type ?? "");
  const toolCallState = getToolCallState(toolPaths);

  if (type === "turn-ended") {
    metrics.turn_count += 1;
    if (!e.usage || typeof e.usage !== "object") {
      throw new TurnEndedUsageMissingError(event);
    }
    addUsageToMetrics(metrics, e.usage as Record<string, unknown>);
    if (options.debugStream) {
      console.error("[sdk-trace:debug] turn-ended", stringifyCompactJson(e));
    }
    return;
  }

  if (type === "tool_call") {
    const paths = extractReadPathsFromToolEvent(e);
    if (paths.length > 0) {
      for (const toolPath of paths) {
        if (!toolCallState.seenReadPaths.has(toolPath)) {
          toolCallState.seenReadPaths.add(toolPath);
          toolPaths.push(toolPath);
        }
      }
      metrics.tool_read_count = toolCallState.seenReadPaths.size;
    }
  }
}

export async function collectFromStream(
  stream: AsyncIterable<unknown>,
  options: {
    wallStartMs?: number;
    debugStream?: boolean;
    onEvent?: (event: unknown) => void;
  } = {},
): Promise<{ metrics: UsageMetrics; toolPaths: string[] }> {
  const metrics = createEmptyMetrics();
  const toolPaths: string[] = [];
  const start = options.wallStartMs ?? Date.now();
  for await (const event of stream) {
    options.onEvent?.(event);
    processStreamEvent(event, metrics, toolPaths, options);
  }
  metrics.duration_ms = Date.now() - start;
  return { metrics, toolPaths };
}

export async function drainRunStream(
  run: { stream: () => AsyncIterable<unknown>; durationMs?: number; wait: () => Promise<unknown> },
  input: {
    metrics: UsageMetrics;
    toolPaths: string[];
    wallStartMs?: number;
    debugStream?: boolean;
    onEvent?: (event: unknown) => void;
  },
): Promise<void> {
  const start = input.wallStartMs ?? Date.now();
  for await (const event of run.stream()) {
    input.onEvent?.(event);
    processStreamEvent(event, input.metrics, input.toolPaths, input);
  }
  if (typeof run.durationMs === "number" && run.durationMs > 0) {
    input.metrics.duration_ms = run.durationMs;
  } else {
    input.metrics.duration_ms = Date.now() - start;
  }
}

export function assertUsageCaptured(metrics: UsageMetrics): void {
  if (metrics.turn_count === 0) {
    throw new UsageCaptureMissingError();
  }
}

export interface TraceSinkConfig {
  traceDir: string;
  combo: string;
  runIndex: number;
  taskId: string;
  model: string;
}

export interface ProductionTraceSinkConfig {
  traceDir: string;
  stageId: string;
  invocationIndex: number;
  taskId: string;
  model: string;
  repoRoot?: string;
}

export interface TraceSummary {
  schema_version: number;
  task_id: string;
  model: string;
  run_index: number;
  combo: string;
  stage_id?: string;
  persona?: string;
  trace_path: string;
  metrics: UsageMetrics;
  tool_paths: string[];
  turn_count: number;
  trace_records: Array<Record<string, unknown>>;
}

export function createTraceSink(config: TraceSinkConfig) {
  const comboDir = path.join(config.traceDir, config.combo);
  mkdirSync(comboDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const tracePath = path.join(comboDir, `run-${config.runIndex}-${stamp}.ndjson`);
  const summaryPath = path.join(comboDir, `run-${config.runIndex}-${stamp}.summary.json`);
  const records: Array<Record<string, unknown>> = [];

  function writeRecord(record: Record<string, unknown>): void {
    const line = redactTraceRecord({ ts: new Date().toISOString(), ...record });
    records.push(line);
    appendFileSync(tracePath, `${stringifyCompactJson(line)}\n`);
  }

  writeRecord({
    type: "run_start",
    task_id: config.taskId,
    model: config.model,
    run_index: config.runIndex,
    combo: config.combo,
  });

  return {
    tracePath,
    summaryPath,
    onEvent(event: unknown): void {
      if (!event || typeof event !== "object") {
        return;
      }
      const e = event as Record<string, unknown>;
      const type = String(e.type ?? "");
      if (type === "turn-ended" && e.usage && typeof e.usage === "object") {
        const fields = normalizeUsageFields(e.usage as Record<string, unknown>);
        writeRecord({
          type: "turn_ended",
          turn: records.filter((r) => r.type === "turn_ended").length + 1,
          usage: fields,
        });
        return;
      }
      if (type === "tool_call") {
        writeRecord({
          type: "tool_call",
          name: e.name,
          paths: extractReadPathsFromToolEvent(e),
          args: e.args ?? e.input,
        });
      }
    },
    finish(metrics: UsageMetrics, toolPaths: string[]): TraceSummary {
      writeRecord({
        type: "run_end",
        metrics: { ...metrics },
        tool_read_count: metrics.tool_read_count,
      });
      const summary: TraceSummary = {
        schema_version: 1,
        task_id: config.taskId,
        model: config.model,
        run_index: config.runIndex,
        combo: config.combo,
        trace_path: repoRelativePath(tracePath),
        metrics,
        tool_paths: toolPaths,
        turn_count: metrics.turn_count,
        trace_records: records,
      };
      writeFileSync(summaryPath, stringifyTraceSummary(process.cwd(), summary));
      return summary;
    },
  };
}

/** Production layout: `.pan/work/<day>/<task>/sdk-traces/<stage>-<invocation>-<stamp>.*` */
export function createProductionTraceSink(config: ProductionTraceSinkConfig) {
  mkdirSync(config.traceDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const base = `${config.stageId}-${config.invocationIndex}-${stamp}`;
  const tracePath = path.join(config.traceDir, `${base}.ndjson`);
  const summaryPath = path.join(config.traceDir, `${base}.summary.json`);
  const records: Array<Record<string, unknown>> = [];

  function writeRecord(record: Record<string, unknown>): void {
    const line = redactTraceRecord({ ts: new Date().toISOString(), ...record });
    records.push(line);
    appendFileSync(tracePath, `${stringifyCompactJson(line)}\n`);
  }

  writeRecord({
    type: "run_start",
    task_id: config.taskId,
    model: config.model,
    stage_id: config.stageId,
    invocation_index: config.invocationIndex,
  });

  return {
    tracePath,
    summaryPath,
    onEvent(event: unknown): void {
      if (!event || typeof event !== "object") {
        return;
      }
      const e = event as Record<string, unknown>;
      const type = String(e.type ?? "");
      if (type === "turn-ended" && e.usage && typeof e.usage === "object") {
        const fields = normalizeUsageFields(e.usage as Record<string, unknown>);
        writeRecord({
          type: "turn_ended",
          turn: records.filter((r) => r.type === "turn_ended").length + 1,
          usage: fields,
        });
        return;
      }
      if (type === "tool_call") {
        writeRecord({
          type: "tool_call",
          name: e.name,
          paths: extractReadPathsFromToolEvent(e),
          args: e.args ?? e.input,
        });
      }
    },
    finish(metrics: UsageMetrics, toolPaths: string[], persona?: string): TraceSummary {
      writeRecord({
        type: "run_end",
        metrics: { ...metrics },
        tool_read_count: metrics.tool_read_count,
      });
      const summary: TraceSummary = {
        schema_version: 1,
        task_id: config.taskId,
        model: config.model,
        run_index: config.invocationIndex,
        combo: `${config.stageId}.${config.model}`,
        stage_id: config.stageId,
        persona,
        trace_path: repoRelativePath(tracePath, config.repoRoot),
        metrics,
        tool_paths: toolPaths,
        turn_count: metrics.turn_count,
        trace_records: records,
      };
      writeFileSync(
        summaryPath,
        stringifyTraceSummary(config.repoRoot ?? process.cwd(), summary),
      );
      return summary;
    },
  };
}
