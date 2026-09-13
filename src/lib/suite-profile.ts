import { readdirSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson, writeJsonAtomic } from './io.js'
import { resolveRunLayout } from './run-layout.js'
import { TEST_PROFILE_ENV } from './suite-profile-env.js'
import type {
  DeterministicResult,
  RunState,
  SuiteProfileEntry,
  SuiteProfileSummary,
} from './types.js'

// The advisory suite profile. The failures-only reporter writes one document
// when `PAN_TEST_PROFILE` names an absolute path; the harness sets that
// variable for exactly one execution, the `full` release gate that runs when
// the run enters ship. Nothing here gates on a count or a duration.

export { TEST_PROFILE_ENV }

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

export interface SuiteProfileFixtureCost {
  template_ms: number
  clone_ms: number
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
  /**
   * Every test timing. The reporter writes this field on every profile it
   * produces, which is whenever `PAN_TEST_PROFILE` names an absolute path.
   * Optional because a profile recorded before the field existed has none.
   */
  all_tests?: SuiteProfileTest[]
  fixture_cost?: SuiteProfileFixtureCost
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

function parseSuiteProfileTest(value: unknown): SuiteProfileTest | null {
  return isRecord(value) &&
    typeof value.file === 'string' &&
    typeof value.name === 'string' &&
    isNumber(value.duration_ms)
    ? {
        file: value.file,
        name: value.name,
        duration_ms: value.duration_ms,
      }
    : null
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
  const tests = value.slowest_tests
    .map(parseSuiteProfileTest)
    .filter((entry): entry is SuiteProfileTest => entry !== null)
  const allTests = Array.isArray(value.all_tests)
    ? value.all_tests
        .map(parseSuiteProfileTest)
        .filter((entry): entry is SuiteProfileTest => entry !== null)
    : undefined
  const fixtureCost =
    isRecord(value.fixture_cost) &&
    isNumber(value.fixture_cost.template_ms) &&
    isNumber(value.fixture_cost.clone_ms)
      ? {
          template_ms: value.fixture_cost.template_ms,
          clone_ms: value.fixture_cost.clone_ms,
        }
      : undefined

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
    ...(allTests ? { all_tests: allTests } : {}),
    ...(fixtureCost ? { fixture_cost: fixtureCost } : {}),
  }
}

export interface RecordedSuiteProfile {
  stage: string
  result: DeterministicResult
}

/**
 * The newest passed gate result that carries a suite profile. The ship
 * release gate is the only `full` execution, and it runs at stage entry
 * before any ship submission exists, so an entry-gate record that passed
 * later than every submitted gate is the current profile.
 */
