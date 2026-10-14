import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { delegationExecutionPath } from '../../src/lib/validation/artifacts.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { Invocation } from '../../src/lib/types.js'
import {
  liveCopilotTranscript,
  WatchDisplay,
  WatchTranscriptCursor,
} from '../../src/lib/watch/display.js'
import { createTestTempDirectory } from '../temp.js'
import {
  DEFAULT_STALL_TIMEOUT_SECONDS,
  WATCH_EXIT_CODES,
  OUTPUT_SCAFFOLD_ORDER_ADVISORY,
  readWatchRecord,
  summarizeDelegationObservation,
  summarizeDelegationWatch,
  watchInvocation,
  watchInvocations,
  watchRecordPath,
} from '../../src/lib/watch.js'
import {
  CADENCE_SECONDS,
  fakeClock,
  multiplexedTargets,
  preparedRun,
  writeStageOutput,
  writeTargetOutput,
} from './watch-helpers.js'

test('watch display observes only appended Copilot chat and tools without changing the ledger', async (t) => {
  const { root, state, invocationId } = preparedRun()
  const sessions = createTestTempDirectory('watch-copilot-')
  const previous = process.env.PANCREATOR_COPILOT_SESSIONS_DIR
  process.env.PANCREATOR_COPILOT_SESSIONS_DIR = sessions
  t.after(() => {
    if (previous === undefined)
      delete process.env.PANCREATOR_COPILOT_SESSIONS_DIR
    else process.env.PANCREATOR_COPILOT_SESSIONS_DIR = previous
  })
  const session = path.join(sessions, 'worker')
  mkdirSync(session)
  const transcript = path.join(session, 'events.jsonl')
  writeFileSync(transcript, '')
  writeFileSync(
    path.join(root, delegationExecutionPath(state.run_id, invocationId, root)),
    JSON.stringify({
      schema_version: 1,
      executor: 'copilot',
      session_id: 'worker',
    }),
  )
  const display = new WatchDisplay(root)
  const clock = fakeClock()
  const lines: string[] = []
  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 10,
    timeoutSeconds: CADENCE_SECONDS * 3,
    now: clock.now,
    sleep: async (milliseconds) => {
      await clock.sleep(milliseconds)
      const wake = lines.length + 1
      if (wake <= 2) {
        appendFileSync(
          transcript,
          `${JSON.stringify({
            type: 'assistant.message',
            data: {
              content: `worker chat ${wake}`,
              toolRequests: [
                {
                  name: wake === 1 ? 'view' : 'bash',
                  arguments: { command: 'private input' },
                },
              ],
            },
          })}\n`,
        )
      }
    },
    onSessionStart: (entry) => {
      const header = display.start(entry)
      assert.ok(header.includes(state.run_id))
      assert.ok(header.includes(invocationId))
    },
    onWake: (entry) => {
      const before = JSON.stringify(entry)
      lines.push(display.wake(entry))
      assert.equal(JSON.stringify(entry), before)
    },
  })
  assert.equal(result.state, 'timed_out')
  assert.equal(WATCH_EXIT_CODES[result.state], 3)
  assert.match(lines[0] ?? '', /chat: worker chat 1\n  tools: Read/u)
  assert.match(lines[1] ?? '', /chat: worker chat 2\n  tools: Shell/u)
  assert.doesNotMatch(lines[1] ?? '', /chat 1|tools: Read/u)
  assert.doesNotMatch(lines[2] ?? '', /chat:|tools:|private input/u)
  const entries = readWatchRecord(root, state.run_id, invocationId)
  assert.equal(
    entries.filter((entry) => entry.event === 'armed').length,
    result.armings,
  )
  assert.equal(
    entries.filter((entry) => entry.event === 'wake').length,
    result.wakes,
  )
  assert.equal(entries.at(-1)?.terminal_state, 'timed_out')
  assert.ok(entries.every((entry) => entry.cadence_seconds === CADENCE_SECONDS))
})

