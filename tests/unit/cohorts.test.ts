import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonChunk,
  cohortDir,
  cohortIsSatisfied,
  cohortStatus,
  assertCohortRunUnblocked,
  integrateCohort,
  maybeAutostartCohort,
  parseCohortPlan,
  startCohort,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import type {
  CohortSessionState,
  RunState,
  RunStatus,
} from '../../src/lib/types.js'
import { createFixture, writeJson } from '../helpers.js'

const COHORT_ID = '10000_Sep-02-0000_cohort-fix'

function planFixture(): Record<string, unknown> {
  return {
    parent_spec_path: 'runtime/specs/parent-specification.md',
    chunks: [
      {
        id: 'c1',
        title: 'First outcome',
        cohort_index: 1,
        child_spec_path: 'runtime/specs/c1.md',
        depends_on: [],
      },
      {
        id: 'c2',
        title: 'Second outcome',
        cohort_index: 2,
        child_spec_path: 'runtime/specs/c2.md',
        depends_on: ['c1'],
      },
    ],
    edges: [{ from: 'c1', to: 'c2' }],
    cohorts: [
      { index: 1, chunks: ['c1'] },
      { index: 2, chunks: ['c2'] },
    ],
  }
}

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

function boundRun(cohortIndex: number, chunk: string): RunState {
  return {
    schema_version: 2,
    run_id: `chunk-${chunk}`,
    workflow_slug: 'delivery',
    workflow_snapshot: { path: 'snapshot.json', sha256: 'sha' },
    workspace_root: '.',
    cohort: { cohort_id: COHORT_ID, cohort_index: cohortIndex, chunk },
    title: chunk,
    status: 'running',
    current_stage: 'implement',
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
  }
}

function writeSpecs(root: string): void {
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })

  for (const name of ['parent-specification', 'c1', 'c2']) {
    writeFileSync(
      path.join(root, 'runtime', 'specs', `${name}.md`),
      `# ${name}\n`,
    )
  }
}

/**
 * Turn the self-development fixture into a target installation. A detached
 * harness must record its target absolutely, and the fixture root stands in
 * for that target.
 */
function setInstallationMode(
  root: string,
  mode: 'embedded' | 'detached',
): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = mode

  if (mode === 'detached') {
    config.workspace_root = root
  }

  writeJson(configPath, config)
}

const EMBEDDED_PAN = './.pancreator/bin/pan'

test('a cohort plan is parsed only when its shape supports fan-out', () => {
  const parsed = parseCohortPlan(planFixture(), 'data.cohort_plan')

  assert.equal(parsed.chunks.length, 2)
  assert.equal(parsed.cohorts.length, 2)
  assert.deepEqual(parsed.chunks[1].depends_on, ['c1'])

  assert.throws(
    () => parseCohortPlan({ ...planFixture(), chunks: [] }, 'plan'),
    /chunks MUST list at least one chunk/u,
  )
  assert.throws(
    () =>
      parseCohortPlan(
        { ...planFixture(), parent_spec_path: '' },
        'data.cohort_plan',
      ),
    /parent_spec_path MUST be a non-empty string/u,
  )
})

test('a cohort plan with an empty or inconsistent cohort group is refused', () => {
  const plan = planFixture()
  const cohorts = plan.cohorts as Array<{ index: number; chunks: string[] }>

  // An empty cohort could never be satisfied, so it would block the plan
  // forever.
  assert.throws(
    () =>
      parseCohortPlan(
        { ...plan, cohorts: [...cohorts, { index: 3, chunks: [] }] },
        'plan',
      ),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'INVALID_COHORT_PLAN' &&
      /cohorts\[2\]\.chunks MUST list at least one chunk id/u.test(
        error.message,
      ),
  )

  // Group membership and each chunk's own cohort_index must agree.
  assert.throws(
    () =>
      parseCohortPlan(
        {
          ...plan,
          cohorts: [
            { index: 1, chunks: ['c1', 'c2'] },
            { index: 2, chunks: ['c2'] },
          ],
        },
        'plan',
      ),
    /names chunk 'c2', which claims cohort 2/u,
  )
  assert.throws(
    () =>
      parseCohortPlan(
        { ...plan, cohorts: [cohorts[0], { index: 2, chunks: ['ghost'] }] },
        'plan',
      ),
    /names chunk 'ghost', which the plan does not declare/u,
  )
})

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
})

