/** Spend metric arithmetic and the ranked, folded, and rounded slice rows. */

import type { CursorUsageEvent } from '../cursor-usage.js'
import type { SpendMetrics, SpendSliceRow } from './model.js'

export const MAX_SLICE_ROWS = 10

/** A spend metrics record with every counter at zero. */
export function emptyMetrics(): SpendMetrics {
  return {
    events: 0,
    request_units: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_write_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
    cost_cents: 0,
    cursor_fee_cents: 0,
  }
}

/** Spend metrics of one usage event: one event, its request units, token counts (missing usage counts as zero), charge, and Cursor fee. */
export function eventMetrics(event: CursorUsageEvent): SpendMetrics {
  const usage = event.token_usage

  const input = usage?.input_tokens ?? 0
  const output = usage?.output_tokens ?? 0
  const cacheWrite = usage?.cache_write_tokens ?? 0
  const cacheRead = usage?.cache_read_tokens ?? 0

  return {
    events: 1,
    request_units: event.request_units,
    input_tokens: input,
    output_tokens: output,
    cache_write_tokens: cacheWrite,
    cache_read_tokens: cacheRead,
    total_tokens: input + output + cacheWrite + cacheRead,
    cost_cents: event.charged_cents,
    cursor_fee_cents: event.cursor_token_fee_cents,
  }
}

/** Adds every counter of `addition` into `target`, in place. */
export function addMetrics(target: SpendMetrics, addition: SpendMetrics): void {
  target.events += addition.events
  target.request_units += addition.request_units
  target.input_tokens += addition.input_tokens
  target.output_tokens += addition.output_tokens
  target.cache_write_tokens += addition.cache_write_tokens
  target.cache_read_tokens += addition.cache_read_tokens
  target.total_tokens += addition.total_tokens
  target.cost_cents += addition.cost_cents
  target.cursor_fee_cents += addition.cursor_fee_cents
}

/** Adds the metrics into the group under `key`, creating a zeroed group first when absent. Mutates `groups`. */
export function metricsMapRow(
  groups: Map<string, SpendMetrics>,
  key: string,
  metrics: SpendMetrics,
): void {
  const aggregate = groups.get(key) ?? emptyMetrics()

  addMetrics(aggregate, metrics)
  groups.set(key, aggregate)
}

/** Slice rows of the groups ranked by total tokens, then cost, descending, then key. */
export function sortedRows(groups: Map<string, SpendMetrics>): SpendSliceRow[] {
  return [...groups.entries()]
    .map(([key, metrics]) => ({ key, metrics }))
    .sort(
      (left, right) =>
        right.metrics.total_tokens - left.metrics.total_tokens ||
        right.metrics.cost_cents - left.metrics.cost_cents ||
        left.key.localeCompare(right.key),
    )
}

/**
 * Ranked slice rows capped at `limit`: when there are more groups, the top
 * `limit - 1` are kept and the rest are summed into one `Other` row.
 */
export function foldedRows(
  groups: Map<string, SpendMetrics>,
  limit = MAX_SLICE_ROWS,
): SpendSliceRow[] {
  const rows = sortedRows(groups)

  if (rows.length <= limit) {
    return rows
  }

  const retained = rows.slice(0, limit - 1)
  const other = emptyMetrics()

  for (const row of rows.slice(limit - 1)) {
    addMetrics(other, row.metrics)
  }

  return [...retained, { key: 'Other', metrics: other }]
}

/** Copy of the metrics with request units rounded to 4 decimals and cost and fee cents to 6. */
export function roundedMetrics(metrics: SpendMetrics): SpendMetrics {
  return {
    ...metrics,
    request_units: Number(metrics.request_units.toFixed(4)),
    cost_cents: Number(metrics.cost_cents.toFixed(6)),
    cursor_fee_cents: Number(metrics.cursor_fee_cents.toFixed(6)),
  }
}

/** Copies of the rows with their metrics rounded by `roundedMetrics`. */
export function roundRows(rows: SpendSliceRow[]): SpendSliceRow[] {
  return rows.map((row) => ({
    ...row,
    metrics: roundedMetrics(row.metrics),
  }))
}
