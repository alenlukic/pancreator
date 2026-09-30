/** Tune record shape validation against the schema and the testing handbook. */

import path from 'node:path'

import { PanError } from '../errors.js'
import { isRecord, readJson, readText } from '../io.js'
import {
  identityKey,
  type PassInterval,
  type TestIdentity,
  TUNE_WORK_DIR,
  type TuneRecord,
  validatePassOverlap,
} from './record.js'

/** Handbook that defines the principle identifiers a verdict may cite. */
const TESTING_HANDBOOK_PATH = 'governance/handbooks/eng/testing.md'

const HANDBOOK_PRINCIPLE_HEADING = /^#{2,6}\s+(TP-[0-9]{2})\b/gmu

interface TuneRecordSchemaConstraints {
  deleteReasons: Set<string>
  principlePattern: RegExp
  /**
   * Principle identifiers the testing handbook defines. The schema pattern is
   * a shape rule and cannot read a Markdown handbook, so it admits identifiers
   * from TP-11 up that no principle backs; membership lives here.
   */
  principleIds: Set<string>
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

  const principleIds = new Set(
    [
      ...readText(path.join(root, TESTING_HANDBOOK_PATH)).matchAll(
        HANDBOOK_PRINCIPLE_HEADING,
      ),
    ].map((match) => match[1]),
  )

  if (principleIds.size === 0) {
    throw new PanError(
      `${TESTING_HANDBOOK_PATH} declares no principle identifier`,
      { code: 'TUNE_HANDBOOK_INVALID' },
    )
  }

  return {
    deleteReasons: new Set(deleteReasons),
    principlePattern: new RegExp(principlePattern, 'u'),
    principleIds,
  }
}

/** Type guard: true for a record whose parseable `started_at` is not after its `ended_at`. */
export function isPassInterval(value: unknown): value is PassInterval {
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
  const documentedLane =
    typeof value === 'string' &&
    /^tests\/(?:unit|integration|regression|secondary)(?:\/.+)?$/u.test(value)

  return (
    typeof value === 'string' &&
    (documentedLane || /^cheaper direct form:\s*\S/u.test(value))
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

/** Operator-readable form of a test identity, for a message a human reads. */
function identityLabel(identity: TestIdentity): string {
  const occurrence = identity.occurrence ?? 1

  return `${identity.file}::${identity.name}${occurrence === 1 ? '' : `#${occurrence}`}`
}

/** Verdicts that take a test out of the suite. DEMOTE and KEEP leave it in. */
const REMOVAL_VERDICTS = new Set(['MERGE', 'DELETE'])

/**
 * Reject a verdict set that would leave a rule with no test.
 *
 * A verdict is authored one test at a time, which is the right granularity for
 * judging one test's value. Coverage, though, is a property of the set: "the
 * contract lives in the other test" is locally defensible on both sides of a
 * pair, and ratifying both removals loses the rule with no verdict saying so.
 * A removal that names a home therefore binds that home to survive.
 */
function validateSurvivingProof(
  verdicts: TuneRecord['verdicts'],
  errors: string[],
): void {
  const removed = new Map<string, { verdict: string; identity: TestIdentity }>()

  for (const entry of verdicts) {
    if (
      isRecord(entry) &&
      isTestIdentity(entry.identity) &&
      REMOVAL_VERDICTS.has(String(entry.verdict))
    ) {
      removed.set(identityKey(entry.identity), {
        verdict: String(entry.verdict),
        identity: entry.identity,
      })
    }
  }

  for (const entry of verdicts) {
    if (!isRecord(entry) || !isTestIdentity(entry.identity)) {
      continue
    }

    const key = identityKey(entry.identity)

    if (!removed.has(key)) {
      continue
    }

    // A survivor is the declared home; a rationale that quotes another test's
    // name is the same claim written in prose.
    const quoted = new Set(
      [...String(entry.rationale ?? '').matchAll(/`([^`]+)`/gu)].map(
        (match) => match[1],
      ),
    )
    const named = new Set<string>()

    if (isTestIdentity(entry.survivor)) {
      named.add(identityKey(entry.survivor))
    }

    for (const [candidateKey, candidate] of removed) {
      if (
        quoted.has(candidate.identity.name) ||
        quoted.has(identityLabel(candidate.identity))
      ) {
        named.add(candidateKey)
      }
    }

    for (const home of named) {
      const remover = removed.get(home)

      if (!remover || home === key) {
        continue
      }

      errors.push(
        `${String(entry.verdict)} for ${identityLabel(entry.identity)} names ` +
          `${identityLabel(remover.identity)} as the surviving proof, but ` +
          `${remover.verdict} removes it in the same set`,
      )
    }
  }
}

/**
 * Validation errors for a tune record: metadata, pass intervals and overlap,
 * inventories, comparison, benchmark, and verdicts (known principle, one per
 * current identity, a survivor for MERGE, a permitted reason for DELETE, a
 * destination for DEMOTE, and no survivor another verdict removes). Returns
 * an empty list when valid. Reads the tune schema constraints under `root`.
 */
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

    if (!constraints.principleIds.has(entry.principle)) {
      errors.push(
        `verdict for ${identityLabel(entry.identity)} cites ${entry.principle}, ` +
          `which ${TESTING_HANDBOOK_PATH} does not define`,
      )
    }

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

  validateSurvivingProof(typed.verdicts, errors)

  for (const identity of typed.current_inventory) {
    if (!verdictKeys.has(identityKey(identity))) {
      errors.push(`missing verdict for ${identityKey(identity)}`)
    }
  }

  return errors
}
