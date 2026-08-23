import assert from 'node:assert/strict'
import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { recoverAgent, tickHypervisor } from '../../src/lib/hypervisor.js'
import type { AgentRecord } from '../../src/lib/types.js'
import { createFixture } from '../helpers.js'

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

test('unknown liveness never starts recovery', () => {
  const root = createFixture()
  let recoveryCalls = 0
  const result = tickHypervisor(root, {
    observations: [
      {
        agent_id: 'agent-1',
        run_id: 'run-1',
        invocation_id: 'invoke-1',
        persona: 'coder',
        executor: 'cursor',
        process_alive: null,
        last_transcript_at: null,
      },
    ],
    recoveryRunner: {
      nudge: () => {
        recoveryCalls += 1
        return { ok: true, evidence: 'The agent resumed.' }
      },
    },
  })

  assert.equal(result.agents[0]?.health, 'unknown')
  assert.equal(recoveryCalls, 0)
  assert.deepEqual(result.recovery_events, [])
})

test('provider drop resumes the recorded Cursor session once', () => {
  const root = createFixture()
  const binary = path.join(root, 'fake-cursor-agent')
  const previousBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN

  writeFileSync(
    binary,
    '#!/bin/sh\nprintf \'%s\\n\' \'{"session_id":"resumed-session"}\'\n',
  )
  chmodSync(binary, 0o755)
  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary

  try {
    const result = tickHypervisor(root, {
      observations: [
        {
          agent_id: 'agent-1',
          run_id: 'run-1',
          invocation_id: 'invoke-1',
          persona: 'coder',
          executor: 'cursor',
          process_alive: false,
          session_id: 'lost-session',
        },
      ],
    })

    assert.equal(result.agents[0]?.health, 'running')
    assert.equal(result.agents[0]?.session_id, 'resumed-session')
    assert.deepEqual(
      result.recovery_events.map((event) => event.step),
      ['nudge', 'resume'],
    )
  } finally {
    if (previousBinary === undefined) {
      delete process.env.PANCREATOR_CURSOR_AGENT_BIN
    } else {
      process.env.PANCREATOR_CURSOR_AGENT_BIN = previousBinary
    }
  }
})

test('recovery reaches re-prepare only after earlier steps are unavailable', () => {
  const unavailable = () => ({
    ok: false,
    supported: false,
    evidence: 'This recovery step is unavailable.',
  })
  const result = recoverAgent(
    stalledAgent(),
    {
      nudge: unavailable,
      resume: unavailable,
      redeliver: unavailable,
      reprepare: () => ({
        ok: true,
        evidence: 'The stale invocation was re-prepared.',
      }),
    },
    '2026-08-21T10:45:00.000Z',
  )

  assert.deepEqual(
    result.events.map((event) => event.step),
    ['nudge', 'resume', 'redeliver', 'reprepare'],
  )
  assert.equal(result.agent.health, 'running')
  assert.equal(result.agent.recovery.step, 'reprepare')
})

test('second matching recovery failure quarantines the agent', () => {
  let calls = 0
  const runner = {
    nudge: () => {
      calls += 1
      return {
        ok: false,
        failure_signature: 'provider-drop',
        evidence: 'The provider session is unavailable.',
      }
    },
  }
  const first = recoverAgent(stalledAgent(), runner, '2026-08-21T10:45:00.000Z')

  assert.equal(first.agent.recovery.quarantined, false)

  const second = recoverAgent(first.agent, runner, '2026-08-21T11:00:00.000Z')

  assert.equal(calls, 2)
  assert.equal(second.agent.recovery.quarantined, true)
  assert.equal(second.agent.recovery.step, 'quarantine')
  assert.deepEqual(
    second.events.map((event) => event.step),
    ['nudge', 'quarantine'],
  )
})
