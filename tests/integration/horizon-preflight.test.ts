import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { getRunState } from '../../src/lib/engine.js'
import {
  checkpointHorizonSession,
  horizonStatus,
  initHorizonSession,
  latestHorizonHandoff,
  nextHorizonTask,
  startHorizonSession,
} from '../../src/lib/horizon.js'
import { createFixture, read, writeJson } from '../helpers.js'
import {
  withFakeEvaluator,
  withFakeEvaluatorAndArbiter,
} from './delivery-helpers.js'

const PROMPT = 'Return one result.'

function promptQueue(root: string): void {
  writeJson(path.join(root, 'runtime', 'queue.json'), {
    tasks: [{ id: 'one', title: 'One', kind: 'prompt', prompt: PROMPT }],
  })
}

test('preflight refuses before mutation without card-attestation authorization', () => {
  const root = createFixture()

  promptQueue(root)
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'preflight-refusal',
    involvement: 'long-horizon',
  })

  assert.throws(
    () =>
      startHorizonSession(root, 'preflight-refusal', {
        attestSupervisorCard: false,
      }),
    /requires --attest-supervisor-card/u,
  )
  const state = horizonStatus(root, 'preflight-refusal')
  assert.equal(state.status, 'created')
  assert.equal(state.preflight.away_mode_armed, false)
  assert.equal(state.preflight.card_attestation_authorized, false)
})

test('an authorized session runs a prompt task and records its outcome', () => {
  const root = createFixture()

  promptQueue(root)
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'preflight-prompt',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, 'preflight-prompt', {
    attestSupervisorCard: true,
  })

  const executed = withFakeEvaluator(root, { ok: true }, () =>
    nextHorizonTask(root, 'preflight-prompt'),
  )

  assert.equal(executed.prompt_result?.ok, true)
  assert.equal(executed.task?.status, 'succeeded')
  assert.equal(executed.task?.run_id, null)

  const requestPath = path.join(
    root,
    'runtime',
    'inbox',
    'queue',
    'horizon-preflight-prompt-one.md',
  )

  assert.equal(readFileSync(requestPath, 'utf8'), `${PROMPT}\n`)

  const artifact = read(
    path.join(root, executed.task?.result_path ?? 'missing'),
  ) as {
    task_id: string
    request_path: string
    card_path: string
    ok: boolean
  }

  assert.equal(artifact.task_id, 'one')
  assert.equal(
    artifact.request_path,
    'runtime/inbox/queue/horizon-preflight-prompt-one.md',
  )
  assert.match(artifact.card_path, /prompt-tasks\/one\.card\.md$/u)
  assert.equal(artifact.ok, true)

  // AC-55: a session that reaches its terminal state names a harness action,
  // never an operator one.
  const final = horizonStatus(root, 'preflight-prompt')
  const handoff = latestHorizonHandoff(root, 'preflight-prompt') as {
    next_action: string
    last_task_id: string
  }

  assert.equal(final.status, 'succeeded')
  assert.equal(final.active_task_id, null)
  assert.equal(handoff.next_action, 'No eligible task remains.')
  assert.equal(handoff.last_task_id, 'one')
})

test('an authorized session attests its first invocation without stopping', () => {
  const root = createFixture()
  const request = path.posix.join('runtime', 'inbox', 'queue', 'armed.md')

  mkdirSync(path.dirname(path.join(root, request)), { recursive: true })
  writeFileSync(path.join(root, request), '# Armed task\n')
  writeJson(path.join(root, 'runtime', 'queue.json'), {
    tasks: [
      {
        id: 'armed',
        title: 'Armed task',
        kind: 'workflow',
        workflow: 'planning',
        request_path: request,
      },
    ],
  })
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'preflight-armed',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, 'preflight-armed', {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(root, 'preflight-armed')
  const runId = opened.run?.run_id as string
  const card = opened.run?.supervisor_card

  assert.ok(card)
  assert.notEqual(card.attested_sha256, card.sha256)

  // The fixture has no worker, so the first delegation stops the run. The
  // arbiter names a hard block here so the run rests where the driver left
  // it; the prepared invocation below is this test's subject, not the stop.
  withFakeEvaluatorAndArbiter(
    root,
    { ok: true },
    {
      verdict: 'hard_block',
      hard_block: 'LH-H2',
      reasoning: 'The fixture declares no worker executor.',
    },
    () => checkpointHorizonSession(root, 'preflight-armed'),
  )

  // The authorization the preflight recorded is what lets the driver attest
  // the card, so the run reaches its first prepared invocation unattended.
  const driven = getRunState(root, runId)

  assert.equal(
    driven.supervisor_card?.attested_sha256,
    driven.supervisor_card?.sha256,
  )
  // Attestation on its own is not the contract. An unattested card stops the
  // driver before it prepares anything, so the prepared invocation is what
  // proves the run reached its first stage unattended.
  assert.ok(driven.current_invocation)
  assert.equal(driven.current_stage, 'plan')
})
