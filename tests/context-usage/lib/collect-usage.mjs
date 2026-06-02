import { READ_TOOL_NAMES } from "./expected.mjs";

/** @typedef {{
 *   input_tokens: number;
 *   output_tokens: number;
 *   cache_read_tokens: number;
 *   cache_write_tokens: number;
 *   total_tokens: number;
 *   duration_ms: number;
 *   turn_count: number;
 *   tool_read_count: number;
 * }} UsageMetrics */

export class TurnEndedUsageMissingError extends Error {
  /**
   * @param {unknown} [event]
   */
  constructor(event) {
    super(
      "[context-usage] turn-ended event missing `usage`. Re-run with --debug-stream to inspect the SDK stream.",
    );
    this.name = "TurnEndedUsageMissingError";
    this.event = event;
  }
}

/**
 * @returns {UsageMetrics}
 */
export function createEmptyMetrics() {
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

/**
 * @param {Record<string, unknown>} usage
 */
export function normalizeUsageFields(usage) {
  const input =
    Number(usage.input_tokens ?? usage.inputTokens ?? 0) || 0;
  const output =
    Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0;
  const cacheRead =
    Number(usage.cache_read_tokens ?? usage.cacheReadTokens ?? 0) || 0;
  const cacheWrite =
    Number(usage.cache_write_tokens ?? usage.cacheWriteTokens ?? 0) || 0;
  return { input, output, cacheRead, cacheWrite };
}

/**
 * @param {UsageMetrics} metrics
 * @param {Record<string, unknown>} usage
 */
export function addUsageToMetrics(metrics, usage) {
  const { input, output, cacheRead, cacheWrite } = normalizeUsageFields(usage);
  metrics.input_tokens += input;
  metrics.output_tokens += output;
  metrics.cache_read_tokens += cacheRead;
  metrics.cache_write_tokens += cacheWrite;
  metrics.total_tokens += input + output + cacheRead + cacheWrite;
}

/**
 * Extract read/grep paths from SDK tool_call events (defensive parsing).
 * @param {unknown} event
 * @returns {string[]}
 */
export function extractReadPathsFromToolEvent(event) {
  if (!event || typeof event !== "object") {
    return [];
  }
  const e = /** @type {Record<string, unknown>} */ (event);
  const name = String(e.name ?? "");
  if (!READ_TOOL_NAMES.has(name)) {
    return [];
  }
  const paths = [];
  const args = e.args ?? e.input;
  if (args && typeof args === "object") {
    const a = /** @type {Record<string, unknown>} */ (args);
    if (typeof a.path === "string") {
      paths.push(a.path);
    }
    if (typeof a.target_directory === "string") {
      paths.push(a.target_directory);
    }
    if (typeof a.targetDirectory === "string") {
      paths.push(a.targetDirectory);
    }
    if (typeof a.glob_pattern === "string") {
      paths.push(a.glob_pattern);
    }
    if (typeof a.glob === "string") {
      paths.push(a.glob);
      if (/handbook/i.test(a.glob)) {
        paths.push("lib/memory/handbook/");
      }
    }
    if (typeof a.pattern === "string" && typeof a.path === "string") {
      paths.push(a.path);
    }
  }
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed?.path) {
        paths.push(String(parsed.path));
      }
    } catch {
      // ignore non-JSON args
    }
  }
  return paths;
}

/**
 * @param {unknown} event
 * @param {UsageMetrics} metrics
 * @param {string[]} toolPaths
 * @param {{ debugStream?: boolean }} [options]
 */
export function processStreamEvent(event, metrics, toolPaths, options = {}) {
  if (!event || typeof event !== "object") {
    return;
  }
  const e = /** @type {Record<string, unknown>} */ (event);
  const type = String(e.type ?? "");

  if (type === "turn-ended") {
    metrics.turn_count += 1;
    if (!e.usage || typeof e.usage !== "object") {
      throw new TurnEndedUsageMissingError(event);
    }
    addUsageToMetrics(metrics, /** @type {Record<string, unknown>} */ (e.usage));
    if (options.debugStream) {
      console.error("[context-usage:debug] turn-ended", JSON.stringify(e));
    }
    return;
  }

  if (type === "tool_call") {
    const paths = extractReadPathsFromToolEvent(e);
    if (paths.length > 0) {
      metrics.tool_read_count += 1;
      toolPaths.push(...paths);
    }
    return;
  }

  if (e.usage && typeof e.usage === "object") {
    addUsageToMetrics(metrics, /** @type {Record<string, unknown>} */ (e.usage));
  }
}

/**
 * @param {AsyncIterable<unknown>} stream
 * @param {{ wallStartMs?: number; debugStream?: boolean }} [options]
 * @returns {Promise<{ metrics: UsageMetrics; toolPaths: string[] }>}
 */
export async function collectFromStream(stream, options = {}) {
  const metrics = createEmptyMetrics();
  const toolPaths = [];
  const start = options.wallStartMs ?? Date.now();
  for await (const event of stream) {
    processStreamEvent(event, metrics, toolPaths, options);
  }
  metrics.duration_ms = Date.now() - start;
  return { metrics, toolPaths };
}

/**
 * Drain `run.stream()` into metrics/toolPaths. Token usage is NOT on this stream;
 * pass `onDelta` to `agent.send()` and feed updates through `processStreamEvent`.
 * @param {import("@cursor/sdk").Run} run
 * @param {{
 *   metrics: UsageMetrics;
 *   toolPaths: string[];
 *   wallStartMs?: number;
 *   debugStream?: boolean;
 * }} input
 */
export async function drainRunStream(run, input) {
  const start = input.wallStartMs ?? Date.now();
  for await (const event of run.stream()) {
    processStreamEvent(event, input.metrics, input.toolPaths, input);
  }
  if (typeof run.durationMs === "number" && run.durationMs > 0) {
    input.metrics.duration_ms = run.durationMs;
  } else {
    input.metrics.duration_ms = Date.now() - start;
  }
}

export class UsageCaptureMissingError extends Error {
  constructor() {
    super(
      "[context-usage] no turn-ended usage captured. @cursor/sdk emits token usage on agent.send({ onDelta }) with type turn-ended, not on run.stream(). Re-run with --debug-stream.",
    );
    this.name = "UsageCaptureMissingError";
  }
}

/**
 * @param {UsageMetrics} metrics
 */
export function assertUsageCaptured(metrics) {
  if (metrics.turn_count === 0) {
    throw new UsageCaptureMissingError();
  }
}

/**
 * @deprecated Prefer agent.send onDelta + drainRunStream; run.stream() lacks turn-ended usage.
 * @param {import("@cursor/sdk").Run} run
 * @param {{ debugStream?: boolean }} [options]
 */
export async function collectFromRun(run, options = {}) {
  const metrics = createEmptyMetrics();
  const toolPaths = [];
  const start = Date.now();
  await drainRunStream(run, { metrics, toolPaths, wallStartMs: start, ...options });
  return { metrics, toolPaths };
}
