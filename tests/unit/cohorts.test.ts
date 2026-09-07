import assert from 'node:assert/strict'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonChunk,
  cohortDir,
  cohortIsSatisfied,
  cohortSessionForPlanRun,
  cohortSessionIds,
  cohortStatus,
  assertCohortRunUnblocked,
  initCohortSession,
  integrateCohort,
  loadCohortState,
  maybeStartDelivery,
  parseCohortPlan,
  retryDeliveryRoute,
  startCohort,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import { sha256 } from '../../src/lib/io.js'
import { createWorktree, readWorktreeIndex } from '../../src/lib/worktrees.js'
import {
  eventPath,
  listRunStates,
  loadState,
  statePath,
} from '../../src/lib/state.js'
import type {
  CohortSessionState,
  RunState,
  RunStatus,
} from '../../src/lib/types.js'
import { createFixture, createRun, writeJson } from '../helpers.js'

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

test('the routing hook fires only for an approval of a routed planning run', () => {
  const root = createFixture()
  const base: RunState = {
    ...boundRun(1, 'c1'),
    workflow_slug: 'planning',
    status: 'succeeded',
    autostart_delivery: true,
  }

  delete base.cohort

  const decision = { actor: 'operator' as const, action: 'approve' }

  // `--no-autostart` is the only opt-out, recorded as `false` at init.
  assert.equal(
    maybeStartDelivery(root, { ...base, autostart_delivery: false }, decision),
    null,
  )
  assert.equal(
    maybeStartDelivery(root, { ...base, workflow_slug: 'delivery' }, decision),
    null,
  )
  assert.equal(
    maybeStartDelivery(root, { ...base, status: 'running' }, decision),
    null,
  )
  assert.equal(
    maybeStartDelivery(root, base, { actor: 'operator', action: 'reject' }),
    null,
  )
  // Routing is a recorded property of the run, not a judgment made at
  // approval time, so an away approval on the operator's behalf takes the
  // same path. This fixture has no ratified plan, so the hook runs and reports
  // the failure rather than staying silent.
  assert.equal(
    maybeStartDelivery(root, base, { actor: 'away', action: 'approve' })
      ?.status,
    'failed',
  )

  // A run created while the flag covered only the cohort fan-out still routes.
  const legacy: RunState = { ...base, autostart_cohort: true }

  delete legacy.autostart_delivery
  assert.equal(maybeStartDelivery(root, legacy, decision)?.status, 'failed')

  // The older flag's opt-out is honored too.
  assert.equal(
    maybeStartDelivery(root, { ...legacy, autostart_cohort: false }, decision),
    null,
  )

  // A planning run that predates routing altogether never recorded a choice.
  // Silence would leave the operator believing something started, so the
  // hook reports a failed route whose one manual command is the opt-in.
  const unrecorded: RunState = { ...base }

  delete unrecorded.autostart_delivery

  const predates = maybeStartDelivery(root, unrecorded, decision)

  assert.equal(predates?.status, 'failed')

  if (predates?.status === 'failed') {
    assert.equal(predates.kind, undefined)
    assert.equal(
      predates.error,
      'This planning run predates routing and recorded no opt-in or opt-out.',
    )
    assert.deepEqual(predates.manual_commands, [
      `./bin/pan cohort route --plan-run ${unrecorded.run_id}`,
    ])
  }
})

test('a planning run that predates routing is routed by the operator command', () => {
  const root = createFixture()

  writeSpecs(root)

  const planRunId = ratifiedSingleChunkPlanRun(root)
  const plan = loadState(root, planRunId)

  delete plan.autostart_delivery
  writeJson(statePath(root, planRunId), plan)

  // The approval hook reports the gap and persists it on the plan run.
  const hook = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.equal(hook?.status, 'failed')
  assert.equal(loadState(root, planRunId).delivery_handoff?.kind, 'failed')
  assert.deepEqual(
    listRunStates(root).filter((run) => run.workflow_slug === 'delivery'),
    [],
  )

  // The operator's invocation is the opt-in: the retry routes the plan as if
  // autostart had been requested and replaces the failed record.
  const routed = retryDeliveryRoute(root, planRunId)

  assert.equal(routed.status, 'started')
  assert.equal(routed.kind, 'delivery')

  const handoff = loadState(root, planRunId).delivery_handoff

  assert.equal(handoff?.kind, 'delivery')
  assert.equal(
    handoff?.kind === 'delivery' ? handoff.run_id : null,
    routed.status === 'started' && routed.kind === 'delivery'
      ? routed.run_id
      : null,
  )
})

