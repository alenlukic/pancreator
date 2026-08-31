/**
 * Harness test tuning: session state, inventories, partitions, and records.
 *
 * Tune records live under runtime/tune-harness/, outside runtime/logs/, so
 * pan archive does not move them.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { PanError } from './errors.js'
import { gitHead, gitWorkspaceSnapshot, isGitRepository } from './git.js'
import {
  fileExists,
  isRecord,
  readJson,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import { isTargetInstallation } from './project-config.js'
import { loadSuiteProfile, type SuiteProfileTest } from './suite-profile.js'

export const TUNE_ROOT = 'runtime/tune-harness'
export const TUNE_WORK_DIR = `${TUNE_ROOT}/work`
export const TUNE_RECORDS_DIR = `${TUNE_ROOT}/records`
export const TUNE_REPORTS_DIR = `${TUNE_ROOT}/reports`
export const TUNE_LATEST_PATH = `${TUNE_ROOT}/latest.json`
export const TUNE_PASSES_FILE = 'passes.json'
export const TUNE_VERDICTS_FILE = 'verdicts.json'
export const TUNE_JUDGMENT_PROVENANCE_FILE = 'judgment-provenance.json'
export const TUNE_FAST_PROFILE_FILE = 'fast-profile.json'
export const TUNE_SECONDARY_PROFILE_FILE = 'secondary-profile.json'

export type TuneVerdict = 'KEEP' | 'MERGE' | 'DEMOTE' | 'DELETE'

export interface TestIdentity {
  file: string
  name: string
  lane: string
  occurrence?: number
  line?: number
}

export interface PassInterval {
  started_at: string
  ended_at: string
}

export interface TuneRecord {
  schema_version: 1
  session_id: string
  harness_version: string
  git_commit: string
  workspace_fingerprint: string
  workspace_dirty: boolean
  recorded_at: string
  prior_record_id?: string
  baseline_source: {
    kind: 'baseline_ref' | 'prior_record' | 'none'
    ref?: string
    prior_session_id?: string
  }
  passes: {
    benchmark: PassInterval
    comparison: PassInterval
    judgment: PassInterval
  }
  retained_set: TestIdentity[]
  current_inventory: TestIdentity[]
  comparison: {
    retained_and_present: TestIdentity[]
    added_since_retained: TestIdentity[]
    retained_but_removed: TestIdentity[]
  }
  benchmark: {
    fast_lane_wall_ms: number
    secondary_lane_wall_ms: number
    summed_file_ms?: number
    fixture_template_ms: number
    fixture_clone_ms: number
    prior_deltas?: Record<string, number>
    files: Array<{
      file: string
      duration_ms: number
      test_count: number
      prior_duration_ms?: number
    }>
    tests: Array<{
      file: string
      name: string
      duration_ms: number
      prior_duration_ms?: number
    }>
    slowest_tests: Array<{
      file: string
      name: string
      duration_ms: number
      prior_duration_ms?: number
    }>
  }
  verdicts: Array<{
    identity: TestIdentity
    verdict: TuneVerdict
    principle: string
    rationale: string
    survivor?: TestIdentity
    delete_reason?:
      | 'duplicate_contract'
      | 'gate_duplication'
      | 'prose_pin'
      | 'no_contract'
      | 'obsolete'
    demote_destination?: string
    claimed_savings_ms?: number
  }>
  judgment_provenance: {
    handbook_path: string
    handbook_revision: string
    inventory_only: true
    inventory_path: string
    similarity_index_path?: string
  }
}

export function identityKey(identity: TestIdentity): string {
  const occurrence = identity.occurrence ?? 1

  return `${identity.file}\0${identity.name}\0${occurrence}`
}

export function partitionRetainedSet(
  current: TestIdentity[],
  retained: TestIdentity[],
): TuneRecord['comparison'] {
  const currentKeys = new Map(current.map((item) => [identityKey(item), item]))
  const retainedKeys = new Map(
    retained.map((item) => [identityKey(item), item]),
  )

  const retained_and_present: TestIdentity[] = []
  const added_since_retained: TestIdentity[] = []
  const retained_but_removed: TestIdentity[] = []

  for (const [key, item] of currentKeys) {
    if (retainedKeys.has(key)) {
      retained_and_present.push(item)
    } else {
      added_since_retained.push(item)
    }
  }

  for (const [key, item] of retainedKeys) {
    if (!currentKeys.has(key)) {
      retained_but_removed.push(item)
    }
  }

  const sort = (left: TestIdentity, right: TestIdentity): number =>
    identityKey(left).localeCompare(identityKey(right))

  return {
    retained_and_present: retained_and_present.sort(sort),
    added_since_retained: added_since_retained.sort(sort),
    retained_but_removed: retained_but_removed.sort(sort),
  }
}

export function intervalsOverlap(
  left: PassInterval,
  right: PassInterval,
): boolean {
  const leftStart = Date.parse(left.started_at)
  const leftEnd = Date.parse(left.ended_at)
  const rightStart = Date.parse(right.started_at)
  const rightEnd = Date.parse(right.ended_at)

  return leftStart <= rightEnd && rightStart <= leftEnd
}

export function validatePassOverlap(record: TuneRecord): string[] {
  const errors: string[] = []
  const { benchmark, comparison, judgment } = record.passes

  if (!intervalsOverlap(benchmark, comparison)) {
    errors.push('benchmark and comparison passes do not overlap')
  }

  if (!intervalsOverlap(benchmark, judgment)) {
    errors.push('benchmark and judgment passes do not overlap')
  }

  if (!intervalsOverlap(comparison, judgment)) {
    errors.push('comparison and judgment passes do not overlap')
  }

  return errors
}

export function tuneSessionWorkDir(root: string, sessionId: string): string {
  return path.join(root, TUNE_WORK_DIR, sessionId)
}

export function loadLatestRecord(root: string): TuneRecord | null {
  const latestPath = path.join(root, TUNE_LATEST_PATH)

  if (!fileExists(latestPath)) {
    return null
  }

  const pointer = readJson(latestPath) as { record_path?: string }
  const recordPath =
    typeof pointer.record_path === 'string'
      ? path.join(root, pointer.record_path)
      : null

  if (!recordPath || !fileExists(recordPath)) {
    return null
  }

  return readJson(recordPath) as TuneRecord
}

export function assertSelfDevelopment(root: string): void {
  if (isTargetInstallation(root)) {
    throw new PanError(
      'pan tune is available only in self-development because installed payloads contain no harness tests.',
      { code: 'TUNE_SELF_DEVELOPMENT_ONLY' },
    )
  }
}

function harnessVersion(root: string): string {
  try {
    return readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  } catch {
    return 'unknown'
  }
}

function readInventoryFile(absolute: string): TestIdentity[] {
  const value = readJson(absolute) as { identities?: TestIdentity[] }

  if (!Array.isArray(value.identities)) {
    throw new PanError(`invalid inventory file: ${absolute}`, {
      code: 'TUNE_INVENTORY_INVALID',
    })
  }

  return value.identities
}

function runInventoryCollection(options: {
  cwd: string
  reporterRoot: string
  out: string
  errorPrefix: string
  errorCode: 'TUNE_INVENTORY_FAILED' | 'TUNE_BASELINE_BUILD_FAILED'
}): TestIdentity[] {
  const cwd = path.resolve(options.cwd)
  const reporterRoot = path.resolve(options.reporterRoot)
  const out = path.resolve(options.out)
  const reporterDir = path.join(reporterRoot, 'dist/tests/reporters')
  const reporterSource = path.join(reporterDir, 'inventory.js')
  const reporterInCwd = path.join(cwd, 'dist/tests/reporters/inventory.js')

  if (!existsSync(reporterSource)) {
    throw new PanError(`inventory reporter missing: ${reporterSource}`, {
      code: options.errorCode,
    })
  }

  if (!existsSync(reporterInCwd)) {
    mkdirSync(path.dirname(reporterInCwd), { recursive: true })
    copyFileSync(reporterSource, reporterInCwd)
  }

  const lanes = ['unit', 'integration', 'regression', 'secondary']
  const merged = new Map<string, TestIdentity>()
  let ranAny = false

  for (const lane of lanes) {
    const dir = path.join(cwd, 'dist/tests', lane)

    if (!existsSync(dir)) {
      continue
    }

    const files = readdirSync(dir)
      .filter((entry) => entry.endsWith('.test.js'))
      .map((entry) => path.join(dir, entry))
      .sort()

    if (files.length === 0) {
      continue
    }

    ranAny = true
    const laneOut = `${out}.${lane}`
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        `--test-reporter=${reporterInCwd}`,
        '--test-reporter-destination=stdout',
        '--test-name-pattern=^$',
        ...files,
      ],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PAN_TEST_INVENTORY: laneOut,
        },
      },
    )

    if (!existsSync(laneOut)) {
      throw new PanError(
        `${options.errorPrefix}: ${result.stderr || result.stdout || `inventory output missing for ${lane}`}`,
        { code: options.errorCode },
      )
    }

    let laneIdentities: TestIdentity[]

    try {
      laneIdentities = readInventoryFile(laneOut)
    } catch (error) {
      throw new PanError(
        `${options.errorPrefix}: ${error instanceof Error ? error.message : String(error)}`,
        { code: options.errorCode },
      )
    }

    if (result.status !== 0 && laneIdentities.length === 0) {
      throw new PanError(
        `${options.errorPrefix}: ${result.stderr || result.stdout || `inventory collection failed for ${lane}`}`,
        { code: options.errorCode },
      )
    }

    rmSync(laneOut, { force: true })

    for (const identity of laneIdentities) {
      merged.set(identityKey(identity), identity)
    }
  }

  if (!ranAny) {
    throw new PanError(
      'no compiled test files found for inventory collection',
      {
        code: options.errorCode,
      },
    )
  }

  const identities = [...merged.values()].sort((left, right) =>
    identityKey(left).localeCompare(identityKey(right)),
  )
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        schema_version: 1,
        recorded_at: new Date().toISOString(),
        identities,
      },
      null,
      2,
    )}\n`,
  )

  return identities
}

export function collectCurrentInventory(root: string): TestIdentity[] {
  const out = path.join(root, TUNE_WORK_DIR, '.inventory-current.json')
  mkdirSync(path.dirname(out), { recursive: true })

  return runInventoryCollection({
    cwd: root,
    reporterRoot: root,
    out,
    errorPrefix: 'inventory collection failed',
    errorCode: 'TUNE_INVENTORY_FAILED',
  })
}

export function collectBaselineInventory(
  root: string,
  baselineRef: string,
  sessionId: string,
): TestIdentity[] {
  const worktree = path.join(
    root,
    TUNE_WORK_DIR,
    sessionId,
    'baseline-worktree',
  )

  if (existsSync(worktree)) {
    rmSync(worktree, { recursive: true, force: true })
  }

  mkdirSync(path.dirname(worktree), { recursive: true })

  execFileSync('git', ['worktree', 'add', '--detach', worktree, baselineRef], {
    cwd: root,
    encoding: 'utf8',
  })

  try {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: worktree,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    execFileSync('npm', ['run', 'build'], {
      cwd: worktree,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    const out = path.join(worktree, '.tune-inventory.json')
    const identities = runInventoryCollection({
      cwd: worktree,
      reporterRoot: root,
      out,
      errorPrefix: `baseline inventory failed at ${baselineRef}`,
      errorCode: 'TUNE_BASELINE_BUILD_FAILED',
    })

    return identities
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', worktree], {
      cwd: root,
      encoding: 'utf8',
    })
  }
}

export interface PrepareTuneSessionOptions {
  baselineRef?: string
}

export interface PreparedTuneSession {
  session_id: string
  work_dir: string
  current_inventory: TestIdentity[]
  retained_set: TestIdentity[]
  baseline_source: TuneRecord['baseline_source']
  prior_record: TuneRecord | null
}

export function prepareTuneSession(
  root: string,
  options: PrepareTuneSessionOptions = {},
): PreparedTuneSession {
  assertSelfDevelopment(root)

  if (!isGitRepository(root)) {
    throw new PanError('pan tune requires a Git repository.', {
      code: 'TUNE_GIT_REQUIRED',
    })
  }

  const sessionId = `tune-${Date.now()}`
  const workDir = tuneSessionWorkDir(root, sessionId)
  mkdirSync(workDir, { recursive: true })

  const current = collectCurrentInventory(root)
  const prior = loadLatestRecord(root)
  let retained: TestIdentity[]
  let baselineSource: TuneRecord['baseline_source']

  if (options.baselineRef) {
    retained = collectBaselineInventory(root, options.baselineRef, sessionId)
    baselineSource = { kind: 'baseline_ref', ref: options.baselineRef }
  } else if (prior) {
    retained = prior.retained_set
    baselineSource = {
      kind: 'prior_record',
      prior_session_id: prior.session_id,
    }
  } else {
    retained = current
    baselineSource = { kind: 'none' }
  }

  writeJsonAtomic(path.join(workDir, 'current-inventory.json'), {
    identities: current,
  })
  writeJsonAtomic(path.join(workDir, 'retained-set.json'), {
    identities: retained,
  })
  writeJsonAtomic(path.join(workDir, 'session-meta.json'), {
    baseline_source: baselineSource,
  })

  return {
    session_id: sessionId,
    work_dir: workDir,
    current_inventory: current,
    retained_set: retained,
    baseline_source: baselineSource,
    prior_record: prior,
  }
}

export function loadPreparedSession(
  root: string,
  sessionId: string,
): PreparedTuneSession {
  const workDir = tuneSessionWorkDir(root, sessionId)
  const currentPath = path.join(workDir, 'current-inventory.json')
  const retainedPath = path.join(workDir, 'retained-set.json')

  if (!fileExists(currentPath) || !fileExists(retainedPath)) {
    throw new PanError(`missing prepared session ${sessionId}`, {
      code: 'TUNE_SESSION_NOT_FOUND',
    })
  }

  const current = readInventoryFile(currentPath)
  const retained = readInventoryFile(retainedPath)
  const metaPath = path.join(workDir, 'session-meta.json')
  const meta = fileExists(metaPath)
    ? (readJson(metaPath) as {
        baseline_source?: TuneRecord['baseline_source']
      })
    : null

  return {
    session_id: sessionId,
    work_dir: workDir,
    current_inventory: current,
    retained_set: retained,
    baseline_source: meta?.baseline_source ?? { kind: 'none' },
    prior_record: loadLatestRecord(root),
  }
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000
}

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

  return {
    fast_lane_wall_ms: fast.wall_clock_ms,
    secondary_lane_wall_ms: secondary?.wall_clock_ms ?? 0,
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
            secondary_lane_wall_ms: roundMs(
              (secondary?.wall_clock_ms ?? 0) -
                prior.benchmark.secondary_lane_wall_ms,
            ),
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

interface TuneRecordSchemaConstraints {
  deleteReasons: Set<string>
  principlePattern: RegExp
}

function tuneRecordSchemaConstraints(
  root: string,
): TuneRecordSchemaConstraints {
  const schema = readJson(
    path.join(root, 'library/schemas/tune-record.schema.json'),
  ) as {
    $defs?: {
      verdict?: {
        properties?: {
          principle?: { pattern?: string }
          delete_reason?: { enum?: string[] }
        }
      }
    }
  }
  const properties = schema.$defs?.verdict?.properties
  const deleteReasons = properties?.delete_reason?.enum
  const principlePattern = properties?.principle?.pattern

  if (!Array.isArray(deleteReasons) || typeof principlePattern !== 'string') {
    throw new PanError('tune record schema is missing verdict constraints', {
      code: 'TUNE_SCHEMA_INVALID',
    })
  }

  return {
    deleteReasons: new Set(deleteReasons),
    principlePattern: new RegExp(principlePattern, 'u'),
  }
}

function isPassInterval(value: unknown): value is PassInterval {
  if (!isRecord(value)) {
    return false
  }

  const startedAt = Date.parse(String(value.started_at))
  const endedAt = Date.parse(String(value.ended_at))

  return (
    typeof value.started_at === 'string' &&
    typeof value.ended_at === 'string' &&
    Number.isFinite(startedAt) &&
    Number.isFinite(endedAt) &&
    startedAt <= endedAt
  )
}

function isTestIdentity(value: unknown): value is TestIdentity {
  return (
    isRecord(value) &&
    typeof value.file === 'string' &&
    /^tests\/.+\.test\.ts$/u.test(value.file) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.lane === 'string' &&
    value.lane.length > 0 &&
    (value.occurrence === undefined ||
      (Number.isInteger(value.occurrence) && Number(value.occurrence) >= 1))
  )
}

function validDemoteDestination(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (value === 'tests/secondary' ||
      value.startsWith('tests/secondary/') ||
      /^cheaper direct form:\s*\S/u.test(value))
  )
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys)

  return Object.keys(value).every((key) => allowed.has(key))
}

function validateJudgmentProvenance(
  record: TuneRecord,
  errors: string[],
): void {
  const provenance = record.judgment_provenance

  if (
    !isRecord(provenance) ||
    !hasOnlyKeys(provenance, [
      'handbook_path',
      'handbook_revision',
      'inventory_only',
      'inventory_path',
      'similarity_index_path',
    ]) ||
    provenance.handbook_path !== 'governance/handbooks/eng/testing.md' ||
    typeof provenance.handbook_revision !== 'string' ||
    provenance.handbook_revision.length === 0 ||
    provenance.inventory_only !== true ||
    typeof provenance.inventory_path !== 'string'
  ) {
    errors.push('judgment provenance has invalid shape')
    return
  }

  const sessionRoot = `${TUNE_WORK_DIR}/${record.session_id}/`
  const expectedInventory = `${sessionRoot}current-inventory.json`

  if (provenance.inventory_path !== expectedInventory) {
    errors.push('judgment provenance MUST name the prepared inventory')
  }

  if (
    provenance.similarity_index_path !== undefined &&
    (typeof provenance.similarity_index_path !== 'string' ||
      provenance.similarity_index_path !==
        `${sessionRoot}similarity-index.json`)
  ) {
    errors.push('judgment provenance has an unpermitted similarity input')
  }
}

export function validateTuneRecordShape(
  record: unknown,
  root = process.cwd(),
): string[] {
  const errors: string[] = []

  if (!isRecord(record) || record.schema_version !== 1) {
    return ['record MUST declare schema_version 1']
  }

  const typed = record as unknown as TuneRecord

  if (
    typeof typed.session_id !== 'string' ||
    typed.session_id.length === 0 ||
    typeof typed.harness_version !== 'string' ||
    typed.harness_version.length === 0 ||
    typeof typed.git_commit !== 'string' ||
    typed.git_commit.length === 0 ||
    typeof typed.workspace_fingerprint !== 'string' ||
    typed.workspace_fingerprint.length === 0 ||
    typeof typed.workspace_dirty !== 'boolean'
  ) {
    errors.push('record metadata has invalid shape')
  }

  if (
    !isRecord(typed.passes) ||
    !isPassInterval(typed.passes.benchmark) ||
    !isPassInterval(typed.passes.comparison) ||
    !isPassInterval(typed.passes.judgment)
  ) {
    errors.push('record passes have invalid shape')
  } else {
    errors.push(...validatePassOverlap(typed))
  }

  if (
    !Array.isArray(typed.retained_set) ||
    !typed.retained_set.every(isTestIdentity) ||
    !Array.isArray(typed.current_inventory) ||
    !typed.current_inventory.every(isTestIdentity)
  ) {
    errors.push('record inventories have invalid shape')
    return errors
  }

  if (
    !isRecord(typed.comparison) ||
    !Array.isArray(typed.comparison.retained_and_present) ||
    !Array.isArray(typed.comparison.added_since_retained) ||
    !Array.isArray(typed.comparison.retained_but_removed)
  ) {
    errors.push('record comparison has invalid shape')
  }

  if (
    !isRecord(typed.benchmark) ||
    !Array.isArray(typed.benchmark.files) ||
    !Array.isArray(typed.benchmark.tests) ||
    !Array.isArray(typed.benchmark.slowest_tests)
  ) {
    errors.push('record benchmark has invalid shape')
  }

  if (!Array.isArray(typed.verdicts)) {
    errors.push('record MUST declare a verdicts array')
    return errors
  }

  validateJudgmentProvenance(typed, errors)

  const constraints = tuneRecordSchemaConstraints(root)
  const inventoryKeys = new Set(typed.current_inventory.map(identityKey))
  const verdictKeys = new Set<string>()

  for (const entry of typed.verdicts) {
    if (
      !isRecord(entry) ||
      !isTestIdentity(entry.identity) ||
      (entry.verdict !== 'KEEP' &&
        entry.verdict !== 'MERGE' &&
        entry.verdict !== 'DEMOTE' &&
        entry.verdict !== 'DELETE') ||
      typeof entry.principle !== 'string' ||
      !constraints.principlePattern.test(entry.principle) ||
      typeof entry.rationale !== 'string' ||
      entry.rationale.length === 0
    ) {
      errors.push('verdict row has invalid shape')
      continue
    }

    const key = identityKey(entry.identity)

    if (!inventoryKeys.has(key)) {
      errors.push(`verdict references unknown identity ${key}`)
    }

    if (verdictKeys.has(key)) {
      errors.push(`duplicate verdict for identity ${key}`)
    }

    verdictKeys.add(key)

    if (
      entry.verdict === 'MERGE' &&
      (!isTestIdentity(entry.survivor) ||
        !inventoryKeys.has(identityKey(entry.survivor)))
    ) {
      errors.push(`MERGE for ${key} MUST name a current survivor`)
    }

    if (
      entry.verdict === 'DELETE' &&
      !constraints.deleteReasons.has(String(entry.delete_reason))
    ) {
      errors.push(`DELETE for ${key} MUST name a permitted reason`)
    }

    if (
      entry.verdict === 'DEMOTE' &&
      !validDemoteDestination(entry.demote_destination)
    ) {
      errors.push(`DEMOTE for ${key} MUST name an actionable destination`)
    }
  }

  for (const identity of typed.current_inventory) {
    if (!verdictKeys.has(identityKey(identity))) {
      errors.push(`missing verdict for ${identityKey(identity)}`)
    }
  }

  return errors
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

export interface AuditRow {
  file: string
  name: string
  introducing_commit?: string
  verdict: TuneVerdict
  principle: string
  rationale: string
  survivor?: string
  demote_destination?: string
  delete_reason?: string
}

export interface ValidateAuditOptions {
  recordPath: string
  baselineRef: string
  targetRef: string
  json?: boolean
}

export interface ValidateAuditResult {
  complete: boolean
  baseline_count: number
  fast_count: number
  secondary_count: number
  delta_count: number
  missing: string[]
  unexpected: string[]
  duplicates: string[]
}

function parseAuditMarkdown(content: string): AuditRow[] {
  const rows: AuditRow[] = []
  const lines = content.split('\n')
  let current: Partial<AuditRow> | null = null

  for (const line of lines) {
    const heading = /^### `([^`]+)` :: (.+)$/u.exec(line)

    if (heading) {
      if (
        current?.file &&
        current.name &&
        current.verdict &&
        current.principle
      ) {
        rows.push(current as AuditRow)
      }

      current = { file: heading[1], name: heading[2] }
      continue
    }

    if (!current) {
      continue
    }

    const verdict = /^- \*\*Verdict:\*\* (.+)$/u.exec(line)

    if (verdict) {
      current.verdict = verdict[1] as TuneVerdict
      continue
    }

    const principle = /^- \*\*Principle:\*\* (.+)$/u.exec(line)

    if (principle) {
      current.principle = principle[1]
      continue
    }

    const rationale = /^- \*\*Rationale:\*\* (.+)$/u.exec(line)

    if (rationale) {
      current.rationale = rationale[1]
    }
  }

  if (current?.file && current.name && current.verdict && current.principle) {
    rows.push(current as AuditRow)
  }

  return rows
}

export function validateAudit(
  root: string,
  options: ValidateAuditOptions,
): ValidateAuditResult {
  assertSelfDevelopment(root)

  const content = readFileSync(
    path.isAbsolute(options.recordPath)
      ? options.recordPath
      : path.join(root, options.recordPath),
    'utf8',
  )
  const rows = parseAuditMarkdown(content)
  const baselineSession = `audit-${Date.now()}`
  const baseline = collectBaselineInventory(
    root,
    options.baselineRef,
    baselineSession,
  )
  const target = execFileSync('git', ['rev-parse', options.targetRef], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  const targetSession = `audit-target-${Date.now()}`
  const targetInventory = collectBaselineInventory(root, target, targetSession)
  rmSync(tuneSessionWorkDir(root, baselineSession), {
    recursive: true,
    force: true,
  })
  rmSync(tuneSessionWorkDir(root, targetSession), {
    recursive: true,
    force: true,
  })

  const baselineKeys = new Set(baseline.map(identityKey))
  const delta = targetInventory.filter(
    (item) => !baselineKeys.has(identityKey(item)),
  )
  const rowKeys = rows.map((row) =>
    identityKey({
      file: row.file,
      name: row.name,
      lane: 'unknown',
    }),
  )
  const rowKeySet = new Set(rowKeys)
  const deltaKeys = new Set(delta.map(identityKey))
  const missing = [...deltaKeys].filter((key) => !rowKeySet.has(key))
  const unexpected = [...rowKeySet].filter((key) => !deltaKeys.has(key))
  const duplicates: string[] = []
  const seen = new Set<string>()

  for (const key of rowKeys) {
    if (seen.has(key)) {
      duplicates.push(key)
    }

    seen.add(key)
  }

  const fast_count = baseline.filter((item) => item.lane !== 'secondary').length
  const secondary_count = baseline.filter(
    (item) => item.lane === 'secondary',
  ).length

  return {
    complete:
      missing.length === 0 &&
      unexpected.length === 0 &&
      duplicates.length === 0,
    baseline_count: baseline.length,
    fast_count,
    secondary_count,
    delta_count: delta.length,
    missing,
    unexpected,
    duplicates,
  }
}
