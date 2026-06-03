const STEP_METRIC_KEYS = ["input_tokens", "cache_read_tokens", "total_tokens", "output_tokens"];
const CUMULATIVE_METRIC_KEYS = ["input_tokens", "cache_read_tokens", "total_tokens", "output_tokens"];

/**
 * @param {{ traces?: Record<string, { budgets?: Record<string, { max?: number }>; trace_id?: string; stage_id?: string }> }} traceBaseline
 * @param {{ maxima?: Record<string, number>; tolerance?: Record<string, number>; noise_floor?: Record<string, number> }} liveEnvelope
 * @param {{ traceOrder: string[]; model: string; sourceTraceBaseline: string; sourceModelBaseline: string }} input
 */
export function buildSessionBaseline(traceBaseline, liveEnvelope, input) {
  if (!traceBaseline?.traces || typeof traceBaseline.traces !== "object") {
    throw new Error("[context-usage] invalid fd-trace baseline for session baseline build");
  }
  if (!liveEnvelope?.maxima || typeof liveEnvelope.maxima !== "object") {
    throw new Error("[context-usage] missing live envelope maxima for session baseline build");
  }

  /** @type {Record<string, unknown>} */
  const perStep = {};
  const cumulative = {
    input_tokens_max: 0,
    cache_read_tokens_max: 0,
    total_tokens_max: 0,
    output_tokens_max: 0,
  };
  for (const traceId of input.traceOrder) {
    const trace = traceBaseline.traces[traceId];
    if (!trace?.budgets) {
      throw new Error(`[context-usage] trace baseline missing budgets for ${traceId}`);
    }
    const inputMax = Math.min(
      Number(trace.budgets.input_tokens?.max ?? 0),
      Number(liveEnvelope.maxima.input_tokens ?? Number.POSITIVE_INFINITY),
    );
    const cacheReadMax = Math.min(
      Number(trace.budgets.cache_read_tokens?.max ?? 0),
      Number(liveEnvelope.maxima.cache_read_tokens ?? Number.POSITIVE_INFINITY),
    );
    const totalMax = Math.min(
      Number(trace.budgets.total_tokens?.max ?? 0),
      Number(liveEnvelope.maxima.total_tokens ?? Number.POSITIVE_INFINITY),
    );
    const outputMax = Math.min(
      Number(trace.budgets.output_tokens?.max ?? 0),
      Number(liveEnvelope.maxima.output_tokens ?? Number.POSITIVE_INFINITY),
    );
    const step = {
      trace_id: traceId,
      stage_id: String(trace.stage_id ?? ""),
      input_tokens_max: Number.isFinite(inputMax) ? inputMax : Number(trace.budgets.input_tokens?.max ?? 0),
      cache_read_tokens_max: Number.isFinite(cacheReadMax)
        ? cacheReadMax
        : Number(trace.budgets.cache_read_tokens?.max ?? 0),
      total_tokens_max: Number.isFinite(totalMax) ? totalMax : Number(trace.budgets.total_tokens?.max ?? 0),
      output_tokens_max: Number.isFinite(outputMax) ? outputMax : Number(trace.budgets.output_tokens?.max ?? 0),
      turn_count_max: Number(trace.budgets.turn_count?.max ?? 0),
      duration_ms_max: Number(trace.budgets.duration_ms?.max ?? 0),
      tool_read_count: {
        min: Number(trace.budgets.tool_read_count?.min ?? 0),
        max: Number(trace.budgets.tool_read_count?.max ?? 0),
      },
    };
    perStep[traceId] = step;
    cumulative.input_tokens_max += step.input_tokens_max;
    cumulative.cache_read_tokens_max += step.cache_read_tokens_max;
    cumulative.total_tokens_max += step.total_tokens_max;
    cumulative.output_tokens_max += step.output_tokens_max;
  }

  const cacheGrowthMax = Math.max(
    Number(liveEnvelope.tolerance?.cache_read_tokens ?? 0),
    Number(liveEnvelope.noise_floor?.cache_read_tokens ?? 0),
    1,
  );

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    model: input.model,
    source_trace_baseline: input.sourceTraceBaseline,
    source_model_baseline: input.sourceModelBaseline,
    trace_sequence: input.traceOrder,
    per_step: perStep,
    cumulative,
    cache_growth: {
      max_step_delta: cacheGrowthMax,
      basis: {
        live_tolerance: Number(liveEnvelope.tolerance?.cache_read_tokens ?? 0),
        noise_floor: Number(liveEnvelope.noise_floor?.cache_read_tokens ?? 0),
      },
    },
  };
}