test('the operator retry routes a failed plan route and refuses a run that is not an approved plan', () => {
  const root = createFixture()

  writeSpecs(root)

  const planRunId = ratifiedSingleChunkPlanRun(root)
  const approve = { actor: 'operator' as const, action: 'approve' }

  // The child specification is gone, so the approval's route fails and the
  // plan run records the failure with the retry as its one manual command.
  rmSync(path.join(root, 'runtime', 'specs', 'c1.md'))

  const failed = maybeStartDelivery(root, loadState(root, planRunId), approve)

  assert.equal(failed?.status, 'failed')

  if (failed?.status === 'failed') {
    assert.equal(failed.kind, 'delivery')
    assert.deepEqual(failed.manual_commands, [
      `./bin/pan cohort route --plan-run ${planRunId}`,
    ])
  }

  assert.equal(loadState(root, planRunId).delivery_handoff?.kind, 'failed')

  // The retry fails the same way while the cause stands, and records nothing
  // new for the same failure.
  const revision = loadState(root, planRunId).revision
  const stillFailed = retryDeliveryRoute(root, planRunId)

  assert.equal(stillFailed.status, 'failed')
  assert.equal(loadState(root, planRunId).revision, revision)

  // Once the cause is repaired, the retry starts the run and replaces the
  // failed record with the handoff.
  writeFileSync(path.join(root, 'runtime', 'specs', 'c1.md'), '# c1\n')

  const routed = retryDeliveryRoute(root, planRunId)

  assert.equal(routed.status, 'started')
  assert.equal(routed.kind, 'delivery')

  if (routed.status !== 'started' || routed.kind !== 'delivery') {
    return
  }

  const handoff = loadState(root, planRunId).delivery_handoff

  assert.deepEqual(handoff, {
    kind: 'delivery',
    run_id: routed.run_id,
    worktree: routed.worktree,
    recorded_at: handoff?.recorded_at,
  })

  // A second retry adopts the run it already started.
  const again = retryDeliveryRoute(root, planRunId)

  assert.equal(again.status, 'already_started')
  assert.equal(
    again.status === 'already_started' && again.kind === 'delivery'
      ? again.run_id
      : null,
    routed.run_id,
  )
  assert.deepEqual(
    listRunStates(root)
      .filter((run) => run.workflow_slug === 'delivery')
      .map((run) => run.run_id),
    [routed.run_id],
  )

  // The retry is refused, by named code, for a run that is not a planning
  // run, for a planning run that has not succeeded, and for a plan whose gate
  // recorded a decision other than approve.
  assert.throws(
    () => retryDeliveryRoute(root, routed.run_id),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_PLAN_RUN_INVALID',
  )

  const running = ratifiedSingleChunkPlanRun(root)

  writeJson(statePath(root, running), {
    ...loadState(root, running),
    status: 'running',
    current_stage: 'plan',
  })
  assert.throws(
    () => retryDeliveryRoute(root, running),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_PLAN_RUN_NOT_SUCCEEDED',
  )

  const rejected = ratifiedSingleChunkPlanRun(root)

  appendFileSync(
    eventPath(root, rejected),
    `${JSON.stringify({
      schema_version: 1,
      event_id: 'decision',
      type: 'operator_decision_recorded',
      timestamp: '2026-09-02T00:00:00.000Z',
      run_id: rejected,
      revision: loadState(root, rejected).revision,
      stage: 'plan',
      decision: 'reject',
      note: 'Not this plan.',
      actor: 'operator',
      target_stage: 'plan',
    })}\n`,
  )
  assert.throws(
    () => retryDeliveryRoute(root, rejected),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_PLAN_REJECTED' &&
      error.message.includes("'reject'"),
  )
  assert.throws(
    () => retryDeliveryRoute(root, 'absent-run'),
    (error: unknown) =>
      error instanceof PanError && error.code === 'RUN_NOT_FOUND',
  )
})

test('a routing failure reports the error and the manual commands', () => {
  const root = createFixture()
  const state: RunState = {
    ...boundRun(1, 'c1'),
    run_id: 'plan-run-missing',
    workflow_slug: 'planning',
    status: 'succeeded',
    autostart_delivery: true,
  }

  delete state.cohort

  // The plan cannot be read, so the route's shape is unknown. The one manual
  // command is the retry, which handles every shape and adopts what exists.
  const result = maybeStartDelivery(root, state, {
    actor: 'operator',
    action: 'approve',
  })

  assert.ok(result)
  assert.equal(result.status, 'failed')

  if (result.status === 'failed') {
    assert.ok(result.error.length > 0)
    assert.equal(result.kind, undefined)
    assert.deepEqual(result.manual_commands, [
      './bin/pan cohort route --plan-run plan-run-missing',
    ])
  }

  // The operator types this command from the target root, so an embedded
  // harness must name its own entrypoint.
  setInstallationMode(root, 'embedded')

  const embedded = maybeStartDelivery(root, state, {
    actor: 'operator',
    action: 'approve',
  })

  assert.ok(embedded)
  assert.equal(embedded.status, 'failed')

  if (embedded.status === 'failed') {
    assert.deepEqual(embedded.manual_commands, [
      `${EMBEDDED_PAN} cohort route --plan-run plan-run-missing`,
    ])
  }
})