test('live Copilot discovery requires a unique prompt matching the run and output path', (t) => {
  const { root, state, invocationId, outputPath } = preparedRun()
  const invocationFile = resolveRunLayout(root, state.run_id).invocation(
    invocationId,
    '.json',
  ).absolute
  const invocation = JSON.parse(
    readFileSync(invocationFile, 'utf8'),
  ) as Invocation
  invocation.stage.persona_executor = 'copilot'
  writeFileSync(invocationFile, JSON.stringify(invocation))
  const sessions = createTestTempDirectory('watch-live-copilot-')
  const previous = process.env.PANCREATOR_COPILOT_SESSIONS_DIR
  process.env.PANCREATOR_COPILOT_SESSIONS_DIR = sessions
  t.after(() => {
    if (previous === undefined)
      delete process.env.PANCREATOR_COPILOT_SESSIONS_DIR
    else process.env.PANCREATOR_COPILOT_SESSIONS_DIR = previous
  })
  const sessionFile = (name: string, prompt: string) => {
    const directory = path.join(sessions, name)
    mkdirSync(directory)
    const file = path.join(directory, 'events.jsonl')
    writeFileSync(
      file,
      `${JSON.stringify({ type: 'user.message', data: { content: prompt } })}\n`,
    )
    return file
  }
  const entry = {
    schema_version: 1 as const,
    event: 'wake' as const,
    run_id: state.run_id,
    invocation_id: invocationId,
    recorded_at: new Date().toISOString(),
    cadence_seconds: 60,
    wake: 1,
  }
  sessionFile('unrelated', 'another worker')
  sessionFile('wrong-run', outputPath.replace(state.run_id, 'other-run'))
  assert.equal(liveCopilotTranscript(root, entry), null)
  const matching = sessionFile(
    'matching',
    `${state.run_id}\nOutput: ${outputPath}`,
  )
  assert.equal(liveCopilotTranscript(root, entry), matching)
  appendFileSync(
    matching,
    `${JSON.stringify({ type: 'assistant.message', data: { content: 'live text', toolRequests: [{ name: 'view' }] } })}\n`,
  )
  const display = new WatchDisplay(root)
  assert.match(display.wake(entry), /chat: live text\n  tools: Read/u)
  assert.doesNotMatch(display.wake(entry), /chat:|tools:/u)
  sessionFile('ambiguous', `${state.run_id}\nOutput: ${outputPath}`)
  assert.equal(liveCopilotTranscript(root, entry), null)
})

test('watch transcript cursor handles partial records, missing files and truncation', () => {
  const directory = createTestTempDirectory('watch-transcript-')
  const file = path.join(directory, 'events.jsonl')
  const cursor = new WatchTranscriptCursor()
  assert.equal(cursor.read(file).notice, 'transcript unavailable')
  const record = JSON.stringify({
    role: 'assistant',
    message: { content: [{ type: 'text', text: 'first' }] },
  })
  writeFileSync(file, record.slice(0, 20))
  assert.deepEqual(cursor.read(file).steps, [])
  appendFileSync(file, `${record.slice(20)}\n`)
  assert.equal(cursor.read(file).steps[0]?.text, 'first')
  assert.deepEqual(cursor.read(file).steps, [])
  writeFileSync(
    file,
    `${JSON.stringify({ type: 'assistant.message', data: { content: 'new' } })}\n`,
  )
  assert.equal(cursor.read(file).steps[0]?.text, 'new')
})

test('watch transcript cursor preserves every record across large backlogs and growth', () => {
  const directory = createTestTempDirectory('watch-transcript-backlog-')
  const file = path.join(directory, 'events.jsonl')
  const record = (text: string) =>
    `${JSON.stringify({
      type: 'assistant.message',
      data: { content: text, toolRequests: [{ name: 'view' }] },
    })}\n`
  const history = record('historical text').repeat(30000)
  const cursor = new WatchTranscriptCursor()
  writeFileSync(file, `${history}${record('current activity')}`)
  const first = cursor.read(file)
  assert.equal(first.notice, '')
  assert.equal(first.steps.length, 30001)
  assert.equal(first.steps[0]?.text, 'historical text')
  assert.equal(first.steps.at(-1)?.text, 'current activity')
  assert.equal(first.steps.at(-1)?.tools[0]?.name, 'Read')
  assert.deepEqual(cursor.read(file).steps, [])
  appendFileSync(file, `${history}${record('new activity')}`)
  const second = cursor.read(file)
  assert.equal(second.notice, '')
  assert.equal(second.steps.length, 30001)
  assert.equal(second.steps[0]?.text, 'historical text')
  assert.equal(second.steps.at(-1)?.text, 'new activity')
  assert.deepEqual(cursor.read(file).steps, [])
  appendFileSync(file, record('following wake'))
  assert.equal(cursor.read(file).steps[0]?.text, 'following wake')
})

