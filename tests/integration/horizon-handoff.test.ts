import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

import {
  deferHorizonTask,
  horizonStatus,
  initHorizonSession,
  latestHorizonHandoff,
  nextHorizonTask,
  startHorizonSession,
} from '../../src/lib/horizon.js'
import { createFixture, read, writeJson } from '../helpers.js'
import { withFakeEvaluator } from './delivery-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

interface Handoff {
  sequence: number
  transition: string
  last_task_id: string | null
  queue: Array<{ id: string; status: string; depends_on: string[] }>
  open_deferrals: string[]
  next_action: string
}

function handoffAt(root: string, sessionId: string, sequence: number): Handoff {
  return read(
    path.join(
      root,
      'runtime',
      'logs',
      'horizon',
      sessionId,
      'handoffs',
      `${String(sequence).padStart(4, '0')}.json`,
    ),
  ) as Handoff
}

test('every task transition writes reconstructable handoff and boundary records', () => {
  const root = createFixture()
  writeJson(path.join(root, 'runtime', 'queue.json'), {
    tasks: [
      {
        id: 'one',
        title: 'One',
        kind: 'workflow',
        workflow: 'planning',
        request_path: 'runtime/inbox/queue/request.md',
      },
    ],
  })
  writeJson(path.join(root, 'runtime', 'inbox', 'queue', 'request.md'), {
    request: 'test',
  })
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'handoff-session',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, 'handoff-session', {
    attestSupervisorCard: true,
  })
  const opened = nextHorizonTask(root, 'handoff-session')
  const handoff = latestHorizonHandoff(root, 'handoff-session') as Handoff

  assert.deepEqual(handoff.queue, [
    {
      id: 'one',
      status: 'running',
      depends_on: [],
      run_id: opened.run?.run_id ?? null,
    },
  ])
  assert.deepEqual(handoff.open_deferrals, [])
  assert.match(handoff.next_action, /Checkpoint active task 'one'/u)
  assert.equal(opened.session.boundaries.length, 1)
  assert.equal(
    opened.session.boundaries[0]?.handoff_consumed?.endsWith('0001.json'),
    true,
  )

  const deferred = deferHorizonTask(
    root,
    'handoff-session',
    'one',
    'manual test deferral',
  )
  assert.equal(deferred.handoff_sequence, 3)
  const final = latestHorizonHandoff(root, 'handoff-session') as Handoff
  assert.deepEqual(final.open_deferrals, ['one'])
  assert.equal(final.next_action, 'No eligible task remains.')
  assert.equal(final.transition, 'deferred')
  assert.equal(final.last_task_id, 'one')
})

test('a session advancing three tasks opens each one in its own driver process', () => {
  const root = createFixture()

  writeJson(path.join(root, 'runtime', 'queue.json'), {
    tasks: [
      { id: 'one', title: 'One', kind: 'prompt', prompt: 'First step.' },
      {
        id: 'two',
        title: 'Two',
        kind: 'prompt',
        prompt: 'Second step.',
        depends_on: ['one'],
      },
      {
        id: 'three',
        title: 'Three',
        kind: 'prompt',
        prompt: 'Third step.',
        depends_on: ['two'],
      },
    ],
  })
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'boundary-session',
    involvement: 'long-horizon',
  })

  // `pan horizon start` is the only boundary mechanism: it opens each task in
  // a driver process of its own rather than continuing the previous one.
  withFakeEvaluator(root, { ok: true }, () =>
    execFileSync(
      process.execPath,
      [
        CLI,
        'horizon',
        'start',
        'boundary-session',
        '--attest-supervisor-card',
        '--json',
      ],
      { cwd: root, encoding: 'utf8', timeout: 120_000 },
    ),
  )

  const session = horizonStatus(root, 'boundary-session')
  const boundaries = session.boundaries

  assert.equal(session.status, 'succeeded')
  assert.equal(session.active_task_id, null)
  assert.deepEqual(
    boundaries.map((boundary) => boundary.task_opened),
    ['one', 'two', 'three'],
  )
  assert.deepEqual(
    boundaries.map((boundary) => boundary.sequence),
    [1, 2, 3],
  )
  assert.equal(new Set(boundaries.map((item) => item.process_id)).size, 3)
  assert.equal(
    boundaries.some((boundary) => boundary.process_id === process.pid),
    false,
  )

  // Each driver reconstructs the queue from the handoff the previous process
  // wrote, so the consumed pointer has to name that artifact.
  for (const boundary of boundaries) {
    const consumed = boundary.handoff_consumed as string
    const sequence = Number(path.basename(consumed, '.json'))
    const handoff = handoffAt(root, 'boundary-session', sequence)

    assert.equal(handoff.sequence, sequence)
    assert.equal(handoff.queue.length, 3)
    assert.equal(
      handoff.next_action,
      `Open task '${boundary.task_opened}' in a new driver process.`,
    )
  }

  const second = handoffAt(root, 'boundary-session', 3)

  assert.equal(second.transition, 'finished')
  assert.equal(second.last_task_id, 'one')
  assert.equal(
    second.queue.find((task) => task.id === 'one')?.status,
    'succeeded',
  )

  // AC-55: no record or output the session writes asks the operator to act.
  const actions = [
    ...Array.from({ length: session.handoff_sequence }, (_unused, index) =>
      handoffAt(root, 'boundary-session', index + 1),
    ).map((item) => item.next_action),
  ]

  assert.equal(
    actions.every((action) =>
      /^(Open task '.*' in a new driver process\.|Checkpoint active task '.*'\.|No eligible task remains\.)$/u.test(
        action,
      ),
    ),
    true,
  )
  assert.equal(actions.at(-1), 'No eligible task remains.')
})
