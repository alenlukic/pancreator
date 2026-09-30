/** The before/after benchmark session. */

import { rmSync } from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import { gitWorkspaceSnapshot } from '../git.js'
import { resolveInside, writeJsonAtomic } from '../io.js'
import { loadSuiteProfile, TEST_PROFILE_ENV } from '../suite-profile.js'
import { runRepositoryCheck } from '../repository-checks/runner.js'

export const BENCHMARK_SESSION_ROOT = 'runtime/benchmarks'

const BENCHMARK_RUNS_PER_SIDE = 3

export interface BenchmarkSample {
  workspace: string
  workspace_fingerprint: string
  final_workspace_fingerprint: string
  profile: string
  test_count: number
  test_population: string[]
  wall_clock_ms: number[]
  average_wall_clock_ms: number
  results: Array<'passed' | 'failed' | 'not_configured'>
}

/**
 * One side of a benchmark, or the reason it has no usable sample.
 *
 * A crashed profile, an unstable test population, and a missing wall-clock
 * reading are three different answers to "why is there no number", and the
 * record exists to make a comparison legible rather than to report one word
 * for all three.
 */
export type BenchmarkCapture =
  | { sample: BenchmarkSample }
  | { sample: null; reason: string }

export interface BenchmarkSessionRecord {
  schema_version: 1
  session_id: string
  recorded_at: string
  population_tolerance: number
  baseline: BenchmarkSample | null
  candidate: BenchmarkSample | null
  comparison:
    | {
        status: 'compared'
        population_delta: number
        average_wall_clock_ms_delta: number
      }
    | {
        status: 'refused'
        population_delta: number | null
        reason: string
      }
}

function populationDelta(
  baseline: readonly string[],
  candidate: readonly string[],
): number {
  const before = new Set(baseline)
  const after = new Set(candidate)

  return (
    [...before].filter((identity) => !after.has(identity)).length +
    [...after].filter((identity) => !before.has(identity)).length
  )
}

/** Pair both benchmark sides before reporting a performance comparison. */
export function buildBenchmarkSessionRecord(options: {
  session_id: string
  population_tolerance: number
  baseline: BenchmarkSample | null
  candidate: BenchmarkSample | null
  baseline_reason?: string
  candidate_reason?: string
  recorded_at?: string
}): BenchmarkSessionRecord {
  if (
    !Number.isInteger(options.population_tolerance) ||
    options.population_tolerance < 0
  ) {
    throw new PanError('population_tolerance MUST be a non-negative integer', {
      code: 'INVALID_BENCHMARK_SESSION',
    })
  }

  const { baseline, candidate } = options
  const common = {
    schema_version: 1 as const,
    session_id: options.session_id,
    recorded_at: options.recorded_at ?? new Date().toISOString(),
    population_tolerance: options.population_tolerance,
    baseline,
    candidate,
  }

  if (!baseline || !candidate) {
    return {
      ...common,
      comparison: {
        status: 'refused',
        population_delta: null,
        reason: !baseline
          ? `The benchmark session has no baseline sample. ${
              options.baseline_reason ?? 'No reason was recorded.'
            }`
          : `The benchmark session has no candidate sample. ${
              options.candidate_reason ?? 'No reason was recorded.'
            }`,
      },
    }
  }

  if (
    baseline.workspace_fingerprint !== baseline.final_workspace_fingerprint ||
    candidate.workspace_fingerprint !== candidate.final_workspace_fingerprint
  ) {
    return {
      ...common,
      comparison: {
        status: 'refused',
        population_delta: null,
        reason: 'A benchmark workspace changed while its sample was captured.',
      },
    }
  }

  if (
    baseline.results.some((result) => result !== 'passed') ||
    candidate.results.some((result) => result !== 'passed')
  ) {
    return {
      ...common,
      comparison: {
        status: 'refused',
        population_delta: null,
        reason: 'A benchmark side did not pass every profile execution.',
      },
    }
  }

  const delta = populationDelta(
    baseline.test_population,
    candidate.test_population,
  )

  if (delta > options.population_tolerance) {
    return {
      ...common,
      comparison: {
        status: 'refused',
        population_delta: delta,
        reason:
          `The test populations differ by ${delta}, above the declared ` +
          `tolerance ${options.population_tolerance}.`,
      },
    }
  }

  return {
    ...common,
    comparison: {
      status: 'compared',
      population_delta: delta,
      average_wall_clock_ms_delta:
        candidate.average_wall_clock_ms - baseline.average_wall_clock_ms,
    },
  }
}

