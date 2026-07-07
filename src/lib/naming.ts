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

export function makeWorkflowRunId(
  at = new Date(),
  uuidSuffix = randomUUID().slice(0, 8),
): string {
  const month = MONTH_NAMES[at.getUTCMonth()]
  const day = String(at.getUTCDate()).padStart(2, '0')

  const minutes = String(minutesToEndOfUtcDay(at)).padStart(4, '0')

  return `${daysToAnchor(at)}_${month}-${day}-${minutes}_${uuidSuffix}`
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
