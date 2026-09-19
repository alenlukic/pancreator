import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  checkpointHorizonSession,
  deferHorizonTask,
  horizonStatus,
  initHorizonSession,
  nextHorizonTask,
  startHorizonSession,
  type HorizonQueueTaskInput,
} from '../../src/lib/horizon.js'
import { buildGovernanceCard } from '../../src/lib/governance-card.js'
import {
  assessStage,
  getRunState,
  pauseRun,
  resumeRun,
} from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { readAwayDecisionLedger } from '../../src/lib/away-mode.js'
import type { RunState } from '../../src/lib/types.js'
import { attestRunCard, createFixture, read, writeJson } from '../helpers.js'
import {
  runWorkflow,
  submitCurrentStage,
  submitStageOutput,
  withFakeEvaluator,
} from './delivery-helpers.js'

/** One request file per task: `createRun` claims an inbox item exclusively. */
function request(root: string, id: string): string {
  const relative = path.posix.join('runtime', 'inbox', 'queue', `${id}.md`)

  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  writeFileSync(path.join(root, relative), `# Request for ${id}\n`)

  return relative
}

function workflowTask(
  root: string,
  id: string,
  dependsOn: string[] = [],
): HorizonQueueTaskInput {
  return {
    id,
    title: `${id} task`,
    kind: 'workflow',
    workflow: 'planning',
    request_path: request(root, id),
    depends_on: dependsOn,
  }
}

function queue(root: string, tasks: HorizonQueueTaskInput[]): string {
  writeJson(path.join(root, 'runtime', 'queue.json'), {
    schema_version: 1,
    tasks,
  })

  return 'runtime/queue.json'
}

function threeTaskQueue(root: string): string {
  return queue(root, [
    workflowTask(root, 'first'),
    workflowTask(root, 'dependent', ['first']),
    workflowTask(root, 'unrelated'),
  ])
}

function deferralLedger(root: string, sessionId: string): unknown[] {
  const ledger = path.join(
    root,
    'runtime',
    'logs',
    'horizon',
    sessionId,
    'deferred.jsonl',
  )

  return readFileSync(ledger, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

test('a started session snapshots mode, starts one eligible task, and refuses a second', () => {
  const root = createFixture()
  const created = initHorizonSession(root, threeTaskQueue(root), {
    sessionId: 'session-ordering',
    involvement: 'long-horizon',
  })

  assert.equal(created.involvement_profile, 'long-horizon')
  const started = startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })
  assert.equal(started.preflight.away_mode_armed, true)
  assert.equal(started.preflight.card_attestation_authorized, true)

  const first = nextHorizonTask(root, created.session_id)
  assert.equal(first.task?.id, 'first')
  assert.equal(first.run?.horizon?.session_id, created.session_id)
  assert.equal(first.run?.operator_involvement?.profile, 'long-horizon')
  assert.throws(
    () => nextHorizonTask(root, created.session_id),
    /already runs task 'first'/u,
  )
})

