import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_COHORT_MAX_PARALLEL,
  chunkIsMerged,
  predecessorIds,
  readyUnstartedChunks,
} from '../../src/lib/cohorts.js'
import type {
  CohortChunkRecord,
  CohortSessionState,
} from '../../src/lib/types.js'

function chunk(
  id: string,
  cohortIndex: number,
  dependsOn: string[] = [],
  extra: Partial<CohortChunkRecord> = {},
): CohortChunkRecord {
  return {
    id,
    title: id,
    cohort_index: cohortIndex,
    child_spec_path: `runtime/specs/${id}.md`,
    depends_on: dependsOn,
    ...extra,
  }
}

function session(
  chunks: CohortChunkRecord[],
  extras: Partial<CohortSessionState> = {},
): CohortSessionState {
  return {
    schema_version: 1,
    cohort_id: 'session',
    plan_run_id: 'plan-run',
    parent_spec_path: 'runtime/specs/parent.md',
    base_branch: 'main',
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    chunks,
    edges: chunks.flatMap((entry) =>
      entry.depends_on.map((from) => ({ from, to: entry.id })),
    ),
    cohorts: [
      {
        index: 1,
        chunks: chunks.filter((c) => c.cohort_index === 1).map((c) => c.id),
      },
      {
        index: 2,
        chunks: chunks.filter((c) => c.cohort_index === 2).map((c) => c.id),
      },
    ].filter((group) => group.chunks.length > 0),
    satisfaction: [],
    ...extras,
  }
}

test('DEFAULT_COHORT_MAX_PARALLEL is three', () => {
  assert.equal(DEFAULT_COHORT_MAX_PARALLEL, 3)
})

test('a dependent is ready once its own predecessors have merged', () => {
  const alpha = chunk('alpha', 1)
  const beta = chunk('beta', 1)
  const gamma = chunk('gamma', 2, ['alpha'])
  const loaded = session([alpha, beta, gamma], {
    chunks: [
      { ...alpha, run_id: 'run-alpha' },
      { ...beta, run_id: 'run-beta' },
      gamma,
    ],
    satisfaction: [
      {
        cohort_index: 1,
        chunk: 'alpha',
        recorded_at: '2026-09-02T01:00:00.000Z',
        base_branch: 'main',
        merge_commit: 'abc',
        evidence_path: 'runtime/logs/cohorts/x/integration-1-alpha.json',
      },
    ],
  })

  assert.equal(chunkIsMerged(loaded, loaded.chunks[0]), true)
  assert.equal(chunkIsMerged(loaded, loaded.chunks[1]), false)
  assert.deepEqual(predecessorIds(loaded, 'gamma'), ['alpha'])
  assert.deepEqual(
    readyUnstartedChunks(loaded).map((entry) => entry.id),
    ['gamma'],
  )
})

test('a group-level proof with no chunk covers every unit of that group', () => {
  const alpha = chunk('alpha', 1)
  const beta = chunk('beta', 1)
  const loaded = session([alpha, beta], {
    satisfaction: [
      {
        cohort_index: 1,
        recorded_at: '2026-09-02T01:00:00.000Z',
        base_branch: 'main',
        merge_commit: 'abc',
        evidence_path: 'runtime/logs/cohorts/x/integration-1.json',
      },
    ],
  })

  assert.equal(chunkIsMerged(loaded, loaded.chunks[0]), true)
  assert.equal(chunkIsMerged(loaded, loaded.chunks[1]), true)
})
