/**
 * @typedef {{
 *   n: number;
 *   min: number;
 *   max: number;
 *   mean: number;
 *   median: number;
 *   mad: number;
 *   iqr: number;
 *   p75: number;
 *   p90: number;
 *   p95: number;
 *   quantile_target: number;
 *   upper_confidence_bound: number;
 *   confidence: number;
 * }} MetricSummary
 */

/**
 * @param {number} value
 */
function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * @param {number[]} values
 */
function sortAsc(values) {
  return [...values].sort((a, b) => a - b);
}

/**
 * @param {number[]} sorted
 * @param {number} q
 */
export function quantileFromSorted(sorted, q) {
  if (sorted.length === 0) {
    return 0;
  }
  if (q <= 0) {
    return sorted[0];
  }
  if (q >= 1) {
    return sorted[sorted.length - 1];
  }
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) {
    return sorted[lower];
  }
  const frac = pos - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * frac;
}

/**
 * @param {number[]} values
 * @param {number} q
 */
export function quantile(values, q) {
  return quantileFromSorted(sortAsc(values), q);
}

/**
 * @param {number[]} values
 */
export function median(values) {
  return quantile(values, 0.5);
}

/**
 * @param {number[]} values
 */
export function mean(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Median absolute deviation.
 * @param {number[]} values
 */
export function mad(values) {
  if (values.length === 0) {
    return 0;
  }
  const m = median(values);
  const deviations = values.map((value) => Math.abs(value - m));
  return median(deviations);
}

/**
 * Interquartile range.
 * @param {number[]} values
 */
export function iqr(values) {
  if (values.length === 0) {
    return 0;
  }
  return quantile(values, 0.75) - quantile(values, 0.25);
}

/**
 * @param {number} n
 * @param {number} p
 * @param {number} kMin
 */
export function binomialTailProbability(n, p, kMin) {
  if (kMin <= 0) {
    return 1;
  }
  if (kMin > n) {
    return 0;
  }
  if (p <= 0) {
    return 0;
  }
  if (p >= 1) {
    return 1;
  }
  const q = 1 - p;
  let pmf = q ** n;
  let tail = 0;
  for (let k = 0; k <= n; k += 1) {
    if (k >= kMin) {
      tail += pmf;
    }
    if (k === n) {
      break;
    }
    const ratio = ((n - k) / (k + 1)) * (p / q);
    pmf *= ratio;
  }
  return Math.max(0, Math.min(1, tail));
}

/**
 * Non-parametric one-sided upper confidence bound for the q-quantile.
 * Conservative by design.
 *
 * @param {number[]} values
 * @param {{ quantile?: number; confidence?: number }} [options]
 */
export function nonparametricQuantileUpperBound(values, options = {}) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = sortAsc(values);
  const q = asFiniteNumber(options.quantile) ?? 0.9;
  const confidence = asFiniteNumber(options.confidence) ?? 0.8;
  const alpha = 1 - confidence;
  const n = sorted.length;
  for (let order = 1; order <= n; order += 1) {
    const tail = binomialTailProbability(n, q, order);
    if (tail <= alpha) {
      return sorted[order - 1];
    }
  }
  return sorted[n - 1];
}

/**
 * @param {number[]} values
 * @param {{ quantile?: number; confidence?: number }} [options]
 * @returns {MetricSummary}
 */
export function summarizeMetric(values, options = {}) {
  const finite = values.map(asFiniteNumber).filter((value) => value !== undefined);
  if (finite.length === 0) {
    return {
      n: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      mad: 0,
      iqr: 0,
      p75: 0,
      p90: 0,
      p95: 0,
      quantile_target: asFiniteNumber(options.quantile) ?? 0.9,
      upper_confidence_bound: 0,
      confidence: asFiniteNumber(options.confidence) ?? 0.8,
    };
  }
  const sorted = sortAsc(finite);
  const q = asFiniteNumber(options.quantile) ?? 0.9;
  const confidence = asFiniteNumber(options.confidence) ?? 0.8;
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: mean(sorted),
    median: quantileFromSorted(sorted, 0.5),
    mad: mad(sorted),
    iqr: quantileFromSorted(sorted, 0.75) - quantileFromSorted(sorted, 0.25),
    p75: quantileFromSorted(sorted, 0.75),
    p90: quantileFromSorted(sorted, 0.9),
    p95: quantileFromSorted(sorted, 0.95),
    quantile_target: q,
    upper_confidence_bound: nonparametricQuantileUpperBound(sorted, { quantile: q, confidence }),
    confidence,
  };
}

/**
 * @param {Array<{ run_index?: number; metrics?: Record<string, number>; tool_read_count?: number }>} samples
 * @param {{ metricKeys?: string[]; quantile?: number; confidence?: number }} [options]
 */
