import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  evaluateDeterministicCriteria,
  evaluateStateCriterion,
} from '../../src/lib/validation.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../fixture-template.js'
import type {
  Criterion,
  RunState,
  StageDefinition,
  StageHistoryItem,
  StageOutput,
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
    source_evidence_path: `runtime/logs/workflows/run-1/artifacts/json/${item.invocation_id}.json`,
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

  const missingQa = stateWith(
    [historyItem('review', 'fp-current')],
    'fp-current',
  )

  assert.equal(
    evaluateStateCriterion(missingQa, CRITERION, 'fp-current').passed,
    false,
  )
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

  // The waiver carries the gate after the ship fingerprint drifted.
  const drifted = historyItem('review', 'fp-deliverable', 'failure')
  const driftedResult = evaluateStateCriterion(
    stateWith(
      [drifted, historyItem('test', 'fp-deliverable')],
      'fp-deliverable',
      [waiverFor(drifted)],
    ),
    CRITERION,
    'fp-post-ship-edit',
  )

  assert.equal(driftedResult.passed, true)
  assert.match(
    driftedResult.explanation ?? '',
    /operator-accepted workspace fingerprint/i,
  )

  // The review waiver is not fingerprint-bound, so another fingerprint still
  // passes.
  const waiver = waiverFor(review)

  waiver.workspace_fingerprint = 'fp-other'

  const otherResult = evaluateStateCriterion(
    stateWith([review, historyItem('test', 'fp-current')], null, [waiver]),
    CRITERION,
    'fp-current',
  )

  assert.equal(otherResult.passed, true)
  assert.match(otherResult.explanation ?? '', /operator-waived/i)
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

function localReleaseStageOf(root: string): StageDefinition {
  const shipStage = stageBySlug(loadWorkflow(root, 'delivery'), 'ship')

  return {
    ...shipStage,
    criteria: shipStage.criteria.filter(
      (criterion) => criterion.id === 'ship.local_release_complete',
    ),
  }
}

test('a worktree-bound run fails the local-release criterion it has not satisfied', () => {
  // The criterion carried only a positive assertion, so a change that always
  // returned `true` left the suite green.
  const root = createFixture()
  const snapshot = gitWorkspaceSnapshot(root)
  const state = {
    run_id: 'bound',
    workspace_root: root,
    state_root: 'runtime',
    stage_history: [],
    gate_overrides: {},
    managed_worktree: {
      name: 'release',
      path: 'worktrees/operator/release',
      branch: 'main',
    },
  } as unknown as RunState

  const evaluate = (release: Record<string, unknown>) =>
    evaluateDeterministicCriteria(
      root,
      path.join(root, 'runtime', 'gate-evidence'),
      state,
      localReleaseStageOf(root),
      snapshot,
      root,
      {},
      'ship',
      { data: { release } } as unknown as StageOutput,
      undefined,
      null,
      snapshot,
    )

  const absent = evaluate({})
  const absentResult = absent.results.find(
    (item) => item.id === 'ship.local_release_complete',
  )

  assert.ok(absentResult)
  assert.equal(absentResult.passed, false)
  assert.match(absentResult.explanation ?? '', /incomplete/u)
  assert.deepEqual(absent.advisories, [], 'the legacy bypass does not apply')

  // Well-formed hashes that describe no commit in this workspace still fail:
  // the criterion resolves topology rather than the shape of a string.
  const unreachable = evaluate({
    local_release: {
      release_commit: 'a'.repeat(40),
      index_commit: 'b'.repeat(40),
      fetched_main: 'c'.repeat(40),
    },
  })

  assert.equal(
    unreachable.results.find(
      (item) => item.id === 'ship.local_release_complete',
    )?.passed,
    false,
  )
})

// int-con HR-005: a self-development run without a managed worktree passes
// the hard local-release criterion that a worktree-bound run must satisfy.
// The operator kept the compatibility path, because removing it changes an
// installation that predates managed worktrees, and asked for the bypass to
// become visible in the record instead.
test('a worktree-less self-development run records the criterion it bypassed', () => {
  const root = createFixture()
  const localReleaseStage = localReleaseStageOf(root)
  const snapshot = gitWorkspaceSnapshot(root)
  const evaluated = evaluateDeterministicCriteria(
    root,
    path.join(root, 'runtime', 'gate-evidence'),
    {
      run_id: 'legacy',
      workspace_root: root,
      state_root: 'runtime',
      stage_history: [],
      gate_overrides: {},
    } as unknown as RunState,
    localReleaseStage,
    snapshot,
    root,
    {},
    'ship',
    { data: { release: {} } } as unknown as StageOutput,
    undefined,
    null,
    snapshot,
  )
  const result = evaluated.results.find(
    (item) => item.id === 'ship.local_release_complete',
  )

  assert.ok(result)
  assert.equal(result.passed, true, 'the compatibility path still passes')
  assert.equal(evaluated.advisories.length, 1)
  assert.match(evaluated.advisories[0] ?? '', /ship\.local_release_complete/u)
  assert.match(evaluated.advisories[0] ?? '', /no\s+managed worktree/u)
})
