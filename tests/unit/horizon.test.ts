import assert from 'node:assert/strict'
import test from 'node:test'

import {
  eligibleHorizonTask,
  horizonCycle,
  parseHorizonQueue,
  transitiveHorizonDependents,
  type HorizonSessionState,
} from '../../src/lib/horizon.js'

function task(id: string, dependsOn: string[] = []) {
  return {
    id,
    title: id,
    kind: 'workflow' as const,
    request_path: `runtime/inbox/queue/${id}.md`,
    depends_on: dependsOn,
    status: 'pending' as const,
    request_stored_path: null,
    run_id: null,
    replan_run_id: null,
    result_path: null,
    ladder: {
      retries_spent: 0,
      strategy_switches_spent: 0,
      replans_spent: 0,
      last_failure_signature: [],
    },
  }
}

test('queue parsing records edges and names a dependency cycle', () => {
  const parsed = parseHorizonQueue({
    tasks: [task('first'), task('second')],
    edges: [{ from: 'first', to: 'second' }],
  })

  assert.deepEqual(parsed.tasks[1]?.depends_on, ['first'])
  assert.deepEqual(parsed.edges, [{ from: 'first', to: 'second' }])
  assert.deepEqual(
    horizonCycle([
      { id: 'first', depends_on: ['second'] },
      { id: 'second', depends_on: ['first'] },
    ]),
    ['first', 'second', 'first'],
  )
  assert.throws(
    () =>
      parseHorizonQueue({
        tasks: [
          { ...task('first'), depends_on: ['second'] },
          { ...task('second'), depends_on: ['first'] },
        ],
      }),
    /first -> second -> first/u,
  )
})

test('a task id that cannot name a path is refused at queue parse', () => {
  assert.throws(
    () => parseHorizonQueue({ tasks: [task('../escape')] }),
    /tasks\[0\]\.id MUST match/u,
  )
  assert.throws(
    () => parseHorizonQueue({ tasks: [task('has space')] }),
    /tasks\[0\]\.id MUST match/u,
  )
})

test('eligibility keeps declared order and dependent traversal stays scoped', () => {
  const state: Pick<HorizonSessionState, 'tasks'> = {
    tasks: [task('first'), task('dependent', ['first']), task('unrelated')],
  }

  assert.equal(eligibleHorizonTask(state)?.id, 'first')
  assert.deepEqual(transitiveHorizonDependents(state, 'first'), ['dependent'])

  const [first] = state.tasks
  assert.ok(first)
  state.tasks[0] = { ...first, status: 'succeeded' }
  assert.equal(eligibleHorizonTask(state)?.id, 'dependent')
})
