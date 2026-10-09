/** Per-day spend series by dimension, read by the spend trends canvas. */

import { resolvedFastMode } from './attribution.js'
import type {
  SpendRecord,
  SpendTrendDimension,
  SpendTrendSeries,
  SpendTrends,
} from './model.js'

/** Most keys one dimension keeps, counting the trailing `Other`. */
export const MAX_TREND_KEYS = 8

const PROVIDERS: Array<[RegExp, string]> = [
  [/claude|opus|sonnet|haiku|fable/iu, 'Anthropic'],
  [/^(?:gpt|o\d|codex)/iu, 'OpenAI'],
  [/gemini/iu, 'Google'],
  [/grok/iu, 'xAI'],
  [/^(?:cursor|composer|default$)/iu, 'Cursor'],
  [/kimi/iu, 'Moonshot'],
]

/** The model vendor a Cursor model name belongs to, or `Other`. */
export function modelProvider(model: string): string {
  return PROVIDERS.find(([pattern]) => pattern.test(model))?.[1] ?? 'Other'
}

function dimensionKey(
  record: SpendRecord,
  dimension: SpendTrendDimension,
): string {
  const { attribution } = record

  switch (dimension) {
    case 'model':
      return record.model
    case 'provider':
      return modelProvider(record.model)
    case 'fast_mode':
      return resolvedFastMode(record.model, attribution.fast_mode)
    case 'workflow_role':
      return attribution.workflow_role
    case 'stage':
      return attribution.stage
    case 'command':
      return attribution.command
    case 'persona':
      return attribution.persona_model.split(' · ')[0] ?? 'Unattributed'
    case 'governance':
      return attribution.governance
  }
}

interface Cell {
  cost_cents: number
  total_tokens: number
}

function trendSeries(
  records: SpendRecord[],
  dimension: SpendTrendDimension,
  dates: string[],
): SpendTrendSeries {
  const costByKey = new Map<string, number>()

  for (const record of records) {
    const key = dimensionKey(record, dimension)

    costByKey.set(key, (costByKey.get(key) ?? 0) + record.metrics.cost_cents)
  }

  const ranked = [...costByKey.entries()]
    .sort(([lk, lc], [rk, rc]) => rc - lc || lk.localeCompare(rk))
    .map(([key]) => key)
  const folded = ranked.length > MAX_TREND_KEYS
  const keys = folded
    ? [...ranked.slice(0, MAX_TREND_KEYS - 1), 'Other']
    : ranked
  const index = new Map(keys.map((key, position) => [key, position]))
  const otherIndex = folded ? keys.length - 1 : -1
  const cells = new Map<string, Cell[]>(
    dates.map((date) => [
      date,
      keys.map(() => ({ cost_cents: 0, total_tokens: 0 })),
    ]),
  )

  for (const record of records) {
    const date = new Date(record.timestamp_ms).toISOString().slice(0, 10)
    const position = index.get(dimensionKey(record, dimension)) ?? otherIndex
    const cell = cells.get(date)?.[position]

    if (cell !== undefined) {
      cell.cost_cents += record.metrics.cost_cents
      cell.total_tokens += record.metrics.total_tokens
    }
  }

  return {
    keys,
    rows: dates.map((date) => {
      const row = cells.get(date) ?? []

      return {
        date,
        cost_cents: row.map((cell) => Number(cell.cost_cents.toFixed(2))),
        total_tokens: row.map((cell) => cell.total_tokens),
      }
    }),
  }
}

/**
 * Daily charged cost and tokens of each trend dimension over the UTC days
 * that carry usage. Each dimension keeps its costliest keys and folds the
 * rest into `Other`.
 */
export function spendTrends(records: SpendRecord[]): SpendTrends {
  const dates = [
    ...new Set(
      records.map((record) =>
        new Date(record.timestamp_ms).toISOString().slice(0, 10),
      ),
    ),
  ].sort()

  const series = (dimension: SpendTrendDimension) =>
    trendSeries(records, dimension, dates)

  return {
    dimensions: {
      model: series('model'),
      provider: series('provider'),
      fast_mode: series('fast_mode'),
      workflow_role: series('workflow_role'),
      stage: series('stage'),
      command: series('command'),
      persona: series('persona'),
      governance: series('governance'),
    },
  }
}
