import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { getRunState } from '../../src/lib/engine.js'
import { FAST_LANE } from '../../src/lib/fast-wall-series.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import type { Invocation, RunState, StageOutput } from '../../src/lib/types.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../fixture-template.js'
import { checkpoint, prepareCheckpointRun } from './delivery-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function configureFastWall(root: string): void {
  const target = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(target, 'utf8')) as Record<
    string,
    unknown
  >

  config.fast_wall = {
    ceiling_ms: 100,
    anchor_date: new Date().toISOString().slice(0, 10),
    weekly_allowance_ms: 0,
  }
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`)
}

interface SeriesRow {
  recorded_at?: string
  wall_clock_ms: number
  test_count?: number
  run_id?: string
  phase?: string
  workspace_fingerprint?: string
  summed_file_duration_ms?: number
}

function seriesRow(row: SeriesRow): string {
  return JSON.stringify({
    schema_version: 2,
    recorded_at: new Date().toISOString(),
    wrapper_wall_clock_ms: row.wall_clock_ms + 10,
    wrapper_overhead_ms: 10,
    test_count: 10,
    worker_count: 13,
    load_average: 4.5,
    workspace_fingerprint: 'fingerprint',
    invoker: 'test',
    run_id: 'run-one',
    exit_code: 0,
    lane: FAST_LANE,
    phase: 'standalone',
    summed_file_duration_ms: row.wall_clock_ms * 13,
    ...row,
  })
}

function writeSeries(root: string, rows: SeriesRow[]): void {
  const target = path.join(root, 'runtime', 'fast-wall-series.jsonl')

  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${rows.map(seriesRow).join('\n')}\n`)
}

function runWall(root: string) {
  const {
    PANCREATOR_ROOT: _pancreatorRoot,
    PANCREATOR_EXEC_ROOT: _execRoot,
    ...env
  } = process.env

  return spawnSync(process.execPath, [CLI, 'tests', 'wall', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env,
  })
}

test('tests wall reports the average and exits with its verdict', () => {
  const root = createFixture()

  configureFastWall(root)
  writeSeries(root, [{ wall_clock_ms: 200 }])

  const failed = runWall(root)
  const failureReport = JSON.parse(failed.stdout) as {
    status: string
    rolling_average_ms: number
    permitted_ceiling_ms: number
  }

  assert.equal(failed.status, 1, failed.stderr)
  assert.equal(failureReport.status, 'failed')
  assert.equal(failureReport.rolling_average_ms, 200)
  assert.equal(failureReport.permitted_ceiling_ms, 100)

  writeSeries(root, [{ wall_clock_ms: 50 }])

  const passed = runWall(root)
  const passReport = JSON.parse(passed.stdout) as {
    status: string
    rolling_average_ms: number
    permitted_ceiling_ms: number
  }

  assert.equal(passed.status, 0, passed.stderr)
  assert.equal(passReport.status, 'passed')
  assert.equal(passReport.rolling_average_ms, 50)
  assert.equal(passReport.permitted_ceiling_ms, 100)
})

test('the hard ship criterion exposes an over-ceiling average', () => {
  const root = createFixture()

  configureFastWall(root)
  writeSeries(root, [{ wall_clock_ms: 200 }])

  for (const workflow of ['delivery', 'metacritic']) {
    const ship = stageBySlug(loadWorkflow(root, workflow), 'ship')
    const stage = {
      ...ship,
      criteria: ship.criteria.filter(
        (criterion) => criterion.id === 'ship.fast_wall_ceiling',
      ),
    }

    const snapshot = gitWorkspaceSnapshot(root)
    const evaluated = evaluateDeterministicCriteria(
      root,
      path.join(root, 'runtime', 'gate-evidence'),
      {
        run_id: 'run-one',
        workspace_root: root,
        state_root: 'runtime',
        stage_history: [],
        gate_overrides: {},
      } as unknown as RunState,
      stage,
      snapshot,
      root,
      {},
      'ship',
      { data: {} } as StageOutput,
      undefined,
      null,
      snapshot,
    )
    const result = evaluated.results.find(
      (item) => item.id === 'ship.fast_wall_ceiling',
    )

    assert.ok(result, workflow)
    assert.equal(result.hard, true, workflow)
    assert.equal(result.passed, false, workflow)
    assert.match(result.explanation ?? '', /0\.2s rolling 24h average/u)
    assert.match(result.explanation ?? '', /permitted 0\.1s/u)
  }
})

test('a prepared verify card carries the baseline and implement-gate walls', () => {
  const { root, runId, state } = checkpoint('delivery@implement-baselined')
  const baseline = state.repository_check_baselines?.fast

  assert.ok(baseline, 'the checkpoint recorded a fast baseline pointer')
  writeSeries(root, [
    // The baseline was captured by another run at the adopted fingerprint.
    // Its summed file time over 13 workers and 1300 tests is 100 ms/test.
    {
      recorded_at: '2026-09-15T01:00:00.000Z',
      wall_clock_ms: 119_000,
      test_count: 1300,
      run_id: 'capturing-run',
      phase: 'baseline',
      workspace_fingerprint: baseline.workspace_fingerprint,
      summed_file_duration_ms: 1_690_000,
    },
    // This run's implement gate, which the fast profile ran after the change,
    // at 90 ms/test over 13 workers and 1305 tests.
    {
      recorded_at: '2026-09-15T02:00:00.000Z',
      wall_clock_ms: 118_000,
      test_count: 1305,
      run_id: runId,
      phase: 'implement.unit_tests',
      summed_file_duration_ms: 1_526_850,
    },
    // Another run's later gate at the same fingerprint is not this run's.
    {
      recorded_at: '2026-09-15T03:00:00.000Z',
      wall_clock_ms: 50_000,
      test_count: 900,
      run_id: 'other-run',
      phase: 'implement.unit_tests',
    },
  ])

  const prepared = prepareCheckpointRun(root, runId)

  assert.equal(prepared.invocation?.stage.slug, 'verify')

  const pointer = getRunState(root, runId).current_invocation

  assert.ok(pointer)

  const invocation = JSON.parse(
    readFileSync(path.join(root, pointer.json_path), 'utf8'),
  ) as Invocation
  const card = readFileSync(path.join(root, pointer.markdown_path), 'utf8')

  assert.deepEqual(invocation.fast_wall, {
    series_path: 'runtime/fast-wall-series.jsonl',
    before: {
      recorded_at: '2026-09-15T01:00:00.000Z',
      wall_clock_ms: 119_000,
      test_count: 1300,
      worker_count: 13,
      phase: 'baseline',
      marginal_wall_ms_per_test: 100,
    },
    after: {
      recorded_at: '2026-09-15T02:00:00.000Z',
      wall_clock_ms: 118_000,
      test_count: 1305,
      worker_count: 13,
      phase: 'implement.unit_tests',
      marginal_wall_ms_per_test: 90,
    },
  })
  assert.match(card, /### Implement-stage fast wall/u)
  assert.match(
    card,
    /Before implement: 1300 tests in 119\.0s .*100\.000ms marginal per test/u,
  )
  assert.match(
    card,
    /After implement: 1305 tests in 118\.0s .*90\.000ms marginal per test/u,
  )
})
