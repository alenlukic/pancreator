import { randomUUID } from 'node:crypto'

import { invariant } from './errors.js'

export const DATETIME_ANCHOR = '2200-01-01T00:00:00.000Z'

const DATETIME_ANCHOR_MS = Date.parse(DATETIME_ANCHOR)
const MILLISECONDS_PER_MINUTE = 60 * 1000
const MINUTES_PER_DAY = 24 * 60
const MILLISECONDS_PER_DAY = MINUTES_PER_DAY * MILLISECONDS_PER_MINUTE
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

export function daysToAnchor(at = new Date()): number {
  return Math.floor((DATETIME_ANCHOR_MS - at.getTime()) / MILLISECONDS_PER_DAY)
}

export const DAYS_TO_ANCHOR = daysToAnchor()

export function minutesToEndOfUtcDay(at = new Date()): number {
  const nextUtcDay = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate() + 1,
  )

  return Math.ceil((nextUtcDay - at.getTime()) / MILLISECONDS_PER_MINUTE)
}

/** Reverse-chronological sortable prefix shared by every temporal runtime name. */
export function temporalNamePrefix(at = new Date()): string {
  const month = MONTH_NAMES[at.getUTCMonth()]
  const day = String(at.getUTCDate()).padStart(2, '0')

  const minutes = String(minutesToEndOfUtcDay(at)).padStart(4, '0')

  return `${daysToAnchor(at)}_${month}-${day}-${minutes}`
}

export const RUN_SUFFIX_MAX_LENGTH = 12

export const RUN_SUFFIX_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,10}[a-z0-9])?$/u

// Words that carry no signal about what a run was for. Kept deliberately small:
// terms of art such as "best-of-n" must survive keyword extraction intact.
const KEYWORD_STOPWORDS = new Set(['a', 'an', 'and', 'the', 'request'])

function keywordTokens(seed: string): string[] {
  return (
    seed
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/u, '')
      // The harness's own temporal prefix on an already-standardized name must
      // not leak its month token into the derived keywords.
      .replace(
        /^\d+_(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-\d{2}-\d{4}_/u,
        ' ',
      )
      .replace(/\d{8}t\d{4,9}z?/gu, ' ')
      .replace(/\d{4}-\d{2}-\d{2}/gu, ' ')
      .split(/[^a-z0-9]+/u)
      .filter(
        (word) =>
          word.length > 0 &&
          !KEYWORD_STOPWORDS.has(word) &&
          !/^\d+$/u.test(word) &&
          // UUID and commit fragments are hex runs with at least one digit; the
          // digit requirement keeps rare all-letter hex words like "acceded".
          !(/^[0-9a-f]{7,}$/u.test(word) && /\d/u.test(word)),
      )
  )
}

/**
 * Derive a hyphenated high-signal keyword suffix from a name-like seed, capped
 * at RUN_SUFFIX_MAX_LENGTH characters. Abrupt cutoffs mid-word are accepted.
 * Returns null when the seed carries no usable keywords.
 */
export function keywordRunSuffix(seed: string): string | null {
  const joined = keywordTokens(seed).join('-')

  if (joined.length === 0) {
    return null
  }

  const truncated = joined.slice(0, RUN_SUFFIX_MAX_LENGTH).replace(/-+$/u, '')

  return truncated.length > 0 ? truncated : null
}

/**
 * Keyword suffix from a file name, falling back to the first content line that
 * yields keywords when the name alone is generic (e.g. `request.md`).
 */
export function keywordRunSuffixFrom(
  name: string,
  content?: string,
): string | null {
  const fromName = keywordRunSuffix(name)

  if (fromName) {
    return fromName
  }

  for (const line of (content ?? '').split('\n')) {
    const cleaned = line.replace(/^[#>*\s-]+/u, '').trim()

    if (cleaned.length === 0) {
      continue
    }

    const fromContent = keywordRunSuffix(cleaned)

    if (fromContent) {
      return fromContent
    }
  }

  return null
}

export function makeWorkflowRunId(
  at = new Date(),
  suffix = randomUUID().slice(0, 8),
): string {
  invariant(
    RUN_SUFFIX_PATTERN.test(suffix),
    'Run ID suffixes MUST be 1-12 lowercase keyword or hex characters.',
    { code: 'INVALID_RUN_SUFFIX', details: { suffix } },
  )

  return `${temporalNamePrefix(at)}_${suffix}`
}

export function pipelineStepPrefix(stageSequence: number): string {
  invariant(
    Number.isInteger(stageSequence) &&
      stageSequence >= 0 &&
      stageSequence <= 99,
    'Stage sequence MUST be an integer between 0 and 99.',
    { code: 'INVALID_STAGE_SEQUENCE' },
  )

  return String(99 - stageSequence).padStart(2, '0')
}

export function completedPipelineStepPrefix(
  stageSequence: number,
  totalStages: number,
): string {
  invariant(
    Number.isInteger(totalStages) && totalStages > 0 && totalStages <= 100,
    'Total stages MUST be an integer between 1 and 100.',
    { code: 'INVALID_STAGE_COUNT' },
  )
  invariant(
    Number.isInteger(stageSequence) &&
      stageSequence >= 0 &&
      stageSequence < totalStages,
    'Stage sequence MUST identify an occurrence within the completed run.',
    { code: 'INVALID_STAGE_SEQUENCE' },
  )

  return String(totalStages - stageSequence - 1).padStart(2, '0')
}

export function makeCompletedStageArtifactId(
  stageSequence: number,
  totalStages: number,
  stageSlug: string,
  stageIteration: number,
  uuidSuffix = randomUUID().slice(0, 8),
): string {
  invariant(stageSlug.length > 0, 'Stage slug MUST be non-empty.', {
    code: 'INVALID_STAGE_SLUG',
  })
  invariant(
    Number.isInteger(stageIteration) && stageIteration > 0,
    'Stage iteration MUST be a positive integer.',
    { code: 'INVALID_STAGE_ITERATION' },
  )

  const prefix = completedPipelineStepPrefix(stageSequence, totalStages)

  return `${prefix}_${stageSlug}-${stageIteration}_${uuidSuffix}`
}

export function makeStageArtifactId(
  stageSequence: number,
  stageSlug: string,
  stageIteration: number,
  uuidSuffix = randomUUID().slice(0, 8),
): string {
  invariant(stageSlug.length > 0, 'Stage slug MUST be non-empty.', {
    code: 'INVALID_STAGE_SLUG',
  })
  invariant(
    Number.isInteger(stageIteration) && stageIteration > 0,
    'Stage iteration MUST be a positive integer.',
    { code: 'INVALID_STAGE_ITERATION' },
  )

  const prefix = pipelineStepPrefix(stageSequence)

  return `${prefix}_${stageSlug}-${stageIteration}_${uuidSuffix}`
}
