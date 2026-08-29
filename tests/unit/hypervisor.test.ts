import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createRun, prepareInvocation } from '../../src/lib/engine.js'
import {
  completeInvocationAgent,
  createAgentRecoveryRunner,
  HYPERVISOR_INTERVAL_MS,
  hypervisorEventsPath,
  readAgentRegistry,
  reconcileAgentRecords,
  recoverAgent,
  registerPreparedInvocation,
  registryHealthForRun,
  runHypervisorLoop,
  tickHypervisor,
} from '../../src/lib/hypervisor.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { AgentRecord, RunState } from '../../src/lib/types.js'
import { createFixture } from '../helpers.js'
import { checkpoint } from '../integration/delivery-helpers.js'

const stalledObservation = {
  agent_id: 'agent-1',
  run_id: 'run-1',
  invocation_id: 'invoke-1',
  persona: 'coder',
  executor: 'cursor' as const,
  process_alive: null,
  last_transcript_at: '2026-08-21T10:00:00.000Z',
}

test('hypervisor requires two unchanged scans before stalled', () => {
  const root = createFixture()

  tickHypervisor(root, {
    now: '2026-08-21T10:15:00.000Z',
    observations: [stalledObservation],
  })
  tickHypervisor(root, {
    now: '2026-08-21T10:30:00.000Z',
    observations: [stalledObservation],
  })
  const result = tickHypervisor(root, {
    now: '2026-08-21T10:45:00.000Z',
    observations: [stalledObservation],
  })

  assert.equal(result.agents[0]?.health, 'stalled')
  assert.equal(result.agents[0]?.consecutive_unchanged_scans, 2)
  assert.equal(
    registryHealthForRun(root, 'run-1', 'invoke-1')?.health,
    'stalled',
  )
})

test('registry reconciliation preserves stable parent and subagent identity', () => {
  const observations = [
    {
      ...stalledObservation,
      agent_id: 'parent-1',
      process_alive: true,
    },
    {
      ...stalledObservation,
      agent_id: 'child-1',
      parent_agent_id: 'parent-1',
      process_alive: true,
    },
  ]
  const first = reconcileAgentRecords(
    [],
    observations,
    '2026-08-21T10:00:00.000Z',
  )
  const second = reconcileAgentRecords(
    first,
    observations,
    '2026-08-21T10:15:00.000Z',
  )

  assert.equal(second.length, 2)
  assert.equal(
    second.find((agent) => agent.agent_id === 'child-1')?.parent_agent_id,
    'parent-1',
  )
  assert.equal(new Set(second.map((agent) => agent.agent_id)).size, 2)
})

test('hypervisor discovers the current Cursor subagent transcript', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)

  const transcriptsRoot = path.join(root, 'cursor-transcripts')
  const parentId = 'parent-session'
  const sessionId = 'worker-session'
  const transcriptPath = path.join(
    transcriptsRoot,
    parentId,
    'subagents',
    `${sessionId}.jsonl`,
  )

  mkdirSync(path.dirname(transcriptPath), { recursive: true })
  writeFileSync(
    transcriptPath,
    `${JSON.stringify({
      role: 'user',
      message: {
        content: [
          {
            type: 'text',
            text: `Contract invocation: ${invocation.invocation_id}`,
          },
        ],
      },
    })}\n`,
  )

  const previousTranscriptsRoot = process.env.PANCREATOR_CURSOR_TRANSCRIPTS_DIR

  process.env.PANCREATOR_CURSOR_TRANSCRIPTS_DIR = transcriptsRoot

  try {
    const result = tickHypervisor(root)
    const agent = result.agents[0]

    assert.equal(agent?.health, 'running')
    assert.equal(agent?.parent_agent_id, parentId)
    assert.equal(agent?.session_id, sessionId)
    assert.equal(agent?.transcript_path, transcriptPath)
  } finally {
    if (previousTranscriptsRoot === undefined) {
      delete process.env.PANCREATOR_CURSOR_TRANSCRIPTS_DIR
    } else {
      process.env.PANCREATOR_CURSOR_TRANSCRIPTS_DIR = previousTranscriptsRoot
    }
  }
})