test('an unbound run and an unknown session leave prepare untouched', () => {
  const root = createFixture()
  const unbound = boundRun(2, 'c2')

  delete unbound.cohort
  assert.doesNotThrow(() => assertCohortRunUnblocked(root, unbound))
  assert.doesNotThrow(() => assertCohortRunUnblocked(root, boundRun(2, 'c2')))
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

test('cohort refusals name the pan entrypoint of the installation', () => {
  const root = createFixture()

  writeSpecs(root)
  writeCohortState(root, {
    max_parallel: 1,
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
        id: 'c3',
        title: 'Sibling outcome',
        cohort_index: 1,
        child_spec_path: 'runtime/specs/c1.md',
        depends_on: [],
      },
      {
        id: 'c2',
        title: 'Second outcome',
        cohort_index: 2,
        child_spec_path: 'runtime/specs/c2.md',
        depends_on: ['c1'],
      },
    ],
    cohorts: [
      { index: 1, chunks: ['c1', 'c3'] },
      { index: 2, chunks: ['c2'] },
    ],
  })
  writeChunkRun(root, 'chunk-c1', 'running')
  setInstallationMode(root, 'embedded')

  const namesEmbeddedPan =
    (code: string, command: string) => (error: unknown) =>
      error instanceof PanError &&
      error.code === code &&
      error.message.includes(
        `'${EMBEDDED_PAN} cohort ${command} ${COHORT_ID}'`,
      ) &&
      !error.message.includes("'./bin/pan")

  assert.throws(
    () => startCohort(root, COHORT_ID),
    namesEmbeddedPan('COHORT_PARALLELISM_LIMIT', 'start'),
  )
  assert.throws(
    () => startCohort(root, COHORT_ID, { cohortIndex: 2 }),
    namesEmbeddedPan('COHORT_PREDECESSOR_UNSATISFIED', 'integrate'),
  )

  // Every chunk of cohort 1 has a run, so there is nothing left to start.
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

  assert.throws(
    () => startCohort(root, COHORT_ID),
    namesEmbeddedPan('COHORT_ALREADY_STARTED', 'integrate'),
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

test('the autostart hook fires only for an operator approval of a flagged planning run', () => {
  const root = createFixture()
  const base: RunState = {
    ...boundRun(1, 'c1'),
    workflow_slug: 'planning',
    status: 'succeeded',
    autostart_cohort: true,
  }

  delete base.cohort

  const decision = { actor: 'operator' as const, action: 'approve' }

  assert.equal(
    maybeAutostartCohort(root, { ...base, autostart_cohort: false }, decision),
    null,
  )
  assert.equal(
    maybeAutostartCohort(
      root,
      { ...base, workflow_slug: 'delivery' },
      decision,
    ),
    null,
  )
  assert.equal(
    maybeAutostartCohort(root, { ...base, status: 'running' }, decision),
    null,
  )
  assert.equal(
    maybeAutostartCohort(root, base, { actor: 'operator', action: 'reject' }),
    null,
  )
  // --autostart is the operator's directive at init. An away approval on the
  // operator's behalf honours it the same way; this fixture has no ratified
  // plan, so the hook runs and reports the failure rather than staying silent.
  assert.equal(
    maybeAutostartCohort(root, base, { actor: 'away', action: 'approve' })
      ?.status,
    'failed',
  )
})

test('an autostart failure reports the error and the manual commands', () => {
  const root = createFixture()
  const state: RunState = {
    ...boundRun(1, 'c1'),
    run_id: 'plan-run-missing',
    workflow_slug: 'planning',
    status: 'succeeded',
    autostart_cohort: true,
  }

  delete state.cohort

  const result = maybeAutostartCohort(root, state, {
    actor: 'operator',
    action: 'approve',
  })

  assert.ok(result)
  assert.equal(result.status, 'failed')

  if (result.status === 'failed') {
    assert.ok(result.error.length > 0)
    assert.deepEqual(result.manual_commands, [
      './bin/pan cohort init --plan-run plan-run-missing',
      './bin/pan cohort start <cohort-id>',
    ])
  }

  // The operator types these commands from the target root, so an embedded
  // harness must name its own entrypoint.
  setInstallationMode(root, 'embedded')

  const embedded = maybeAutostartCohort(root, state, {
    actor: 'operator',
    action: 'approve',
  })

  assert.ok(embedded)
  assert.equal(embedded.status, 'failed')

  if (embedded.status === 'failed') {
    assert.deepEqual(embedded.manual_commands, [
      `${EMBEDDED_PAN} cohort init --plan-run plan-run-missing`,
      `${EMBEDDED_PAN} cohort start <cohort-id>`,
    ])
  }
})
