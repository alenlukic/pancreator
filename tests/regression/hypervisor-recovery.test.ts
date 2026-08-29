import assert from 'node:assert/strict'
import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { tickHypervisor } from '../../src/lib/hypervisor.js'
import { createFixture } from '../helpers.js'

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
