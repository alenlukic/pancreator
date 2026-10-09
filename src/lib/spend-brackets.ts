/**
 * Labeled date periods that the spend canvases draw as brackets above the
 * daily charged cost chart.
 *
 * The agent that runs `/pan-spend` resolves each label to a period from
 * transcripts and connected integrations. This module only validates those
 * periods, names them, and clamps them to the report window. A bracket
 * carries a label, a display name, UTC dates, and a source kind, never the
 * evidence that resolved it.
 */
import { invariant } from './errors.js'
import { isRecord } from './io.js'

export const SPEND_BRACKET_SOURCES = [
  'transcript',
  'calendar',
  'mail',
  'granola',
  'slack',
  'operator',
  'other',
] as const

export type SpendBracketSource = (typeof SPEND_BRACKET_SOURCES)[number]

export interface SpendBracket {
  label: string
  name: string
  /** First UTC day of the period, `YYYY-MM-DD`. */
  start: string
  /** Last UTC day of the period, inclusive. */
  end: string
  source: SpendBracketSource
}

export interface SkippedSpendBracket {
  label: string
  reason: 'unresolved' | 'outside_window'
}

export interface SpendBrackets {
  brackets: SpendBracket[]
  skipped: SkippedSpendBracket[]
}

const LABEL_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/iu
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u
const ITEM_RE = /^(?<label>[^@]+)(?:@(?<start>[^.]+)(?:\.\.(?<end>.+))?)?$/u
const MAX_BRACKETS = 12
const MAX_NAME_LENGTH = 60

// Words a humanized label spells in a fixed form rather than in lowercase.
const WORD_FORMS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  ci: 'CI',
  cursor: 'Cursor',
  fast: 'Fast',
  github: 'GitHub',
  granola: 'Granola',
  linear: 'Linear',
  mcp: 'MCP',
  notion: 'Notion',
  pr: 'PR',
  qa: 'QA',
  slack: 'Slack',
  ui: 'UI',
}

/** A readable name for a label: words split on hyphens, sentence case. */
export function spendBracketName(label: string): string {
  return label
    .split(/[-_]+/u)
    .filter((word) => word.length > 0)
    .map((word, position) => {
      const lower = word.toLowerCase()
      const form = WORD_FORMS[lower]

      if (form !== undefined) {
        return form
      }

      return position === 0
        ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
        : lower
    })
    .join(' ')
}

function isUtcDate(value: string): boolean {
  if (!DATE_RE.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

function checkedLabel(label: string): string {
  invariant(
    LABEL_RE.test(label),
    `Bracket label "${label}" MUST be 1 to 64 letters, digits, hyphens, or underscores.`,
    { code: 'INVALID_ARGUMENT' },
  )

  return label
}

function checkedPeriod(
  label: string,
  start: string,
  end: string,
): { start: string; end: string } {
  invariant(
    isUtcDate(start) && isUtcDate(end),
    `Bracket "${label}" MUST name its period as YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD.`,
    { code: 'INVALID_ARGUMENT' },
  )
  invariant(start <= end, `Bracket "${label}" MUST NOT end before it starts.`, {
    code: 'INVALID_ARGUMENT',
  })

  return { start, end }
}

function cleanName(value: unknown, label: string): string {
  const name =
    typeof value === 'string'
      ? value
          .replace(/\p{Cc}/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim()
          .slice(0, MAX_NAME_LENGTH)
      : ''

  return name.length > 0 ? name : spendBracketName(label)
}

function isSource(value: unknown): value is SpendBracketSource {
  return SPEND_BRACKET_SOURCES.some((source) => source === value)
}

/** Resolved brackets from a `--brackets-file` JSON array, keyed by label. */
function fileBrackets(file: unknown): Map<string, SpendBracket> {
  invariant(
    Array.isArray(file),
    '--brackets-file MUST hold a JSON array of { label, name?, start, end?, source? } entries.',
    { code: 'INVALID_ARGUMENT' },
  )

  const resolved = new Map<string, SpendBracket>()
  const entries: unknown[] = file

  for (const entry of entries) {
    invariant(
      isRecord(entry) &&
        typeof entry.label === 'string' &&
        typeof entry.start === 'string' &&
        (entry.end === undefined || typeof entry.end === 'string'),
      'Each --brackets-file entry MUST carry a string label and start date.',
      { code: 'INVALID_ARGUMENT' },
    )

    const label = checkedLabel(entry.label)
    const period = checkedPeriod(
      label,
      entry.start,
      typeof entry.end === 'string' ? entry.end : entry.start,
    )

    invariant(
      !resolved.has(label),
      `--brackets-file names "${label}" more than once.`,
      { code: 'INVALID_ARGUMENT' },
    )
    resolved.set(label, {
      label,
      name: cleanName(entry.name, label),
      ...period,
      source: isSource(entry.source) ? entry.source : 'other',
    })
  }

  return resolved
}

/** Brackets from `--brackets` items, each `label` or `label@start[..end]`. */
function listedBrackets(
  labels: string,
  resolved: Map<string, SpendBracket>,
): Array<SpendBracket | SkippedSpendBracket> {
  const items = labels
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  const seen = new Set<string>()

  invariant(items.length > 0, '--brackets MUST name at least one label.', {
    code: 'INVALID_ARGUMENT',
  })

  return items.map((item) => {
    const groups = ITEM_RE.exec(item)?.groups
    const label = checkedLabel(groups?.label?.trim() ?? item)

    invariant(!seen.has(label), `--brackets names "${label}" more than once.`, {
      code: 'INVALID_ARGUMENT',
    })
    seen.add(label)

    if (groups?.start !== undefined) {
      const period = checkedPeriod(
        label,
        groups.start,
        groups.end ?? groups.start,
      )

      return {
        label,
        name: resolved.get(label)?.name ?? spendBracketName(label),
        ...period,
        source: 'operator',
      }
    }

    return resolved.get(label) ?? { label, reason: 'unresolved' }
  })
}

export type RequestedSpendBrackets = Array<SpendBracket | SkippedSpendBracket>

/**
 * Validate and name the requested brackets. `--brackets` selects and orders
 * labels; `--brackets-file` resolves the ones without an inline period. With
 * only a file, every file entry is requested.
 */
export function parseSpendBrackets(input: {
  labels: string | null
  file: unknown
}): RequestedSpendBrackets {
  const resolved =
    input.file === undefined ? new Map() : fileBrackets(input.file)
  const requested =
    input.labels === null
      ? [...resolved.values()]
      : listedBrackets(input.labels, resolved)

  invariant(
    requested.length <= MAX_BRACKETS,
    `--brackets MUST name at most ${MAX_BRACKETS} periods.`,
    { code: 'INVALID_ARGUMENT' },
  )

  return requested
}

/** Clamp requested brackets to the report window's UTC days. */
export function clampSpendBrackets(
  requested: RequestedSpendBrackets,
  window: { start: string; end: string },
): SpendBrackets {
  const windowStart = window.start.slice(0, 10)
  const windowEnd = window.end.slice(0, 10)
  const brackets: SpendBracket[] = []
  const skipped: SkippedSpendBracket[] = []

  for (const item of requested) {
    if ('reason' in item) {
      skipped.push(item)
      continue
    }

    const start = item.start < windowStart ? windowStart : item.start
    const end = item.end > windowEnd ? windowEnd : item.end

    if (start > end) {
      skipped.push({ label: item.label, reason: 'outside_window' })
      continue
    }

    brackets.push({ ...item, start, end })
  }

  return { brackets, skipped }
}
