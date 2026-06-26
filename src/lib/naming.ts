import { randomUUID } from 'node:crypto'

import { invariant } from './errors.js'

export const DATETIME_ANCHOR = '2200-01-01T00:00:00.000Z'

const DATETIME_ANCHOR_MS = Date.parse(DATETIME_ANCHOR)
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
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

export function makeWorkflowRunId(
  at = new Date(),
  uuidSuffix = randomUUID().slice(0, 8),
): string {
  const month = MONTH_NAMES[at.getUTCMonth()]
  const day = String(at.getUTCDate()).padStart(2, '0')

  return `${daysToAnchor(at)}_${month}-${day}_${uuidSuffix}`
}

export function pipelineStepPrefix(stageSequence: number): string {
  invariant(
    Number.isInteger(stageSequence) &&
      stageSequence >= 0 &&
      stageSequence <= 999,
    'Stage sequence MUST be an integer between 0 and 999.',
    { code: 'INVALID_STAGE_SEQUENCE' },
  )

  return String(999 - stageSequence).padStart(3, '0')
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
