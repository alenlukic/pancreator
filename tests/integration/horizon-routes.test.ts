import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { maybeStartDelivery } from '../../src/lib/cohorts.js'
import {
  checkpointHorizonSession,
  deferHorizonTask,
  horizonStatus,
  initHorizonSession,
  nextHorizonTask,
  reconcileHorizonSession,
  startHorizonSession,
  type HorizonQueueTaskInput,
} from '../../src/lib/horizon.js'
import { readArbiterLedger } from '../../src/lib/horizon-arbiter.js'
import { loadState, statePath } from '../../src/lib/state.js'
import { CLI, markSucceeded } from './cohort-helpers.js'
import { withFakeEvaluatorAndArbiter } from './delivery-helpers.js'
import { createFixture, read, writeJson } from '../helpers.js'

/**
 * A planning task's plan approval routes its work into one delivery run or a
 * cohort. Before routes were tracked the planning run's success ended the
 * task and orphaned every run it had started; these cases pin the task to its
 * route on the chat-supervised path.
 */

function request(root: string, id: string): string {
  const relative = path.posix.join('runtime', 'inbox', 'queue', `${id}.md`)

  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  writeFileSync(path.join(root, relative), `# Request for ${id}\n`)

  return relative
}

function queue(root: string, tasks: HorizonQueueTaskInput[]): string {
  writeJson(path.join(root, 'runtime', 'queue.json'), {
    schema_version: 1,
    tasks,
  })

  return 'runtime/queue.json'
}

function planningQueue(root: string): string {
  return queue(root, [
    {
      id: 'plan',
      title: 'Plan task',
      kind: 'workflow',
      workflow: 'planning',
      request_path: request(root, 'plan'),
    },
    {
      id: 'after',
      title: 'After the plan',
      kind: 'prompt',
      prompt: 'Runs after the plan task finishes.',
      depends_on: ['plan'],
    },
  ])
}

interface ChunkSpec {
  id: string
  cohort_index: number
  depends_on?: string[]
}