/**
 * @param {{ trace_id: string; metrics: Record<string, number> }[]} observedSteps
 * @param {{
 *   trace_sequence: string[];
 *   per_step: Record<string, Record<string, unknown>>;
 *   cumulative: Record<string, number>;
 *   cache_growth?: { max_step_delta?: number };
 * }} baseline
 */
export function compareSessionToBaseline(observedSteps, baseline) {
  /** @type {string[]} */
  const errors = [];
  const expectedOrder = baseline.trace_sequence ?? [];
  if (observedSteps.length !== expectedOrder.length) {
    errors.push(
      `session step count=${observedSteps.length} does not match baseline trace_sequence=${expectedOrder.length}`,
    );
    return { ok: false, errors };
  }

  /** @type {Record<string, number>} */
  const cumulativeObserved = {
    input_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
    output_tokens: 0,
  };
  /** @type {number[]} */
  const cacheReadDeltas = [];

  for (let i = 0; i < observedSteps.length; i += 1) {
    const step = observedSteps[i];
    const expectedTraceId = expectedOrder[i];
    if (step.trace_id !== expectedTraceId) {
      errors.push(`session step[${i}] trace_id=${step.trace_id} expected=${expectedTraceId}`);
      continue;
    }
    const perStep = baseline.per_step?.[step.trace_id];
    if (!perStep) {
      errors.push(`baseline per_step missing trace_id=${step.trace_id}`);
      continue;
    }
    for (const key of STEP_METRIC_KEYS) {
      const metric = Number(step.metrics?.[key]);
      const max = Number(perStep[`${key}_max`]);
      if (!Number.isFinite(max)) {
        errors.push(`baseline step ${step.trace_id} missing max for ${key}`);
        continue;
      }
      if (metric > max) {
        errors.push(`${step.trace_id} ${key}=${metric} exceeds max=${max}`);
      }
    }

    const turnCount = Number(step.metrics?.turn_count);
    const turnMax = Number(perStep.turn_count_max);
    if (Number.isFinite(turnMax) && turnCount > turnMax) {
      errors.push(`${step.trace_id} turn_count=${turnCount} exceeds max=${turnMax}`);
    }
    const durationMs = Number(step.metrics?.duration_ms);
    const durationMax = Number(perStep.duration_ms_max);
    if (Number.isFinite(durationMax) && durationMs > durationMax) {
      errors.push(`${step.trace_id} duration_ms=${durationMs} exceeds max=${durationMax}`);
    }
    const reads = Number(step.metrics?.tool_read_count);
    const minReads = Number(perStep.tool_read_count?.min);
    const maxReads = Number(perStep.tool_read_count?.max);
    if (Number.isFinite(minReads) && Number.isFinite(maxReads) && (reads < minReads || reads > maxReads)) {
      errors.push(`${step.trace_id} tool_read_count=${reads} outside range ${minReads}-${maxReads}`);
    }

    for (const key of CUMULATIVE_METRIC_KEYS) {
      cumulativeObserved[key] += Number(step.metrics?.[key] ?? 0);
    }
    if (i > 0) {
      const prev = Number(observedSteps[i - 1].metrics?.cache_read_tokens ?? 0);
      const current = Number(step.metrics?.cache_read_tokens ?? 0);
      cacheReadDeltas.push(Math.abs(current - prev));
    }
  }

  for (const key of CUMULATIVE_METRIC_KEYS) {
    const max = Number(baseline.cumulative?.[`${key}_max`]);
    if (!Number.isFinite(max)) {
      errors.push(`baseline cumulative missing max for ${key}`);
      continue;
    }
    const observed = Number(cumulativeObserved[key]);
    if (observed > max) {
      errors.push(`session cumulative ${key}=${observed} exceeds max=${max}`);
    }
  }

  const cacheDeltaMax = Number(baseline.cache_growth?.max_step_delta ?? Number.POSITIVE_INFINITY);
  for (const delta of cacheReadDeltas) {
    if (delta > cacheDeltaMax) {
      errors.push(`session cache_read_tokens delta=${delta} exceeds max_step_delta=${cacheDeltaMax}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    observed: {
      cumulative: cumulativeObserved,
      cache_read_deltas: cacheReadDeltas,
    },
  };
}
