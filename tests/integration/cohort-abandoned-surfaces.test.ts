import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonChunk,
  cleanCohortSession,
  cohortDir,
  cohortStatus,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import type {
  CohortSessionState,
  RunState,
  RunStatus,
} from '../../src/lib/types.js'
import { createFixture, read, writeJson } from '../helpers.js'

const COHORT_ID = '10000_Sep-13-0000_cohort-aband'

/** A two-chunk session whose chunks both sit in the active cohort. */
function writeSession(
  root: string,
  chunks: CohortSessionState['chunks'],
): CohortSessionState {
  const state: CohortSessionState = {
    schema_version: 1,
    cohort_id: COHORT_ID,
    plan_run_id: 'plan-run',
    parent_spec_path: 'runtime/specs/parent-specification.md',
    base_branch: 'main',
    created_at: '2026-09-13T00:00:00.000Z',
    updated_at: '2026-09-13T00:00:00.000Z',
    chunks,
    edges: [],
    cohorts: [{ index: 1, chunks: chunks.map((chunk) => chunk.id) }],
    satisfaction: [],
  }

  mkdirSync(cohortDir(root, COHORT_ID), { recursive: true })
  writeJson(path.join(cohortDir(root, COHORT_ID), 'state.json'), state)

  return state
}

function chunk(
  id: string,
  patch: Partial<CohortSessionState['chunks'][number]> = {},
): CohortSessionState['chunks'][number] {
  return {
    id,
    title: `Chunk ${id}`,
    cohort_index: 1,
    child_spec_path: `runtime/specs/${id}.md`,
    depends_on: [],
    ...patch,
  }
}

function writeChunkRun(root: string, runId: string, status: RunStatus): void {
  writeJson(
    path.join(
      root,
      'runtime',
      'logs',
      'workflows',
      runId,
      'agent',
      'state.json',
    ),
    {
      schema_version: 2,
      run_id: runId,
      workflow_slug: 'delivery-chunk',
      workflow_snapshot: { path: 'snapshot.json', sha256: 'sha' },
      workspace_root: '.',
      title: runId,
      status,
      current_stage: status === 'succeeded' ? null : 'implement',
      pending_action: { type: 'prepare_invocation' },
      current_invocation: null,
      request: { source_path: 'r.md', stored_path: 'r.md', sha256: 'sha' },
      limits: {
        max_total_transitions: 12,
        max_stage_attempts: 3,
        max_consecutive_failures: 3,
      },
      attempts: {},
      transition_count: 0,
      consecutive_failures: 0,
      stage_history: [],
      revision: 1,
      created_at: '2026-09-13T00:00:00.000Z',
      updated_at: '2026-09-13T00:00:00.000Z',
    },
  )
}

// HR3-010: the session offered `cohort integrate` for a cohort the operator
// had abandoned whole. There was no branch to merge, so the command named
// work that could not happen.
test('a fully abandoned cohort advertises no integration command', () => {
  const root = createFixture()

  writeSession(root, [
    chunk('c1', { run_id: 'chunk-c1', worktree: 'cohort-c1' }),
    chunk('c2', { run_id: 'chunk-c2', worktree: 'cohort-c2' }),
  ])
  writeChunkRun(root, 'chunk-c1', 'succeeded')
  writeChunkRun(root, 'chunk-c2', 'succeeded')

  // A cohort with real work to merge still offers the merge.
  const mergeable = cohortStatus(root, COHORT_ID)

  assert.match(mergeable.integrate_command ?? '', /cohort integrate/u)
  assert.equal(mergeable.record_abandoned_cohort_command, null)

  abandonChunk(root, COHORT_ID, 'c1', 'Superseded by c2.')

  // One abandoned chunk still leaves a branch to merge.
  assert.match(
    cohortStatus(root, COHORT_ID).integrate_command ?? '',
    /cohort integrate/u,
  )

  abandonChunk(root, COHORT_ID, 'c2', 'Folded into the next phase.')

  const abandoned = cohortStatus(root, COHORT_ID)

  assert.equal(abandoned.integrate_command, null)
  // The operator is not stranded: the command that does apply records the
  // abandonment so the next cohort unblocks.
  assert.match(
    abandoned.record_abandoned_cohort_command ?? '',
    /cohort integrate/u,
  )
  assert.equal(abandoned.active_cohort_index, 1)
})

