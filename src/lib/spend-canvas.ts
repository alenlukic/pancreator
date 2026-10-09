/**
 * Render an aggregate spend report into Cursor Canvas files.
 *
 * The report layout lives in `library/templates/spend-report.canvas.tsx`, the
 * trends layout in `library/templates/spend-trends.canvas.tsx`, and the chart
 * code both share in `library/templates/spend-canvas-shared.tsx`. Every figure
 * derives from the embedded report, so a canvas never carries a number that
 * was copied by hand.
 */
import path from 'node:path'

import { executingSourceRoot } from './build-identity.js'
import { invariant } from './errors.js'
import { readText, writeTextAtomic } from './io.js'
import type { SpendBracket, SpendBrackets } from './spend-brackets.js'
import type { MultiInstanceSpendReport } from './spend-sync/model.js'
import type { SpendCoverage, TokenSpendReport } from './token-spend/model.js'

export const SPEND_CANVAS_TEMPLATE = 'library/templates/spend-report.canvas.tsx'
export const SPEND_TRENDS_TEMPLATE = 'library/templates/spend-trends.canvas.tsx'
export const SPEND_CANVAS_SHARED = 'library/templates/spend-canvas-shared.tsx'
const REPORT_PLACEHOLDER = '__SPEND_REPORT__'
const SHARED_PLACEHOLDER = '// __SPEND_CANVAS_SHARED__'
const CANVAS_EXTENSION = '.canvas.tsx'

export type RenderableSpendReport = (
  | TokenSpendReport
  | MultiInstanceSpendReport
) & { brackets?: SpendBracket[] }

export interface SpendCanvasOptions {
  brackets?: SpendBrackets
  /** Also write the trends canvas beside the report canvas. */
  trends?: boolean
}

export interface SpendCanvasResult {
  status: 'rendered'
  canvas: string
  trends_canvas?: string
  period: { days: number; start: string; end: string }
  totals: {
    events: number
    total_tokens: number
    cost_cents: number
    cursor_fee_cents: number
    on_demand_cost_cents: number
    included_cost_cents: number
  }
  lowest_coverage: { dimension: string; known_token_percent: number } | null
  brackets?: SpendBrackets
}

/** Fill a canvas template with one report and the shared chart code. */
export function renderSpendCanvas(
  template: string,
  report: RenderableSpendReport,
  shared = '',
): string {
  const sections = template.split(SHARED_PLACEHOLDER)

  invariant(
    sections.length <= 2,
    `A spend canvas template MUST contain ${SHARED_PLACEHOLDER} at most once.`,
    { code: 'SPEND_CANVAS_TEMPLATE_INVALID' },
  )

  const parts = sections.join(shared.trimEnd()).split(REPORT_PLACEHOLDER)

  invariant(
    parts.length === 2,
    `A spend canvas template MUST contain ${REPORT_PLACEHOLDER} exactly once.`,
    { code: 'SPEND_CANVAS_TEMPLATE_INVALID' },
  )

  return parts.join(JSON.stringify(report, null, 2))
}

function lowestCoverage(
  coverage: Record<string, SpendCoverage>,
): SpendCanvasResult['lowest_coverage'] {
  let lowest: SpendCanvasResult['lowest_coverage'] = null

  for (const [dimension, value] of Object.entries(coverage)) {
    const percent = value.known_token_percent ?? 0

    if (lowest === null || percent < lowest.known_token_percent) {
      lowest = { dimension, known_token_percent: percent }
    }
  }

  return lowest
}

/** The trends canvas path beside a report canvas: `<name>-trends.canvas.tsx`. */
export function trendsCanvasPath(canvasPath: string): string {
  return `${canvasPath.slice(0, -CANVAS_EXTENSION.length)}-trends${CANVAS_EXTENSION}`
}

/**
 * Write the report canvas to an absolute `.canvas.tsx` path, with any
 * brackets drawn over its daily cost chart, and the trends canvas beside it
 * when requested.
 */
export function writeSpendCanvas(
  root: string,
  canvasPath: string,
  report: RenderableSpendReport,
  options: SpendCanvasOptions = {},
): SpendCanvasResult {
  invariant(
    path.isAbsolute(canvasPath) && canvasPath.endsWith(CANVAS_EXTENSION),
    `--canvas MUST name an absolute path that ends in ${CANVAS_EXTENSION}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  const templateRoot = executingSourceRoot() ?? root
  const template = (relativePath: string) =>
    readText(path.join(templateRoot, relativePath))
  const shared = template(SPEND_CANVAS_SHARED)
  const data =
    options.brackets === undefined
      ? report
      : { ...report, brackets: options.brackets.brackets }

  writeTextAtomic(
    canvasPath,
    renderSpendCanvas(template(SPEND_CANVAS_TEMPLATE), data, shared),
  )

  const trendsCanvas =
    options.trends === true ? trendsCanvasPath(canvasPath) : null

  if (trendsCanvas !== null) {
    writeTextAtomic(
      trendsCanvas,
      renderSpendCanvas(template(SPEND_TRENDS_TEMPLATE), data, shared),
    )
  }

  return {
    status: 'rendered',
    canvas: canvasPath,
    ...(trendsCanvas === null ? {} : { trends_canvas: trendsCanvas }),
    period: {
      days: report.period.days,
      start: report.period.start,
      end: report.period.end,
    },
    totals: {
      events: report.totals.events,
      total_tokens: report.totals.total_tokens,
      cost_cents: report.totals.cost_cents,
      cursor_fee_cents: report.totals.cursor_fee_cents,
      on_demand_cost_cents: Number(
        (report.totals.cost_cents - report.totals.included_cost_cents).toFixed(
          6,
        ),
      ),
      included_cost_cents: report.totals.included_cost_cents,
    },
    lowest_coverage: lowestCoverage(report.coverage),
    ...(options.brackets === undefined ? {} : { brackets: options.brackets }),
  }
}
