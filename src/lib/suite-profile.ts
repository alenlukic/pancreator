import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson } from './io.js'
import { resolveRunLayout } from './run-layout.js'
import type {
  DeterministicResult,
  RunState,
  SuiteProfileEntry,
  SuiteProfileSummary,
} from './types.js'

// The advisory suite profile. The failures-only reporter writes one document
// when `PAN_TEST_PROFILE` names an absolute path; the harness sets that
// variable for exactly one execution, the `full` gate that is the last suite
// run before ship. Nothing here gates on a count or a duration.

/** Environment variable the reporter reads for its profile target. */
export const TEST_PROFILE_ENV = 'PAN_TEST_PROFILE'

/** The only repository-check profile the harness profiles. */
export const SUITE_PROFILE_GATE_PROFILE = 'full'

const CARD_ENTRY_LIMIT = 10

export interface SuiteProfileFile {
  file: string
  duration_ms: number
  test_count: number
  pass_count: number
  fail_count: number
}

export interface SuiteProfileTest {
  file: string
  name: string
  duration_ms: number
}

/** The document `PAN_TEST_PROFILE` produces. */
export interface SuiteProfile {
  schema_version: 1
  lane: string
  recorded_at: string
  test_count: number
  pass_count: number
  fail_count: number
  wall_clock_ms: number
  files: SuiteProfileFile[]
  slowest_tests: SuiteProfileTest[]
}

/** Absolute artifact path for the profile of one gate execution. */
export function suiteProfileEvidencePath(
  runDirectory: string,
  artifactId: string,
): string {
  return path.join(runDirectory, 'evidence', `${artifactId}-suite-profile.json`)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function loadSuiteProfile(
  root: string,
  relativePath: string,
): SuiteProfile | null {
  const absolute = path.join(root, relativePath)

  if (!fileExists(absolute)) {
    return null
  }

  let value: unknown

  try {
    value = readJson(absolute)
  } catch {
    return null
  }

  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    !isNumber(value.test_count) ||
    !isNumber(value.wall_clock_ms) ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.slowest_tests)
  ) {
    return null
  }

  const files = value.files.filter(
    (entry): entry is SuiteProfileFile =>
      isRecord(entry) &&
      typeof entry.file === 'string' &&
      isNumber(entry.duration_ms) &&
      isNumber(entry.test_count),
  )
  const tests = value.slowest_tests.filter(
    (entry): entry is SuiteProfileTest =>
      isRecord(entry) &&
      typeof entry.file === 'string' &&
      typeof entry.name === 'string' &&
      isNumber(entry.duration_ms),
  )

  return {
    schema_version: 1,
    lane: typeof value.lane === 'string' ? value.lane : 'unknown',
    recorded_at: typeof value.recorded_at === 'string' ? value.recorded_at : '',
    test_count: value.test_count,
    pass_count: isNumber(value.pass_count) ? value.pass_count : 0,
    fail_count: isNumber(value.fail_count) ? value.fail_count : 0,
    wall_clock_ms: value.wall_clock_ms,
    files,
    slowest_tests: tests,
  }
}

export interface RecordedSuiteProfile {
  stage: string
  result: DeterministicResult
}

/**
 * The newest passed gate result that carries a suite profile. Verify and
 * remediate both gate on `full`, so the last one in history is the last suite
 * execution before ship.
 */
export function latestRecordedSuiteProfile(
  state: RunState,
): RecordedSuiteProfile | null {
  for (const item of [...state.stage_history].reverse()) {
    for (const result of [...item.deterministic].reverse()) {
      if (result.suite_profile_path && result.passed && !result.skipped) {
        return { stage: item.stage, result }
      }
    }
  }

  return null
}

interface PreviousRunProfile {
  run_id: string
  profile_path: string
  profile: SuiteProfile
}

/**
 * The profile recorded by the most recent succeeded run in the same
 * workspace, or null when no such run exists.
 */
export function previousSucceededRunProfile(
  root: string,
  state: RunState,
): PreviousRunProfile | null {
  const workflows = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(workflows)) {
    return null
  }

  let best: { updated_at: string; value: PreviousRunProfile } | null = null

  for (const entry of readdirSync(workflows, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === state.run_id) {
      continue
    }

    const stateFile = resolveRunLayout(root, entry.name).state.absolute

    if (!fileExists(stateFile)) {
      continue
    }

    let value: unknown

    try {
      value = readJson(stateFile)
    } catch {
      continue
    }

    if (!isRecord(value) || value.status !== 'succeeded') {
      continue
    }

    const other = value as unknown as RunState

    if (
      (other.workspace_root || '.') !== (state.workspace_root || '.') ||
      !Array.isArray(other.stage_history)
    ) {
      continue
    }

    const recorded = latestRecordedSuiteProfile(other)

    if (!recorded?.result.suite_profile_path) {
      continue
    }

    const profile = loadSuiteProfile(root, recorded.result.suite_profile_path)

    if (!profile) {
      continue
    }

    const updatedAt =
      typeof other.updated_at === 'string' ? other.updated_at : ''

    if (!best || updatedAt > best.updated_at) {
      best = {
        updated_at: updatedAt,
        value: {
          run_id: other.run_id,
          profile_path: recorded.result.suite_profile_path,
          profile,
        },
      }
    }
  }

  return best?.value ?? null
}

