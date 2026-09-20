import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  appendFastWallRun,
  buildFastWallReport,
  buildFastWallStageSummary,
  fastWallSeriesPath,
  marginalFastWallCost,
  permittedFastWallCeiling,
  qualifiesAsFastLane,
  readFastWallSeries,
  rollingFastWallAverage,
  rollingMarginalFastWallCost,
  type FastWallSeriesEntry,
} from '../../src/lib/fast-wall-series.js'
import { createTestTempDirectory } from '../temp.js'

const FAST_LANE = 'integration+regression+unit'

function entry(
  recordedAt: string,
  wallClockMs: number,
  testCount: number,
  overrides: Partial<FastWallSeriesEntry> = {},
): FastWallSeriesEntry {
  return {
    schema_version: 3,
    recorded_at: recordedAt,
    wall_clock_ms: wallClockMs,
    wrapper_wall_clock_ms: wallClockMs + 10,
    wrapper_overhead_ms: 10,
    test_count: testCount,
    worker_count: 13,
    load_average: 4,
    cpu_count: 16,
    caller_class: 'harness_gate',
    workspace_fingerprint: 'fingerprint',
    invoker: 'test',
    run_id: 'run-one',
    exit_code: 0,
    lane: FAST_LANE,
    phase: 'implement.unit_tests',
    summed_file_duration_ms: wallClockMs * 13,
    ...overrides,
  }
}

/** A schema-1 row as the first writer appended it: no lane, phase, or sum. */
function legacyRow(
  recordedAt: string,
  wallClockMs: number,
  testCount: number,
  invoker: string,
): Record<string, unknown> {
  const {
    lane: _lane,
    phase: _phase,
    summed_file_duration_ms: _summed,
    cpu_count: _cpuCount,
    caller_class: _callerClass,
    ...rest
  } = entry(recordedAt, wallClockMs, testCount, { invoker })

  return { ...rest, schema_version: 1 }
}

function writeSeries(root: string, rows: unknown[]): void {
  const target = fastWallSeriesPath(root)

  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(
    target,
    rows
      .map((row) => (typeof row === 'string' ? row : JSON.stringify(row)))
      .concat('')
      .join('\n'),
  )
}

function selfDevelopmentRoot(): string {
  const root = createTestTempDirectory('pancreator-fast-wall-self-')

  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({
      schema_version: 1,
      installation_mode: 'self_development',
      fast_wall: {
        ceiling_ms: 120_000,
        anchor_date: '2026-09-14',
        weekly_allowance_ms: 1000,
        max_load_average_per_cpu: 1,
        minimum_qualified_samples: 2,
      },
    }),
  )

  return root
}

test('fast-wall dates govern the rolling mean and weekly allowance', () => {
  const config = {
    ceiling_ms: 120_000,
    anchor_date: '2026-09-14',
    weekly_allowance_ms: 1000,
    max_load_average_per_cpu: 1,
    minimum_qualified_samples: 2,
  }

  assert.equal(
    permittedFastWallCeiling(config, new Date('2026-09-01T12:00:00.000Z')),
    120_000,
  )
  assert.equal(
    permittedFastWallCeiling(config, new Date('2026-09-14T12:00:00.000Z')),
    120_000,
  )
  assert.equal(
    permittedFastWallCeiling(config, new Date('2026-09-28T12:00:00.000Z')),
    122_000,
  )

  const at = new Date('2026-09-15T12:00:00.000Z')
  const records = [
    entry('2026-09-14T11:59:59.999Z', 10, 100),
    entry('2026-09-14T12:00:00.000Z', 100, 100),
    entry('2026-09-15T11:59:59.999Z', 200, 100),
    entry('2026-09-15T12:00:00.001Z', 1000, 100),
  ]

  assert.equal(rollingFastWallAverage([], at), null)
  assert.equal(rollingFastWallAverage(records, at), 150)
})

