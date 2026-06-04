import { summarizeMetric } from "./calibration-stats.mjs";

/**
 * @param {number[]} observedTotals
 * @param {number} overheadMedian
 */
export function computeVariableSamples(observedTotals, overheadMedian) {
  return observedTotals.map((total) => Math.max(0, total - overheadMedian));
}

/**
 * @param {{
 *   taskId: string;
 *   model: string;
 *   overheadBaseline: { model: string; total_tokens: import("./calibration-stats.mjs").MetricSummary };
 *   variableTotals: number[];
 *   quantile?: number;
 *   confidence?: number;
 * }} input
 */
export function buildExpectedBaseline(input) {
  const variable = summarizeMetric(input.variableTotals, {
    quantile: input.quantile ?? 0.9,
    confidence: input.confidence ?? 0.8,
  });
  const overhead = input.overheadBaseline.total_tokens;
  const upperBound = expectedUpperBound(overhead, variable);
  return {
    schema_version: 1,
    task_id: input.taskId,
    model: input.model,
    formula: "overhead.upper_confidence_bound + variable.upper_confidence_bound",
    overhead_median: overhead.median,
    overhead,
    variable,
    expected_total_tokens: {
      upper_confidence_bound: upperBound,
      quantile_target: variable.quantile_target,
      confidence: variable.confidence,
    },
    sample_count: input.variableTotals.length,
    generated_at: new Date().toISOString(),
  };
}

/**
 * @param {{ upper_confidence_bound: number }} overheadSummary
 * @param {{ upper_confidence_bound: number }} variableSummary
 */
export function expectedUpperBound(overheadSummary, variableSummary) {
  return overheadSummary.upper_confidence_bound + variableSummary.upper_confidence_bound;
}
