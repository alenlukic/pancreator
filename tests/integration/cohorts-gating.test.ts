import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonChunk,
  claimCohortBaselineCapture,
  cohortBaselineDirectory,
  cohortDir,
  cohortIsSatisfied,
  cohortStatus,
  assertCohortRunUnblocked,
  integrateCohort,
  loadCohortState,
  recordCohortBaselines,
  releaseCohortBaselineClaim,
  startCohort,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import type { CohortSessionState, RunStatus } from '../../src/lib/types.js'
import { createFixture, writeJson } from '../helpers.js'
import {
  COHORT_ID,
  EMBEDDED_PAN,
  boundRun,
  planFixture,
  setInstallationMode,
  writeSpecs,
} from './cohorts-helpers.js'

function writeCohortState(
  root: string,
  patch: Partial<CohortSessionState> = {},
): CohortSessionState {
  const plan = planFixture()
  const state: CohortSessionState = {
    schema_version: 1,
    cohort_id: COHORT_ID,
    plan_run_id: 'plan-run',
    parent_spec_path: plan.parent_spec_path as string,
    base_branch: 'main',
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    chunks: plan.chunks as CohortSessionState['chunks'],
    edges: plan.edges as CohortSessionState['edges'],
    cohorts: plan.cohorts as CohortSessionState['cohorts'],
    satisfaction: [],
    ...patch,
  }

  mkdirSync(cohortDir(root, COHORT_ID), { recursive: true })
  writeJson(path.join(cohortDir(root, COHORT_ID), 'state.json'), state)

  return state
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
      workflow_slug: 'delivery',
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
      created_at: '2026-09-02T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
    },
  )
}

test('a cohort needs both succeeded runs and a merge proof to be satisfied', () => {
  const root = createFixture()
  const state = writeCohortState(root, {
    chunks: [
      {
        id: 'c1',
        title: 'First outcome',
        cohort_index: 1,
        child_spec_path: 'runtime/specs/c1.md',
        depends_on: [],
        run_id: 'chunk-c1',
      },
      {
        id: 'c2',
        title: 'Second outcome',
        cohort_index: 2,
        child_spec_path: 'runtime/specs/c2.md',
        depends_on: ['c1'],
      },
    ],
  })

  writeChunkRun(root, 'chunk-c1', 'running')
  assert.equal(cohortIsSatisfied(root, state, 1), false)

  writeChunkRun(root, 'chunk-c1', 'succeeded')
  assert.equal(
    cohortIsSatisfied(root, state, 1),
    false,
    'succeeded runs alone leave the chunk branches unmerged',
  )

  const merged: CohortSessionState = {
    ...state,
    satisfaction: [
      {
        cohort_index: 1,
        recorded_at: '2026-09-02T01:00:00.000Z',
        base_branch: 'main',
        merge_commit: 'abc123',
        evidence_path: 'runtime/logs/cohorts/x/integration-1.json',
      },
    ],
  }

  assert.equal(cohortIsSatisfied(root, merged, 1), true)
})

test('a cohort-bound run cannot be advanced past an unsatisfied predecessor', () => {
  const root = createFixture()

  writeCohortState(root)
  writeChunkRun(root, 'chunk-c1', 'running')

  assert.throws(
    () => assertCohortRunUnblocked(root, boundRun(2, 'c2')),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_PREDECESSOR_UNSATISFIED' &&
      error.message.includes(COHORT_ID) &&
      error.message.includes('cohort 1'),
  )

  // Cohort 1 has no predecessor, so it is never blocked.
  assert.doesNotThrow(() => assertCohortRunUnblocked(root, boundRun(1, 'c1')))

  // A run outside every cohort, and a run naming a session that was never
  // written, both leave prepare untouched rather than refusing it.
  const unbound = boundRun(2, 'c2')

  delete unbound.cohort
  assert.doesNotThrow(() => assertCohortRunUnblocked(root, unbound))
  assert.doesNotThrow(() =>
    assertCohortRunUnblocked(
      root,
      boundRun(2, 'c2', '10000_Sep-02-0000_cohort-gone'),
    ),
  )
})