/**
 * A succeeded planning run whose ratified plan holds the single chunk `c1`,
 * or both fixture chunks when `chunkCount` is 2, written through the run's own
 * durable records as the routing hook reads them.
 */
function ratifiedSingleChunkPlanRun(
  root: string,
  chunkCount: 1 | 2 = 1,
): string {
  const plan = planFixture()
  const run = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'request.md',
  })
  const outputPath = `runtime/logs/workflows/${run.run_id}/agent/outputs/plan-1.json`

  writeJson(path.join(root, outputPath), {
    schema_version: 1,
    result: 'success',
    data: {
      cohort_plan:
        chunkCount === 2
          ? plan
          : {
              ...plan,
              chunks: (plan.chunks as unknown[]).slice(0, 1),
              edges: [],
              cohorts: [{ index: 1, chunks: ['c1'] }],
            },
    },
  })
  writeJson(statePath(root, run.run_id), {
    ...loadState(root, run.run_id),
    status: 'succeeded',
    current_stage: null,
    stage_history: [
      {
        stage: 'plan',
        attempt: 1,
        outcome: 'success',
        invocation_id: 'plan-1',
        output_path: outputPath,
        recorded_at: '2026-09-02T00:00:00.000Z',
        validation_errors: [],
        deterministic: [],
      },
    ],
  })

  return run.run_id
}

test('a retry after a lost handoff record adopts the delivery run it already created', () => {
  const root = createFixture()

  writeSpecs(root)

  const planRunId = ratifiedSingleChunkPlanRun(root)
  const approve = { actor: 'operator' as const, action: 'approve' }
  const first = maybeStartDelivery(root, loadState(root, planRunId), approve)

  assert.equal(first?.status, 'started')
  assert.equal(first?.kind, 'delivery')

  if (first?.status !== 'started' || first.kind !== 'delivery') {
    return
  }

  // Run creation and the handoff record are two writes. Drop the second one to
  // stand in for a process that died between them.
  const plan = loadState(root, planRunId)

  delete plan.delivery_handoff
  writeJson(statePath(root, planRunId), plan)

  const second = maybeStartDelivery(root, loadState(root, planRunId), approve)

  assert.equal(second?.status, 'already_started')
  assert.equal(second?.kind, 'delivery')

  if (second?.status !== 'already_started' || second.kind !== 'delivery') {
    return
  }

  // The retry adopts the run bound to the derived worktree, records the
  // handoff it lost, and binds no second run to the same checkout.
  assert.equal(second.run_id, first.run_id)
  assert.equal(second.worktree, first.worktree)
  assert.deepEqual(
    listRunStates(root)
      .filter((run) => run.workflow_slug === 'delivery')
      .map((run) => run.run_id),
    [first.run_id],
  )
  const handoff = loadState(root, planRunId).delivery_handoff

  assert.equal(handoff?.kind, 'delivery')
  assert.equal(
    handoff?.kind === 'delivery' ? handoff.run_id : null,
    first.run_id,
  )
})

