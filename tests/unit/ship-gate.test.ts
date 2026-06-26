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
  waivers: RunState['operator_gate_waivers'] = [],
): RunState {
  return {
    stage_history: history,
    accepted_workspace_fingerprint: accepted,
    operator_gate_waivers: waivers,
  } as unknown as RunState
}

function waiverFor(
  item: StageHistoryItem,
): NonNullable<RunState['operator_gate_waivers']>[number] {
  return {
    waiver_id: `waiver-${item.stage}`,
    stage: item.stage,
    source_invocation_id: item.invocation_id,
    source_attempt: item.attempt,
    source_evidence_path: `runtime/logs/workflows/run-1/artifacts/markdown/${item.invocation_id}.record.md`,
    criterion_ids: [`${item.stage}.acceptance_met`],
    workspace_fingerprint: item.workspace_fingerprint,
    note: 'Operator accepts one bounded deferred criterion.',
    artifact_path: `runtime/logs/workflows/run-1/artifacts/markdown/${item.stage}-waiver.md`,
    deferred_acceptance_criteria: ['AC-9'],
    spotfix_case_path: 'runtime/inbox/spotfix-case.md',
    timestamp: '2026-06-24T22:20:00.000Z',
  }
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
  const review = historyItem('review', 'fp-current', 'failure')
  const state = stateWith(
    [review, historyItem('test', 'fp-current')],
    'fp-current',
    [waiverFor(review)],
  )

  const result = evaluateStateCriterion(state, CRITERION, 'fp-current')

  assert.equal(result.passed, true)
  assert.match(result.explanation ?? '', /operator-waived/i)
})

test('ship gate passes with operator-waived review when ship fingerprint drifted after acceptance', () => {
  const review = historyItem('review', 'fp-deliverable', 'failure')
  const state = stateWith(
    [review, historyItem('test', 'fp-deliverable')],
    'fp-deliverable',
    [waiverFor(review)],
  )

  const result = evaluateStateCriterion(state, CRITERION, 'fp-post-ship-edit')

  assert.equal(result.passed, true)
  assert.match(
    result.explanation ?? '',
    /operator-accepted workspace fingerprint/i,
  )
})

test('ship gate does not infer a waiver from an operator resume note', () => {
  const state = {
    ...stateWith([
      historyItem('review', 'fp-current', 'failure'),
      historyItem('test', 'fp-current'),
    ]),
    operator_feedback: [
      {
        decision: 'resume',
        from_stage: 'review',
        to_stage: 'test',
        attempt: 3,
        note: 'Skip review.',
        path: 'runtime/logs/workflows/run-1/artifacts/markdown/operator-feedback.md',
        timestamp: '2026-06-24T22:20:00.000Z',
      },
    ],
  } as RunState

  const result = evaluateStateCriterion(state, CRITERION, 'fp-current')

  assert.equal(result.passed, false)
})

test('ship gate rejects a waiver bound to a different fingerprint', () => {
  const review = historyItem('review', 'fp-current', 'failure')
  const waiver = waiverFor(review)

  waiver.workspace_fingerprint = 'fp-other'

  const state = stateWith([review, historyItem('test', 'fp-current')], null, [
    waiver,
  ])

  const result = evaluateStateCriterion(state, CRITERION, 'fp-current')

  assert.equal(result.passed, false)
})
