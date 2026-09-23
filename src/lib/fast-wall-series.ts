import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { PanError } from './errors.js'
import { fileExists, isRecord } from './io.js'
import {
  isSelfDevelopmentInstallation,
  loadProjectConfig,
} from './project-config.js'
import { parseFileDurationRecord } from './test-file-order.js'
import type {
  FastWallConfig,
  FastWallStagePoint,
  FastWallStageSummary,
  RunState,
} from './types.js'

export type { FastWallStagePoint, FastWallStageSummary } from './types.js'

export const FAST_WALL_SERIES_PATH = 'runtime/fast-wall-series.jsonl'
export const FAST_WALL_SERIES_ROOT_ENV = 'PAN_FAST_WALL_SERIES_ROOT'
export const FAST_WALL_RUN_ID_ENV = 'PAN_FAST_WALL_RUN_ID'
export const FAST_WALL_PHASE_ENV = 'PAN_FAST_WALL_PHASE'
export const FAST_WALL_CALLER_CLASS_ENV = 'PAN_FAST_WALL_CALLER_CLASS'
export const FAST_WALL_CRITERION_ID = 'ship.fast_wall_ceiling'

/** Phase of a run's baseline capture, before the implementation stage. */
export const FAST_WALL_BASELINE_PHASE = 'baseline'
/** Phase of an agent's own `pan repository-check` execution inside a run. */
export const FAST_WALL_AGENT_PHASE = 'agent'
/** Phase of a run the harness did not start, such as a developer's `npm test`. */
export const FAST_WALL_STANDALONE_PHASE = 'standalone'
/** Phase recorded for a schema-1 entry, which carried no phase. */
export const FAST_WALL_LEGACY_PHASE = 'legacy'

export type FastWallCallerClass =
  | 'agent'
  | 'harness_gate'
  | 'prefetch'
  | 'standalone'

const FAST_WALL_QUALIFIED_CALLER: FastWallCallerClass = 'harness_gate'

/** The lane string the reporter writes for the complete `npm test` lane. */
export const FAST_LANE = 'integration+regression+unit'
/** The lifecycle event under which `npm test` runs the complete fast lane. */
const FAST_LANE_INVOKER = 'test'
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/**
 * One fast-lane run. Schema 3 adds the logical CPU count and caller class used
 * to qualify the advisory population. Earlier schemas retain their observable
 * lane data but are unqualified because they cannot establish that provenance.
 */
export interface FastWallSeriesEntry {
  schema_version: 1 | 2 | 3
  recorded_at: string
  wall_clock_ms: number
  wrapper_wall_clock_ms: number
  wrapper_overhead_ms: number
  test_count: number
  worker_count: number
  load_average: number
  /** Logical CPU count used to normalize load; null on legacy rows. */
  cpu_count: number | null
  /** Origin of the run; null on legacy rows. */
  caller_class: FastWallCallerClass | null
  workspace_fingerprint: string
  invoker: string
  run_id: string
  exit_code: number
  lane: string | null
  phase: string
  summed_file_duration_ms: number | null
}

export interface FastWallSeriesRead {
  records: FastWallSeriesEntry[]
  malformed_lines: number
}