test('fast-wall governance is inert outside self-development', () => {
  const root = createTestTempDirectory('pancreator-fast-wall-target-')

  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({ schema_version: 1, installation_mode: 'embedded' }),
  )
  const report = buildFastWallReport(root, new Date('2026-09-15T12:00:00.000Z'))

  assert.equal(report.status, 'not_applicable')
  assert.equal(report.rolling_average_ms, null)
  assert.equal(report.permitted_ceiling_ms, null)
})

test('fast-wall series reads both schemas and ignores malformed lines', () => {
  const root = createTestTempDirectory('pancreator-fast-wall-read-')

  writeSeries(root, [
    legacyRow('2026-09-15T00:00:00.000Z', 1000, 100, 'test'),
    '{ malformed',
    { ...entry('2026-09-15T00:01:00.000Z', 1150, 110), phase: '' },
    entry('2026-09-15T00:02:00.000Z', 1300, 120),
  ])

  const series = readFastWallSeries(root)

  assert.equal(series.records.length, 2)
  assert.equal(series.malformed_lines, 2)
  assert.deepEqual(
    series.records.map((record) => [
      record.schema_version,
      record.lane,
      record.phase,
      record.summed_file_duration_ms,
    ]),
    [
      [1, null, 'legacy', null],
      [3, FAST_LANE, 'implement.unit_tests', 1300 * 13],
    ],
  )
})

test('marginal cost is the summed file time per worker per test, within one run', () => {
  const at = new Date('2026-09-15T12:00:00.000Z')
  // 1314 tests whose files summed to 1714 s across 13 workers cost about
  // 100 ms of wall each; the arithmetic is the definition, not a fit.
  const measured = entry('2026-09-15T08:00:00.000Z', 113_246, 1314, {
    summed_file_duration_ms: 1_714_234,
  })

  assert.equal(marginalFastWallCost(measured), 1_714_234 / (13 * 1314))
  assert.equal(
    marginalFastWallCost({ ...measured, summed_file_duration_ms: null }),
    null,
  )
  assert.equal(marginalFastWallCost({ ...measured, test_count: 0 }), null)

  // Two runs at the same test count under different load agree on the
  // marginal cost only through their own sums; a legacy row contributes none.
  const rolling = rollingMarginalFastWallCost(
    [
      entry('2026-09-15T08:00:00.000Z', 130_000, 1300, {
        summed_file_duration_ms: 13 * 1300 * 100,
      }),
      entry('2026-09-15T09:00:00.000Z', 150_000, 1300, {
        summed_file_duration_ms: 13 * 1300 * 120,
        load_average: 27,
      }),
      entry('2026-09-15T10:00:00.000Z', 140_000, 1300, {
        schema_version: 2,
        cpu_count: null,
        caller_class: null,
        summed_file_duration_ms: null,
      }),
    ],
    at,
  )

  assert.deepEqual(rolling, { value: 110, samples: 2 })
})

test('the report counts only complete fast-lane rows in one window population', () => {
  const root = selfDevelopmentRoot()
  const at = new Date('2026-09-15T12:00:00.000Z')

  writeSeries(root, [
    // The contaminant the first series carried: a 244-test partial run that
    // an earlier build appended under a manual invoker.
    legacyRow('2026-09-15T06:58:59.819Z', 36_789, 244, 'manual'),
    // A quiet harness-gate run in the qualified population.
    entry('2026-09-15T07:00:00.000Z', 139_000, 1305),
    // A schema-2 row from a lane subset, and one from a failed complete run.
    entry('2026-09-15T08:00:00.000Z', 20_000, 200, {
      lane: 'unit',
      summed_file_duration_ms: 20_000 * 13,
    }),
    entry('2026-09-15T09:00:00.000Z', 135_000, 1314, {
      exit_code: 1,
      summed_file_duration_ms: 13 * 1314 * 100,
    }),
    // Outside the window.
    entry('2026-09-14T09:00:00.000Z', 50_000, 1314),
  ])

  const report = buildFastWallReport(root, at)

  assert.equal(report.status, 'failed')
  assert.equal(report.recorded_runs, 2)
  assert.equal(report.unqualified_runs, 2)
  assert.equal(report.rolling_average_ms, 137_000)
  assert.equal(report.permitted_ceiling_ms, 120_000)
  assert.equal(report.marginal_wall_ms_per_test, (139_000 / 1305 + 100) / 2)
  assert.equal(report.marginal_samples, 2)
  assert.equal(
    qualifiesAsFastLane(
      entry('2026-09-15T09:00:00.000Z', 1, 1, { invoker: 'manual' }),
    ),
    false,
  )
})