test('a plan run opens one cohort session, and a second init names the first', () => {
  const root = createFixture()

  writeSpecs(root)

  const planRunId = ratifiedSingleChunkPlanRun(root, 2)
  const session = initCohortSession(root, { planRunId })

  assert.throws(
    () => initCohortSession(root, { planRunId }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_SESSION_EXISTS' &&
      error.message.includes(session.cohort_id) &&
      error.message.includes(`./bin/pan cohort start ${session.cohort_id}`),
  )
  assert.deepEqual(cohortSessionIds(root), [session.cohort_id])
})

test('a cohort start adopts a chunk worktree left behind without its run', () => {
  const root = createFixture()

  writeSpecs(root)

  const planRunId = ratifiedSingleChunkPlanRun(root, 2)
  const session = initCohortSession(root, { planRunId })
  const worktreeName = `cohort-${sha256(session.cohort_id).slice(0, 6)}-c1`

  // A fan-out that died between worktree creation and the run record leaves
  // exactly this: an indexed chunk worktree and no run.
  const orphan = createWorktree(root, worktreeName, {
    from: session.base_branch,
  })

  const started = startCohort(root, session.cohort_id)

  assert.equal(started.chunks.length, 1)
  assert.equal(started.chunks[0].chunk, 'c1')
  assert.equal(started.chunks[0].worktree, orphan.path)
  assert.equal(
    readWorktreeIndex(root).worktrees.length,
    1,
    'the retry reuses the worktree instead of refusing a second one',
  )

  const run = loadState(root, started.chunks[0].run_id)
  const chunk = loadCohortState(root, session.cohort_id).chunks.find(
    (entry) => entry.id === 'c1',
  )

  assert.equal(run.workspace_root, orphan.path)
  assert.equal(run.managed_worktree?.name, worktreeName)
  assert.equal(chunk?.run_id, run.run_id)
  assert.equal(chunk?.worktree, worktreeName)
  assert.equal(chunk?.branch, orphan.branch)

  // A fan-out that died between run creation and the run_id write leaves a
  // live run bound to the worktree: the retry adopts it rather than binding a
  // second run to the same checkout.
  writeJson(path.join(cohortDir(root, session.cohort_id), 'state.json'), {
    ...loadCohortState(root, session.cohort_id),
    chunks: loadCohortState(root, session.cohort_id).chunks.map((entry) =>
      entry.id === 'c1' ? { ...entry, run_id: undefined } : entry,
    ),
  })

  const retried = startCohort(root, session.cohort_id)

  assert.deepEqual(
    retried.chunks.map((entry) => entry.run_id),
    [run.run_id],
  )
  assert.equal(
    listRunStates(root).filter(
      (entry) => entry.workflow_slug === 'delivery-chunk',
    ).length,
    1,
  )
})

test('a cohort route that fails after init names the session that exists', () => {
  const root = createFixture()

  writeSpecs(root)

  const planRunId = ratifiedSingleChunkPlanRun(root, 2)
  const approve = { actor: 'operator' as const, action: 'approve' }

  // The operator worktree store is unusable, so init opens the session and
  // the fan-out that follows cannot create a chunk worktree.
  mkdirSync(path.join(root, 'worktrees'), { recursive: true })
  writeFileSync(path.join(root, 'worktrees', 'operator'), 'not a directory\n')

  const before = loadState(root, planRunId)
  const failed = maybeStartDelivery(root, before, approve)

  assert.equal(failed?.status, 'failed')
  assert.equal(failed?.kind, 'cohort')

  const session = cohortSessionForPlanRun(root, planRunId)

  assert.ok(session, 'init opened the session before the fan-out failed')

  if (failed?.status !== 'failed') {
    return
  }

  // The recovery is the one retry command, which continues the session that
  // exists rather than opening a second one.
  assert.deepEqual(failed.manual_commands, [
    `./bin/pan cohort route --plan-run ${planRunId}`,
  ])

  // The failure is durable on the plan run, beside the approval it followed.
  // It replaced the cohort handoff init recorded a moment earlier.
  const plan = loadState(root, planRunId)

  assert.equal(plan.status, 'succeeded')
  assert.deepEqual(plan.delivery_handoff, {
    kind: 'failed',
    route: 'cohort',
    error: failed.error,
    manual_commands: failed.manual_commands,
    recorded_at: plan.delivery_handoff?.recorded_at,
  })
  assert.ok(plan.revision > before.revision)

  // Once the store is usable again, the retry continues the same session
  // rather than opening a second one, and replaces the failed record.
  rmSync(path.join(root, 'worktrees', 'operator'))

  const retried = retryDeliveryRoute(root, planRunId)

  assert.equal(retried.status, 'started')
  assert.equal(retried.kind, 'cohort')

  if (retried.status === 'started' && retried.kind === 'cohort') {
    assert.equal(retried.cohort_id, session.cohort_id)
  }

  assert.deepEqual(cohortSessionIds(root), [session.cohort_id])
  assert.deepEqual(
    { ...loadState(root, planRunId).delivery_handoff, recorded_at: 'x' },
    { kind: 'cohort', cohort_id: session.cohort_id, recorded_at: 'x' },
  )

  // A repeated approval finds the started cohort and adds nothing.
  assert.equal(
    maybeStartDelivery(root, loadState(root, planRunId), approve)?.status,
    'already_started',
  )
})

test('a manual cohort init records the handoff on the plan run and clears a failed route', () => {
  const root = createFixture()

  writeSpecs(root)

  const planRunId = ratifiedSingleChunkPlanRun(root, 2)

  // A failed route stands on the plan run.
  rmSync(path.join(root, 'runtime', 'specs', 'c2.md'))
  assert.equal(
    maybeStartDelivery(root, loadState(root, planRunId), {
      actor: 'operator',
      action: 'approve',
    })?.status,
    'failed',
  )
  assert.equal(loadState(root, planRunId).delivery_handoff?.kind, 'failed')

  // The operator repairs the cause and opens the session by hand: the plan
  // run names the session and the failed record is gone.
  writeFileSync(path.join(root, 'runtime', 'specs', 'c2.md'), '# c2\n')

  const session = initCohortSession(root, { planRunId })
  const handoff = loadState(root, planRunId).delivery_handoff

  assert.deepEqual(handoff, {
    kind: 'cohort',
    cohort_id: session.cohort_id,
    recorded_at: handoff?.recorded_at,
  })
})
