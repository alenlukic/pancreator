import { existsSync } from 'node:fs'
import { isRecord } from '../io.js'
import { makeWorkflowRunId } from '../naming.js'
import { resolveRunLayout } from '../run-layout.js'
import { parseJsonFile, parseJsonLines } from './identity.js'
import { updateFiles } from './layout.js'

const LEGACY_RUN_ID_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-([0-9a-f]{8})$/u

const DAY_ONLY_RUN_ID_PATTERN = /^(\d+)_([A-Z][a-z]{2})-(\d{2})_([0-9a-f]{8})$/u

// Suffixes are keyword slugs up to 12 characters; legacy 8-hex UUID fragments
// remain valid members of the same character class.
const CURRENT_RUN_ID_PATTERN =
  /^(\d+)_([A-Z][a-z]{2})-(\d{2})-(\d{4})_([a-z0-9](?:[a-z0-9-]{0,10}[a-z0-9])?)$/u

export const HASH_RUN_SUFFIX_PATTERN =
  /^(\d+_[A-Z][a-z]{2}-\d{2}-\d{4})_([0-9a-f]{8})$/u

const TEMPORAL_FILE_NAME_PATTERN =
  /^(\d+)_([A-Z][a-z]{2})-(\d{2})-(\d{4})_([a-z0-9][a-z0-9.-]*)$/u

export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

const MILLISECONDS_PER_MINUTE = 60 * 1000

const DATETIME_ANCHOR_MS = Date.parse('2200-01-01T00:00:00.000Z')

const MONTH_INDEX = new Map(
  [
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
  ].map((month, index) => [month, index]),
)

export interface RunMigration {
  sourceRunId: string
  targetRunId: string
}

function legacyRunDate(
  runId: string,
): { date: Date; uuidSuffix: string } | null {
  const match = LEGACY_RUN_ID_PATTERN.exec(runId)

  if (!match) {
    return null
  }

  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      Number(match[7]),
    ),
  )

  return { date, uuidSuffix: match[8] }
}

function dayOnlyRunDate(runId: string): Date | null {
  const match = DAY_ONLY_RUN_ID_PATTERN.exec(runId)

  if (!match) {
    return null
  }

  const monthIndex = MONTH_INDEX.get(match[2])

  if (monthIndex === undefined) {
    return null
  }

  const day = Number(match[3])
  const boundary = new Date(
    DATETIME_ANCHOR_MS - Number(match[1]) * MILLISECONDS_PER_DAY,
  )
  const candidates = [
    boundary,
    new Date(boundary.getTime() - MILLISECONDS_PER_DAY),
  ]
  const matchingDate = candidates.find(
    (candidate) =>
      candidate.getUTCMonth() === monthIndex && candidate.getUTCDate() === day,
  )

  if (!matchingDate) {
    return null
  }

  return new Date(
    Date.UTC(
      matchingDate.getUTCFullYear(),
      matchingDate.getUTCMonth(),
      matchingDate.getUTCDate(),
      12,
    ),
  )
}

function temporalPrefixDate(
  daysValue: string,
  monthName: string,
  dayValue: string,
  minutesValue: string,
): Date | null {
  const monthIndex = MONTH_INDEX.get(monthName)

  if (monthIndex === undefined) {
    return null
  }

  const day = Number(dayValue)
  const minutesToEnd = Number(minutesValue)

  if (minutesToEnd < 1 || minutesToEnd > 1440) {
    return null
  }

  const boundary = new Date(
    DATETIME_ANCHOR_MS - Number(daysValue) * MILLISECONDS_PER_DAY,
  )
  const candidates = [
    boundary,
    new Date(boundary.getTime() - MILLISECONDS_PER_DAY),
  ]
  const matchingDate = candidates.find(
    (candidate) =>
      candidate.getUTCMonth() === monthIndex && candidate.getUTCDate() === day,
  )

  if (!matchingDate) {
    return null
  }

  const startOfDay = Date.UTC(
    matchingDate.getUTCFullYear(),
    matchingDate.getUTCMonth(),
    matchingDate.getUTCDate(),
  )

  return new Date(startOfDay + (1440 - minutesToEnd) * MILLISECONDS_PER_MINUTE)
}