/** Give an existing planning run a ratified plan and a terminal success. */
function ratifyPlan(root: string, runId: string, chunks: ChunkSpec[]): void {
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime', 'specs', 'parent-specification.md'),
    '# Parent specification\n\nThe complete record of the request.\n',
  )

  for (const chunk of chunks) {
    writeFileSync(
      path.join(root, 'runtime', 'specs', `${chunk.id}.md`),
      `# Chunk ${chunk.id}\n\nOne unit of work.\n`,
    )
  }

  const outputPath = `runtime/logs/workflows/${runId}/agent/outputs/plan-1.json`
  const indexes = [...new Set(chunks.map((chunk) => chunk.cohort_index))].sort()

  writeJson(path.join(root, outputPath), {
    schema_version: 1,
    result: 'success',
    data: {
      cohort_plan: {
        parent_spec_path: 'runtime/specs/parent-specification.md',
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          title: `Outcome ${chunk.id}`,
          cohort_index: chunk.cohort_index,
          child_spec_path: `runtime/specs/${chunk.id}.md`,
          depends_on: chunk.depends_on ?? [],
        })),
        edges: chunks.flatMap((chunk) =>
          (chunk.depends_on ?? []).map((from) => ({ from, to: chunk.id })),
        ),
        cohorts: indexes.map((index) => ({
          index,
          chunks: chunks
            .filter((chunk) => chunk.cohort_index === index)
            .map((chunk) => chunk.id),
        })),
      },
    },
  })

  writeJson(statePath(root, runId), {
    ...loadState(root, runId),
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
}

function openPlanningTask(root: string, sessionId: string): string {
  const created = initHorizonSession(root, planningQueue(root), {
    sessionId,
    involvement: 'long-horizon',
  })
  startHorizonSession(root, created.session_id, {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(root, created.session_id)

  assert.equal(opened.task?.id, 'plan')

  return opened.run?.run_id as string
}

test('a plan approval that starts one delivery run keeps the task running on that route until the run succeeds', () => {
  const root = createFixture()
  const planRunId = openPlanningTask(root, 'route-delivery')

  ratifyPlan(root, planRunId, [{ id: 'alpha', cohort_index: 1 }])

  const started = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.equal(started?.kind, 'delivery')

  if (started?.status !== 'started' || started.kind !== 'delivery') {
    return
  }

  // The planning run succeeded, but its work went to the delivery run. The
  // task follows it there instead of finishing.
  const routed = reconcileHorizonSession(root, 'route-delivery')

  assert.equal(routed.transitioned, false)
  assert.equal(routed.task?.status, 'running')
  assert.equal(routed.task?.route?.kind, 'delivery')
  assert.equal(routed.task?.route?.run_id, started.run_id)
  assert.equal(routed.stopped, null)
  assert.deepEqual(
    routed.live_runs.map((run) => [run.role, run.run_id]),
    [['delivery', started.run_id]],
  )
  assert.equal(routed.live_runs[0]?.pending_action.type, 'prepare_invocation')
  assert.match(
    routed.live_runs[0]?.governance_card_command ?? '',
    /governance card --mode supervisor --run/u,
  )

  const status = horizonStatus(root, 'route-delivery')

  assert.equal(status.active_task_id, 'plan')
  assert.deepEqual(
    status.live_runs.map((run) => run.run_id),
    [started.run_id],
  )
  assert.match(status.next_command ?? '', /horizon reconcile route-delivery/u)

  // A dependent stays pending while the route is open; the session refuses to
  // open it because the task is still active.
  assert.equal(
    status.tasks.find((task) => task.id === 'after')?.status,
    'pending',
  )
  assert.throws(
    () => nextHorizonTask(root, 'route-delivery'),
    /already runs task 'plan'/u,
  )

  // The route finishing is what finishes the task.
  markSucceeded(root, started.run_id)

  const finished = reconcileHorizonSession(root, 'route-delivery')

  assert.equal(finished.transitioned, true)
  assert.equal(finished.task?.status, 'succeeded')
  assert.equal(finished.session.active_task_id, null)
  assert.deepEqual(finished.live_runs, [])
  assert.match(
    horizonStatus(root, 'route-delivery').next_command ?? '',
    /horizon next route-delivery/u,
  )
})

test('the headless checkpoint drives the routed run, not the finished planning run, and settles the task when the route finishes', () => {
  const root = createFixture()
  const planRunId = openPlanningTask(root, 'route-headless')

  ratifyPlan(root, planRunId, [{ id: 'alpha', cohort_index: 1 }])

  const started = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  if (started?.status !== 'started' || started.kind !== 'delivery') {
    assert.fail('the plan did not route to a delivery run')
  }

  reconcileHorizonSession(root, 'route-headless')

  // The fixture has no worker, so the delivery run stops at its first
  // delegation and the arbiter names a hard block to end the exchange. What
  // matters here is which run the driver picked up: the routed one.
  const driven = withFakeEvaluatorAndArbiter(
    root,
    { ok: true },
    {
      verdict: 'hard_block',
      hard_block: 'LH-H2',
      reasoning: 'The fixture declares no worker executor.',
    },
    () => checkpointHorizonSession(root, 'route-headless'),
  )

  assert.equal(driven.driven.state.run_id, started.run_id)
  assert.equal(
    driven.session.tasks.find((task) => task.id === 'plan')?.route?.run_id,
    started.run_id,
  )

  // Reinstating and finishing the routed run finishes the task through the
  // same checkpoint, without driving anything.
  const root2 = createFixture()
  const planRunId2 = openPlanningTask(root2, 'route-headless-finish')

  ratifyPlan(root2, planRunId2, [{ id: 'alpha', cohort_index: 1 }])

  const started2 = maybeStartDelivery(root2, loadState(root2, planRunId2), {
    actor: 'operator',
    action: 'approve',
  })

  if (started2?.status !== 'started' || started2.kind !== 'delivery') {
    assert.fail('the plan did not route to a delivery run')
  }

  reconcileHorizonSession(root2, 'route-headless-finish')
  markSucceeded(root2, started2.run_id)

  const settled = checkpointHorizonSession(root2, 'route-headless-finish')

  assert.equal(settled.driven.stop.type, 'terminal')
  assert.equal(settled.driven.handoff_reason, 'the route finished')
  assert.equal(
    settled.session.tasks.find((task) => task.id === 'plan')?.status,
    'succeeded',
  )
  assert.equal(settled.session.active_task_id, null)
})

test('a plan approval that starts a cohort lists its chunk runs as live runs and finishes at the release run', () => {
  const root = createFixture()
  const planRunId = openPlanningTask(root, 'route-cohort')

  ratifyPlan(root, planRunId, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
  ])

  const started = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.equal(started?.kind, 'cohort')

  if (started?.status !== 'started' || started.kind !== 'cohort') {
    return
  }

  const routed = reconcileHorizonSession(root, 'route-cohort')

  assert.equal(routed.transitioned, false)
  assert.equal(routed.task?.route?.kind, 'cohort')
  assert.equal(routed.task?.route?.cohort_id, started.cohort_id)
  assert.equal(routed.task?.route?.release_run_id, null)
  assert.deepEqual(
    routed.live_runs.map((run) => [run.role, run.chunk]).sort(),
    [
      ['chunk', 'alpha'],
      ['chunk', 'beta'],
    ],
  )

  for (const live of routed.live_runs) {
    assert.ok(live.worktree, `${live.run_id} names its worktree`)
    assert.match(live.attest_command, /governance attest-supervisor/u)
    assert.match(live.redline_command, /--occasion pan-horizon/u)
  }

  // Both chunks are already started, so no cohort step is offered yet.
  assert.equal(routed.commands.start_command, null)
  assert.equal(routed.commands.release_command, null)

  // A finished chunk leaves the live list; the task stays on the route.
  const alpha = routed.live_runs.find((run) => run.chunk === 'alpha')

  markSucceeded(root, alpha?.run_id as string)

  const half = reconcileHorizonSession(root, 'route-cohort')

  assert.equal(half.transitioned, false)
  assert.deepEqual(
    half.live_runs.map((run) => run.chunk),
    ['beta'],
  )
})

test('horizon defer refuses without a named hard block or an operator directive, and records the classification it is given', () => {
  const root = createFixture()

  openPlanningTask(root, 'route-defer')

  assert.throws(
    () =>
      deferHorizonTask(root, 'route-defer', 'plan', '', [], {
        kind: 'hard_block',
        hard_block: 'LH-H2',
      }),
    /non-empty reason/u,
  )

  const refused = spawnSync(
    process.execPath,
    [
      CLI,
      'horizon',
      'defer',
      'route-defer',
      '--task',
      'plan',
      '--reason',
      'The worker said it was blocked.',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )

  assert.notEqual(refused.status, 0)
  assert.match(
    `${refused.stdout}${refused.stderr}`,
    /HORIZON_DEFER_UNAUTHORIZED/u,
  )
  assert.equal(
    horizonStatus(root, 'route-defer').tasks.find((task) => task.id === 'plan')
      ?.status,
    'running',
  )

  const deferred = deferHorizonTask(
    root,
    'route-defer',
    'plan',
    'The registry credential is absent after the recovery flow.',
    [],
    { kind: 'hard_block', hard_block: 'LH-H2' },
  )

  assert.equal(
    deferred.tasks.find((task) => task.id === 'plan')?.status,
    'deferred',
  )
  assert.equal(
    deferred.tasks.find((task) => task.id === 'after')?.status,
    'blocked',
  )

  const ledger = read(
    path.join(
      root,
      'runtime',
      'logs',
      'horizon',
      'route-defer',
      'deferred.jsonl',
    ),
  ) as {
    reason: string
    classification: { kind: string; hard_block?: string }
  }

  assert.equal(ledger.classification.kind, 'hard_block')
  assert.equal(ledger.classification.hard_block, 'LH-H2')
  assert.match(ledger.reason, /^\[LH-H2\] /u)

  const arbiter = readArbiterLedger(root, 'route-defer')

  assert.deepEqual(
    arbiter.map((record) => [
      record.actor,
      record.result,
      record.verdict?.hard_block,
    ]),
    [['supervisor', 'hard_block', 'LH-H2']],
  )
})

test('horizon start without --headless arms the session and returns for the chat supervisor', () => {
  const root = createFixture()
  const created = initHorizonSession(root, planningQueue(root), {
    sessionId: 'route-start',
    involvement: 'long-horizon',
  })

  const output = execFileSync(
    process.execPath,
    [
      CLI,
      'horizon',
      'start',
      created.session_id,
      '--attest-supervisor-card',
      '--json',
    ],
    { cwd: root, encoding: 'utf8', timeout: 120_000 },
  )
  const status = JSON.parse(output) as {
    status: string
    active_task_id: string | null
    next_command: string | null
    live_runs: unknown[]
  }

  // Nothing was driven: no task opened, and the next command hands the
  // session to the supervisor rather than to a driver process.
  assert.equal(status.status, 'running')
  assert.equal(status.active_task_id, null)
  assert.deepEqual(status.live_runs, [])
  assert.match(status.next_command ?? '', /horizon next route-start/u)
})
