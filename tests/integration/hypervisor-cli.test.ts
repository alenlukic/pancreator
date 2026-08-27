import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
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

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

function run(root: string, ...args: string[]): Record<string, unknown> {
  return JSON.parse(
    execFileSync(process.execPath, [CLI, ...args, '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  ) as Record<string, unknown>
}

test('hypervisor CLI ticks and reports registry state', () => {
  const root = createFixture()
  const tick = run(root, 'hypervisor', 'tick') as {
    tick: { agents: unknown[]; recovery_events: unknown[] }
    away_decisions: unknown[]
  }
  const status = run(root, 'hypervisor', 'status')

  assert.deepEqual(tick.tick.agents, [])
  assert.deepEqual(tick.tick.recovery_events, [])
  assert.deepEqual(tick.away_decisions, [])
  assert.equal(status.running, false)
})

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

test('hypervisor quarantine pauses the run and records a decision', () => {
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
    run(root, 'hypervisor', 'tick')

    const next = getRunState(root, state.run_id)
    const ledger = readAwayDecisionLedger(root)

    assert.equal(next.status, 'paused')
    assert.equal(next.pending_action.type, 'operator_decision')
    assert.match(next.pause_reason ?? '', /was quarantined/u)
    assert.equal(ledger.length, 1)
    assert.equal(ledger[0]?.blocker.type, 'hypervisor_incident')
    assert.equal(ledger[0]?.result, 'rejected')
  } finally {
    if (previousBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previousBinary
    }
  }
})

test('hypervisor tick leaves ordinary away decisions to the supervisor', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >
  const binary = path.join(root, 'fake-cursor-agent')
  const response = {
    ranked_options: [
      {
        rank: 1,
        action: 'resume',
        feasible: true,
        rationale: 'Resume the paused run.',
        evidence: ['runtime/logs/workflows/run/agent/state.json'],
        rollback_plan: {
          steps: ['Pause the run again.'],
          verification: 'Confirm that the run is paused.',
        },
      },
    ],
  }

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
  writeFileSync(
    binary,
    `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({
      session_id: 'evaluator-session',
      result: JSON.stringify(response),
    })}'\n`,
  )
  chmodSync(binary, 0o755)

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  pauseRun(root, state.run_id, 'Operator unavailable.')

  const previousBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN
  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary

  try {
    const result = run(root, 'hypervisor', 'tick') as {
      away_decisions: unknown[]
    }
    const next = getRunState(root, state.run_id)

    assert.deepEqual(result.away_decisions, [])
    assert.equal(next.status, 'paused')
    assert.equal(next.pending_action.type, 'operator_decision')
    assert.deepEqual(readAwayDecisionLedger(root), [])
  } finally {
    if (previousBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previousBinary
    }
  }
})

test('away evaluate and apply resume a paused run exactly once', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >
  const binary = path.join(root, 'fake-cursor-agent')
  const response = {
    ranked_options: [
      {
        rank: 1,
        action: 'resume',
        feasible: true,
        rationale: 'Resume the paused run.',
        evidence: ['runtime/logs/workflows/run/agent/state.json'],
        rollback_plan: {
          steps: ['Pause the run again.'],
          verification: 'Confirm that the run is paused.',
        },
      },
    ],
  }

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
  writeFileSync(
    binary,
    `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({
      session_id: 'evaluator-session',
      result: JSON.stringify(response),
    })}'\n`,
  )
  chmodSync(binary, 0o755)

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  pauseRun(root, state.run_id, 'Operator unavailable.')

  const previousBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN

  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary

  try {
    const evaluated = run(root, 'away', 'evaluate', state.run_id) as {
      decision_id: string
      decision_kind: string
      result: string
      selected_action: { action: string } | null
    }

    assert.equal(evaluated.result, 'accepted')
    assert.equal(evaluated.decision_kind, 'evaluated')
    assert.equal(evaluated.selected_action?.action, 'resume')

    // Status exposes the exact id apply accepts, so a supervisor that lost
    // the evaluate stdout never falls back to a mirrored run-local packet id.
    const status = run(root, 'away', 'status', state.run_id) as {
      apply_ready_decision_ids: string[]
    }

    assert.deepEqual(status.apply_ready_decision_ids, [evaluated.decision_id])

    // A wrong id names the canonical namespace and the apply-ready ids
    // instead of a bare not-found.
    assert.throws(
      () =>
        run(root, 'away', 'apply', state.run_id, '--decision', randomUUID()),
      (error: unknown) => {
        const stderr = String((error as { stderr?: unknown }).stderr ?? '')

        return (
          /AWAY_DECISION_NOT_FOUND/u.test(stderr) &&
          /away decision ledger/u.test(stderr) &&
          stderr.includes(evaluated.decision_id)
        )
      },
    )

    const applied = run(
      root,
      'away',
      'apply',
      state.run_id,
      '--decision',
      evaluated.decision_id,
    ) as {
      state: { status: string; pending_action: { type: string } }
      decision: { result: string; linked_decision_id: string }
    }

    assert.equal(applied.state.status, 'running')
    assert.equal(applied.state.pending_action.type, 'prepare_invocation')
    assert.equal(applied.decision.result, 'applied')
    assert.equal(applied.decision.linked_decision_id, evaluated.decision_id)

    assert.throws(
      () =>
        run(
          root,
          'away',
          'apply',
          state.run_id,
          '--decision',
          evaluated.decision_id,
        ),
      (error: unknown) =>
        error instanceof Error &&
        /AWAY_DECISION_ALREADY_APPLIED/u.test(
          String((error as { stderr?: unknown }).stderr ?? ''),
        ),
    )
    assert.deepEqual(
      readAwayDecisionLedger(root).map((record) => record.result),
      ['accepted', 'applied'],
    )
  } finally {
    if (previousBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previousBinary
    }
  }
})

test('hypervisor tick preserves disabled-mode operator stops', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  pauseRun(root, state.run_id, 'Operator approval is required.')

  const result = run(root, 'hypervisor', 'tick') as {
    away_decisions: unknown[]
  }
  const next = getRunState(root, state.run_id)

  assert.deepEqual(result.away_decisions, [])
  assert.equal(next.status, 'paused')
  assert.equal(next.pending_action.type, 'operator_decision')
})

test('hypervisor tick does not run the away evaluator', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >
  const binary = path.join(root, 'failing-cursor-agent')

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
  writeFileSync(binary, '#!/bin/sh\nexit 3\n')
  chmodSync(binary, 0o755)

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  pauseRun(root, state.run_id, 'Operator unavailable.')

  const previousBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN

  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary

  try {
    const result = run(root, 'hypervisor', 'tick') as {
      away_decisions: unknown[]
    }
    const ledger = readAwayDecisionLedger(root)

    assert.deepEqual(result.away_decisions, [])
    assert.deepEqual(ledger, [])
  } finally {
    if (previousBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previousBinary
    }
  }
})