test('hypervisor observes an external executor session from run state', () => {
  const { root, runId, invocation } = checkpoint('delivery@plan-prepared')

  assert.ok(invocation)

  const statePath = resolveRunLayout(root, runId).state.absolute
  const persisted = JSON.parse(readFileSync(statePath, 'utf8')) as RunState

  assert.ok(persisted.current_stage)
  persisted.external_executor_sessions = {
    [persisted.current_stage]: {
      executor: 'claude-code',
      session_id: 'external-session-1',
      invocation_id: invocation.invocation_id,
      stage: persisted.current_stage,
      recorded_at: '2026-08-21T10:00:00.000Z',
    },
  }
  writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`)

  const result = tickHypervisor(root)
  const agent = result.agents.find(
    (candidate) => candidate.invocation_id === invocation.invocation_id,
  )

  assert.equal(agent?.executor, 'claude-code')
  assert.equal(agent?.session_id, 'external-session-1')
  assert.equal(agent?.transcript_path, null)
  assert.equal(agent?.health, 'unknown')
})

test('hypervisor never recovers an invocation that no longer needs a worker', () => {
  const root = createFixture()
  const result = tickHypervisor(root, {
    observations: [
      {
        ...stalledObservation,
        process_alive: false,
        terminal: true,
      },
    ],
    recoveryRunner: {
      nudge: () => {
        throw new Error('Recovery must not run.')
      },
    },
  })

  assert.equal(result.agents[0]?.health, 'completed')
  assert.deepEqual(result.recovery_events, [])
})

test('hypervisor quarantines the second matching recovery failure', () => {
  const root = createFixture()
  const result = tickHypervisor(root, {
    now: '2026-08-21T10:15:00.000Z',
    observations: [
      {
        ...stalledObservation,
        process_alive: false,
      },
    ],
    recoveryRunner: {
      nudge: () => ({
        ok: false,
        failure_signature: 'executor-unavailable',
        evidence: 'The executor is unavailable.',
      }),
      resume: () => ({
        ok: false,
        failure_signature: 'executor-unavailable',
        evidence: 'The executor is unavailable.',
      }),
    },
  })

  assert.equal(result.agents[0]?.health, 'dead')
  assert.equal(result.agents[0]?.recovery.quarantined, true)
  assert.equal(result.agents[0]?.recovery.step, 'quarantine')
  assert.deepEqual(
    result.recovery_events.map((event) => event.step),
    ['nudge', 'resume', 'quarantine'],
  )
  assert.match(
    readFileSync(hypervisorEventsPath(root), 'utf8'),
    /"type":"recovery"/u,
  )
  assert.equal(readAgentRegistry(root).agents.length, 1)
})

function stalledAgent(): AgentRecord {
  return {
    agent_id: 'run-1:invoke-1',
    parent_agent_id: null,
    run_id: 'run-1',
    invocation_id: 'invoke-1',
    persona: 'coder',
    executor: 'cursor',
    model: null,
    session_id: null,
    transcript_path: null,
    process_id: null,
    process_alive: null,
    discovered_at: '2026-08-21T10:00:00.000Z',
    last_observed_at: '2026-08-21T10:30:00.000Z',
    last_transcript_at: '2026-08-21T10:00:00.000Z',
    consecutive_unchanged_scans: 2,
    health: 'stalled',
    health_evidence: ['Two consecutive scans found no transcript change.'],
    recovery: { attempts: 0, consecutive_failures: 0, quarantined: false },
  }
}

const unsupportedStep = (evidence: string) => () => ({
  ok: false,
  supported: false,
  evidence,
})

test('recovery falls back to redelivery when nudge and resume are unsupported', () => {
  const result = recoverAgent(
    stalledAgent(),
    {
      nudge: unsupportedStep('No live session accepts a nudge.'),
      resume: unsupportedStep('No resumable session is registered.'),
      redeliver: () => ({
        ok: true,
        evidence: 'The canonical invocation was redelivered.',
      }),
    },
    '2026-08-21T10:45:00.000Z',
  )

  assert.deepEqual(
    result.events.map((event) => event.step),
    ['nudge', 'resume', 'redeliver'],
  )
  assert.equal(result.agent.health, 'running')
  assert.equal(result.agent.recovery.step, 'redeliver')
  assert.equal(result.agent.recovery.attempts, 1)
})

test('re-prepare is refused while the canonical invocation stays valid', () => {
  const result = recoverAgent(
    stalledAgent(),
    {
      nudge: unsupportedStep('No live session accepts a nudge.'),
      resume: unsupportedStep('No resumable session is registered.'),
      redeliver: unsupportedStep('Redelivery is unsupported for this agent.'),
      reprepare: () => ({
        ok: false,
        supported: false,
        failure_signature: 'canonical-invocation-still-valid',
        evidence:
          'The canonical invocation still validates against the workspace.',
      }),
    },
    '2026-08-21T10:45:00.000Z',
  )

  assert.deepEqual(
    result.events.map((event) => event.step),
    ['nudge', 'resume', 'redeliver', 'reprepare'],
  )
  assert.equal(result.agent.health, 'stalled')
  assert.equal(result.agent.recovery.attempts, 0)
  assert.equal(result.agent.recovery.quarantined, false)
})

test('prepared invocation registration is idempotent and completable', () => {
  const root = createFixture()
  const input = {
    run_id: 'run-1',
    invocation_id: 'invoke-1',
    persona: 'coder',
    executor: 'cursor' as const,
    model: 'composer-2.5',
  }

  registerPreparedInvocation(root, input, '2026-08-21T10:00:00.000Z')
  registerPreparedInvocation(root, input, '2026-08-21T10:01:00.000Z')
  const completed = completeInvocationAgent(
    root,
    'run-1',
    'invoke-1',
    '2026-08-21T10:02:00.000Z',
  )

  assert.equal(readAgentRegistry(root).agents.length, 1)
  assert.equal(completed?.health, 'completed')
})

test('redelivery refuses an invocation after workspace drift', () => {
  const { root } = checkpoint('delivery@plan-prepared')
  const agent = readAgentRegistry(root).agents[0]

  assert.ok(agent)
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = false\n',
  )

  const result = createAgentRecoveryRunner(root).redeliver?.(agent)

  assert.equal(result?.ok, false)
  assert.equal(result?.supported, false)
  assert.equal(result?.failure_signature, 'invocation-workspace-stale')
})

test('hypervisor loop runs ticks sequentially at fixed cadence', async () => {
  let active = 0
  let maximumActive = 0
  const sleeps: number[] = []

  await runHypervisorLoop(
    async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await Promise.resolve()
      active -= 1
    },
    {
      maxTicks: 3,
      clock: {
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds)
        },
      },
    },
  )

  assert.equal(maximumActive, 1)
  assert.deepEqual(sleeps, [HYPERVISOR_INTERVAL_MS, HYPERVISOR_INTERVAL_MS])
})