export interface FastWallReport {
  status: 'passed' | 'failed' | 'insufficient_samples' | 'not_applicable'
  series_path: string
  /** Qualified complete fast-lane runs inside the 24-hour window. */
  recorded_runs: number
  /** Rows inside the window that did not qualify for the governed population. */
  unqualified_runs: number
  malformed_lines: number
  window_started_at: string
  evaluated_at: string
  rolling_average_ms: number | null
  permitted_ceiling_ms: number | null
  max_load_average_per_cpu: number | null
  minimum_qualified_samples: number | null
  /** Mean of the per-run marginal cost over the qualified runs that carry one. */
  marginal_wall_ms_per_test: number | null
  /** Qualified runs inside the window that recorded a marginal-cost sample. */
  marginal_samples: number
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function parseSeriesEntry(value: unknown): FastWallSeriesEntry | null {
  if (
    !isRecord(value) ||
    (value.schema_version !== 1 &&
      value.schema_version !== 2 &&
      value.schema_version !== 3) ||
    typeof value.recorded_at !== 'string' ||
    !finiteNumber(value.wall_clock_ms) ||
    !finiteNumber(value.wrapper_wall_clock_ms) ||
    !finiteNumber(value.wrapper_overhead_ms) ||
    !nonNegativeInteger(value.test_count) ||
    !nonNegativeInteger(value.worker_count) ||
    !finiteNumber(value.load_average) ||
    typeof value.workspace_fingerprint !== 'string' ||
    typeof value.invoker !== 'string' ||
    typeof value.run_id !== 'string' ||
    !nonNegativeInteger(value.exit_code)
  ) {
    return null
  }

  const common = {
    recorded_at: value.recorded_at,
    wall_clock_ms: value.wall_clock_ms,
    wrapper_wall_clock_ms: value.wrapper_wall_clock_ms,
    wrapper_overhead_ms: value.wrapper_overhead_ms,
    test_count: value.test_count,
    worker_count: value.worker_count,
    load_average: value.load_average,
    workspace_fingerprint: value.workspace_fingerprint,
    invoker: value.invoker,
    run_id: value.run_id,
    exit_code: value.exit_code,
  }

  if (value.schema_version === 1) {
    return {
      schema_version: 1,
      ...common,
      cpu_count: null,
      caller_class: null,
      lane: null,
      phase: FAST_WALL_LEGACY_PHASE,
      summed_file_duration_ms: null,
    }
  }

  if (value.schema_version === 2) {
    if (
      typeof value.lane !== 'string' ||
      typeof value.phase !== 'string' ||
      value.phase.length === 0 ||
      (value.summed_file_duration_ms !== null &&
        !finiteNumber(value.summed_file_duration_ms))
    ) {
      return null
    }

    return {
      schema_version: 2,
      ...common,
      cpu_count: null,
      caller_class: null,
      lane: value.lane,
      phase: value.phase,
      summed_file_duration_ms: value.summed_file_duration_ms as number | null,
    }
  }

  if (
    !nonNegativeInteger(value.cpu_count) ||
    value.cpu_count === 0 ||
    !['agent', 'harness_gate', 'prefetch', 'standalone'].includes(
      String(value.caller_class),
    ) ||
    typeof value.lane !== 'string' ||
    typeof value.phase !== 'string' ||
    value.phase.length === 0 ||
    (value.summed_file_duration_ms !== null &&
      !finiteNumber(value.summed_file_duration_ms))
  ) {
    return null
  }

  return {
    schema_version: 3,
    ...common,
    cpu_count: value.cpu_count,
    caller_class: value.caller_class as FastWallCallerClass,
    lane: value.lane,
    phase: value.phase,
    summed_file_duration_ms: value.summed_file_duration_ms as number | null,
  }
}

function readUnknownJson(target: string): unknown {
  try {
    return JSON.parse(readFileSync(target, 'utf8')) as unknown
  } catch {
    return null
  }
}

export function fastWallSeriesPath(root: string): string {
  return path.join(root, FAST_WALL_SERIES_PATH)
}

export function readFastWallSeries(
  root: string,
  target = fastWallSeriesPath(root),
): FastWallSeriesRead {
  if (!fileExists(target)) {
    return { records: [], malformed_lines: 0 }
  }

  const records: FastWallSeriesEntry[] = []
  let malformedLines = 0

  for (const line of readFileSync(target, 'utf8').split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue
    }

    let value: unknown

    try {
      value = JSON.parse(line) as unknown
    } catch {
      malformedLines += 1
      continue
    }

    const parsed = parseSeriesEntry(value)

    if (parsed) {
      records.push(parsed)
    } else {
      malformedLines += 1
    }
  }

  return { records, malformed_lines: malformedLines }
}

/**
 * Whether an entry is a complete fast-lane run the governed average counts.
 * The append guard is the first defense; this check is re-applied on every
 * read, so a row another writer or an earlier build appended cannot move the
 * number a release gate reads. A run's exit code does not affect
 * qualification: a failing suite run still executes every test, so its wall
 * is a measurement of the same lane.
 */
