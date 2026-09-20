import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyHorizonFailure } from '../../src/lib/engine.js'
import type { RunState, StageDefinition } from '../../src/lib/types.js'

const stage = {
  slug: 'verify',
  transitions: { success: 'ship', failure: 'remediate', blocked: 'paused' },
} as StageDefinition

function state(): RunState {
  return {} as RunState
}

test('two transient signatures spend retries on the declared repair route before the strategy switch', () => {
  const run = state()

  // The stage names its repair route, so a retry follows it instead of
  // re-running the failed stage against an unchanged workspace.
  assert.deepEqual(classifyHorizonFailure(run, stage, ['first']), {
    kind: 'route',
    target: 'remediate',
  })
  assert.deepEqual(classifyHorizonFailure(run, stage, ['second']), {
    kind: 'route',
    target: 'remediate',
  })
  assert.deepEqual(classifyHorizonFailure(run, stage, ['third']), {
    kind: 'strategy',
    target: 'remediate',
  })
  assert.equal(run.horizon_ladder?.retries_spent, 2)
  assert.equal(run.horizon_ladder?.strategy_switches_spent, 1)
})

test('a repeated signature skips retry and the first post-switch failure exhausts', () => {
  const run = state()

  assert.equal(classifyHorizonFailure(run, stage, ['same']).kind, 'route')
  assert.deepEqual(classifyHorizonFailure(run, stage, ['same']), {
    kind: 'strategy',
    target: 'remediate',
  })
  assert.equal(classifyHorizonFailure(run, stage, ['same']).kind, 'exhausted')
  assert.match(run.horizon_ladder?.directive ?? '', /Change strategy/u)
})

test('a stage without a repair route moves directly beyond strategy switch', () => {
  const selfLoop = {
    ...stage,
    slug: 'implement',
    transitions: { ...stage.transitions, failure: 'implement' },
  } as StageDefinition
  const run = state()

  // A self-looping failure transition keeps the same-stage retry.
  assert.equal(classifyHorizonFailure(run, selfLoop, ['same']).kind, 'retry')
  const action = classifyHorizonFailure(run, selfLoop, ['same'])

  assert.equal(action.kind, 'exhausted')
  assert.match(
    action.kind === 'exhausted' ? action.reason : '',
    /no declared repair route/u,
  )
})