/**
 * Assemble the card summary for the run's recorded profile. Null when the run
 * recorded none: a target whose `full` profile runs no reporter leaves no
 * artifact, and the card then carries no section.
 */
export function buildSuiteProfileSummary(
  root: string,
  state: RunState,
): SuiteProfileSummary | null {
  const recorded = latestRecordedSuiteProfile(state)

  if (!recorded?.result.suite_profile_path) {
    return null
  }

  const profile = loadSuiteProfile(root, recorded.result.suite_profile_path)

  if (!profile) {
    return null
  }

  const previous = previousSucceededRunProfile(root, state)
  const slowestFiles: SuiteProfileEntry[] = [...profile.files]
    .sort((left, right) => right.duration_ms - left.duration_ms)
    .slice(0, CARD_ENTRY_LIMIT)
    .map((entry) => ({
      file: entry.file,
      duration_ms: entry.duration_ms,
      test_count: entry.test_count,
    }))
  const slowestTests: SuiteProfileEntry[] = profile.slowest_tests
    .slice(0, CARD_ENTRY_LIMIT)
    .map((entry) => ({
      file: entry.file,
      name: entry.name,
      duration_ms: entry.duration_ms,
    }))

  return {
    profile_path: recorded.result.suite_profile_path,
    gate_id: recorded.result.id,
    stage: recorded.stage,
    cached: recorded.result.cached === true,
    lane: profile.lane,
    test_count: profile.test_count,
    pass_count: profile.pass_count,
    fail_count: profile.fail_count,
    wall_clock_ms: profile.wall_clock_ms,
    slowest_files: slowestFiles,
    slowest_tests: slowestTests,
    ...(previous
      ? {
          previous: {
            run_id: previous.run_id,
            profile_path: previous.profile_path,
            test_count: previous.profile.test_count,
            wall_clock_ms: previous.profile.wall_clock_ms,
            test_count_delta: profile.test_count - previous.profile.test_count,
            wall_clock_ms_delta:
              profile.wall_clock_ms - previous.profile.wall_clock_ms,
          },
        }
      : {}),
  }
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function signed(value: number, format: (value: number) => string): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '±'

  return `${sign}${format(Math.abs(value))}`
}

/** One line for `pan status`. */
export function renderSuiteProfileStatusLine(
  summary: SuiteProfileSummary,
): string {
  const delta = summary.previous
    ? ` (${signed(summary.previous.test_count_delta, String)} tests, ` +
      `${signed(summary.previous.wall_clock_ms_delta, seconds)} vs run ` +
      `${summary.previous.run_id})`
    : ' (no previous succeeded run to compare)'

  return (
    `Suite profile: ${summary.test_count} tests in ` +
    `${seconds(summary.wall_clock_ms)} at ${summary.stage} gate ` +
    `${summary.gate_id}${summary.cached ? ', cached' : ''}${delta}`
  )
}

/** The advisory card section. STE-001 prose, no gate. */
export function renderSuiteProfileSection(
  summary: SuiteProfileSummary,
): string[] {
  const lines = [
    '## 📈 Suite profile',
    '',
    'This section is advisory. It records the one profiled `full` run before ' +
      'ship. No count and no duration gates the release.',
    '',
    `- Source: \`${summary.profile_path}\` from the ${summary.stage} gate ` +
      `\`${summary.gate_id}\`` +
      (summary.cached
        ? ' (cached pass; profile of the original execution)'
        : '') +
      '.',
    `- Lane: \`${summary.lane}\`.`,
    `- Tests: ${summary.test_count} (${summary.pass_count} passed, ` +
      `${summary.fail_count} failed).`,
    `- Wall clock: ${seconds(summary.wall_clock_ms)}.`,
  ]

  if (summary.previous) {
    lines.push(
      `- Delta against run \`${summary.previous.run_id}\` ` +
        `(\`${summary.previous.profile_path}\`): ` +
        `${signed(summary.previous.test_count_delta, String)} tests, ` +
        `${signed(summary.previous.wall_clock_ms_delta, seconds)} wall clock.`,
    )
  } else {
    lines.push(
      '- Delta: none. No previous succeeded run in this workspace recorded ' +
        'a profile.',
    )
  }

  lines.push('', '### Slowest files', '')

  if (summary.slowest_files.length === 0) {
    lines.push('- The profile lists no files.')
  }

  for (const entry of summary.slowest_files) {
    lines.push(
      `- \`${entry.file}\` — ${seconds(entry.duration_ms)}` +
        (entry.test_count !== undefined ? `, ${entry.test_count} tests` : ''),
    )
  }

  lines.push('', '### Slowest tests', '')

  if (summary.slowest_tests.length === 0) {
    lines.push('- The profile lists no tests.')
  }

  for (const entry of summary.slowest_tests) {
    lines.push(
      `- ${entry.name ?? '(unnamed)'} (\`${entry.file}\`) — ` +
        `${seconds(entry.duration_ms)}`,
    )
  }

  lines.push('')

  return lines
}