export function latestRecordedSuiteProfile(
  state: RunState,
): RecordedSuiteProfile | null {
  for (const [stage, record] of Object.entries(state.entry_gates ?? {})) {
    const result = record.last_result

    if (
      result.suite_profile_path &&
      result.passed &&
      !result.skipped &&
      record.passed_at_history_length !== undefined &&
      record.passed_at_history_length >= state.stage_history.length
    ) {
      return { stage, result }
    }
  }

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

/** Where a previous-profile lookup came from, and what it cost. */
export interface PreviousRunProfileLookup {
  value: PreviousRunProfile | null
  source: 'index' | 'scan'
  /** JSON files the lookup opened, which the index path bounds at two. */
  file_reads: number
}

/** One workspace's most recent succeeded profiled run. */
export interface SuiteProfileIndexEntry {
  run_id: string
  profile_path: string
  recorded_at: string
}

interface SuiteProfileIndex {
  schema_version: 1
  /** Keyed by the run's workspace root, relative to the harness root. */
  workspaces: Record<string, SuiteProfileIndexEntry>
}

/**
 * Pointer to the newest profiled run of each workspace.
 *
 * The fact is written once, when a run succeeds, instead of derived at read
 * time from every retained run state. The file is a cache: a lost or corrupt
 * index costs one scan, which rebuilds it.
 */
export const SUITE_PROFILE_INDEX_PATH = 'runtime/cache/suite-profile-index.json'

function workspaceKey(state: Pick<RunState, 'workspace_root'>): string {
  return state.workspace_root || '.'
}

function loadSuiteProfileIndex(root: string): SuiteProfileIndex | null {
  const absolute = path.join(root, SUITE_PROFILE_INDEX_PATH)

  if (!fileExists(absolute)) {
    return null
  }

  let value: unknown

  try {
    value = readJson(absolute)
  } catch {
    // A corrupt index is a miss, never a status failure: the scan rebuilds it.
    return null
  }

  if (!isRecord(value) || !isRecord(value.workspaces)) {
    return null
  }

  const workspaces: Record<string, SuiteProfileIndexEntry> = {}

  for (const [workspace, entry] of Object.entries(value.workspaces)) {
    if (
      isRecord(entry) &&
      typeof entry.run_id === 'string' &&
      typeof entry.profile_path === 'string' &&
      typeof entry.recorded_at === 'string'
    ) {
      workspaces[workspace] = {
        run_id: entry.run_id,
        profile_path: entry.profile_path,
        recorded_at: entry.recorded_at,
      }
    }
  }

  return { schema_version: 1, workspaces }
}

function writeSuiteProfileIndexEntry(
  root: string,
  workspace: string,
  entry: SuiteProfileIndexEntry,
): void {
  const existing = loadSuiteProfileIndex(root)

  writeJsonAtomic(path.join(root, SUITE_PROFILE_INDEX_PATH), {
    schema_version: 1,
    workspaces: { ...(existing?.workspaces ?? {}), [workspace]: entry },
  } satisfies SuiteProfileIndex)
}

/**
 * Record the profile of a run that just succeeded, so a later status read
 * finds it without scanning. A run that recorded no profile writes nothing.
 */
export function recordSuiteProfileIndexEntry(
  root: string,
  state: RunState,
): SuiteProfileIndexEntry | null {
  const recorded = latestRecordedSuiteProfile(state)

  if (!recorded?.result.suite_profile_path) {
    return null
  }

  const entry: SuiteProfileIndexEntry = {
    run_id: state.run_id,
    profile_path: recorded.result.suite_profile_path,
    recorded_at:
      typeof state.updated_at === 'string'
        ? state.updated_at
        : new Date().toISOString(),
  }

  writeSuiteProfileIndexEntry(root, workspaceKey(state), entry)

  return entry
}

/**
 * The profile of the most recent succeeded run in the same workspace, found
 * by reading every retained run state. This is the rebuild path: it costs one
 * read per retained run, which is what the index exists to avoid.
 */
export function previousSucceededRunProfileByScan(
  root: string,
  state: RunState,
): PreviousRunProfileLookup {
  const workflows = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(workflows)) {
    return { value: null, source: 'scan', file_reads: 0 }
  }

  let best: { updated_at: string; value: PreviousRunProfile } | null = null
  let reads = 0

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
      reads += 1
      value = readJson(stateFile)
    } catch {
      continue
    }

    if (!isRecord(value) || value.status !== 'succeeded') {
      continue
    }

    const other = value as unknown as RunState

    if (
      workspaceKey(other) !== workspaceKey(state) ||
      !Array.isArray(other.stage_history)
    ) {
      continue
    }

    const recorded = latestRecordedSuiteProfile(other)

    if (!recorded?.result.suite_profile_path) {
      continue
    }

    reads += 1

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

  return { value: best?.value ?? null, source: 'scan', file_reads: reads }
}

/**
 * The profile recorded by the most recent succeeded run in the same
 * workspace, read from the index when it holds the answer.
 *
 * A missing index entry, an unreadable profile, or an entry that names this
 * run falls back to the scan, and a scan that finds a profile rebuilds the
 * entry it was missing.
 */
export function lookupPreviousSucceededRunProfile(
  root: string,
  state: RunState,
): PreviousRunProfileLookup {
  const workspace = workspaceKey(state)
  const indexed = loadSuiteProfileIndex(root)?.workspaces[workspace]

  if (indexed && indexed.run_id !== state.run_id) {
    const profile = loadSuiteProfile(root, indexed.profile_path)

    if (profile) {
      return {
        value: {
          run_id: indexed.run_id,
          profile_path: indexed.profile_path,
          profile,
        },
        source: 'index',
        // The index and the profile it names are the whole cost.
        file_reads: 2,
      }
    }
  }

  const scanned = previousSucceededRunProfileByScan(root, state)

  if (scanned.value) {
    writeSuiteProfileIndexEntry(root, workspace, {
      run_id: scanned.value.run_id,
      profile_path: scanned.value.profile_path,
      recorded_at: scanned.value.profile.recorded_at,
    })
  }

  return scanned
}

/**
 * The profile recorded by the most recent succeeded run in the same
 * workspace, or null when no such run exists.
 */
export function previousSucceededRunProfile(
  root: string,
  state: RunState,
): PreviousRunProfile | null {
  return lookupPreviousSucceededRunProfile(root, state).value
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
    'This section is advisory. It records the one profiled `full` run, the ' +
      'release gate at ship entry. No count and no duration gates the release.',
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