test('starting a later cohort is refused while an earlier one is unsatisfied', () => {
  const root = createFixture()

  writeSpecs(root)
  writeCohortState(root, {
    satisfaction: [],
    chunks: [
      {
        id: 'c1',
        title: 'First outcome',
        cohort_index: 1,
        child_spec_path: 'runtime/specs/c1.md',
        depends_on: [],
        run_id: 'chunk-c1',
      },
      {
        id: 'c2',
        title: 'Second outcome',
        cohort_index: 2,
        child_spec_path: 'runtime/specs/c2.md',
        depends_on: ['c1'],
      },
    ],
  })
  writeChunkRun(root, 'chunk-c1', 'succeeded')

  // Cohort 1's runs succeeded but nothing merged, so cohort 1 is still the
  // active cohort and its only chunk already has a run.
  assert.throws(
    () => startCohort(root, COHORT_ID),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_ALREADY_STARTED',
  )

  // Naming cohort 2 explicitly is the one way to ask for a later cohort, and
  // the unmerged predecessor refuses it.
  assert.throws(
    () => startCohort(root, COHORT_ID, { cohortIndex: 2 }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_PREDECESSOR_UNSATISFIED' &&
      error.message.includes('cohort 1 is unsatisfied') &&
      error.message.includes(`cohort integrate ${COHORT_ID}`),
  )
  assert.throws(
    () => startCohort(root, COHORT_ID, { cohortIndex: 7 }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_NOT_FOUND' &&
      error.message.includes('declares no cohort 7'),
  )

  // The refusal names the pan entrypoint of the installation, which for an
  // embedded harness is the nested path, never './bin/pan'.
  setInstallationMode(root, 'embedded')

  assert.throws(
    () => startCohort(root, COHORT_ID, { cohortIndex: 2 }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_PREDECESSOR_UNSATISFIED' &&
      error.message.includes(
        `'${EMBEDDED_PAN} cohort integrate ${COHORT_ID}'`,
      ) &&
      !error.message.includes("'./bin/pan"),
  )
})

test('cohort status names the pan entrypoint of the installation', () => {
  const root = createFixture()

  writeCohortState(root)
  setInstallationMode(root, 'embedded')

  // The supervisor runs start_command verbatim from the target root, where
  // only the embedded harness path resolves.
  const unstarted = cohortStatus(root, COHORT_ID)

  assert.equal(
    unstarted.start_command,
    `${EMBEDDED_PAN} cohort start ${COHORT_ID}`,
  )
  assert.equal(unstarted.integrate_command, null)

  writeCohortState(root, {
    chunks: [
      {
        id: 'c1',
        title: 'First outcome',
        cohort_index: 1,
        child_spec_path: 'runtime/specs/c1.md',
        depends_on: [],
        run_id: 'chunk-c1',
      },
      {
        id: 'c2',
        title: 'Second outcome',
        cohort_index: 2,
        child_spec_path: 'runtime/specs/c2.md',
        depends_on: ['c1'],
      },
    ],
  })
  writeChunkRun(root, 'chunk-c1', 'succeeded')

  const ready = cohortStatus(root, COHORT_ID)

  assert.equal(
    ready.integrate_command,
    `${EMBEDDED_PAN} cohort integrate ${COHORT_ID}`,
  )
  assert.equal(ready.start_command, null)

  setInstallationMode(root, 'detached')
  assert.equal(
    cohortStatus(root, COHORT_ID).integrate_command,
    `${path.join(root, 'bin', 'pan')} cohort integrate ${COHORT_ID}`,
  )
})

test('integration writes no merge proof while a chunk run has not succeeded', () => {
  const root = createFixture()

  writeSpecs(root)
  writeCohortState(root, {
    chunks: [
      {
        id: 'c1',
        title: 'First outcome',
        cohort_index: 1,
        child_spec_path: 'runtime/specs/c1.md',
        depends_on: [],
        run_id: 'chunk-c1',
        worktree: 'cohort-abc-c1',
        branch: 'cohort-abc-c1',
      },
      {
        id: 'c2',
        title: 'Second outcome',
        cohort_index: 2,
        child_spec_path: 'runtime/specs/c2.md',
        depends_on: ['c1'],
      },
    ],
  })
  writeChunkRun(root, 'chunk-c1', 'failed')

  assert.throws(
    () => integrateCohort(root, COHORT_ID),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_INTEGRATION_INCOMPLETE',
  )

  assert.deepEqual(cohortStatus(root, COHORT_ID).satisfied_cohort_indexes, [])
  assert.equal(cohortStatus(root, COHORT_ID).active_cohort_index, 1)
  assert.throws(
    () => assertCohortRunUnblocked(root, boundRun(2, 'c2')),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_PREDECESSOR_UNSATISFIED',
  )
})

test('abandoning a chunk is an operator decision that needs a note', () => {
  const root = createFixture()

  writeCohortState(root)

  assert.throws(
    () => abandonChunk(root, COHORT_ID, 'c1', '  '),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_ARGUMENT',
  )
  assert.throws(
    () => abandonChunk(root, COHORT_ID, 'absent', 'Superseded.'),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_CHUNK_NOT_FOUND',
  )

  const state = abandonChunk(root, COHORT_ID, 'c1', 'Superseded by c2.')

  assert.equal(
    state.chunks.find((chunk) => chunk.id === 'c1')?.abandoned?.note,
    'Superseded by c2.',
  )
})

test('the shared baseline claim admits one live capturer at a time', () => {
  const root = createFixture()
  const cohortId = writeCohortState(root).cohort_id

  assert.deepEqual(claimCohortBaselineCapture(root, cohortId, 'run-a'), {
    status: 'capture',
  })
  assert.equal(
    loadCohortState(root, cohortId).repository_check_baseline_capture?.run_id,
    'run-a',
  )

  // Another run cannot capture while the claimant's process is alive.
  assert.throws(
    () => claimCohortBaselineCapture(root, cohortId, 'run-b'),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_BASELINE_CAPTURE_IN_PROGRESS' &&
      error.message.includes('run-a'),
  )

  // The claimant may re-enter its own claim; a stranger's release is a no-op.
  assert.deepEqual(claimCohortBaselineCapture(root, cohortId, 'run-a'), {
    status: 'capture',
  })
  releaseCohortBaselineClaim(root, cohortId, 'run-b')
  assert.equal(
    loadCohortState(root, cohortId).repository_check_baseline_capture?.run_id,
    'run-a',
  )

  // A released claim lets another run capture.
  releaseCohortBaselineClaim(root, cohortId, 'run-a')
  assert.equal(
    loadCohortState(root, cohortId).repository_check_baseline_capture,
    undefined,
  )
  assert.deepEqual(claimCohortBaselineCapture(root, cohortId, 'run-b'), {
    status: 'capture',
  })

  const pointer = {
    profile: 'fast',
    status: 'passed' as const,
    artifact_path: `${cohortBaselineDirectory(root, cohortId)}/pre-implementation-fast.json`,
    workspace_fingerprint: 'f'.repeat(64),
    recorded_at: '2026-09-02T00:00:00.000Z',
  }

  recordCohortBaselines(root, cohortId, 'run-b', { fast: pointer })

  const recorded = loadCohortState(root, cohortId)

  assert.equal(recorded.repository_check_baseline_capture, undefined)
  assert.equal(
    recorded.repository_check_baselines?.fast?.captured_by_run_id,
    'run-b',
  )

  // Once recorded, every later claim adopts and a second record is refused.
  assert.deepEqual(claimCohortBaselineCapture(root, cohortId, 'run-c'), {
    status: 'adopted',
    baselines: {
      fast: {
        ...pointer,
        captured_by_run_id: 'run-b',
        shared_from_cohort: cohortId,
      },
    },
  })
  assert.throws(
    () => recordCohortBaselines(root, cohortId, 'run-c', { fast: pointer }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_BASELINE_ALREADY_RECORDED',
  )
})
