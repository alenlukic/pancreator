/**
 * Tests for the standalone `pan watch --agent` form (AC-006).
 *
 * The agent index is fed with synthetic hook payloads; see
 * tests/unit/agent-index.test.ts for why.
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  AGENTS_DIR,
  handlePreToolUse,
  handleSubagentStart,
  handleSubagentStop,
} from '../../src/lib/agent-index.js'
import {
  watchAgent,
  watchAttach,
  type WatchAgentSessionEntry,
  type WatchAgentWakeInfo,
} from '../../src/lib/watch.js'
import { createTestTempDirectory } from '../temp.js'

const AGENT = 'bg-agent-001'

function makeRoot(): string {
  const root = createTestTempDirectory('watch-agent-')
  mkdirSync(path.join(root, AGENTS_DIR), { recursive: true })
  return root
}

function fakeClock(onSleep?: (wake: number) => void): {
  now: () => number
  sleep: (ms: number) => Promise<void>
} {
  let current = Date.now()
  let sleeps = 0

  return {
    now: () => current,
    sleep: async (ms) => {
      current += ms
      sleeps += 1
      onSleep?.(sleeps)
    },
  }
}

function register(root: string): void {
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: AGENT,
    parent_conversation_id: 'operator-session',
  })
}

function stop(
  root: string,
  status: 'completed' | 'error' | 'aborted',
  withTranscript: boolean,
): void {
  const transcript = path.join(root, `${AGENT}.jsonl`)

  if (withTranscript) {
    writeFileSync(transcript, '{"role":"assistant"}\n')
  }

  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: AGENT,
    status,
    agent_transcript_path: transcript,
  })
}

function ledger(
  root: string,
  recordPath: string,
): Array<Record<string, unknown>> {
  return readFileSync(path.join(root, recordPath), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

test('AC-006: a completed stop with a transcript completes on the agent state', async () => {
  const root = makeRoot()
  register(root)
  const sessions: WatchAgentSessionEntry[] = []
  const result = await watchAgent(root, AGENT, {
    ...fakeClock((wake) => {
      if (wake === 2) {
        stop(root, 'completed', true)
      }
    }),
    onSessionStart: (entry) => sessions.push(entry),
  })

  assert.equal(result.state, 'completed')
  assert.equal(result.wakes, 2)

  const entries = ledger(root, result.record_path)
  const last = entries.at(-1)

  assert.equal(entries[0]?.event, 'session_started')
  assert.equal(entries[0]?.watcher_pid, process.pid)
  assert.equal(
    (entries[0]?.agent_entry as { status: string }).status,
    'running',
  )
  assert.equal(sessions[0]?.record_path, result.record_path)
  assert.equal(last?.terminal_state, 'completed')
  assert.equal(last?.terminal_basis, 'agent_state')
})

test('AC-006: an agent already stopped at arming ends the watch without a wake wait', async () => {
  const root = makeRoot()
  register(root)
  stop(root, 'completed', true)

  const result = await watchAgent(root, AGENT, fakeClock())

  assert.equal(result.state, 'completed')
  assert.equal(result.wakes, 0)
})

for (const status of ['error', 'aborted'] as const) {
  test(`AC-006: a stop with status ${status} fails`, async () => {
    const root = makeRoot()
    register(root)
    const result = await watchAgent(
      root,
      AGENT,
      fakeClock((wake) => {
        if (wake === 1) {
          stop(root, status, true)
        }
      }),
    )

    assert.equal(result.state, 'failed')
    assert.equal(
      ledger(root, result.record_path).at(-1)?.terminal_basis,
      undefined,
    )
  })
}

test('AC-006: a completed stop without a transcript completes and records the missing output', async () => {
  const root = makeRoot()
  register(root)
  const result = await watchAgent(
    root,
    AGENT,
    fakeClock((wake) => {
      if (wake === 1) {
        stop(root, 'completed', false)
      }
    }),
  )
  const last = ledger(root, result.record_path).at(-1) as
    | WatchAgentWakeInfo
    | undefined

  assert.equal(result.state, 'completed')
  assert.equal(last?.terminal_basis, 'agent_state')
  assert.equal(last?.agent_activity?.stop?.terminal_output_present, false)
})

test('AC-006: a stop whose index update a live lock dropped still ends the watch', async () => {
  const root = makeRoot()
  register(root)
  writeFileSync(path.join(root, AGENTS_DIR, 'index.lock'), String(process.pid))
  const result = await watchAgent(
    root,
    AGENT,
    fakeClock((wake) => {
      if (wake === 1) {
        stop(root, 'error', true)
      }
    }),
  )

  assert.equal(result.state, 'failed')
  assert.equal(result.wakes, 1)
})

test('AC-009: an agent the index never registers ends unregistered, never stalled', async () => {
  const root = makeRoot()
  const wakes: WatchAgentWakeInfo[] = []
  const sessions: WatchAgentSessionEntry[] = []
  const result = await watchAgent(root, 'never-seen', {
    ...fakeClock(),
    onWake: (info) => wakes.push(info),
    onSessionStart: (entry) => sessions.push(entry),
  })

  assert.equal(result.state, 'unregistered')
  assert.equal(result.wakes, 5, 'five 60-second wakes make the 5-minute window')
  assert.ok(wakes.every((wake) => wake.agent_activity === null))
  assert.equal(wakes.at(-1)?.terminal_state, 'unregistered')
  // The canonical hooks.json this temp root carries none of, so there is
  // nothing to compare against and the status reads null rather than a
  // false claim of drift.
  assert.equal(sessions[0]?.hooks_projection, null)
  assert.equal(wakes.at(-1)?.hooks_projection, null)
})

test('AC-006: an agent registered after arming is found on a later wake', async () => {
  const root = makeRoot()
  const wakes: WatchAgentWakeInfo[] = []
  const result = await watchAgent(root, AGENT, {
    ...fakeClock((wake) => {
      if (wake === 2) {
        register(root)
      }

      if (wake === 3) {
        stop(root, 'completed', true)
      }
    }),
    onWake: (info) => wakes.push(info),
  })

  assert.equal(result.state, 'completed')
  assert.equal(wakes[0]?.agent_activity, null)
  assert.equal(wakes[1]?.agent_activity?.agent_id, AGENT)
  assert.equal(wakes[1]?.changed, true)
})

test('AC-011: an agent registered after arming still stalls once its state stops changing', async () => {
  const root = makeRoot()
  const wakes: WatchAgentWakeInfo[] = []
  const result = await watchAgent(root, AGENT, {
    ...fakeClock((wake) => {
      if (wake === 2) {
        register(root)
      }
    }),
    onWake: (info) => wakes.push(info),
  })

  assert.equal(result.state, 'stalled')
  assert.equal(wakes[0]?.agent_activity, null)
  assert.equal(wakes[1]?.agent_activity?.agent_id, AGENT)
  assert.equal(wakes[1]?.changed, true)
  assert.equal(wakes.at(-1)?.terminal_state, 'stalled')
})

test('AC-006: an open non-shell call holds off the stall until the bound', async () => {
  const root = makeRoot()
  register(root)
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: AGENT,
    tool_name: 'Task',
    tool_use_id: 'tu-nested',
  })

  const result = await watchAgent(root, AGENT, {
    ...fakeClock(),
    timeoutSeconds: 600,
  })

  assert.equal(result.state, 'timed_out')
  assert.equal(result.wakes, 10)
})

test('AC-006: an open shell call without a live pan-run heartbeat still stalls', async () => {
  const root = makeRoot()
  register(root)
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: AGENT,
    tool_name: 'Shell',
    tool_use_id: 'tu-shell',
    tool_input: { command: 'sleep 9999' },
  })

  const result = await watchAgent(root, AGENT, {
    ...fakeClock(),
    timeoutSeconds: 600,
  })

  assert.equal(result.state, 'stalled')
})

test('AC-006: a signal closes the watch with one interrupted wake', async () => {
  const root = makeRoot()
  register(root)
  const signals: string[] = []
  const result = await watchAgent(root, AGENT, {
    ...fakeClock((wake) => {
      if (wake === 1) {
        process.emit('SIGINT')
      }
    }),
    onInterrupted: (signal) => signals.push(signal),
  })

  assert.equal(result.state, 'interrupted')
  assert.deepEqual(signals, ['SIGINT'])

  const last = ledger(root, result.record_path).at(-1)

  assert.equal(last?.terminal_state, 'interrupted')
  assert.equal(last?.interrupted_reason, 'SIGINT')
})

test('AC-006: pan watch --attach follows an agent ledger to its verdict exit code', async () => {
  const completedRoot = makeRoot()
  register(completedRoot)
  stop(completedRoot, 'completed', true)
  const completed = await watchAgent(completedRoot, AGENT, fakeClock())
  const followed = await watchAttach(completedRoot, {
    ledgers: [completed.record_path],
    ...fakeClock(),
  })

  assert.equal(followed.state, 'attach_completed')
  assert.equal(followed.exit_code, 0)

  const failedRoot = makeRoot()
  register(failedRoot)
  stop(failedRoot, 'error', true)
  const failed = await watchAgent(failedRoot, AGENT, fakeClock())
  const followedFailure = await watchAttach(failedRoot, {
    ledgers: [failed.record_path],
    ...fakeClock(),
  })

  assert.equal(followedFailure.exit_code, 1)

  const unregisteredRoot = makeRoot()
  const unregistered = await watchAgent(unregisteredRoot, 'never-seen', fakeClock())
  const followedUnregistered = await watchAttach(unregisteredRoot, {
    ledgers: [unregistered.record_path],
    ...fakeClock(),
  })

  assert.equal(followedUnregistered.exit_code, 6)
})