export function currentRunDate(runId: string): Date | null {
  const match = CURRENT_RUN_ID_PATTERN.exec(runId)

  return match
    ? temporalPrefixDate(match[1], match[2], match[3], match[4])
    : null
}

export function temporalFileDate(name: string): Date | null {
  const match = TEMPORAL_FILE_NAME_PATTERN.exec(name)

  return match
    ? temporalPrefixDate(match[1], match[2], match[3], match[4])
    : null
}

/**
 * The creation time a run, session, file, or policy-mandated name carries.
 * Retention reads age from here for every class whose name is its age
 * authority, so the archive tier and the deletion tier agree on what is old.
 */
export function temporalNameDate(name: string): Date | null {
  return (
    currentRunDate(name) ??
    temporalFileDate(name) ??
    policyMandatedFileDate(name)
  )
}

export function validDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null
  }

  const date = new Date(value)

  return Number.isFinite(date.getTime()) ? date : null
}

export function runCreatedAt(root: string, runId: string): Date | null {
  const layout = resolveRunLayout(root, runId)
  const statePath = layout.state.absolute

  if (existsSync(statePath)) {
    const state = parseJsonFile(statePath)

    if (isRecord(state)) {
      const createdAt = validDate(state.created_at)

      if (createdAt) {
        return createdAt
      }
    }
  }

  const eventsPath = layout.events.absolute

  for (const event of parseJsonLines(eventsPath)) {
    if (isRecord(event)) {
      const timestamp = validDate(event.timestamp)

      if (timestamp) {
        return timestamp
      }
    }
  }

  return (
    legacyRunDate(runId)?.date ?? currentRunDate(runId) ?? dayOnlyRunDate(runId)
  )
}

export function migratedRunId(runId: string, createdAt?: Date): string | null {
  const legacy = legacyRunDate(runId)

  if (legacy) {
    return makeWorkflowRunId(legacy.date, legacy.uuidSuffix)
  }

  const dayOnly = DAY_ONLY_RUN_ID_PATTERN.exec(runId)

  if (!dayOnly) {
    return null
  }

  return makeWorkflowRunId(
    createdAt ?? dayOnlyRunDate(runId) ?? new Date(),
    dayOnly[4],
  )
}

export function migrationTargetRunId(
  root: string,
  runId: string,
): string | null {
  const migrated = migratedRunId(runId, runCreatedAt(root, runId) ?? undefined)

  if (migrated) {
    return migrated
  }

  return currentRunDate(runId) ? runId : null
}

export function updateFileCount(
  files: string[],
  mappings: ReadonlyMap<string, string>,
): number {
  const updated = new Set<string>()

  updateFiles(files, mappings, updated)

  return updated.size
}

export function utcDate(
  year: string,
  month: string,
  day: string,
  hours = '12',
  minutes = '0',
  seconds = '0',
  milliseconds = '0',
): Date | null {
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
      Number(milliseconds),
    ),
  )

  return Number.isFinite(date.getTime()) ? date : null
}

/**
 * File names a governance policy mandates verbatim, with the UTC timestamp
 * each one carries captured so its age stays legible without a rename.
 *
 * `REPAIR-001` mandates `harness-repair-<UTC timestamp>-<category-slug>-<detail-slug>.md`
 * and requires one intake to cite another by file name; `SPOT-001` mandates
 * `spotfix-escalation-<UTC timestamp>-<slug>.md`. Standardizing either shape
 * breaks the mandated name and every citation of it, because a citation is a
 * bare file name that the reference rewrite, which maps whole relative paths,
 * never sees.
 */
const POLICY_MANDATED_FILE_NAME_PATTERN =
  /^(?:harness-repair|spotfix-escalation)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z-.+\.md$/u

/** The creation date a policy-mandated file name carries, if it is one. */
export function policyMandatedFileDate(name: string): Date | null {
  const match = POLICY_MANDATED_FILE_NAME_PATTERN.exec(name)

  return match
    ? utcDate(
        match[1],
        match[2],
        match[3],
        match[4],
        match[5],
        match[6],
        match[7] ?? '0',
      )
    : null
}
