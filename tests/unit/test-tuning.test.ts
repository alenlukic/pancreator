import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildBenchmarkFromProfiles,
  identityKey,
  partitionRetainedSet,
  validatePassOverlap,
  validateTuneRecordShape,
  type PassInterval,
  type TestIdentity,
  type TuneRecord,
} from '../../src/lib/test-tuning.js'
import { createTestTempDirectory } from '../temp.js'

const sample = (file: string, name: string): TestIdentity => ({
  file,
  name,
  lane: 'unit',
})

/** One recorded lane profile of a tune session, as the benchmark reads it. */
const writeLaneProfile = (
  root: string,
  name: string,
  wallMs: number,
  testName: string,
  fixtureMs: number,
): string => {
  const relative = `runtime/tune-harness/work/session/${name}.json`
  const absolute = path.join(root, relative)
  const file = `tests/${name}.test.ts`
  const fileMs = Math.max(0, wallMs - 1)
  const caseMs = Math.max(0, wallMs - 2)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      schema_version: 1,
      lane: name,
      recorded_at: '2026-01-01T10:00:00.000Z',
      test_count: 1,
      pass_count: 1,
      fail_count: 0,
      wall_clock_ms: wallMs,
      files: [
        {
          file,
          duration_ms: fileMs,
          test_count: 1,
          pass_count: 1,
          fail_count: 0,
        },
      ],
      slowest_tests: [{ file, name: testName, duration_ms: caseMs }],
      all_tests: [{ file, name: testName, duration_ms: caseMs }],
      fixture_cost: { template_ms: fixtureMs, clone_ms: fixtureMs / 2 },
    })}\n`,
  )

  return relative
}

/** A prior session record that carries nothing but the benchmark under test. */
const priorRecord = (benchmark: TuneRecord['benchmark']): TuneRecord => {
  const interval: PassInterval = {
    started_at: '2026-01-01T10:00:00.000Z',
    ended_at: '2026-01-01T10:01:00.000Z',
  }

  return {
    schema_version: 1,
    session_id: 'prior',
    harness_version: '0',
    git_commit: 'abc',
    workspace_fingerprint: 'fp',
    workspace_dirty: false,
    recorded_at: '2026-01-01T10:01:00.000Z',
    baseline_source: { kind: 'none' },
    passes: { benchmark: interval, comparison: interval, judgment: interval },
    retained_set: [],
    current_inventory: [],
    comparison: {
      retained_and_present: [],
      added_since_retained: [],
      retained_but_removed: [],
    },
    benchmark,
    verdicts: [],
    judgment_provenance: {
      handbook_path: 'governance/handbooks/eng/testing.md',
      handbook_revision: 'HEAD',
      inventory_only: true,
      inventory_path: 'runtime/tune-harness/work/s/current-inventory.json',
    },
  }
}

test('partitionRetainedSet produces three disjoint groups', () => {
  const retained = [sample('a.test.ts', 'one'), sample('b.test.ts', 'two')]
  const current = [sample('a.test.ts', 'one'), sample('c.test.ts', 'three')]
  const groups = partitionRetainedSet(current, retained)

  assert.deepEqual(groups.retained_and_present, [sample('a.test.ts', 'one')])
  assert.deepEqual(groups.added_since_retained, [sample('c.test.ts', 'three')])
  assert.deepEqual(groups.retained_but_removed, [sample('b.test.ts', 'two')])
})

test('validatePassOverlap requires all three passes to overlap', () => {
  const interval = (start: string, end: string): PassInterval => ({
    started_at: start,
    ended_at: end,
  })
  const base: TuneRecord = {
    schema_version: 1,
    session_id: 's',
    harness_version: '0',
    git_commit: 'abc',
    workspace_fingerprint: 'fp',
    workspace_dirty: false,
    recorded_at: new Date().toISOString(),
    baseline_source: { kind: 'none' },
    passes: {
      benchmark: interval(
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T10:05:00.000Z',
      ),
      comparison: interval(
        '2026-01-01T10:02:00.000Z',
        '2026-01-01T10:06:00.000Z',
      ),
      judgment: interval(
        '2026-01-01T10:03:00.000Z',
        '2026-01-01T10:07:00.000Z',
      ),
    },
    retained_set: [],
    current_inventory: [],
    comparison: {
      retained_and_present: [],
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
    verdicts: [],
    judgment_provenance: {
      handbook_path: 'governance/handbooks/eng/testing.md',
      handbook_revision: 'HEAD',
      inventory_only: true,
      inventory_path: 'runtime/tune-harness/work/s/current-inventory.json',
    },
  }

  assert.deepEqual(validatePassOverlap(base), [])
  assert.ok(
    validatePassOverlap({
      ...base,
      passes: {
        ...base.passes,
        judgment: interval(
          '2026-01-01T11:00:00.000Z',
          '2026-01-01T11:01:00.000Z',
        ),
      },
    }).length > 0,
  )
})

test('tune record validation accepts documented DEMOTE lanes only', () => {
  const identity = sample('tests/unit/a.test.ts', 'alpha')
  const interval = {
    started_at: '2026-01-01T10:00:00.000Z',
    ended_at: '2026-01-01T10:01:00.000Z',
  }
  const record: TuneRecord = {
    schema_version: 1,
    session_id: 's',
    harness_version: '0',
    git_commit: 'abc',
    workspace_fingerprint: 'fp',
    workspace_dirty: false,
    recorded_at: '2026-01-01T10:01:00.000Z',
    baseline_source: { kind: 'none' },
    passes: {
      benchmark: interval,
      comparison: interval,
      judgment: interval,
    },
    retained_set: [identity],
    current_inventory: [identity],
    comparison: {
      retained_and_present: [identity],
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
    verdicts: [],
    judgment_provenance: {
      handbook_path: 'governance/handbooks/eng/testing.md',
      handbook_revision: 'HEAD',
      inventory_only: true,
      inventory_path: 'runtime/tune-harness/work/s/current-inventory.json',
    },
  }

  for (const destination of [
    'tests/unit',
    'tests/unit/example.test.ts',
    'tests/integration',
    'tests/integration/example.test.ts',
    'tests/regression',
    'tests/regression/example.test.ts',
    'tests/secondary',
    'tests/secondary/example.test.ts',
    'cheaper direct form: call the exported function',
  ]) {
    const candidate = {
      ...record,
      verdicts: [
        {
          identity,
          verdict: 'DEMOTE' as const,
          principle: 'TP-03',
          rationale: 'Use the documented lane.',
          demote_destination: destination,
        },
      ],
    }

    assert.deepEqual(validateTuneRecordShape(candidate, process.cwd()), [])
  }

  const invalid = {
    ...record,
    verdicts: [
      {
        identity,
        verdict: 'DEMOTE' as const,
        principle: 'TP-03',
        rationale: 'Use an unknown lane.',
        demote_destination: 'tests/unknown/example.test.ts',
      },
    ],
  }

  assert.ok(
    validateTuneRecordShape(invalid, process.cwd()).some((error) =>
      error.includes('actionable destination'),
    ),
  )

  const badMerge = {
    ...record,
    verdicts: [
      {
        identity,
        verdict: 'MERGE' as const,
        principle: 'TP-01',
        rationale: 'Use the current survivor.',
        survivor: sample('tests/unit/missing.test.ts', 'missing'),
      },
    ],
  }
  const badDelete = {
    ...record,
    verdicts: [
      {
        identity,
        verdict: 'DELETE' as const,
        principle: 'TP-01',
        rationale: 'Delete the duplicate.',
        delete_reason: 'too_slow',
      },
    ],
  }
  const badProvenance = {
    ...record,
    judgment_provenance: {
      ...record.judgment_provenance,
      similarity_index_path: 'runtime/tune-harness/work/s/fast-profile.json',
    },
  }

  assert.ok(
    validateTuneRecordShape(badMerge, process.cwd()).some((error) =>
      error.includes('current survivor'),
    ),
  )
  assert.ok(
    validateTuneRecordShape(badDelete, process.cwd()).some((error) =>
      error.includes('permitted reason'),
    ),
  )
  assert.ok(
    validateTuneRecordShape(badProvenance, process.cwd()).some((error) =>
      error.includes('unpermitted similarity input'),
    ),
  )
})

test('identityKey includes occurrence suffix for duplicate names', () => {
  const first = { ...sample('dup.test.ts', 'same'), occurrence: 1 }
  const second = { ...sample('dup.test.ts', 'same'), occurrence: 2 }

  assert.notEqual(identityKey(first), identityKey(second))

  // A retained set records the first occurrence implicitly and an inventory
  // pass records it explicitly. Both must name the same test, or the
  // comparison reports the whole duplicate-named family as removed and added.
  assert.equal(identityKey(sample('dup.test.ts', 'same')), identityKey(first))
})

test('buildBenchmarkFromProfiles preserves every timing and fixture cost', () => {
  const root = createTestTempDirectory('pan-tune-benchmark-')
  const fast = writeLaneProfile(root, 'fast', 100, 'fast test', 8)
  const secondary = writeLaneProfile(
    root,
    'secondary',
    200,
    'secondary test',
    10,
  )
  const benchmark = buildBenchmarkFromProfiles(root, fast, secondary, null)

  assert.equal(benchmark.fast_lane_wall_ms, 100)
  assert.equal(benchmark.secondary_lane_wall_ms, 200)
  assert.deepEqual(
    benchmark.tests.map((entry) => entry.name),
    ['fast test', 'secondary test'],
  )
  assert.equal(benchmark.fixture_template_ms, 18)
  assert.equal(benchmark.fixture_clone_ms, 9)
})

test('an absent secondary lane is null and a measured zero stays zero', () => {
  const root = createTestTempDirectory('pan-tune-secondary-absent-')
  const fast = writeLaneProfile(root, 'fast', 100, 'fast test', 8)

  // Coercing both to 0 made a session that never ran the lane indistinguishable
  // from one that ran it and measured nothing.
  assert.equal(
    buildBenchmarkFromProfiles(root, fast, null, null).secondary_lane_wall_ms,
    null,
  )

  const measuredZero = writeLaneProfile(root, 'secondary', 0, 'zero test', 0)

  assert.equal(
    buildBenchmarkFromProfiles(root, fast, measuredZero, null)
      .secondary_lane_wall_ms,
    0,
  )
})

test('the secondary lane delta needs a measurement on both sides', () => {
  const root = createTestTempDirectory('pan-tune-secondary-delta-')
  const fast = writeLaneProfile(root, 'fast', 100, 'fast test', 8)
  const secondary = writeLaneProfile(
    root,
    'secondary',
    200,
    'secondary test',
    10,
  )
  const withLane = buildBenchmarkFromProfiles(root, fast, secondary, null)
  const withoutLane = buildBenchmarkFromProfiles(root, fast, null, null)
  const deltaKeys = (benchmark: TuneRecord['benchmark']): string[] =>
    Object.keys(benchmark.prior_deltas ?? {})

  assert.equal(
    deltaKeys(
      buildBenchmarkFromProfiles(
        root,
        fast,
        secondary,
        priorRecord(withoutLane),
      ),
    ).includes('secondary_lane_wall_ms'),
    false,
  )
  assert.equal(
    deltaKeys(
      buildBenchmarkFromProfiles(root, fast, null, priorRecord(withLane)),
    ).includes('secondary_lane_wall_ms'),
    false,
  )

  // Both sides measured 200, so the honest delta is a real zero rather than
  // the absent key the two unmeasured comparisons report.
  assert.equal(
    buildBenchmarkFromProfiles(root, fast, secondary, priorRecord(withLane))
      .prior_deltas?.secondary_lane_wall_ms,
    0,
  )
})
