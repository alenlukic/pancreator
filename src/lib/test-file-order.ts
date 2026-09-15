import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface FileDurationEntry {
  file: string
  duration_ms: number
  /** When this file was measured. Absent in a record written before merging. */
  recorded_at?: string
}

/**
 * Compact record that schedules the next invocation's test files.
 *
 * `files` accumulates across runs, because a run that measures part of the
 * suite must not discard what the rest of it costs. The scalar fields
 * describe the run that wrote the record last.
 */
export interface FileDurationRecord {
  schema_version: 1
  recorded_at: string
  lane: string
  wall_clock_ms: number
  test_count: number
  files: FileDurationEntry[]
}

/**
 * How long a measurement another run contributed stays in a merged record.
 * A file nobody has run for this long is likelier to have changed cost than
 * to still be described by the number on disk.
 */
export const FILE_DURATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseFileDurationRecord(value: unknown): FileDurationRecord | null {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    typeof value.recorded_at !== 'string' ||
    typeof value.lane !== 'string' ||
    typeof value.wall_clock_ms !== 'number' ||
    !Number.isFinite(value.wall_clock_ms) ||
    typeof value.test_count !== 'number' ||
    !Number.isInteger(value.test_count) ||
    value.test_count < 0 ||
    !Array.isArray(value.files)
  ) {
    return null
  }

  const files = value.files
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) &&
        typeof entry.file === 'string' &&
        typeof entry.duration_ms === 'number' &&
        Number.isFinite(entry.duration_ms) &&
        entry.duration_ms >= 0,
    )
    .map((entry) => ({
      file: entry.file as string,
      duration_ms: entry.duration_ms as number,
      ...(typeof entry.recorded_at === 'string'
        ? { recorded_at: entry.recorded_at }
        : {}),
    }))

  return {
    schema_version: 1,
    recorded_at: value.recorded_at,
    lane: value.lane,
    wall_clock_ms: value.wall_clock_ms,
    test_count: value.test_count,
    files,
  }
}

/**
 * Fold one run's measurements into the record already on disk.
 *
 * A run that measures part of the suite used to replace the record whole.
 * Every file it did not run then read as unmeasured, and unmeasured files
 * lead, so the impacted loop each implementing stage iterates on dispatched
 * the known long pole last — the scheduling shape the record exists to
 * remove. Keeping what other runs measured holds the order stable across a
 * partial run, and the age bound stops a number outliving the file it
 * describes.
 */
export function mergeFileDurationRecord(
  existingValue: unknown,
  incoming: FileDurationRecord,
  maxAgeMs = FILE_DURATION_MAX_AGE_MS,
): FileDurationRecord {
  const merged = new Map<string, FileDurationEntry>(
    incoming.files.map((entry) => [
      entry.file,
      { ...entry, recorded_at: entry.recorded_at ?? incoming.recorded_at },
    ]),
  )
  const existing = parseFileDurationRecord(existingValue)
  const incomingAt = Date.parse(incoming.recorded_at)
  const reference = Number.isNaN(incomingAt) ? Date.now() : incomingAt

  for (const entry of existing?.files ?? []) {
    if (merged.has(entry.file)) {
      continue
    }

    const stamp = entry.recorded_at ?? existing?.recorded_at ?? ''
    const measuredAt = Date.parse(stamp)

    if (Number.isNaN(measuredAt) || reference - measuredAt > maxAgeMs) {
      continue
    }

    merged.set(entry.file, { ...entry, recorded_at: stamp })
  }

  return {
    ...incoming,
    files: [...merged.values()].sort(
      (left, right) => right.duration_ms - left.duration_ms,
    ),
  }
}

function normalizedTestFile(argument: string, cwd: string): string | null {
  if (
    argument.startsWith('-') ||
    !/\.test\.(?:[cm]?js|tsx?)$/u.test(argument)
  ) {
    return null
  }

  return path
    .relative(cwd, path.resolve(cwd, argument))
    .split(path.sep)
    .join('/')
}

/**
 * Reorder only test-file arguments, leaving the executable and every option
 * in place. Unknown files lead because their unmeasured cost may be highest.
 */
export function orderTestFileArguments(
  arguments_: string[],
  recordValue: unknown,
  cwd = process.cwd(),
): string[] {
  const record = parseFileDurationRecord(recordValue)

  if (!record) {
    return [...arguments_]
  }

  const durations = new Map(
    record.files.map((entry) => [entry.file, entry.duration_ms]),
  )
  const candidates = arguments_
    .map((argument, index) => ({
      argument,
      index,
      file: normalizedTestFile(argument, cwd),
    }))
    .filter(
      (entry): entry is { argument: string; index: number; file: string } =>
        entry.file !== null,
    )
    .sort((left, right) => {
      const leftDuration = durations.get(left.file)
      const rightDuration = durations.get(right.file)

      if (leftDuration === undefined && rightDuration !== undefined) {
        return -1
      }

      if (leftDuration !== undefined && rightDuration === undefined) {
        return 1
      }

      if (leftDuration !== undefined && rightDuration !== undefined) {
        const durationOrder = rightDuration - leftDuration

        if (durationOrder !== 0) {
          return durationOrder
        }
      }

      return left.index - right.index
    })
  const ordered = [...arguments_]
  let candidate = 0

  for (let index = 0; index < ordered.length; index += 1) {
    if (normalizedTestFile(ordered[index] as string, cwd) !== null) {
      ordered[index] = candidates[candidate]?.argument ?? ordered[index]
      candidate += 1
    }
  }

  return ordered
}

function readRecord(recordPath: string): unknown {
  try {
    return JSON.parse(readFileSync(recordPath, 'utf8')) as unknown
  } catch {
    return null
  }
}

function main(): void {
  const recordPath = process.argv[2]

  if (!recordPath) {
    process.exitCode = 1
    return
  }

  const ordered = orderTestFileArguments(
    process.argv.slice(3),
    readRecord(recordPath),
  )

  process.stdout.write(ordered.map((argument) => `${argument}\0`).join(''))
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