test('watch transcript cursor retains oversized partial records and primes incomplete history', () => {
  const directory = createTestTempDirectory('watch-transcript-oversized-')
  const file = path.join(directory, 'events.jsonl')
  const record = (text: string) =>
    `${JSON.stringify({
      type: 'assistant.message',
      data: { content: text, toolRequests: [{ name: 'bash' }] },
    })}\n`
  const historical = record('history')
  writeFileSync(file, historical.slice(0, -3))
  const cursor = new WatchTranscriptCursor()
  assert.deepEqual(cursor.read(file, true).steps, [])
  const text = `${'\u{1f642}'.repeat(600000)}-END`
  const fresh = record(text)
  appendFileSync(file, historical.slice(-3) + fresh.slice(0, -3))
  assert.deepEqual(cursor.read(file).steps, [])
  appendFileSync(file, fresh.slice(-3) + record('following'))
  const delta = cursor.read(file)
  assert.equal(delta.notice, '')
  assert.deepEqual(
    delta.steps.map((step) => step.text),
    [text, 'following'],
  )
  assert.deepEqual(
    delta.steps.map((step) => step.tools[0]?.name),
    ['Shell', 'Shell'],
  )
  assert.deepEqual(cursor.read(file).steps, [])
})

test('watch display primes historical activity at arming and displays only subsequent records', (t) => {
  const { root, state, invocationId } = preparedRun()
  const sessions = createTestTempDirectory('watch-prime-copilot-')
  const previous = process.env.PANCREATOR_COPILOT_SESSIONS_DIR
  process.env.PANCREATOR_COPILOT_SESSIONS_DIR = sessions
  t.after(() => {
    if (previous === undefined)
      delete process.env.PANCREATOR_COPILOT_SESSIONS_DIR
    else process.env.PANCREATOR_COPILOT_SESSIONS_DIR = previous
  })
  const session = path.join(sessions, 'worker')
  mkdirSync(session)
  const transcript = path.join(session, 'events.jsonl')
  const record = (text: string, name: string) =>
    `${JSON.stringify({
      type: 'assistant.message',
      data: { content: text, toolRequests: [{ name }] },
    })}\n`
  writeFileSync(transcript, record('history', 'view').repeat(30000))
  writeFileSync(
    path.join(root, delegationExecutionPath(state.run_id, invocationId, root)),
    JSON.stringify({
      schema_version: 1,
      executor: 'copilot',
      session_id: 'worker',
    }),
  )
  const entry = {
    schema_version: 1 as const,
    event: 'session_started' as const,
    run_id: state.run_id,
    invocation_id: invocationId,
    recorded_at: new Date().toISOString(),
    cadence_seconds: 60,
    wake: 0,
  }
  const display = new WatchDisplay(root)
  display.start(entry)
  appendFileSync(transcript, record('fresh first wake', 'bash'))
  const first = display.wake({ ...entry, event: 'wake', wake: 1 })
  assert.match(first, /chat: fresh first wake\n  tools: Shell/u)
  assert.doesNotMatch(first, /history|Read|skipped/u)
  appendFileSync(transcript, record('fresh second wake', 'glob'))
  const second = display.wake({ ...entry, event: 'wake', wake: 2 })
  assert.match(second, /chat: fresh second wake\n  tools: Glob/u)
  assert.doesNotMatch(second, /first wake|Shell|history/u)
  assert.doesNotMatch(
    display.wake({ ...entry, event: 'wake', wake: 3 }),
    /chat:|tools:/u,
  )
})

