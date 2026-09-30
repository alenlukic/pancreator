/** Tune session finalization and the benchmark it derives from suite profiles. */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import { gitHead, gitWorkspaceSnapshot } from '../git.js'
import { fileExists, isRecord, readJson, writeTextAtomic } from '../io.js'
import { loadSuiteProfile, type SuiteProfileTest } from '../suite-profile.js'
import {
  partitionRetainedSet,
  type TestIdentity,
  TUNE_FAST_PROFILE_FILE,
  TUNE_JUDGMENT_PROVENANCE_FILE,
  TUNE_LATEST_PATH,
  TUNE_PASSES_FILE,
  TUNE_RECORDS_DIR,
  TUNE_REPORTS_DIR,
  TUNE_SECONDARY_PROFILE_FILE,
  TUNE_VERDICTS_FILE,
  type TuneRecord,
  validatePassOverlap,
} from './record.js'
import {
  assertSelfDevelopment,
  harnessVersion,
  loadPreparedSession,
} from './inventory.js'
import { isPassInterval, validateTuneRecordShape } from './shape.js'

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Builds a tune record's benchmark from the fast and optional secondary suite
 * profiles: lane walls, summed file time, fixture costs, per-file and per-test
 * durations annotated with the prior record's figures, the 15 slowest tests,
 * and deltas against the prior record. Throws `TUNE_BENCHMARK_MISSING` when
 * the fast profile cannot be read.
 */
export function buildBenchmarkFromProfiles(
  root: string,
  fastProfilePath: string,
  secondaryProfilePath: string | null,
  prior: TuneRecord | null,
): TuneRecord['benchmark'] {
  const fast = loadSuiteProfile(root, fastProfilePath)
  const secondary = secondaryProfilePath
    ? loadSuiteProfile(root, secondaryProfilePath)
    : null

  if (!fast) {
    throw new PanError(`missing fast lane profile: ${fastProfilePath}`, {
      code: 'TUNE_BENCHMARK_MISSING',
    })
  }

  const fastFixtures = fast.fixture_cost ?? { template_ms: 0, clone_ms: 0 }
  const secondaryFixtures = secondary?.fixture_cost ?? {
    template_ms: 0,
    clone_ms: 0,
  }

  const allTests: SuiteProfileTest[] = [
    ...(fast.all_tests ?? fast.slowest_tests),
    ...(secondary?.all_tests ?? secondary?.slowest_tests ?? []),
  ]
  const priorTests = new Map<string, number>()

  if (prior) {
    for (const entry of prior.benchmark.tests) {
      priorTests.set(`${entry.file}\0${entry.name}`, entry.duration_ms)
    }
  }

  const priorFiles = new Map<string, number>()

  if (prior) {
    for (const entry of prior.benchmark.files) {
      priorFiles.set(entry.file, entry.duration_ms)
    }
  }

  const files = [...fast.files, ...(secondary?.files ?? [])].map((entry) => ({
    file: entry.file,
    duration_ms: entry.duration_ms,
    test_count: entry.test_count,
    ...(priorFiles.has(entry.file)
      ? {
          prior_duration_ms: priorFiles.get(entry.file),
        }
      : {}),
  }))

  const tests = allTests.map((entry) => ({
    file: entry.file,
    name: entry.name,
    duration_ms: entry.duration_ms,
    ...(priorTests.has(`${entry.file}\0${entry.name}`)
      ? {
          prior_duration_ms: priorTests.get(`${entry.file}\0${entry.name}`),
        }
      : {}),
  }))

  const summed_file_ms = roundMs(
    files.reduce((total, entry) => total + entry.duration_ms, 0),
  )

  // A prior record written before the lane was measured, or by a session that
  // ran no secondary lane, carries no comparable number, so the delta is
  // reported only when both sides measured the lane.
  const priorSecondaryWallMs = prior?.benchmark.secondary_lane_wall_ms
  const secondaryDelta =
    secondary && typeof priorSecondaryWallMs === 'number'
      ? roundMs(secondary.wall_clock_ms - priorSecondaryWallMs)
      : undefined

  return {
    fast_lane_wall_ms: fast.wall_clock_ms,
    secondary_lane_wall_ms: secondary?.wall_clock_ms ?? null,
    summed_file_ms,
    fixture_template_ms: roundMs(
      fastFixtures.template_ms + secondaryFixtures.template_ms,
    ),
    fixture_clone_ms: roundMs(
      fastFixtures.clone_ms + secondaryFixtures.clone_ms,
    ),
    ...(prior
      ? {
          prior_deltas: {
            fast_lane_wall_ms: roundMs(
              fast.wall_clock_ms - prior.benchmark.fast_lane_wall_ms,
            ),
            ...(secondaryDelta === undefined
              ? {}
              : { secondary_lane_wall_ms: secondaryDelta }),
            summed_file_ms: roundMs(
              summed_file_ms - (prior.benchmark.summed_file_ms ?? 0),
            ),
          },
        }
      : {}),
    files,
    tests,
    slowest_tests: [...tests]
      .sort((left, right) => right.duration_ms - left.duration_ms)
      .slice(0, 15),
  }
}

