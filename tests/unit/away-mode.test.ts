import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  awayDecisionLedgerPath,
  awayModeTrigger,
  readAwayDecisionLedger,
  unknownAwayOption,
} from '../../src/lib/away-mode.js'
import { decideAwayAsSupervisor } from '../../src/lib/away-orchestration.js'
import { AWAY_MODE_ACTIONS } from '../../src/lib/project-config.js'
import type {
  AwayModeAction,
  OperatorFeedbackItem,
  ResolvedAwayModeConfig,
  RunState,
  StageHistoryItem,
} from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

function awayConfig(
  guardrails: Partial<ResolvedAwayModeConfig['guardrails']> = {},
): ResolvedAwayModeConfig {
  return {
    enabled: true,
    guardrails: {
      allowed_actions: [...AWAY_MODE_ACTIONS],
      ...guardrails,
    },
    source_sha256: 'a'.repeat(64),
  }
}

function runStateLiteral(overrides: Partial<RunState>): RunState {
  return {
    run_id: 'run-literal',
    status: 'running',
    current_stage: 'plan',
    pending_action: { type: 'prepare_invocation' },
    stage_history: [],
    pause_reason: null,
    ...overrides,
  } as unknown as RunState
}

function blockedHistoryItem(stage: string): StageHistoryItem {
  return {
    stage,
    attempt: 1,
    invocation_id: `1_${stage}-1_fixture`,
    output_path: 'runtime/logs/workflows/run/agent/outputs/fixture.json',
    outcome: 'blocked',
    submitted_at: '2026-08-21T12:00:00.000Z',
    workspace_fingerprint: 'fixture',
    validation_errors: [],
    deterministic: [],
  }
}

test('a stale blocked outcome does not trigger on a progressing run', () => {
  assert.equal(
    awayModeTrigger(
      runStateLiteral({
        away_mode: { ...awayConfig(), enabled: false },
        status: 'paused',
        pending_action: { type: 'operator_decision' },
      }),
    ),
    null,
  )

  const running = runStateLiteral({ away_mode: awayConfig() })

  assert.equal(awayModeTrigger(running), null)

  const state = runStateLiteral({
    away_mode: awayConfig(),
    stage_history: [blockedHistoryItem('plan')],
  })

  assert.equal(awayModeTrigger(state), null)

  state.status = 'paused'
  state.pending_action = { type: 'operator_decision' }

  const blocker = awayModeTrigger(state)

  assert.equal(blocker?.type, 'stage_blocked')
  assert.equal(blocker?.stage, 'plan')
})

test('away mode triggers on operator_approval pending action', () => {
  const state = runStateLiteral({
    away_mode: awayConfig(),
    status: 'paused',
    pending_action: {
      type: 'operator_approval',
      stage: 'ship',
      proposed_transition: 'advance',
    },
  })

  const blocker = awayModeTrigger(state)

  assert.equal(blocker?.type, 'operator_approval')
  assert.equal(blocker?.stage, 'ship')
})

test('away mode does not trigger when away_mode is disabled', () => {
  const state = runStateLiteral({
    away_mode: { ...awayConfig(), enabled: false },
    status: 'paused',
    pending_action: { type: 'operator_decision' },
    stage_history: [blockedHistoryItem('implement')],
  })

  assert.equal(awayModeTrigger(state), null)
})

test('an option an away subcommand does not accept is named, not ignored', () => {
  assert.equal(
    unknownAwayOption('decide', ['decide', 'run-1', '--action', 'resume']),
    null,
  )
  assert.equal(
    unknownAwayOption('decide', ['decide', 'run-1', '--note', 'text']),
    null,
  )
  assert.equal(
    unknownAwayOption('decide', ['decide', 'run-1', '--dceision', 'd-1']),
    '--dceision',
  )
  assert.equal(
    unknownAwayOption('status', ['status', 'run-1', '--decision', 'd-1']),
    '--decision',
  )
  // An unrecognized subcommand is the subcommand handler's refusal, not this
  // guard's, so it claims nothing about the options.
  assert.equal(unknownAwayOption('sttaus', ['sttaus', '--json']), null)
})

function stageOutput(
  root: string,
  stage: string,
  submittedAt: string,
  body: string,
): StageHistoryItem {
  const relative = `runtime/logs/workflows/run-literal/agent/outputs/${stage}.json`

  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  writeFileSync(path.join(root, relative), body)

  return {
    ...blockedHistoryItem(stage),
    outcome: 'success',
    output_path: relative,
    submitted_at: submittedAt,
  }
}

function awaitingPlanApproval(stageHistory: StageHistoryItem[]): RunState {
  return runStateLiteral({
    away_mode: awayConfig(),
    status: 'paused',
    pending_action: {
      type: 'operator_approval',
      stage: 'plan',
      proposed_transition: 'advance',
    },
    stage_history: stageHistory,
  })
}