export function qualifiesAsFastLane(entry: FastWallSeriesEntry): boolean {
  if (entry.invoker !== FAST_LANE_INVOKER) {
    return false
  }

  // Schema 1 recorded no lane. Its writer verified the complete fast lane
  // before appending under the `test` invoker, and every other row that
  // writer produced carries a different invoker.
  return entry.schema_version === 1 || entry.lane === FAST_LANE
}

/** Whether a complete-lane row belongs to the governed advisory population. */
export function qualifiesForFastWall(
  entry: FastWallSeriesEntry,
  config: FastWallConfig,
): boolean {
  return (
    qualifiesAsFastLane(entry) &&
    entry.caller_class === FAST_WALL_QUALIFIED_CALLER &&
    entry.cpu_count !== null &&
    entry.load_average / entry.cpu_count <= config.max_load_average_per_cpu
  )
}

export interface AppendFastWallInput {
  series_root: string
  workspace_fingerprint: string
  duration_record_path: string
  worker_count: number
  load_average: number
  cpu_count: number
  caller_class: FastWallCallerClass
  wrapper_wall_clock_ms: number
  invoker: string
  run_id: string
  phase: string
  exit_code: number
}

/**
 * Append one completed fast-lane run. The main `npm test` lifecycle and its
 * exact lane combination distinguish it from impacted subsets that happen to
 * select at least one file from every fast lane. The summed per-file time
 * counts only the files this run measured: the duration record accumulates
 * files across runs, and each file it kept from an earlier run carries that
 * run's timestamp.
 */
export function appendFastWallRun(
  input: AppendFastWallInput,
): FastWallSeriesEntry | null {
  const duration = parseFileDurationRecord(
    readUnknownJson(input.duration_record_path),
  )

  if (
    !duration ||
    duration.lane !== FAST_LANE ||
    input.invoker !== FAST_LANE_INVOKER
  ) {
    return null
  }

  if (
    !Number.isInteger(input.worker_count) ||
    input.worker_count <= 0 ||
    !finiteNumber(input.load_average) ||
    !Number.isInteger(input.cpu_count) ||
    input.cpu_count <= 0 ||
    !['agent', 'harness_gate', 'prefetch', 'standalone'].includes(
      input.caller_class,
    ) ||
    !finiteNumber(input.wrapper_wall_clock_ms) ||
    input.wrapper_wall_clock_ms < 0 ||
    !Number.isInteger(input.exit_code) ||
    input.exit_code < 0 ||
    input.workspace_fingerprint.trim().length === 0 ||
    input.run_id.trim().length === 0 ||
    input.phase.trim().length === 0
  ) {
    throw new PanError('Invalid fast-wall runner measurement.', {
      code: 'INVALID_FAST_WALL_MEASUREMENT',
    })
  }

  const measuredFiles = duration.files.filter(
    (entry) =>
      (entry.recorded_at ?? duration.recorded_at) === duration.recorded_at,
  )
  const entry: FastWallSeriesEntry = {
    schema_version: 3,
    recorded_at: new Date().toISOString(),
    wall_clock_ms: duration.wall_clock_ms,
    wrapper_wall_clock_ms: input.wrapper_wall_clock_ms,
    wrapper_overhead_ms: Math.max(
      0,
      input.wrapper_wall_clock_ms - duration.wall_clock_ms,
    ),
    test_count: duration.test_count,
    worker_count: input.worker_count,
    load_average: input.load_average,
    cpu_count: input.cpu_count,
    caller_class: input.caller_class,
    workspace_fingerprint: input.workspace_fingerprint,
    invoker: input.invoker,
    run_id: input.run_id,
    exit_code: input.exit_code,
    lane: duration.lane,
    phase: input.phase,
    summed_file_duration_ms:
      measuredFiles.length === 0
        ? null
        : measuredFiles.reduce((total, file) => total + file.duration_ms, 0),
  }
  const target = fastWallSeriesPath(input.series_root)

  mkdirSync(path.dirname(target), { recursive: true })
  appendFileSync(target, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    flag: 'a',
  })

  return entry
}