// HR3-011: the operator had already recorded the abandonment with a note,
// and clean still demanded --force to discard the same work.
test('a recorded abandonment discards its dirty worktree without a force flag', () => {
  const root = createFixture()
  const abandonedTree = createWorktree(root, 'cohort-abandoned')
  const activeTree = createWorktree(root, 'cohort-active')

  writeSession(root, [
    chunk('c1', { run_id: 'chunk-c1', worktree: abandonedTree.name }),
    chunk('c2', { run_id: 'chunk-c2', worktree: activeTree.name }),
  ])
  writeChunkRun(root, 'chunk-c1', 'succeeded')
  writeChunkRun(root, 'chunk-c2', 'succeeded')
  writeFileSync(
    path.join(root, abandonedTree.path, 'unsaved.txt'),
    'work in progress\n',
  )
  writeFileSync(
    path.join(root, activeTree.path, 'unsaved.txt'),
    'work in progress\n',
  )

  // Neither chunk is abandoned yet, so both keep the coded refusal.
  assert.throws(
    () => cleanCohortSession(root, COHORT_ID),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_WORKTREE_DIRTY',
  )

  abandonChunk(root, COHORT_ID, 'c1', 'Superseded by c2.')

  // The unabandoned chunk still refuses, and the refusal stops the whole
  // command, so the abandoned chunk's worktree survives too.
  assert.throws(
    () => cleanCohortSession(root, COHORT_ID),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_WORKTREE_DIRTY',
  )

  abandonChunk(root, COHORT_ID, 'c2', 'Folded into the next phase.')

  const cleaned = cleanCohortSession(root, COHORT_ID)

  assert.deepEqual(cleaned.removed_worktrees, [
    abandonedTree.name,
    activeTree.name,
  ])

  // The result says why the uncommitted work went without the flag.
  assert.deepEqual(cleaned.discarded_abandoned_chunks, [
    {
      chunk: 'c1',
      worktree: abandonedTree.name,
      note: 'Superseded by c2.',
    },
    {
      chunk: 'c2',
      worktree: activeTree.name,
      note: 'Folded into the next phase.',
    },
  ])
})

// Abandoning a chunk drops its work; it does not stop the agent still
// writing into that workspace.
test('a recorded abandonment does not exempt a live chunk run', () => {
  const root = createFixture()
  const tree = createWorktree(root, 'cohort-live')

  writeSession(root, [chunk('c1', { run_id: 'chunk-c1', worktree: tree.name })])
  writeChunkRun(root, 'chunk-c1', 'running')
  abandonChunk(root, COHORT_ID, 'c1', 'Superseded.')

  assert.throws(
    () => cleanCohortSession(root, COHORT_ID),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_RUN_ACTIVE',
  )
})

/** Put the plan run under the contract the exclusion behaviour is gated on. */
function longHorizonPlanRun(root: string): void {
  writeChunkRun(root, 'plan-run', 'succeeded')

  const planPath = path.join(
    root,
    'runtime',
    'logs',
    'workflows',
    'plan-run',
    'agent',
    'state.json',
  )
  const plan = read(planPath) as RunState

  plan.operator_involvement = {
    profile: 'long-horizon',
    summary: 'Long-horizon test profile.',
    contracts: ['long_horizon'],
    applied_gates: {},
  }
  writeJson(planPath, plan)
}

function followUpPath(root: string, chunkId: string): string {
  return path.join(
    root,
    'runtime',
    'inbox',
    'queue',
    `cohort-${COHORT_ID}-${chunkId}-excluded.md`,
  )
}

test('long-horizon exclusion drops only dependent cohort units and writes a follow-up', () => {
  const root = createFixture()
  const state = writeSession(root, [chunk('c1'), chunk('c2'), chunk('c3')])
  writeJson(path.join(cohortDir(root, COHORT_ID), 'state.json'), {
    ...state,
    edges: [{ from: 'c1', to: 'c2' }],
  })
  longHorizonPlanRun(root)

  const excluded = abandonChunk(
    root,
    COHORT_ID,
    'c1',
    'The unit cannot complete unattended.',
  )

  assert.equal(
    excluded.chunks.find((item) => item.id === 'c1')?.abandoned?.note,
    'The unit cannot complete unattended.',
  )
  assert.match(
    excluded.chunks.find((item) => item.id === 'c2')?.abandoned?.note ?? '',
    /because chunk 'c1' was excluded/u,
  )
  assert.equal(
    excluded.chunks.find((item) => item.id === 'c3')?.abandoned,
    undefined,
  )
  assert.equal(existsSync(followUpPath(root, 'c1')), true)
})

test('exclusion follows a dependency declared only on the chunk', () => {
  const root = createFixture()

  // A plan may state a dependency on the chunk instead of in `edges`, and the
  // cohort-plan validator accepts either, so the exclusion walk reads both.
  writeSession(root, [
    chunk('c1'),
    chunk('c2', { depends_on: ['c1'] }),
    chunk('c3'),
  ])
  longHorizonPlanRun(root)

  const excluded = abandonChunk(
    root,
    COHORT_ID,
    'c1',
    'The unit cannot complete unattended.',
  )

  assert.match(
    excluded.chunks.find((item) => item.id === 'c2')?.abandoned?.note ?? '',
    /because chunk 'c1' was excluded/u,
  )
  assert.equal(
    excluded.chunks.find((item) => item.id === 'c3')?.abandoned,
    undefined,
  )
})

test('exclusion outside the contract stays one operator-owned chunk', () => {
  const root = createFixture()
  const state = writeSession(root, [
    chunk('c1'),
    chunk('c2', { depends_on: ['c1'] }),
  ])
  writeJson(path.join(cohortDir(root, COHORT_ID), 'state.json'), {
    ...state,
    edges: [{ from: 'c1', to: 'c2' }],
  })
  writeChunkRun(root, 'plan-run', 'succeeded')

  const abandoned = abandonChunk(root, COHORT_ID, 'c1', 'Operator dropped it.')

  assert.equal(
    abandoned.chunks.find((item) => item.id === 'c1')?.abandoned?.note,
    'Operator dropped it.',
  )
  assert.equal(
    abandoned.chunks.find((item) => item.id === 'c2')?.abandoned,
    undefined,
  )
  assert.equal(existsSync(followUpPath(root, 'c1')), false)
})
