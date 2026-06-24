import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateStateCriterion } from '../../src/lib/validation.js'
import type {
  Criterion,
  RunState,
  StageHistoryItem,
} from '../../src/lib/types.js'

const CRITERION: Criterion = {
  id: 'ship.prior_gates_current',
  type: 'state',
  hard: true,
  statement: 'Review and QA passed against the current workspace fingerprint.',
}

function historyItem(
  stage: string,
  fingerprint: string,
  outcome: StageHistoryItem['outcome'] = 'success',
): StageHistoryItem {
  return {
    stage,
    attempt: 1,
    invocation_id: `${stage}-1-test`,
    output_path: `runtime/logs/workflows/run-1/outputs/${stage}-1.json`,
    outcome,
    submitted_at: '2026-06-22T00:00:00.000Z',
    workspace_fingerprint: fingerprint,
    validation_errors: [],
    deterministic: [],
  }
}

function stateWith(
  history: StageHistoryItem[],
  accepted: string | null = null,
  operatorFeedback: RunState['operator_feedback'] = [],
): RunState {
  return {
    stage_history: history,
    accepted_workspace_fingerprint: accepted,
    operator_feedback: operatorFeedback,
  } as unknown as RunState
}

test('ship gate passes when review and QA match the current fingerprint', () => {
  const state = stateWith([
    historyItem('review', 'fp-current'),
    historyItem('test', 'fp-current'),
  ])

  const result = evaluateStateCriterion(state, CRITERION, 'fp-current')

  assert.equal(result.passed, true)
})

test('ship gate passes with stale QA when the operator accepted the current workspace', () => {
  const state = stateWith(
    [historyItem('review', 'fp-old'), historyItem('test', 'fp-old')],
    'fp-current',
  )

  const result = evaluateStateCriterion(state, CRITERION, 'fp-current')

  assert.equal(result.passed, true)
  assert.match(result.explanation ?? '', /operator accepted/i)
})

test('ship gate fails when neither current fingerprint nor acceptance matches', () => {
  const state = stateWith(
    [historyItem('review', 'fp-old'), historyItem('test', 'fp-old')],
    'fp-accepted-but-different',
  )

  const result = evaluateStateCriterion(state, CRITERION, 'fp-current')

  assert.equal(result.passed, false)
})

test('ship gate fails when review or QA evidence is absent even if accepted', () => {
  const state = stateWith([historyItem('review', 'fp-current')], 'fp-current')

  const result = evaluateStateCriterion(state, CRITERION, 'fp-current')

  assert.equal(result.passed, false)
})

test('ship gate passes when review failed but operator waived advancement to QA', () => {
  const state = stateWith(
    [
      historyItem('review', 'fp-current', 'failure'),
      historyItem('test', 'fp-current'),
    ],
    'fp-current',
    [
      {
        decision: 'resume',
        from_stage: 'review',
        to_stage: 'test',
        attempt: 3,
        note: 'Operator accepts delivery with AC9 deferred.',
        path: 'runtime/logs/workflows/run-1/artifacts/operator-feedback-2.md',
        timestamp: '2026-06-24T22:20:00.000Z',
      },
    ],
  )

  const result = evaluateStateCriterion(state, CRITERION, 'fp-current')

  assert.equal(result.passed, true)
  assert.match(result.explanation ?? '', /operator-waived/i)
})

test('ship gate passes with operator-waived review when ship fingerprint drifted after acceptance', () => {
  const state = stateWith(
    [
      historyItem('review', 'fp-deliverable', 'failure'),
      historyItem('test', 'fp-deliverable'),
    ],
    'fp-deliverable',
    [
      {
        decision: 'resume',
        from_stage: 'review',
        to_stage: 'test',
        attempt: 3,
        note: 'Operator accepts delivery with AC9 deferred.',
        path: 'runtime/logs/workflows/run-1/artifacts/operator-feedback-2.md',
        timestamp: '2026-06-24T22:20:00.000Z',
      },
    ],
  )

  const result = evaluateStateCriterion(state, CRITERION, 'fp-post-ship-edit')

  assert.equal(result.passed, true)
  assert.match(result.explanation ?? '', /operator-accepted workspace fingerprint/i)
})
