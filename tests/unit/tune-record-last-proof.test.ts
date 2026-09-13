import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateTuneRecordShape,
  type TestIdentity,
  type TuneRecord,
} from '../../src/lib/test-tuning.js'

const ROOT = process.cwd()

const ALPHA: TestIdentity = {
  file: 'tests/unit/a.test.ts',
  name: 'the waiver reaches the entry gate it names',
  lane: 'unit',
}

const BETA: TestIdentity = {
  file: 'tests/unit/b.test.ts',
  name: 'a waiver for an unknown gate is refused by name',
  lane: 'unit',
}

const INTERVAL = {
  started_at: '2026-01-01T10:00:00.000Z',
  ended_at: '2026-01-01T10:01:00.000Z',
}

function record(verdicts: TuneRecord['verdicts']): TuneRecord {
  return {
    schema_version: 1,
    session_id: 's',
    harness_version: '0',
    git_commit: 'abc',
    workspace_fingerprint: 'fp',
    workspace_dirty: false,
    recorded_at: '2026-01-01T10:01:00.000Z',
    baseline_source: { kind: 'none' },
    passes: {
      benchmark: INTERVAL,
      comparison: INTERVAL,
      judgment: INTERVAL,
    },
    retained_set: [ALPHA, BETA],
    current_inventory: [ALPHA, BETA],
    comparison: {
      retained_and_present: [ALPHA, BETA],
      added_since_retained: [],
      retained_but_removed: [],
    },
    benchmark: {
      fast_lane_wall_ms: 1,
      secondary_lane_wall_ms: 0,
      fixture_template_ms: 0,
      fixture_clone_ms: 0,
      files: [],
      tests: [],
      slowest_tests: [],
    },
    verdicts,
    judgment_provenance: {
      handbook_path: 'governance/handbooks/eng/testing.md',
      handbook_revision: 'HEAD',
      inventory_only: true,
      inventory_path: 'runtime/tune-harness/work/s/current-inventory.json',
    },
  }
}

test('a verdict set whose two removals each name the other as survivor is refused', () => {
  const errors = validateTuneRecordShape(
    record([
      {
        identity: ALPHA,
        verdict: 'MERGE',
        principle: 'TP-01',
        rationale: 'The rule is proved by the other waiver case.',
        survivor: BETA,
      },
      {
        identity: BETA,
        verdict: 'MERGE',
        principle: 'TP-01',
        rationale: 'The rule is proved by the other waiver case.',
        survivor: ALPHA,
      },
    ]),
    ROOT,
  )

  assert.deepEqual(errors, [
    `MERGE for ${ALPHA.file}::${ALPHA.name} names ${BETA.file}::${BETA.name} as the surviving proof, but MERGE removes it in the same set`,
    `MERGE for ${BETA.file}::${BETA.name} names ${ALPHA.file}::${ALPHA.name} as the surviving proof, but MERGE removes it in the same set`,
  ])
})

test('a deletion whose rationale quotes a test the same set removes is refused', () => {
  const errors = validateTuneRecordShape(
    record([
      {
        identity: ALPHA,
        verdict: 'DELETE',
        principle: 'TP-01',
        rationale: `The contract lives in \`${BETA.name}\`.`,
        delete_reason: 'duplicate_contract',
      },
      {
        identity: BETA,
        verdict: 'DELETE',
        principle: 'TP-01',
        rationale: 'No unique contract remains.',
        delete_reason: 'no_contract',
      },
    ]),
    ROOT,
  )

  assert.deepEqual(errors, [
    `DELETE for ${ALPHA.file}::${ALPHA.name} names ${BETA.file}::${BETA.name} as the surviving proof, but DELETE removes it in the same set`,
  ])
})

test('a verdict set whose every named home survives is accepted', () => {
  assert.deepEqual(
    validateTuneRecordShape(
      record([
        {
          identity: ALPHA,
          verdict: 'MERGE',
          principle: 'TP-01',
          rationale: `The contract lives in \`${BETA.name}\`.`,
          survivor: BETA,
        },
        {
          identity: BETA,
          verdict: 'KEEP',
          principle: 'TP-01',
          rationale: 'It proves the refusal path on its own.',
        },
      ]),
      ROOT,
    ),
    [],
  )
})

test('a DEMOTE of a named home leaves the proof in place', () => {
  // DEMOTE moves a contract to a cheaper lane or form. The assertion survives,
  // so a removal may name it.
  assert.deepEqual(
    validateTuneRecordShape(
      record([
        {
          identity: ALPHA,
          verdict: 'DELETE',
          principle: 'TP-01',
          rationale: `The contract lives in \`${BETA.name}\`.`,
          delete_reason: 'duplicate_contract',
        },
        {
          identity: BETA,
          verdict: 'DEMOTE',
          principle: 'TP-03',
          rationale: 'An integration case is the cheaper truthful proof.',
          demote_destination: 'tests/integration/b.test.ts',
        },
      ]),
      ROOT,
    ),
    [],
  )
})

test('a verdict citing a principle the testing handbook does not define is refused', () => {
  const errors = validateTuneRecordShape(
    record([
      {
        identity: ALPHA,
        verdict: 'KEEP',
        principle: 'TP-42',
        rationale: 'It proves the waiver reach.',
      },
      {
        identity: BETA,
        verdict: 'KEEP',
        principle: 'TP-01',
        rationale: 'It proves the refusal path.',
      },
    ]),
    ROOT,
  )

  assert.deepEqual(errors, [
    `verdict for ${ALPHA.file}::${ALPHA.name} cites TP-42, which governance/handbooks/eng/testing.md does not define`,
  ])
})