function feedback(
  source: 'away' | 'operator',
  timestamp: string,
): OperatorFeedbackItem {
  return {
    decision: 'approve',
    source,
    from_stage: 'plan',
    to_stage: 'implement',
    attempt: 1,
    note: `${source} decision`,
    path: `runtime/logs/workflows/run-literal/agent/decisions/${source}.md`,
    timestamp,
  }
}

// An unreadable output cannot show that no question stands. Away mode once
// treated the failed read as consent and cleared the gate.
test('an unreadable stage output fails closed as an open operator question', () => {
  const root = createTestTempDirectory('pan-away-unit-')
  const state = awaitingPlanApproval([
    stageOutput(root, 'plan', '2026-09-19T10:00:00.000Z', '{ not json'),
  ])

  const blocker = awayModeTrigger(state, root)

  assert.equal(blocker?.type, 'operator_question')
  assert.match(blocker?.summary ?? '', /could not be read/u)
  assert.throws(
    () => decideAwayAsSupervisor(root, state, { action: 'approve', note: 'n' }),
    { code: 'AWAY_OPERATOR_QUESTION_OPEN' },
  )
  assert.equal(existsSync(awayDecisionLedgerPath(root)), false)
})

// A question raised by one stage survives the next stage writing an output
// with none, and only the operator's own decision retires it.
test('an away decision does not retire an operator question; the operator does', () => {
  const root = createTestTempDirectory('pan-away-unit-')
  const state = awaitingPlanApproval([
    stageOutput(
      root,
      'plan',
      '2026-09-19T10:00:00.000Z',
      JSON.stringify({
        schema_version: 1,
        operator_question: {
          question: 'Which store owns the retry record?',
          reason: 'Two materially different choices remain.',
          evidence: ['runtime/logs/workflows/run-literal/operator/request.md'],
        },
      }),
    ),
    stageOutput(
      root,
      'implement',
      '2026-09-19T11:00:00.000Z',
      JSON.stringify({ schema_version: 1, summary: 'No question here.' }),
    ),
  ])

  assert.equal(awayModeTrigger(state, root)?.type, 'operator_question')

  state.operator_feedback = [feedback('away', '2026-09-19T12:00:00.000Z')]

  assert.equal(awayModeTrigger(state, root)?.type, 'operator_question')
  assert.throws(
    () => decideAwayAsSupervisor(root, state, { action: 'approve', note: 'n' }),
    { code: 'AWAY_OPERATOR_QUESTION_OPEN' },
  )

  state.operator_feedback.push(feedback('operator', '2026-09-19T13:00:00.000Z'))

  assert.equal(awayModeTrigger(state, root)?.type, 'operator_approval')
})

test('the supervisor decision ledger rejects a malformed line', () => {
  const root = createTestTempDirectory('pan-away-unit-')
  const ledgerPath = awayDecisionLedgerPath(root)

  mkdirSync(path.dirname(ledgerPath), { recursive: true })

  for (const line of [
    'not json',
    '{"schema_version":2,"decision_id":"d"}',
    '{"schema_version":1}',
  ]) {
    writeFileSync(ledgerPath, `${line}\n`)

    assert.throws(
      () => readAwayDecisionLedger(root),
      (error: unknown) =>
        error instanceof Error &&
        (error as { code?: unknown }).code === 'INVALID_AWAY_LEDGER' &&
        error.message.includes(ledgerPath),
      line,
    )
  }
})

// The release gate raises an operator-only pause after its repair loops run
// out. The supervisor cannot clear it with any action.
test('pan away decide refuses every action on an operator-only pause', () => {
  const root = createTestTempDirectory('pan-away-unit-')
  const actions: AwayModeAction[] = [
    'approve',
    'resume',
    'set-stage',
    'waive-gate',
  ]

  for (const outcome of ['success', 'blocked'] as const) {
    const state = runStateLiteral({
      away_mode: awayConfig({ allowed_actions: actions }),
      status: 'paused',
      current_stage: 'ship',
      pending_action: { type: 'operator_decision', operator_only: true },
      stage_history: [{ ...blockedHistoryItem('ship'), outcome }],
    })

    assert.equal(awayModeTrigger(state, root), null, outcome)

    for (const action of actions) {
      assert.throws(
        () =>
          decideAwayAsSupervisor(root, state, {
            action,
            note: 'n',
            stage: action === 'set-stage' ? 'implement' : null,
          }),
        { code: 'AWAY_TRIGGER_UNAVAILABLE' },
        `${outcome} ${action}`,
      )
    }
  }

  assert.equal(existsSync(awayDecisionLedgerPath(root)), false)

  const ordinary = runStateLiteral({
    away_mode: awayConfig({ allowed_actions: actions }),
    status: 'paused',
    current_stage: 'ship',
    pending_action: { type: 'operator_decision' },
  })

  assert.equal(awayModeTrigger(ordinary, root)?.type, 'operator_decision')
})
