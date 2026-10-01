/**
 * A retry that resumes the previous attempt's subagent must not inherit that
 * attempt's stop.
 *
 * Run 63278_Oct-01-0306_agent-heartb resumed one coder for implement attempt
 * 2. The agent index still held attempt 1's ended transcript turn, so the
 * attempt 2 watch read it at wake 0 and ended before the worker had started.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getStopRecord,
  handleSubagentStart,
  handleSubagentStop,
} from '../../src/lib/agent-index.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { Invocation } from '../../src/lib/types.js'
import { watchInvocation, type WatchRecordEntry } from '../../src/lib/watch.js'
import { watchedAgentStopped } from '../../src/lib/watch/observe.js'
import {
  CADENCE_SECONDS,
  fakeClock,
  fillPreparedOutput,
  preparedRun,
} from '../integration/watch-helpers.js'

const AGENT = 'resumed-coder'

function stopAgent(root: string): number {
  handleSubagentStop(root, {
    event: 'subagentStop',
    subagent_id: AGENT,
    status: 'completed',
  })

  return Date.parse(getStopRecord(root, AGENT)?.recorded_at ?? '')
}

test('a watch ignores the stop a resumed agent carried from its previous attempt', async () => {
  const { root, state, invocationId } = preparedRun()

  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: AGENT,
    parent_conversation_id: 'supervisor-session',
    task_text: `Read runtime/logs/workflows/${state.run_id}/agent/invocations/${invocationId}.md first.`,
  })

  // The previous attempt stopped, then this attempt's invocation was created.
  const previousStopMs = stopAgent(root)
  const invocationPath = resolveRunLayout(root, state.run_id).invocation(
    invocationId,
    '.json',
  ).absolute
  const createdMs = previousStopMs + 1
  const invocation: Invocation = {
    ...(JSON.parse(readFileSync(invocationPath, 'utf8')) as Invocation),
    created_at: new Date(createdMs).toISOString(),
  }

  writeFileSync(invocationPath, `${JSON.stringify(invocation)}\n`)

  assert.equal(
    watchedAgentStopped(root, invocation),
    false,
    'the earlier stop does not wake a sleeping watch',
  )

  const clock = fakeClock()
  let sleeps = 0
  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    now: clock.now,
    sleep: async (milliseconds) => {
      await clock.sleep(milliseconds)
      sleeps += 1

      if (sleeps === 2) {
        while (Date.now() <= createdMs) {
          // The resumed worker's own stop lands after the invocation exists.
        }

        fillPreparedOutput(root, state)
        stopAgent(root)
      }
    },
  })
  const wakes = readFileSync(path.join(root, result.record_path), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as WatchRecordEntry)
    .filter((entry) => entry.event === 'wake')

  assert.equal(result.state, 'completed')
  assert.equal(result.wakes, 2, 'the watch waited for the resumed worker')
  assert.equal(
    wakes.some((entry) => entry.wake === 0),
    false,
    'no wake 0 verdict came from the earlier stop',
  )
  assert.equal(wakes.at(-1)?.terminal_basis, 'agent_state')
})