export interface FinalizeTuneSessionInput {
  session_id: string
  passes: TuneRecord['passes']
  verdicts: TuneRecord['verdicts']
  judgment_provenance: NonNullable<TuneRecord['judgment_provenance']>
  benchmark: TuneRecord['benchmark']
  current_inventory: TestIdentity[]
  retained_set: TestIdentity[]
  baseline_source: TuneRecord['baseline_source']
  prior_record: TuneRecord | null
}

export interface FinalizeTuneSessionResult {
  record_path: string
  report_path: string
  latest_path: string
}

/**
 * Validates and writes a tune session's record and ranked Markdown report
 * under `runtime/tune-harness/`, then points the latest-record pointer at
 * them, returning the three relative paths. Throws
 * `TUNE_SELF_DEVELOPMENT_ONLY`, `TUNE_PASS_OVERLAP` when the passes do not
 * overlap, `TUNE_RECORD_INVALID` on a bad shape, and `TUNE_SESSION_FINALIZED`
 * when the session was already finalized.
 */
export function finalizeTuneSession(
  root: string,
  input: FinalizeTuneSessionInput,
): FinalizeTuneSessionResult {
  assertSelfDevelopment(root)

  const snapshot = gitWorkspaceSnapshot(root)
  const comparison = partitionRetainedSet(
    input.current_inventory,
    input.retained_set,
  )

  const record: TuneRecord = {
    schema_version: 1,
    session_id: input.session_id,
    harness_version: harnessVersion(root),
    git_commit: gitHead(root) ?? 'unknown',
    workspace_fingerprint: snapshot.fingerprint,
    workspace_dirty: snapshot.entries.length > 0,
    recorded_at: new Date().toISOString(),
    ...(input.prior_record
      ? { prior_record_id: input.prior_record.session_id }
      : {}),
    baseline_source: input.baseline_source,
    passes: input.passes,
    retained_set: input.retained_set,
    current_inventory: input.current_inventory,
    comparison,
    benchmark: input.benchmark,
    verdicts: input.verdicts,
    judgment_provenance: input.judgment_provenance,
  }

  const overlapErrors = validatePassOverlap(record)

  if (overlapErrors.length > 0) {
    throw new PanError(overlapErrors.join('; '), { code: 'TUNE_PASS_OVERLAP' })
  }

  const shapeErrors = validateTuneRecordShape(record, root)

  if (shapeErrors.length > 0) {
    throw new PanError(shapeErrors.join('; '), { code: 'TUNE_RECORD_INVALID' })
  }

  const recordsDir = path.join(root, TUNE_RECORDS_DIR)
  const reportsDir = path.join(root, TUNE_REPORTS_DIR)
  mkdirSync(recordsDir, { recursive: true })
  mkdirSync(reportsDir, { recursive: true })

  const recordRelative = path.join(TUNE_RECORDS_DIR, `${input.session_id}.json`)
  const reportRelative = path.join(TUNE_REPORTS_DIR, `${input.session_id}.md`)

  const recordAbsolute = path.join(root, recordRelative)
  const reportAbsolute = path.join(root, reportRelative)
  const staging = `${recordAbsolute}.staging`

  if (fileExists(recordAbsolute) || fileExists(reportAbsolute)) {
    throw new PanError(`tune session ${input.session_id} already finalized`, {
      code: 'TUNE_SESSION_FINALIZED',
    })
  }

  writeFileSync(staging, `${JSON.stringify(record, null, 2)}\n`)
  renameSync(staging, recordAbsolute)

  const ranked = [...input.verdicts]
    .filter((entry) => entry.verdict !== 'KEEP')
    .sort(
      (left, right) =>
        (right.claimed_savings_ms ?? 0) - (left.claimed_savings_ms ?? 0),
    )

  const reportLines = [
    '# Tune harness report',
    '',
    `- Session: \`${input.session_id}\``,
    `- Record: \`${recordRelative}\``,
    `- Harness: ${record.harness_version}`,
    `- Commit: \`${record.git_commit}\``,
    '',
    '## Ranked actionable verdicts',
    '',
  ]

  if (ranked.length === 0) {
    reportLines.push('- None.')
  } else {
    for (const entry of ranked) {
      reportLines.push(
        `- **${entry.verdict}** \`${entry.identity.file}\` :: ${entry.identity.name} — ${entry.principle}: ${entry.rationale}` +
          (entry.claimed_savings_ms
            ? ` (claimed ${entry.claimed_savings_ms}ms)`
            : ''),
      )
    }
  }

  writeTextAtomic(reportAbsolute, `${reportLines.join('\n')}\n`)

  const latestStaging = path.join(root, `${TUNE_LATEST_PATH}.staging`)
  writeFileSync(
    latestStaging,
    `${JSON.stringify(
      {
        schema_version: 1,
        session_id: input.session_id,
        record_path: recordRelative,
        report_path: reportRelative,
        updated_at: record.recorded_at,
      },
      null,
      2,
    )}\n`,
  )
  renameSync(latestStaging, path.join(root, TUNE_LATEST_PATH))

  return {
    record_path: recordRelative,
    report_path: reportRelative,
    latest_path: TUNE_LATEST_PATH,
  }
}