test('watch completes when the invocation output appears and records every arming and wake', async () => {
  const { root, state, invocationId } = preparedRun()

  // The output lands right after the first wake observed nothing, so the
  // record shows one unchanged wake before the completing one. Writing from
  // the wake hook rather than a wall-clock timer keeps the order fixed when the
  // suite runs under load.
  let written = false
  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 10,
    timeoutSeconds: 5,
    onWake: () => {
      if (!written) {
        written = true
        writeStageOutput(root, state)
      }
    },
  })

  assert.equal(result.state, 'completed')
  assert.equal(result.invocation_id, invocationId)
  assert.ok(result.wakes >= 2)
  assert.equal(result.armings, result.wakes)
  assert.equal(
    result.record_path,
    watchRecordPath(root, state.run_id, invocationId),
  )

  const entries = readWatchRecord(root, state.run_id, invocationId)
  const armed = entries.filter((entry) => entry.event === 'armed')
  const wakes = entries.filter((entry) => entry.event === 'wake')

  assert.equal(armed.length, result.armings)
  assert.equal(wakes.length, result.wakes)
  assert.ok(armed.every((entry) => entry.wake_due_at && entry.recorded_at))
  assert.ok(wakes.every((entry) => entry.observation?.watched_paths.length))
  assert.equal(wakes.at(-1)?.terminal_state, 'completed')
  assert.equal(wakes.at(-1)?.observation?.output_matches_invocation, true)

  const summary = summarizeDelegationWatch(root, state.run_id, invocationId)

  assert.equal(summary.terminal_state, 'completed')
  assert.equal(summary.cadence_seconds, CADENCE_SECONDS)
  assert.equal(
    summarizeDelegationObservation(root, state.run_id, invocationId).source,
    'watch_completed',
  )
})

test('multiplexed watch returns the first changed invocation and keeps ordinary ledgers', async () => {
  const { root, targets } = multiplexedTargets(3)
  const clock = fakeClock()
  let wrote = false
  const result = await watchInvocations(
    root,
    targets.map(({ runId, invocationId }) => ({ runId, invocationId })),
    {
      cadenceSeconds: CADENCE_SECONDS,
      stallWakes: 10,
      timeoutSeconds: 1,
      now: clock.now,
      sleep: async (milliseconds) => {
        await clock.sleep(milliseconds)

        if (!wrote) {
          wrote = true
          const moved = targets[1]

          assert.ok(moved)
          writeFileSync(
            moved.layout.output(moved.invocationId).absolute,
            `${JSON.stringify({
              invocation_id: moved.invocationId,
              result: 'success',
              summary: 'done',
              criteria: [],
              data: {},
            })}\n`,
            'utf8',
          )
        }
      },
    },
  )

  assert.equal(result.state, 'changed')
  assert.equal(result.targets, 3)
  assert.deepEqual(
    result.moved.map((item) => item.invocation_id),
    ['multi-two'],
  )
  // A change is not a completion. This document is not one the supervisor
  // could submit, so the wait names the target that moved and claims nothing
  // about its terminal state.
  assert.deepEqual(
    result.moved.map((item) => item.terminal_state),
    [null],
  )
  assert.deepEqual(result.stalled, [])

  for (const { runId, invocationId } of targets) {
    const entries = readWatchRecord(root, runId, invocationId)

    // The session opens before its first arming, and the wait's return
    // closes every target that reached no verdict with a sibling handoff.
    assert.deepEqual(
      entries.map((entry) => [entry.schema_version, entry.event, entry.wake]),
      [
        [1, 'session_started', 0],
        [1, 'armed', 1],
        [1, 'wake', 1],
        [1, 'session_ended', 1],
      ],
    )
    assert.equal(entries.at(-1)?.session_end_reason, 'sibling_handoff')
    assert.ok(
      entries.every(
        (entry) => entry.watch_session_id === entries[0]?.watch_session_id,
      ),
      'one session owns the whole wait',
    )
    assert.equal(entries[1]?.run_id, runId)
    assert.equal(entries[1]?.invocation_id, invocationId)
  }
})

// The focused watch holds a finished-looking output whose evidence is weak
// for one confirming wake, because a worker that wrote a complete-looking
// output can keep editing. A group wait that skipped that hold would hand the
// supervisor a run whose submission is refused.
test('multiplexed watch holds weak completion evidence for one confirming wake', async () => {
  const { root, targets } = multiplexedTargets(2)
  const held = targets[1]

  assert.ok(held)

  const clock = fakeClock()
  let wrote = false
  const result = await watchInvocations(
    root,
    targets.map(({ runId, invocationId }) => ({ runId, invocationId })),
    {
      cadenceSeconds: CADENCE_SECONDS,
      stallWakes: 10,
      timeoutSeconds: 60,
      now: clock.now,
      sleep: async (milliseconds) => {
        await clock.sleep(milliseconds)

        if (!wrote) {
          wrote = true
          writeTargetOutput(root, held)
        }
      },
    },
  )

  assert.equal(result.state, 'changed')
  assert.equal(result.wakes, 2)
  assert.deepEqual(
    result.moved.map((item) => [item.invocation_id, item.terminal_state]),
    [[held.invocationId, 'completed']],
  )

  const wakes = readWatchRecord(root, held.runId, held.invocationId).filter(
    (entry) => entry.event === 'wake',
  )

  assert.equal(wakes[0]?.completion_hold, 'output_younger_than_cadence')
  assert.equal(wakes[0]?.terminal_state, undefined)
  assert.equal(wakes[1]?.terminal_basis, 'confirming_wake')
  assert.equal(wakes[1]?.terminal_state, 'completed')
})

