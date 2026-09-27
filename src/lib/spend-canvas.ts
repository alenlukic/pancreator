/**
 * Render an aggregate spend report into a Cursor Canvas file.
 *
 * The canvas layout lives in `library/templates/spend-report.canvas.tsx` and
 * derives every figure from the embedded report, so a canvas never carries a
 * number that was copied by hand.
 */
import path from 'node:path'

import { executingSourceRoot } from './build-identity.js'
import { invariant } from './errors.js'
import { readText, writeTextAtomic } from './io.js'
import type { MultiInstanceSpendReport } from './spend-sync.js'
import type { SpendCoverage, TokenSpendReport } from './token-spend.js'

export const SPEND_CANVAS_TEMPLATE = 'library/templates/spend-report.canvas.tsx'
const REPORT_PLACEHOLDER = '__SPEND_REPORT__'
const CANVAS_EXTENSION = '.canvas.tsx'

export type RenderableSpendReport = TokenSpendReport | MultiInstanceSpendReport

export interface SpendCanvasResult {
  status: 'rendered'
  canvas: string
  period: { days: number; start: string; end: string }
  totals: {
    events: number
    total_tokens: number
    cost_cents: number
    cursor_fee_cents: number
  }
  lowest_coverage: { dimension: string; known_token_percent: number } | null
}

/** Fill the canvas template with one report. */
export function renderSpendCanvas(
  template: string,
  report: RenderableSpendReport,
): string {
  const parts = template.split(REPORT_PLACEHOLDER)

  invariant(
    parts.length === 2,
    `The spend canvas template MUST contain ${REPORT_PLACEHOLDER} exactly once.`,
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

/** Write the report canvas to an absolute `.canvas.tsx` path. */
export function writeSpendCanvas(
  root: string,
  canvasPath: string,
  report: RenderableSpendReport,
): SpendCanvasResult {
  invariant(
    path.isAbsolute(canvasPath) && canvasPath.endsWith(CANVAS_EXTENSION),
    `--canvas MUST name an absolute path that ends in ${CANVAS_EXTENSION}.`,
    { code: 'INVALID_ARGUMENT' },
  )

  const templateRoot = executingSourceRoot() ?? root
  const template = readText(path.join(templateRoot, SPEND_CANVAS_TEMPLATE))

  writeTextAtomic(canvasPath, renderSpendCanvas(template, report))

  return {
    status: 'rendered',
    canvas: canvasPath,
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
    },
    lowest_coverage: lowestCoverage(report.coverage),
  }
}