test('deferring a task other than the active one keeps the running task active', () => {
  const root = createFixture()
  const created = initHorizonSession(root, threeTaskQueue(root), {
    sessionId: 'session-foreign-deferral',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(root, created.session_id)
  assert.equal(opened.task?.id, 'first')

  const deferred = deferHorizonTask(
    root,
    created.session_id,
    'unrelated',
    'The operator set this task aside.',
  )

  assert.equal(deferred.active_task_id, 'first')
  assert.equal(
    deferred.tasks.find((task) => task.id === 'first')?.status,
    'running',
  )
  assert.throws(
    () => nextHorizonTask(root, created.session_id),
    /already runs task 'first'/u,
  )
})

test('deferring the active task stops its run before the next task opens', () => {
  const root = createFixture()
  const created = initHorizonSession(root, threeTaskQueue(root), {
    sessionId: 'session-active-deferral',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(root, created.session_id)
  const runId = opened.run?.run_id as string

  assert.equal(opened.task?.id, 'first')
  assert.equal(getRunState(root, runId).status, 'running')

  const deferred = deferHorizonTask(
    root,
    created.session_id,
    'first',
    'The operator set the active task aside.',
  )

  // The escape hatch releases the session slot, so the run it released must
  // stop advancing first. A still-running run plus a newly opened one are two
  // mutating workflows in one workspace.
  assert.equal(deferred.active_task_id, null)
  assert.equal(getRunState(root, runId).status, 'paused')

  const advanced = nextHorizonTask(root, created.session_id)

  assert.equal(advanced.task?.id, 'unrelated')
  assert.notEqual(advanced.run?.run_id, runId)
  assert.equal(getRunState(root, runId).status, 'paused')
})

test('a deferred run resumed to running refuses the next task', () => {
  const root = createFixture()
  const created = initHorizonSession(root, threeTaskQueue(root), {
    sessionId: 'session-resumed-deferral',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })

  const runId = nextHorizonTask(root, created.session_id).run?.run_id as string

  deferHorizonTask(
    root,
    created.session_id,
    'first',
    'The operator set the active task aside.',
  )
  resumeRun(root, runId)

  assert.equal(getRunState(root, runId).status, 'running')
  assert.throws(
    () => nextHorizonTask(root, created.session_id),
    /run '.*' for task 'first' is still running/u,
  )
})

test('deferral blocks transitive dependents and leaves unrelated work eligible', () => {
  const root = createFixture()
  const created = initHorizonSession(root, threeTaskQueue(root), {
    sessionId: 'session-deferral',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })

  const deferred = deferHorizonTask(
    root,
    created.session_id,
    'first',
    'The task exhausted its ladder.',
    ['runtime/evidence/failure.json'],
  )
  assert.equal(
    deferred.tasks.find((task) => task.id === 'first')?.status,
    'deferred',
  )
  assert.equal(
    deferred.tasks.find((task) => task.id === 'dependent')?.status,
    'blocked',
  )
  assert.equal(
    deferred.tasks.find((task) => task.id === 'unrelated')?.status,
    'pending',
  )

  const records = deferralLedger(root, created.session_id) as Array<{
    task: string
    reason: string
    dependents: string[]
    evidence_paths: string[]
  }>

  assert.equal(records.length, 1)
  assert.equal(records[0]?.task, 'first')
  assert.equal(records[0]?.reason, 'The task exhausted its ladder.')
  assert.deepEqual(records[0]?.dependents, ['dependent'])
  assert.deepEqual(records[0]?.evidence_paths, [
    'runtime/evidence/failure.json',
  ])

  const item = readFileSync(
    path.join(
      root,
      'runtime',
      'inbox',
      'queue',
      `horizon-${created.session_id}-first-deferred.md`,
    ),
    'utf8',
  )

  assert.match(item, /Deferred horizon task first/u)
  assert.match(item, /Reason: The task exhausted its ladder\./u)
  assert.match(item, /Dependents: dependent/u)

  const next = nextHorizonTask(root, created.session_id)
  assert.equal(next.task?.id, 'unrelated')
  assert.equal(
    horizonStatus(root, created.session_id).active_task_id,
    'unrelated',
  )
})

test('a blocker no permitted action can clear defers the task and advances the session', () => {
  const root = createFixture()
  const created = initHorizonSession(root, threeTaskQueue(root), {
    sessionId: 'session-unclearable',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(root, created.session_id)
  const runId = opened.run?.run_id as string

  // A paused run whose blocker the away evaluator cannot resolve is the
  // fourth rung: the task leaves the session, the session does not stop.
  pauseRun(root, runId, 'A blocker holds the run.')

  // The evaluator marks its only ranking infeasible, so the guardrail
  // selection leaves nothing to apply. This is a ranking rejection rather
  // than an evaluator or executor failure, and the reason assertion below is
  // what separates the two: an evaluator failure is retried, a rejected
  // ranking is the deferral rung.
  const checkpointed = withFakeEvaluator(
    root,
    {
      ranked_options: [
        {
          rank: 1,
          action: 'resume',
          feasible: false,
          rationale: 'Nothing the run can do clears this blocker.',
          evidence: ['runtime/evidence/blocker.json'],
          rollback_plan: {
            steps: ['Pause the run again.'],
            verification: 'Confirm the run is paused.',
          },
        },
      ],
    },
    () => checkpointHorizonSession(root, created.session_id),
  )

  assert.equal(checkpointed.driven.stop.type, 'operator_pause')
  assert.equal(
    checkpointed.driven.handoff_reason,
    'No permitted autonomous action can clear the blocker.',
  )
  assert.equal(
    checkpointed.session.tasks.find((task) => task.id === 'first')?.status,
    'deferred',
  )
  assert.equal(
    checkpointed.session.tasks.find((task) => task.id === 'dependent')?.status,
    'blocked',
  )
  assert.equal(checkpointed.session.active_task_id, null)
  assert.equal(checkpointed.session.status, 'running')
  assert.equal(deferralLedger(root, created.session_id).length, 1)

  const advanced = nextHorizonTask(root, created.session_id)
  assert.equal(advanced.task?.id, 'unrelated')
})

test('a selected option that fails to apply falls through to the next ranked option instead of deferring', () => {
  const root = createFixture()
  const created = initHorizonSession(root, threeTaskQueue(root), {
    sessionId: 'session-fallthrough',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(root, created.session_id)
  const runId = opened.run?.run_id as string

  // Rank 1 is a waiver whose note names no destination, so the harness
  // refuses to apply it. Rank 2 is a plain resume. Before HORIZON-001 named
  // the closed hard-block list, the failed apply deferred the task; the
  // ranking's second sound option must now carry the run instead. The pause
  // happens inside the evaluator fixture so its binary is not a workspace
  // change made while the run was paused, which away mode refuses to ratify.
  const rollback_plan = {
    steps: ['Pause the run again.'],
    verification: 'Confirm the run is paused.',
  }
  const checkpointed = withFakeEvaluator(
    root,
    {
      ranked_options: [
        {
          rank: 1,
          action: 'waive-gate',
          feasible: true,
          rationale: 'Waive the gate that holds the run.',
          evidence: ['runtime/evidence/blocker.json'],
          note: 'Waive it.',
          rollback_plan,
        },
        {
          rank: 2,
          action: 'resume',
          feasible: true,
          rationale: 'Re-attempt the stage.',
          evidence: ['runtime/evidence/blocker.json'],
          rollback_plan,
        },
      ],
    },
    () => {
      pauseRun(root, runId, 'A blocker holds the run.')

      return checkpointHorizonSession(root, created.session_id)
    },
  )

  // The resume carried the run past the pause; whatever the fixture's stage
  // worker does next is not this test's subject. The deferral reason, when
  // one exists, must not be the first option's apply error.
  assert.doesNotMatch(
    checkpointed.driven.handoff_reason ?? '',
    /did not apply/u,
  )

  const applies = readAwayDecisionLedger(root).filter(
    (record) => record.run_id === runId && record.result !== 'accepted',
  )

  assert.deepEqual(
    applies.map((record) => [record.result, record.applied_action ?? null]),
    [
      ['failed', null],
      ['applied', 'resume'],
    ],
  )
})

test('an exhausted away-decision budget defers the task instead of the session', () => {
  const root = createFixture()
  const created = initHorizonSession(root, threeTaskQueue(root), {
    sessionId: 'session-budget',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(root, created.session_id)
  const runId = opened.run?.run_id as string
  const statePath = path.join(
    root,
    'runtime',
    'logs',
    'workflows',
    runId,
    'agent',
    'state.json',
  )
  const state = read(statePath) as RunState

  // A guardrail the away-mode ledger enforces raises rather than returning,
  // and that error belongs to the one task, not to the whole session.
  state.away_mode = {
    ...(state.away_mode as NonNullable<RunState['away_mode']>),
    guardrails: {
      ...(state.away_mode as NonNullable<RunState['away_mode']>).guardrails,
      max_decisions_per_run: 0,
    },
  }
  writeJson(statePath, state)
  pauseRun(root, runId, 'The run needs a decision no guardrail permits.')

  const checkpointed = checkpointHorizonSession(root, created.session_id)

  assert.match(
    checkpointed.driven.handoff_reason ?? '',
    /away evaluator reached no usable decision/u,
  )
  assert.equal(
    checkpointed.session.tasks.find((task) => task.id === 'first')?.status,
    'deferred',
  )
  assert.equal(checkpointed.session.status, 'running')
  assert.equal(nextHorizonTask(root, created.session_id).task?.id, 'unrelated')
})

test('session-scoped unbound cards resolve long-horizon policy without changing standalone cards', () => {
  const root = createFixture()
  const created = initHorizonSession(root, threeTaskQueue(root), {
    sessionId: 'session-card',
    involvement: 'long-horizon',
  })
  const scoped = buildGovernanceCard(root, {
    mode: 'unbound',
    outputPath: 'runtime/scoped-card.md',
    contracts: created.contracts,
  })
  const ordinary = buildGovernanceCard(root, {
    mode: 'unbound',
    outputPath: 'runtime/ordinary-card.md',
  })

  assert.equal(
    scoped.policies.some((policy) => policy.id === 'HORIZON-001'),
    true,
  )
  assert.equal(
    ordinary.policies.some((policy) => policy.id === 'HORIZON-001'),
    false,
  )
  assert.equal(
    ordinary.policies.some((policy) => policy.id === 'SINGLERUN-001'),
    true,
  )
})

/** Record the passing supervisor assessment the plan gate waits for. */
function passAssessment(
  root: string,
  runId: string,
  invocation: { invocation_id: string; output: { path: string } },
): void {
  const state = getRunState(root, runId)

  if (state.pending_action.type !== 'supervisor_assessment') {
    return
  }

  const assessmentPath = state.pending_action.output_path

  writeJson(path.join(root, assessmentPath), {
    schema_version: 1,
    assessment_id: randomUUID(),
    invocation_id: invocation.invocation_id,
    verdict: 'pass',
    criteria: stageBySlug(runWorkflow(root, state), 'plan').criteria.map(
      (criterion) => ({
        id: criterion.id,
        result: 'pass' as const,
        evidence: [invocation.output.path],
        explanation: 'Criterion is satisfied.',
      }),
    ),
    summary: 'The scoped re-plan is complete.',
  })
  assessStage(root, runId, assessmentPath)
}

/** Fail the run's current implement stage once with one hard criterion. */
function failImplement(root: string, runId: string) {
  const state = getRunState(root, runId)
  const implement = stageBySlug(runWorkflow(root, state), 'implement')

  return submitStageOutput(root, runId, implement, 'failure', [
    'implement.acceptance_claimed',
  ])
}

test('a ladder exhaustion re-plans once, defers on the second, and the session still finishes', () => {
  const root = createFixture()
  const created = initHorizonSession(
    root,
    queue(root, [
      {
        id: 'ladder',
        title: 'Ladder task',
        kind: 'workflow',
        workflow: 'delivery',
        request_path: request(root, 'ladder'),
      },
      {
        id: 'dependent',
        title: 'Dependent task',
        kind: 'prompt',
        prompt: 'Depends on the ladder task.',
        depends_on: ['ladder'],
      },
      {
        id: 'other',
        title: 'Independent task',
        kind: 'prompt',
        prompt: 'Runs whatever the ladder task does.',
      },
    ]),
    { sessionId: 'session-rungs', involvement: 'long-horizon' },
  )
  startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(root, created.session_id)
  const firstRunId = opened.run?.run_id as string

  attestRunCard(root, firstRunId)
  failImplement(root, firstRunId)

  const exhausted = failImplement(root, firstRunId)

  assert.equal(exhausted.state.horizon_ladder?.pause_kind, 'ladder_exhausted')

  // Rung three: exactly one scoped planning run, and the task waits for it.
  const replanned = checkpointHorizonSession(root, created.session_id)
  const ladderTask = replanned.session.tasks.find(
    (task) => task.id === 'ladder',
  )
  const replanRunId = ladderTask?.replan_run_id as string

  assert.equal(ladderTask?.status, 'replanning')
  assert.equal(ladderTask?.ladder.replans_spent, 1)
  assert.equal(replanned.session.active_task_id, 'ladder')
  assert.equal(
    getRunState(root, replanRunId).request.source_path,
    exhausted.state.horizon_ladder?.failure_record_path,
  )

  attestRunCard(root, replanRunId)

  const planned = submitCurrentStage(root, replanRunId, 'success')

  passAssessment(root, replanRunId, planned.invocation)

  // The long-horizon profile owns the plan gate, so the scoped re-plan reaches
  // its terminal state with no operator decision between start and finish.
  assert.equal(getRunState(root, replanRunId).status, 'succeeded')

  const returned = checkpointHorizonSession(root, created.session_id)

  assert.equal(
    returned.session.tasks.find((task) => task.id === 'ladder')?.status,
    'pending',
  )
  assert.equal(returned.session.active_task_id, null)

  // The first run claimed the inbox request, so the reopen has to read the
  // stored copy instead of the queue path that no longer exists.
  const reopened = nextHorizonTask(root, created.session_id)
  const secondRunId = reopened.run?.run_id as string

  assert.equal(reopened.task?.id, 'ladder')
  assert.notEqual(secondRunId, firstRunId)

  attestRunCard(root, secondRunId)

  const secondExhaustion = failImplement(root, secondRunId)

  assert.equal(
    secondExhaustion.state.horizon_ladder?.pause_kind,
    'ladder_exhausted',
  )

  const deferred = checkpointHorizonSession(root, created.session_id)

  assert.equal(
    deferred.session.tasks.find((task) => task.id === 'ladder')?.status,
    'deferred',
  )
  assert.equal(
    deferred.session.tasks.find((task) => task.id === 'dependent')?.status,
    'blocked',
  )
  assert.equal(deferred.session.active_task_id, null)

  const records = deferralLedger(root, created.session_id) as Array<{
    task: string
    dependents: string[]
    rung_history: { replans_spent: number }
  }>

  assert.equal(records.length, 1)
  assert.equal(records[0]?.task, 'ladder')
  assert.deepEqual(records[0]?.dependents, ['dependent'])
  assert.equal(records[0]?.rung_history.replans_spent, 1)

  // AC-25: every bound is counted on the task that spent it, so the untouched
  // task still holds its full allowance.
  assert.deepEqual(
    deferred.session.tasks.find((task) => task.id === 'other')?.ladder,
    {
      retries_spent: 0,
      strategy_switches_spent: 0,
      replans_spent: 0,
      last_failure_signature: [],
    },
  )
  assert.equal(
    deferred.session.tasks.find((task) => task.id === 'ladder')?.ladder
      .strategy_switches_spent,
    1,
  )

  // AC-24: the unrelated task still reaches its own terminal outcome.
  const finished = withFakeEvaluator(root, { ok: true }, () =>
    nextHorizonTask(root, created.session_id),
  )

  assert.equal(finished.task?.id, 'other')
  assert.equal(finished.task?.status, 'succeeded')
  assert.equal(finished.session.status, 'empty')
  assert.equal(finished.session.active_task_id, null)
})