// DELEGATE-001 makes the supervisor act on a stall, and the multiplexed wait
// is what the cohort guidance now arms. Without this signal a cohort of
// stalled siblings would hold the session until the four-hour timeout.
test('multiplexed watch reports the targets that stalled', async () => {
  const { root, targets } = multiplexedTargets(2)
  const clock = fakeClock()
  const result = await watchInvocations(
    root,
    targets.map(({ runId, invocationId }) => ({ runId, invocationId })),
    {
      cadenceSeconds: CADENCE_SECONDS,
      stallWakes: 2,
      timeoutSeconds: 60,
      now: clock.now,
      sleep: clock.sleep,
    },
  )

  assert.equal(result.state, 'stalled')
  assert.equal(result.wakes, 2)
  assert.deepEqual(result.moved, [])
  assert.deepEqual(
    result.stalled.map((item) => [item.invocation_id, item.terminal_state]),
    [
      ['multi-one', 'stalled'],
      ['multi-two', 'stalled'],
    ],
  )

  const first = targets[0]

  assert.ok(first)

  const wakes = readWatchRecord(root, first.runId, first.invocationId).filter(
    (entry) => entry.event === 'wake',
  )

  assert.deepEqual(
    wakes.map((entry) => entry.unchanged_wakes),
    [1, 2],
  )
  assert.equal(wakes.at(-1)?.terminal_state, 'stalled')
})

test('watch reports stalled after the configured unchanged wakes', async () => {
  const { root, state } = preparedRun()

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 2,
    timeoutSeconds: 5,
  })

  assert.equal(result.state, 'stalled')
  assert.equal(result.wakes, 2)

  const wakes = readWatchRecord(
    root,
    state.run_id,
    result.invocation_id,
  ).filter((entry) => entry.event === 'wake')

  assert.deepEqual(
    wakes.map((entry) => entry.unchanged_wakes),
    [1, 2],
  )
  assert.equal(wakes.at(-1)?.terminal_state, 'stalled')
})

test('stall duration remains constant when cadence changes', async () => {
  assert.equal(DEFAULT_STALL_TIMEOUT_SECONDS, 5 * 60)

  const first = preparedRun()
  const firstClock = fakeClock()
  const firstResult = await watchInvocation(first.root, first.state.run_id, {
    cadenceSeconds: 0.1,
    stallTimeoutSeconds: 0.3,
    timeoutSeconds: 1,
    ...firstClock,
  })

  const second = preparedRun()
  const secondClock = fakeClock()
  const secondResult = await watchInvocation(second.root, second.state.run_id, {
    cadenceSeconds: 0.15,
    stallTimeoutSeconds: 0.3,
    timeoutSeconds: 1,
    ...secondClock,
  })

  assert.equal(firstResult.state, 'stalled')
  assert.equal(secondResult.state, 'stalled')
  assert.equal(firstResult.wakes, 3)
  assert.equal(secondResult.wakes, 2)
  assert.equal(firstResult.elapsed_seconds, secondResult.elapsed_seconds)
  assert.equal(firstResult.stall_timeout_seconds, 0.3)
  assert.equal(secondResult.stall_timeout_seconds, 0.3)
})

test('a recorded running worker is never stalled by unchanged files', async () => {
  const { root, state } = preparedRun()
  const clock = fakeClock()

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: 0.1,
    stallTimeoutSeconds: 0.1,
    timeoutSeconds: 0.3,
    agentState: 'running',
    ...clock,
  })

  assert.equal(result.state, 'timed_out')
  assert.equal(result.wakes, 3)
})

