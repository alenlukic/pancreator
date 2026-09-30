/**
 * Tune record paths and types, the retained-set partition, pass overlap, and
 * the latest record.
 */

import path from 'node:path'

import { fileExists, readJson } from '../io.js'

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
    /** Null when the session measured no secondary lane at all. */
    secondary_lane_wall_ms: number | null
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

/** Stable key of a test identity: file, name, and occurrence (default 1), NUL-separated. */
export function identityKey(identity: TestIdentity): string {
  const occurrence = identity.occurrence ?? 1

  return `${identity.file}\0${identity.name}\0${occurrence}`
}

/**
 * Splits current and retained test identities into those retained and still
 * present, those added since the retained set, and those retained but since
 * removed, each sorted by identity key.
 */
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

/** True when two pass intervals share at least one instant, endpoints included. */
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

/** Error messages for each pair of the record's benchmark, comparison, and judgment passes that does not overlap; empty when all overlap. */
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

/** Absolute work directory of a tune session under the tune work root. Creates nothing. */
export function tuneSessionWorkDir(root: string, sessionId: string): string {
  return path.join(root, TUNE_WORK_DIR, sessionId)
}

/**
 * The tune record the latest-record pointer names, or null when the pointer
 * or the record file is missing. Throws `INVALID_JSON` when either file is
 * unreadable.
 */
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
