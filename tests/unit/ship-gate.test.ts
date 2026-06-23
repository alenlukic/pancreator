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

function historyItem(stage: string, fingerprint: string): StageHistoryItem {
  return {
    stage,
    attempt: 1,
    invocation_id: `${stage}-1-test`,
    output_path: `runtime/logs/workflows/run-1/outputs/${stage}-1.json`,
    outcome: 'success',
    submitted_at: '2026-06-22T00:00:00.000Z',
    workspace_fingerprint: fingerprint,
    validation_errors: [],
    deterministic: [],
  }
}

function stateWith(
  history: StageHistoryItem[],
  accepted: string | null = null,
): RunState {
  return {
    stage_history: history,
    accepted_workspace_fingerprint: accepted,
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
