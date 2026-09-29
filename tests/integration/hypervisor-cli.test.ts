import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
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
  readAgentRegistry,
} from '../../src/lib/hypervisor.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function run(root: string, ...args: string[]): Record<string, unknown> {
  return JSON.parse(
    execFileSync(process.execPath, [CLI, ...args, '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  ) as Record<string, unknown>
}

test('pan list reports registry-backed agent health fields', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  prepareInvocation(root, state.run_id)

  const listed = run(root, 'list') as unknown as Array<Record<string, unknown>>
  const entry = listed.find((item) => item.run_id === state.run_id)

  assert.ok(entry)
  assert.equal(entry.agent_health, 'unknown')
  assert.equal(typeof entry.health_evidence_at, 'string')
  assert.equal(entry.recovery_state, null)
})

test('hypervisor CLI start is singleton and stop is reversible', () => {
  const root = createFixture()

  const tick = run(root, 'hypervisor', 'tick') as {
    tick: { agents: unknown[]; quarantine_events: unknown[] }
  }
  const idle = run(root, 'hypervisor', 'status')

  assert.deepEqual(Object.keys(tick), ['tick'])
  assert.deepEqual(tick.tick.agents, [])
  assert.deepEqual(tick.tick.quarantine_events, [])
  assert.equal(idle.running, false)

  try {
    const first = run(root, 'hypervisor', 'start')
    const second = run(root, 'hypervisor', 'start')
    const status = run(root, 'hypervisor', 'status')

    assert.equal(first.started, true)
    assert.equal(second.started, false)
    assert.equal(second.pid, first.pid)
    assert.equal(status.running, true)
  } finally {
    run(root, 'hypervisor', 'stop')
  }
})

test('hypervisor quarantine pauses the run and records no away decision', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        ...config,
        away_mode: {
          enabled: true,
          guardrails: { allowed_actions: ['resume'] },
        },
      },
      null,
      2,
    )}\n`,
  )

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)

  const registry = readAgentRegistry(root)
  const agent = registry.agents[0]

  assert.ok(agent)
  writeFileSync(
    agentRegistryPath(root),
    `${JSON.stringify(
      {
        ...registry,
        agents: [
          {
            ...agent,
            process_id: 2_147_483_647,
            health: 'dead',
            recovery: {
              attempts: 2,
              consecutive_failures: 1,
              quarantined: false,
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  )

  const previousBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN

  process.env.PANCREATOR_CURSOR_AGENT_BIN = path.join(
    root,
    'missing-cursor-agent',
  )

  try {
    const tick = run(root, 'hypervisor', 'tick') as {
      tick: { quarantine_events: Array<{ agent_id: string }> }
    }

    const next = getRunState(root, state.run_id)

    assert.deepEqual(Object.keys(tick), ['tick'])
    assert.deepEqual(
      tick.tick.quarantine_events.map((event) => event.agent_id),
      [agent.agent_id],
    )
    assert.equal(next.status, 'paused')
    assert.equal(next.pending_action.type, 'operator_decision')
    assert.match(next.pause_reason ?? '', /was quarantined/u)
    assert.deepEqual(readAwayDecisionLedger(root), [])
  } finally {
    if (previousBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previousBinary
    }
  }
})

test('pan away decide resumes a paused run and records a supervisor decision', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        ...config,
        away_mode: {
          enabled: true,
          guardrails: { allowed_actions: ['resume'] },
        },
      },
      null,
      2,
    )}\n`,
  )

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  prepareInvocation(root, state.run_id)
  pauseRun(root, state.run_id, 'Operator unavailable.')

  const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

  const decided = JSON.parse(
    execFileSync(
      process.execPath,
      [
        CLI,
        'away',
        'decide',
        state.run_id,
        '--action',
        'resume',
        '--note',
        'Resuming the paused run.',
        '--json',
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  ) as {
    state: { status: string }
    decision: { result: string; action: string }
  }

  assert.equal(decided.state.status, 'running')
  assert.equal(decided.decision.result, 'applied')
  assert.equal(decided.decision.action, 'resume')

  const ledger = readAwayDecisionLedger(root)

  assert.equal(ledger.length, 1)
  assert.equal(ledger[0]?.action, 'resume')
  assert.equal(ledger[0]?.result, 'applied')
  assert.equal(ledger[0]?.author, 'supervisor')
})