test('a workspace edit before scaffolding records an advisory and not an unchanged wake', async () => {
  const { root, state, invocationId } = preparedRun()
  const clock = fakeClock()

  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(
    path.join(root, 'src', 'feature.ts'),
    'export const value = 1\n',
  )

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 1,
    timeoutSeconds: CADENCE_SECONDS * 3,
    ...clock,
  })
  const wakes = readWatchRecord(root, state.run_id, invocationId).filter(
    (entry) => entry.event === 'wake',
  )

  assert.equal(result.state, 'stalled')
  assert.deepEqual(wakes[0]?.advisories, [OUTPUT_SCAFFOLD_ORDER_ADVISORY])
  assert.equal(wakes[0]?.unchanged_wakes, 0)
  assert.equal(wakes[0]?.observation?.output_present, false)
  assert.equal(wakes[0]?.observation?.workspace_changed_from_invocation, true)
  assert.equal(wakes[1]?.unchanged_wakes, 1)
})

test('a worker that edits only the workspace or nested evidence is not called stalled', async () => {
  const { root, state } = preparedRun()
  const nestedEvidence = path.join(
    root,
    'runtime',
    'logs',
    'workflows',
    state.run_id,
    'agent',
    'evidence',
    'qa',
  )

  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(nestedEvidence, { recursive: true })

  // Neither write touches the output or an invocation-prefixed evidence file,
  // which is exactly what a coder mid-implementation or a QA tester writing to
  // its declared evidence directory looks like. The churn lands from the wake
  // hook against a fake clock, so the wake count does not depend on how long
  // an observation takes under suite load.
  const clock = fakeClock()
  let tick = 0
  const churn = (): void => {
    tick += 1

    if (tick % 2 === 0) {
      writeFileSync(path.join(root, 'src', 'feature.ts'), `// ${tick}\n`)
    } else {
      writeFileSync(path.join(nestedEvidence, 'report.md'), `tick ${tick}\n`)
    }
  }

  churn()

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 2,
    timeoutSeconds: CADENCE_SECONDS * 4,
    ...clock,
    onWake: churn,
  })

  assert.equal(
    result.state,
    'timed_out',
    'progress in the workspace is progress',
  )
  assert.equal(result.wakes, 4)

  const wakes = readWatchRecord(
    root,
    state.run_id,
    result.invocation_id,
  ).filter((entry) => entry.event === 'wake')

  assert.ok(
    wakes.every((entry) => entry.observation?.workspace_fingerprint),
    'each wake records the workspace fingerprint',
  )
  assert.ok(wakes.every((entry) => entry.observation?.run_tree_fingerprint))
})

test('watch reports timed_out at the timeout when the paths keep changing', async () => {
  const { root, state } = preparedRun()
  const evidenceDir = path.join(
    root,
    'runtime',
    'logs',
    'workflows',
    state.run_id,
    'agent',
    'evidence',
  )

  const clock = fakeClock()
  let tick = 0
  const churn = (): void => {
    tick += 1
    writeFileSync(
      path.join(evidenceDir, `${state.current_invocation!.id}-progress.log`),
      `tick ${tick}\n`.repeat(tick),
    )
  }

  churn()

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    cadenceAuthority: "operator's fixture",
    stallWakes: 2,
    timeoutSeconds: CADENCE_SECONDS * 3,
    ...clock,
    onWake: churn,
  })

  assert.equal(result.state, 'timed_out')
  assert.equal(result.wakes, 3)
  assert.equal(WATCH_EXIT_CODES.completed, 0)
  assert.equal(WATCH_EXIT_CODES.timed_out, 3)
  assert.match(
    result.rearm_command ?? '',
    new RegExp(
      `^\\./bin/pan watch ${state.run_id} --invocation ` +
        `${result.invocation_id} .*--timeout-seconds ${CADENCE_SECONDS * 3}$`,
      'u',
    ),
  )
  // The free-text authority travels as one shell word.
  assert.ok(
    (result.rearm_command ?? '').includes(
      `--cadence-directed-by-operator 'operator'"'"'s fixture' `,
    ),
  )
  // Whole milliseconds on the fake clock: 300 ms, not 0.1 * 3 in floating point.
  assert.ok(result.elapsed_seconds >= 0.3)
})