test('the report excludes contended and non-gate samples and requires a minimum population', () => {
  const root = selfDevelopmentRoot()
  const at = new Date('2026-09-15T12:00:00.000Z')

  writeSeries(root, [
    entry('2026-09-15T08:00:00.000Z', 100_000, 1000, {
      load_average: 8,
      cpu_count: 16,
    }),
    entry('2026-09-15T09:00:00.000Z', 300_000, 1000, {
      load_average: 20,
      cpu_count: 16,
    }),
    entry('2026-09-15T10:00:00.000Z', 300_000, 1000, {
      caller_class: 'agent',
    }),
  ])

  const insufficient = buildFastWallReport(root, at)

  assert.equal(insufficient.status, 'insufficient_samples')
  assert.equal(insufficient.recorded_runs, 1)
  assert.equal(insufficient.unqualified_runs, 2)
  assert.equal(insufficient.rolling_average_ms, 100_000)
  assert.equal(insufficient.max_load_average_per_cpu, 1)
  assert.equal(insufficient.minimum_qualified_samples, 2)

  writeSeries(root, [
    entry('2026-09-15T08:00:00.000Z', 100_000, 1000),
    entry('2026-09-15T09:00:00.000Z', 130_000, 1000),
  ])
  assert.equal(buildFastWallReport(root, at).status, 'passed')
})

test('the stage summary selects the baseline and later phases by provenance', () => {
  const root = createTestTempDirectory('pancreator-fast-wall-stage-')

  writeSeries(root, [
    // The shared baseline another run captured at the adopted fingerprint.
    entry('2026-09-15T00:30:00.000Z', 1000, 100, {
      run_id: 'capturing-run',
      phase: 'baseline',
      workspace_fingerprint: 'baseline-fingerprint',
    }),
    // A baseline at a different fingerprint, and a later baseline that is
    // not this run's.
    entry('2026-09-15T00:40:00.000Z', 900, 100, {
      run_id: 'other-run',
      phase: 'baseline',
      workspace_fingerprint: 'other-fingerprint',
    }),
    // This run: an earlier agent pass, then the implement gate. A legacy row
    // recorded later than both names no phase and brackets nothing.
    entry('2026-09-15T01:00:00.000Z', 1100, 101, { phase: 'agent' }),
    entry('2026-09-15T02:00:00.000Z', 1200, 102),
    legacyRow('2026-09-15T03:00:00.000Z', 5000, 102, 'test'),
    // A partial lane row for this run never qualifies.
    entry('2026-09-15T04:00:00.000Z', 100, 5, { lane: 'unit' }),
  ])

  const state = {
    run_id: 'run-one',
    repository_check_baselines: {
      fast: {
        profile: 'fast',
        status: 'passed' as const,
        artifact_path: 'baseline.json',
        workspace_fingerprint: 'baseline-fingerprint',
        recorded_at: '2026-09-15T00:30:00.000Z',
      },
    },
  }

  assert.deepEqual(buildFastWallStageSummary(root, state), {
    series_path: 'runtime/fast-wall-series.jsonl',
    before: {
      recorded_at: '2026-09-15T00:30:00.000Z',
      wall_clock_ms: 1000,
      test_count: 100,
      worker_count: 13,
      phase: 'baseline',
      // The helper sums 13 ms of file time per wall millisecond over 13
      // workers, so each point's marginal cost is its wall over its tests.
      marginal_wall_ms_per_test: 10,
    },
    after: {
      recorded_at: '2026-09-15T02:00:00.000Z',
      wall_clock_ms: 1200,
      test_count: 102,
      worker_count: 13,
      phase: 'implement.unit_tests',
      marginal_wall_ms_per_test: 1200 / 102,
    },
  })
  assert.deepEqual(
    buildFastWallStageSummary(root, { run_id: 'run-one' })?.before,
    null,
  )
  assert.equal(
    buildFastWallStageSummary(root, {
      run_id: 'unseen-run',
      repository_check_baselines: {
        fast: {
          ...state.repository_check_baselines.fast,
          workspace_fingerprint: 'unseen',
        },
      },
    }),
    null,
  )
})