export function summarizeConditionSamples(samples, options = {}) {
  const metricKeys = options.metricKeys ?? [
    "input_tokens",
    "cache_read_tokens",
    "total_tokens",
    "output_tokens",
  ];
  /** @type {Record<string, MetricSummary>} */
  const metrics = {};
  for (const key of metricKeys) {
    metrics[key] = summarizeMetric(
      samples.map((sample) => sample.metrics?.[key]),
      options,
    );
  }
  metrics.tool_read_count = summarizeMetric(
    samples.map((sample) => sample.tool_read_count),
    options,
  );
  return {
    sample_count: samples.length,
    metrics,
  };
}

/**
 * @param {Array<{ run_index?: number; metrics?: Record<string, number> }>} repoSamples
 * @param {Array<{ run_index?: number; metrics?: Record<string, number> }>} emptySamples
 * @param {string[]} metricKeys
 * @param {{ quantile?: number; confidence?: number }} [options]
 */
export function summarizeDifferential(repoSamples, emptySamples, metricKeys, options = {}) {
  const sortedRepo = [...repoSamples].sort((a, b) => Number(a.run_index ?? 0) - Number(b.run_index ?? 0));
  const sortedEmpty = [...emptySamples].sort(
    (a, b) => Number(a.run_index ?? 0) - Number(b.run_index ?? 0),
  );
  const pairCount = Math.min(sortedRepo.length, sortedEmpty.length);
  /** @type {Record<string, number[]>} */
  const deltas = {};
  /** @type {Record<string, number[]>} */
  const absDeltas = {};
  for (const key of metricKeys) {
    deltas[key] = [];
    absDeltas[key] = [];
  }
  for (let i = 0; i < pairCount; i += 1) {
    for (const key of metricKeys) {
      const repoValue = asFiniteNumber(sortedRepo[i]?.metrics?.[key]);
      const emptyValue = asFiniteNumber(sortedEmpty[i]?.metrics?.[key]);
      if (repoValue === undefined || emptyValue === undefined) {
        continue;
      }
      const delta = repoValue - emptyValue;
      deltas[key].push(delta);
      absDeltas[key].push(Math.abs(delta));
    }
  }
  /** @type {Record<string, { delta: MetricSummary; abs_delta: MetricSummary }>} */
  const metrics = {};
  for (const key of metricKeys) {
    metrics[key] = {
      delta: summarizeMetric(deltas[key], options),
      abs_delta: summarizeMetric(absDeltas[key], options),
    };
  }
  return {
    pair_count: pairCount,
    metrics,
  };
}

/**
 * @param {{
 *   model: string;
 *   samples: {
 *     repo_root: Array<{ run_index?: number; metrics?: Record<string, number>; tool_read_count?: number }>;
 *     empty_dir: Array<{ run_index?: number; metrics?: Record<string, number>; tool_read_count?: number }>;
 *   };
 * }} modelEntry
 * @param {{
 *   envelopeMetrics?: string[];
 *   quantile?: number;
 *   confidence?: number;
 * }} [options]
 */
export function summarizeModelCalibration(modelEntry, options = {}) {
  const envelopeMetrics = options.envelopeMetrics ?? [
    "input_tokens",
    "cache_read_tokens",
    "total_tokens",
    "output_tokens",
  ];
  const conditionSummary = {
    repo_root: summarizeConditionSamples(modelEntry.samples.repo_root ?? [], {
      metricKeys: envelopeMetrics,
      quantile: options.quantile,
      confidence: options.confidence,
    }),
    empty_dir: summarizeConditionSamples(modelEntry.samples.empty_dir ?? [], {
      metricKeys: envelopeMetrics,
      quantile: options.quantile,
      confidence: options.confidence,
    }),
  };
  const differential = summarizeDifferential(
    modelEntry.samples.repo_root ?? [],
    modelEntry.samples.empty_dir ?? [],
    envelopeMetrics,
    options,
  );

  /** @type {Record<string, number>} */
  const maxima = {};
  /** @type {Record<string, number>} */
  const noiseFloor = {};
  for (const key of envelopeMetrics) {
    maxima[key] = conditionSummary.repo_root.metrics[key].upper_confidence_bound;
    noiseFloor[key] = differential.metrics[key].abs_delta.p90;
  }

  return {
    model: modelEntry.model,
    sample_counts: {
      repo_root: conditionSummary.repo_root.sample_count,
      empty_dir: conditionSummary.empty_dir.sample_count,
    },
    conditions: conditionSummary,
    differential,
    envelope: {
      quantile_target: asFiniteNumber(options.quantile) ?? 0.9,
      confidence: asFiniteNumber(options.confidence) ?? 0.8,
      maxima,
      noise_floor: noiseFloor,
    },
  };
}
