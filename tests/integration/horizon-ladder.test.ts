import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { awayModeTrigger } from '../../src/lib/away-mode.js'
import { decideRun } from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import type { StageOutput } from '../../src/lib/types.js'
import { read, writeJson } from '../helpers.js'
import { checkpoint, submitStageOutput } from './delivery-helpers.js'

const SESSION_ID = 'ladder-session'

/** The session record `horizonDependentTaskIds` reads from the run binding. */
function sessionRecord(root: string): void {
  writeJson(
    path.join(root, 'runtime', 'logs', 'horizon', SESSION_ID, 'session.json'),
    {
      schema_version: 1,
      session_id: SESSION_ID,
      tasks: [
        { id: 'first', depends_on: [] },
        { id: 'dependent', depends_on: ['first'] },
        { id: 'unrelated', depends_on: [] },
      ],
    },
  )
}

/** The precondition report a `blocked` ship result owes instead of a packet. */
function blockedReport(output: StageOutput): void {
  output.data = {
    ...(output.data ?? {}),
    blocked: {
      missing_precondition:
        'A release diagnostic reports a legitimate security concern.',
      supplying_command: 'pan status',
    },
  }
}

test('a contracted run outside a session reaches the typed ladder pause', () => {
  const { root, runId, workflow } = checkpoint('delivery@created', {
    key: 'long-horizon-ladder',
    run: { involvement: 'long-horizon' },
  })
  const implement = stageBySlug(workflow, 'implement')

  submitStageOutput(root, runId, implement, 'failure', [
    'implement.acceptance_claimed',
  ])

  const repeated = submitStageOutput(root, runId, implement, 'failure', [
    'implement.acceptance_claimed',
  ])

  assert.equal(repeated.state.status, 'paused')
  assert.equal(repeated.state.horizon_ladder?.pause_kind, 'ladder_exhausted')

  // No session owns this run, so the record names none and the decision
  // points the operator at `pan resume` instead of a session rung.
  const record = read(
    path.join(root, repeated.state.horizon_ladder?.failure_record_path ?? ''),
  ) as { task_id: string | null; session_id: string | null }

  assert.equal(record.task_id, null)
  assert.equal(record.session_id, null)
})

test('a repeated implementation signature skips to the next rung and writes failure evidence', () => {
  const { root, runId, workflow } = checkpoint('delivery@created', {
    key: 'long-horizon-session-ladder',
    fixture: sessionRecord,
    run: {
      involvement: 'long-horizon',
      horizon: { session_id: SESSION_ID, task_id: 'first', role: 'task' },
    },
  })
  const implement = stageBySlug(workflow, 'implement')
  const first = submitStageOutput(root, runId, implement, 'failure', [
    'implement.acceptance_claimed',
  ])

  assert.equal(first.state.status, 'running')
  assert.equal(first.state.current_stage, 'implement')
  assert.equal(first.state.horizon_ladder?.retries_spent, 1)
  assert.equal(first.state.same_reason_failures, undefined)

  const repeated = submitStageOutput(root, runId, implement, 'failure', [
    'implement.acceptance_claimed',
  ])

  assert.equal(repeated.state.status, 'paused')
  assert.equal(repeated.state.horizon_ladder?.strategy_switches_spent, 1)
  assert.equal(repeated.state.horizon_ladder?.pause_kind, 'ladder_exhausted')
  assert.match(repeated.state.pause_reason ?? '', /no declared repair route/u)

  const recordPath = repeated.state.horizon_ladder?.failure_record_path ?? ''

  assert.equal(existsSync(path.join(root, recordPath)), true)

  // AC-19 asks the record to name the task, the rung, the approaches tried,
  // the error class, and the dependent tasks, so each one is read back.
  const record = read(path.join(root, recordPath)) as {
    task_id: string
    session_id: string
    rung: string
    stage: string
    approaches_tried: string[]
    error_class: string
    dependent_tasks: string[]
    reason: string
  }

  assert.equal(record.task_id, 'first')
  assert.equal(record.session_id, SESSION_ID)
  assert.equal(record.rung, 'scoped_replan')
  assert.equal(record.stage, 'implement')
  assert.deepEqual(record.approaches_tried, [
    "retry 1 at stage 'implement'",
    "strategy switch from 'implement'",
  ])
  assert.equal(record.error_class, 'implement.acceptance_claimed')
  assert.deepEqual(record.dependent_tasks, ['dependent'])
  assert.match(record.reason, /no declared repair route/u)
})

test('two long-horizon retries stay inside the declared stage attempt ceiling', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared', {
    key: 'long-horizon-verify-ladder',
    run: { involvement: 'long-horizon' },
  })
  const verify = stageBySlug(workflow, 'verify')

  const first = submitStageOutput(root, runId, verify, 'failure', [
    'verify.acceptance_met',
  ])

  assert.equal(first.state.current_stage, 'verify')
  assert.equal(first.state.horizon_ladder?.retries_spent, 1)

  const second = submitStageOutput(root, runId, verify, 'failure', [
    'verify.tests_correct',
  ])

  // The third attempt at the stage is what the configured ceiling allows, so
  // the second retry must not pause the run for exceeding its attempts.
  assert.equal(second.state.status, 'running')
  assert.equal(second.state.current_stage, 'verify')
  assert.equal(second.state.horizon_ladder?.retries_spent, 2)
  assert.equal(second.state.limits.max_stage_attempts, 3)

  const third = submitStageOutput(root, runId, verify, 'failure', [
    'verify.cases_executed',
  ])

  assert.equal(third.state.horizon_ladder?.strategy_switches_spent, 1)
  assert.equal(third.state.current_stage, 'remediate')
  assert.match(third.state.horizon_ladder?.directive ?? '', /Change strategy/u)
})

test('a blocked release gate inside the contract pauses for the operator alone', () => {
  const { root, runId, workflow } = checkpoint('delivery@ship-prepared', {
    key: 'long-horizon-ship-blocked',
    run: { involvement: 'long-horizon' },
  })
  const ship = stageBySlug(workflow, 'ship')

  submitStageOutput(root, runId, ship, 'blocked', [], blockedReport)

  const paused = decideRun(root, runId, 'approve', 'Route the blocked report.')

  assert.equal(paused.status, 'paused')
  assert.equal(paused.pending_action.type, 'operator_decision')
  assert.equal(
    paused.pending_action.type === 'operator_decision' &&
      paused.pending_action.operator_only,
    true,
  )
  // Rung four owns this pause, so no away-mode blocker class claims it.
  assert.equal(awayModeTrigger(paused), null)
})

test('a blocked release gate outside the contract stays an away-mode blocker', () => {
  const { root, runId, workflow } = checkpoint('delivery@ship-prepared', {
    key: 'ordinary-ship-blocked',
  })
  const ship = stageBySlug(workflow, 'ship')

  submitStageOutput(root, runId, ship, 'blocked', [], blockedReport)

  const paused = decideRun(root, runId, 'approve', 'Route the blocked report.')

  assert.equal(paused.status, 'paused')
  assert.equal(
    paused.pending_action.type === 'operator_decision' &&
      paused.pending_action.operator_only,
    undefined,
  )
})