test('a completed fast lane appends one runner measurement with its context', () => {
  const seriesRoot = createTestTempDirectory('pancreator-fast-wall-series-')
  const durationRoot = createTestTempDirectory('pancreator-fast-wall-duration-')
  const durationRecord = path.join(durationRoot, 'duration.json')
  const measurement = {
    series_root: seriesRoot,
    workspace_fingerprint: 'fingerprint-one',
    duration_record_path: durationRecord,
    worker_count: 13,
    load_average: 8.25,
    cpu_count: 16,
    caller_class: 'harness_gate' as const,
    wrapper_wall_clock_ms: 120_450,
    invoker: 'test',
    run_id: 'run-one',
    phase: 'implement.unit_tests',
    exit_code: 0,
  }

  writeFileSync(
    durationRecord,
    JSON.stringify({
      schema_version: 1,
      recorded_at: '2026-09-15T08:00:00.000Z',
      lane: FAST_LANE,
      wall_clock_ms: 120_000,
      test_count: 1305,
      files: [
        { file: 'dist/tests/unit/a.test.js', duration_ms: 700_000 },
        {
          file: 'dist/tests/integration/b.test.js',
          duration_ms: 800_000,
          recorded_at: '2026-09-15T08:00:00.000Z',
        },
        // Kept from an earlier run by the merge; not part of this run's sum.
        {
          file: 'dist/tests/integration/removed.test.js',
          duration_ms: 999_999,
          recorded_at: '2026-09-14T08:00:00.000Z',
        },
      ],
    }),
  )

  const appended = appendFastWallRun(measurement)

  assert.ok(appended)
  assert.match(appended.recorded_at, /^\d{4}-\d{2}-\d{2}T/u)
  assert.equal(appended.schema_version, 3)
  assert.equal(appended.wall_clock_ms, 120_000)
  assert.equal(appended.wrapper_overhead_ms, 450)
  assert.equal(appended.test_count, 1305)
  assert.equal(appended.worker_count, 13)
  assert.equal(appended.load_average, 8.25)
  assert.equal(appended.cpu_count, 16)
  assert.equal(appended.caller_class, 'harness_gate')
  assert.equal(appended.workspace_fingerprint, 'fingerprint-one')
  assert.equal(appended.invoker, 'test')
  assert.equal(appended.lane, FAST_LANE)
  assert.equal(appended.phase, 'implement.unit_tests')
  assert.equal(appended.summed_file_duration_ms, 1_500_000)
  assert.deepEqual(readFastWallSeries(seriesRoot).records, [appended])

  assert.equal(appendFastWallRun({ ...measurement, invoker: 'manual' }), null)
  assert.throws(
    () => appendFastWallRun({ ...measurement, worker_count: 0 }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code ===
        'INVALID_FAST_WALL_MEASUREMENT',
  )

  writeFileSync(
    durationRecord,
    JSON.stringify({
      schema_version: 1,
      recorded_at: '2026-09-15T08:05:00.000Z',
      lane: 'unit',
      wall_clock_ms: 10,
      test_count: 1,
      files: [],
    }),
  )

  assert.equal(
    appendFastWallRun({ ...measurement, wrapper_wall_clock_ms: 20 }),
    null,
  )
  assert.equal(readFastWallSeries(seriesRoot).records.length, 1)
})