function utcDate(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00.000Z`)

  if (!Number.isFinite(parsed)) {
    throw new PanError(`Invalid fast-wall anchor date: ${value}`, {
      code: 'INVALID_PROJECT_CONFIG',
    })
  }

  return parsed
}

/** Ceiling on a date, with no decrease before the configured anchor. */
export function permittedFastWallCeiling(
  config: FastWallConfig,
  at: Date,
): number {
  const elapsedWeeks = Math.max(
    0,
    Math.floor((at.getTime() - utcDate(config.anchor_date)) / WEEK_MS),
  )

  return config.ceiling_ms + elapsedWeeks * config.weekly_allowance_ms
}

function insideWindow(
  records: FastWallSeriesEntry[],
  at: Date,
): FastWallSeriesEntry[] {
  const start = at.getTime() - DAY_MS

  return records.filter((entry) => {
    const timestamp = Date.parse(entry.recorded_at)

    return timestamp >= start && timestamp <= at.getTime()
  })
}

function mean(values: number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length
}

export function rollingFastWallAverage(
  records: FastWallSeriesEntry[],
  at: Date,
): number | null {
  return mean(insideWindow(records, at).map((entry) => entry.wall_clock_ms))
}

/**
 * The wall one average test adds to this run under the runner's concurrency:
 * the summed per-file test time divided by the worker count and the test
 * count. The wall of a balanced run is its fixed floor plus that summed time
 * spread over the workers, so this ratio is the slope of wall against test
 * count for the run itself, measured from its own durations rather than
 * fitted across runs whose test counts barely differ.
 */
export function marginalFastWallCost(
  entry: Pick<
    FastWallSeriesEntry,
    'summed_file_duration_ms' | 'worker_count' | 'test_count'
  >,
): number | null {
  if (
    entry.summed_file_duration_ms === null ||
    entry.worker_count === 0 ||
    entry.test_count === 0
  ) {
    return null
  }

  return entry.summed_file_duration_ms / (entry.worker_count * entry.test_count)
}

/** Mean per-run marginal cost over the entries that carry a sample. */
export function rollingMarginalFastWallCost(
  records: FastWallSeriesEntry[],
  at: Date,
): { value: number | null; samples: number } {
  const samples = insideWindow(records, at)
    .map((entry) => marginalFastWallCost(entry))
    .filter((value): value is number => value !== null)

  return { value: mean(samples), samples: samples.length }
}

function fastWallConfig(root: string): FastWallConfig {
  const config = loadProjectConfig(root).fast_wall

  if (!config) {
    throw new PanError(
      'config.json.fast_wall is required for self-development wall governance.',
      { code: 'FAST_WALL_NOT_CONFIGURED' },
    )
  }

  return config
}

/**
 * The governed report. Every number describes the same population: the
 * qualified complete fast-lane runs recorded inside the trailing 24 hours.
 */
export function buildFastWallReport(
  root: string,
  at = new Date(),
): FastWallReport {
  const windowStart = at.getTime() - DAY_MS

  if (!isSelfDevelopmentInstallation(root)) {
    return {
      status: 'not_applicable',
      series_path: FAST_WALL_SERIES_PATH,
      recorded_runs: 0,
      unqualified_runs: 0,
      malformed_lines: 0,
      window_started_at: new Date(windowStart).toISOString(),
      evaluated_at: at.toISOString(),
      rolling_average_ms: null,
      permitted_ceiling_ms: null,
      max_load_average_per_cpu: null,
      minimum_qualified_samples: null,
      marginal_wall_ms_per_test: null,
      marginal_samples: 0,
    }
  }

  const config = fastWallConfig(root)
  const series = readFastWallSeries(root)

  const recent = insideWindow(series.records, at)
  const qualified = recent.filter((entry) =>
    qualifiesForFastWall(entry, config),
  )

  const average = rollingFastWallAverage(qualified, at)
  const permitted = permittedFastWallCeiling(config, at)
  const marginal = rollingMarginalFastWallCost(qualified, at)

  return {
    status:
      qualified.length < config.minimum_qualified_samples
        ? 'insufficient_samples'
        : average !== null && average > permitted
          ? 'failed'
          : 'passed',
    series_path: FAST_WALL_SERIES_PATH,
    recorded_runs: qualified.length,
    unqualified_runs: recent.length - qualified.length,
    malformed_lines: series.malformed_lines,
    window_started_at: new Date(windowStart).toISOString(),
    evaluated_at: at.toISOString(),
    rolling_average_ms: average,
    permitted_ceiling_ms: permitted,
    max_load_average_per_cpu: config.max_load_average_per_cpu,
    minimum_qualified_samples: config.minimum_qualified_samples,
    marginal_wall_ms_per_test: marginal.value,
    marginal_samples: marginal.samples,
  }
}

function seconds(value: number): string {
  return `${(value / 1000).toFixed(1)}s`
}

export function formatFastWallReport(report: FastWallReport): string {
  if (report.status === 'not_applicable') {
    return 'Fast wall: not applicable outside self-development; PASS.'
  }

  const average =
    report.rolling_average_ms === null
      ? 'no qualifying runs'
      : `${seconds(report.rolling_average_ms)} rolling 24h average across ` +
        `${report.recorded_runs} runs`
  const ignored =
    report.unqualified_runs > 0
      ? ` (${report.unqualified_runs} unqualified rows ignored)`
      : ''

  const permitted = seconds(report.permitted_ceiling_ms ?? 0)
  const marginal =
    report.marginal_wall_ms_per_test === null
      ? 'unavailable'
      : `${report.marginal_wall_ms_per_test.toFixed(3)}ms/test across ` +
        `${report.marginal_samples} runs`

  const verdict =
    report.status === 'insufficient_samples'
      ? `INSUFFICIENT SAMPLES (${report.recorded_runs}/${report.minimum_qualified_samples}); ADVISORY.`
      : report.status === 'passed'
        ? 'PASS.'
        : 'FAIL; advisory only. Operator action: run /pan-tune-harness to review the suite and ceiling.'

  return (
    `Fast wall: ${average}${ignored}; permitted ${permitted}; ` +
    `marginal ${marginal}; ${verdict}`
  )
}

function point(entry: FastWallSeriesEntry): FastWallStagePoint {
  return {
    recorded_at: entry.recorded_at,
    wall_clock_ms: entry.wall_clock_ms,
    test_count: entry.test_count,
    worker_count: entry.worker_count,
    phase: entry.phase,
    marginal_wall_ms_per_test: marginalFastWallCost(entry),
  }
}

function latest(
  records: FastWallSeriesEntry[],
): FastWallSeriesEntry | undefined {
  return [...records]
    .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at))
    .at(-1)
}

/**
 * The fast-lane measurements that bracket a run's implementation stage, each
 * selected by the phase that produced it rather than by position.
 *
 * The before point is the run's `fast` baseline. A run adopts a baseline
 * another run captured at the same workspace fingerprint, and a cohort shares
 * one across its chunk runs, so the point is the baseline-phase record at the
 * fingerprint the run's baseline pointer names, whichever run recorded it.
 * The after point is the latest record this run produced in any later phase:
 * an implement-stage gate, or the agent's own recorded pass when that pass
 * satisfied the gate from the cache. A legacy record names no phase, so it
 * can bracket nothing.
 */
export function buildFastWallStageSummary(
  root: string,
  state: Pick<RunState, 'run_id' | 'repository_check_baselines'>,
): FastWallStageSummary | null {
  const records = readFastWallSeries(root).records.filter(qualifiesAsFastLane)
  const baselineFingerprint =
    state.repository_check_baselines?.fast?.workspace_fingerprint ?? null
  const before = baselineFingerprint
    ? latest(
        records.filter(
          (entry) =>
            entry.phase === FAST_WALL_BASELINE_PHASE &&
            entry.workspace_fingerprint === baselineFingerprint,
        ),
      )
    : undefined
  const after = latest(
    records.filter(
      (entry) =>
        entry.run_id === state.run_id &&
        entry.phase !== FAST_WALL_BASELINE_PHASE &&
        entry.phase !== FAST_WALL_LEGACY_PHASE,
    ),
  )

  if (!before && !after) {
    return null
  }

  return {
    series_path: FAST_WALL_SERIES_PATH,
    before: before ? point(before) : null,
    after: after ? point(after) : null,
  }
}