function benchmarkPopulation(
  profile: NonNullable<ReturnType<typeof loadSuiteProfile>>,
): string[] {
  return (profile.all_tests ?? profile.slowest_tests)
    .map((entry) => `${entry.file}::${entry.name}`)
    .sort()
}

function captureBenchmarkSample(
  root: string,
  sessionId: string,
  side: 'baseline' | 'candidate',
  workspace: string,
  profileName: string,
): BenchmarkCapture {
  const absoluteWorkspace = resolveInside(root, workspace)
  const fingerprint = gitWorkspaceSnapshot(absoluteWorkspace).fingerprint

  const populations: string[][] = []
  const wallClock: number[] = []
  const results: BenchmarkSample['results'] = []

  for (let attempt = 1; attempt <= BENCHMARK_RUNS_PER_SIDE; attempt += 1) {
    const profilePath = path.join(
      root,
      BENCHMARK_SESSION_ROOT,
      `${sessionId}-${side}-${attempt}.profile.json`,
    )
    const result = runRepositoryCheck(root, profileName, {
      workspace: absoluteWorkspace,
      env: { [TEST_PROFILE_ENV]: profilePath },
    })
    const profile = loadSuiteProfile(
      root,
      path.relative(root, profilePath).split(path.sep).join('/'),
    )

    results.push(result.status)

    if (profile) {
      populations.push(benchmarkPopulation(profile))
      wallClock.push(profile.wall_clock_ms)
    }

    rmSync(profilePath, { force: true })
  }

  if (populations.length !== BENCHMARK_RUNS_PER_SIDE) {
    return {
      sample: null,
      reason:
        `Only ${populations.length} of ${BENCHMARK_RUNS_PER_SIDE} ` +
        `${side} runs produced a suite profile; the profile statuses were ` +
        `${results.join(', ')}.`,
    }
  }

  const firstPopulation = populations[0] ?? []
  const stablePopulation = populations.every(
    (population) => populationDelta(firstPopulation, population) === 0,
  )

  if (!stablePopulation) {
    return {
      sample: null,
      reason:
        `The ${side} test population changed between its ` +
        `${BENCHMARK_RUNS_PER_SIDE} runs, so the side measures more than ` +
        'one suite.',
    }
  }

  if (wallClock.length !== BENCHMARK_RUNS_PER_SIDE) {
    return {
      sample: null,
      reason: `A ${side} run reported no wall-clock reading.`,
    }
  }

  return {
    sample: {
      workspace,
      workspace_fingerprint: fingerprint,
      final_workspace_fingerprint:
        gitWorkspaceSnapshot(absoluteWorkspace).fingerprint,
      profile: profileName,
      test_count: firstPopulation.length,
      test_population: firstPopulation,
      wall_clock_ms: wallClock,
      average_wall_clock_ms:
        wallClock.reduce((total, value) => total + value, 0) / wallClock.length,
      results,
    },
  }
}

/**
 * Benchmarks the baseline and candidate workspaces by running the
 * repository-check profile (fast by default) a fixed number of times on each
 * side, compares their test populations and average wall clock, and writes
 * the session record under `runtime/benchmarks/` (or `output_path`). A side
 * whose runs produce no stable suite profile is recorded with its reason
 * instead of a sample.
 */
export function runBenchmarkSession(options: {
  root: string
  baseline_workspace: string
  candidate_workspace: string
  population_tolerance: number
  profile?: string
  output_path?: string
}): { record: BenchmarkSessionRecord; output_path: string } {
  const sessionId = `benchmark-${Date.now()}`
  const profile = options.profile ?? 'fast'

  const baseline = captureBenchmarkSample(
    options.root,
    sessionId,
    'baseline',
    options.baseline_workspace,
    profile,
  )
  const candidate = captureBenchmarkSample(
    options.root,
    sessionId,
    'candidate',
    options.candidate_workspace,
    profile,
  )

  const record = buildBenchmarkSessionRecord({
    session_id: sessionId,
    population_tolerance: options.population_tolerance,
    baseline: baseline.sample,
    candidate: candidate.sample,
    ...(baseline.sample === null ? { baseline_reason: baseline.reason } : {}),
    ...(candidate.sample === null
      ? { candidate_reason: candidate.reason }
      : {}),
  })
  const outputPath =
    options.output_path ?? `${BENCHMARK_SESSION_ROOT}/${sessionId}.json`

  writeJsonAtomic(resolveInside(options.root, outputPath), record)

  return { record, output_path: outputPath }
}
