import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FILE_DURATION_MAX_AGE_MS,
  mergeFileDurationRecord,
  orderTestFileArguments,
  type FileDurationRecord,
} from '../../src/lib/test-file-order.js'

test('recorded test files order unknown first and then longest first', () => {
  const arguments_ = [
    'node',
    '--test',
    'dist/tests/unit/fast.test.js',
    'dist/tests/unit/slow.test.js',
    'dist/tests/unit/unknown.test.js',
  ]

  assert.deepEqual(
    orderTestFileArguments(
      arguments_,
      {
        schema_version: 1,
        recorded_at: '2026-09-15T00:00:00.000Z',
        lane: 'unit',
        wall_clock_ms: 110,
        test_count: 2,
        files: [
          { file: 'dist/tests/unit/fast.test.js', duration_ms: 10 },
          { file: 'dist/tests/unit/slow.test.js', duration_ms: 100 },
        ],
      },
      '/repo',
    ),
    [
      'node',
      '--test',
      'dist/tests/unit/unknown.test.js',
      'dist/tests/unit/slow.test.js',
      'dist/tests/unit/fast.test.js',
    ],
  )
})

test('missing or malformed duration records preserve argument order', () => {
  const arguments_ = [
    'node',
    '--test',
    'dist/tests/unit/first.test.js',
    'dist/tests/unit/second.test.js',
  ]

  assert.deepEqual(
    orderTestFileArguments(arguments_, null, '/repo'),
    arguments_,
  )
  assert.deepEqual(
    orderTestFileArguments(arguments_, { schema_version: 2 }, '/repo'),
    arguments_,
  )
})

// Two files recorded at the same cost must still dispatch in one order, or
// consecutive runs of an unchanged suite schedule differently.
test('files of equal recorded duration keep their received order', () => {
  const arguments_ = [
    'node',
    '--test',
    'dist/tests/unit/second.test.js',
    'dist/tests/unit/first.test.js',
  ]

  assert.deepEqual(
    orderTestFileArguments(
      arguments_,
      {
        schema_version: 1,
        recorded_at: '2026-09-15T00:00:00.000Z',
        lane: 'unit',
        wall_clock_ms: 20,
        test_count: 2,
        files: [
          { file: 'dist/tests/unit/first.test.js', duration_ms: 10 },
          { file: 'dist/tests/unit/second.test.js', duration_ms: 10 },
        ],
      },
      '/repo',
    ),
    arguments_,
  )
})

function measured(
  recordedAt: string,
  files: Array<[string, number]>,
): FileDurationRecord {
  return {
    schema_version: 1,
    recorded_at: recordedAt,
    lane: 'unit',
    wall_clock_ms: files.reduce((total, [, duration]) => total + duration, 0),
    test_count: files.length,
    files: files.map(([file, duration_ms]) => ({ file, duration_ms })),
  }
}

// The impacted loop every implementing stage iterates on measures a subset of
// the suite. Replacing the record with that subset left every other file
// unmeasured, and unmeasured files lead, so the long pole went last.
test('a run that measures a subset still dispatches the long pole first', () => {
  const complete = measured('2026-09-15T00:00:00.000Z', [
    ['dist/tests/integration/long-pole.test.js', 74_700],
    ['dist/tests/unit/a.test.js', 200],
    ['dist/tests/unit/b.test.js', 100],
  ])
  const subset = measured('2026-09-15T01:00:00.000Z', [
    ['dist/tests/unit/a.test.js', 220],
  ])
  const merged = mergeFileDurationRecord(complete, subset)

  assert.deepEqual(
    merged.files.map((entry) => [entry.file, entry.duration_ms]),
    [
      ['dist/tests/integration/long-pole.test.js', 74_700],
      ['dist/tests/unit/a.test.js', 220],
      ['dist/tests/unit/b.test.js', 100],
    ],
  )
  assert.deepEqual(
    orderTestFileArguments(
      [
        'node',
        '--test',
        'dist/tests/unit/a.test.js',
        'dist/tests/integration/long-pole.test.js',
        'dist/tests/unit/b.test.js',
      ],
      merged,
      '/repo',
    ).slice(2),
    [
      'dist/tests/integration/long-pole.test.js',
      'dist/tests/unit/a.test.js',
      'dist/tests/unit/b.test.js',
    ],
  )
})

test('merging drops measurements no run has refreshed for too long', () => {
  const now = Date.parse('2026-09-15T00:00:00.000Z')
  const stale = measured(
    new Date(now - FILE_DURATION_MAX_AGE_MS - 1).toISOString(),
    [['dist/tests/unit/abandoned.test.js', 900]],
  )
  const fresh = measured(new Date(now).toISOString(), [
    ['dist/tests/unit/current.test.js', 100],
  ])

  assert.deepEqual(
    mergeFileDurationRecord(stale, fresh).files.map((entry) => entry.file),
    ['dist/tests/unit/current.test.js'],
  )
  // The same entry one millisecond inside the bound is still scheduling input.
  assert.deepEqual(
    mergeFileDurationRecord(
      measured(new Date(now - FILE_DURATION_MAX_AGE_MS).toISOString(), [
        ['dist/tests/unit/abandoned.test.js', 900],
      ]),
      fresh,
    ).files.map((entry) => entry.file),
    ['dist/tests/unit/abandoned.test.js', 'dist/tests/unit/current.test.js'],
  )
})

test('merging over an absent or unreadable record keeps this run intact', () => {
  const fresh = measured('2026-09-15T00:00:00.000Z', [
    ['dist/tests/unit/only.test.js', 100],
  ])

  for (const existing of [null, 'not a record', { schema_version: 2 }]) {
    const merged = mergeFileDurationRecord(existing, fresh)

    assert.deepEqual(
      merged.files.map((entry) => entry.file),
      ['dist/tests/unit/only.test.js'],
    )
    assert.equal(merged.recorded_at, fresh.recorded_at)
    assert.equal(merged.files[0]?.recorded_at, fresh.recorded_at)
  }
})
