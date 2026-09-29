import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  pauseRun,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { readAwayDecisionLedger } from '../../src/lib/away-mode.js'
import {
  agentRegistryPath,
  completeInvocationAgent,
  HYPERVISOR_INTERVAL_MS,
  hypervisorEventsPath,
  readAgentRegistry,
  reconcileAgentRecords,
  registerPreparedInvocation,
  registryHealthForRun,
  runHypervisorLoop,
  tickHypervisor,
} from '../../src/lib/hypervisor.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { RunState } from '../../src/lib/types.js'
import { validateHypervisorState } from '../../src/lib/validators/autonomy-state.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'
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

test('hypervisor tick leaves ordinary away decisions to the supervisor', () => {
  const created = checkpoint('delivery@created')

  pauseRun(created.root, created.runId, 'Operator unavailable.')
  tickHypervisor(created.root)

  const next = getRunState(created.root, created.runId)

  assert.equal(next.status, 'paused')
  assert.equal(next.pending_action.type, 'operator_decision')
  assert.deepEqual(readAwayDecisionLedger(created.root), [])
})

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
  const { root, runId, invocation } = checkpoint('planning@plan-prepared')

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

test('hypervisor never quarantines a completed invocation', () => {
  const root = createFixture()
  const result = tickHypervisor(root, {
    observations: [
      {
        ...stalledObservation,
        process_alive: false,
        terminal: true,
      },
    ],
  })

  assert.equal(result.agents[0]?.health, 'completed')
  assert.deepEqual(result.quarantine_events, [])
})

test('hypervisor quarantines a dead agent immediately', () => {
  const root = createFixture()
  const result = tickHypervisor(root, {
    now: '2026-08-21T10:15:00.000Z',
    observations: [
      {
        ...stalledObservation,
        process_alive: false,
      },
    ],
  })

  assert.equal(result.agents[0]?.health, 'dead')
  assert.equal(result.agents[0]?.recovery.quarantined, true)
  assert.equal(result.agents[0]?.recovery.step, 'quarantine')
  assert.equal(result.quarantine_events.length, 1)
  assert.equal(result.quarantine_events[0]?.health, 'dead')
  assert.match(
    readFileSync(hypervisorEventsPath(root), 'utf8'),
    /"type":"quarantine"/u,
  )
  assert.equal(readAgentRegistry(root).agents.length, 1)
})

test('the registry validator accepts a legacy recovery step and rejects an unknown one', () => {
  const root = createFixture()

  tickHypervisor(root, { observations: [stalledObservation] })

  const registry = readAgentRegistry(root)
  const withStep = (step: string): void => {
    writeFileSync(
      agentRegistryPath(root),
      `${JSON.stringify({
        ...registry,
        agents: registry.agents.map((agent) => ({
          ...agent,
          recovery: { ...agent.recovery, step },
        })),
      })}\n`,
    )
  }
  const input = { root } as Parameters<typeof validateHypervisorState>[0]

  withStep('nudge')
  assert.equal(validateHypervisorState(input).status, 'passed')

  withStep('rewind')
  assert.deepEqual(
    validateHypervisorState(input).issues.map((issue) => issue.code),
    ['hypervisor.agent.recovery'],
  )
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