/**
 * Finalizes a prepared tune session from the pass, verdict, provenance, and
 * suite profile files in its work directory, via `finalizeTuneSession`.
 * Throws `TUNE_SESSION_NOT_FOUND` when the session was not prepared and
 * `TUNE_SESSION_INPUT_INVALID` when its input files have the wrong shape.
 */
export function finalizePreparedTuneSession(
  root: string,
  sessionId: string,
): FinalizeTuneSessionResult {
  assertSelfDevelopment(root)

  const prepared = loadPreparedSession(root, sessionId)
  const passes = readJson(path.join(prepared.work_dir, TUNE_PASSES_FILE))
  const verdicts = readJson(path.join(prepared.work_dir, TUNE_VERDICTS_FILE))
  const provenance = readJson(
    path.join(prepared.work_dir, TUNE_JUDGMENT_PROVENANCE_FILE),
  )

  if (
    !isRecord(passes) ||
    !isPassInterval(passes.benchmark) ||
    !isPassInterval(passes.comparison) ||
    !isPassInterval(passes.judgment) ||
    !Array.isArray(verdicts) ||
    !isRecord(provenance)
  ) {
    throw new PanError('tune session files have invalid shape', {
      code: 'TUNE_SESSION_INPUT_INVALID',
    })
  }

  const fastProfile = path.join(prepared.work_dir, TUNE_FAST_PROFILE_FILE)
  const secondaryProfile = path.join(
    prepared.work_dir,
    TUNE_SECONDARY_PROFILE_FILE,
  )
  const relativeFastProfile = path.relative(root, fastProfile)
  const relativeSecondaryProfile = fileExists(secondaryProfile)
    ? path.relative(root, secondaryProfile)
    : null

  const benchmark = buildBenchmarkFromProfiles(
    root,
    relativeFastProfile,
    relativeSecondaryProfile,
    prepared.prior_record,
  )

  return finalizeTuneSession(root, {
    session_id: sessionId,
    passes: passes as unknown as TuneRecord['passes'],
    verdicts: verdicts as TuneRecord['verdicts'],
    judgment_provenance: provenance as TuneRecord['judgment_provenance'],
    benchmark,
    current_inventory: prepared.current_inventory,
    retained_set: prepared.retained_set,
    baseline_source: prepared.baseline_source,
    prior_record: prepared.prior_record,
  })
}
