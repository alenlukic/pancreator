import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { submitOutput } from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import {
  DELEGATION_TIMER_UNAWAITED,
  DELEGATION_UNOBSERVED,
  appendSessionGap,
  backgroundMarkerPath,
  formatGapLine,
  formatSessionStartLine,
  readWatchRecord,
  recordForegroundReturn,
  summarizeDelegationObservation,
  summarizeDelegationWatch,
  watchInvocation,
  watchInvocations,
  watchLockPath,
  watchRecordPath,
  type WatchRecordEntry,
} from '../../src/lib/watch.js'
import {
  CADENCE_SECONDS,
  fakeClock,
  fillPreparedOutput,
  multiplexedTargets,
  preparedRun,
  writeAgentStateEvidence,
  writeTargetOutputPastCadence,
} from './watch-helpers.js'
import { CLI, ledgerEntry, runCli, seedLedger } from './watch-repair-helpers.js'

/** Poll until the predicate holds or the deadline passes. */
async function waitFor(
  check: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (check()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  throw new Error('waitFor deadline passed')
}

/** Spawn a watching CLI child on a pending fixture and wait for its arming. */
async function spawnWatchingChild(
  root: string,
  runId: string,
  invocationId: string,
) {
  const child = spawn(
    process.execPath,
    [
      CLI,
      'watch',
      runId,
      '--invocation',
      invocationId,
      '--cadence-seconds',
      '0.2',
      '--cadence-directed-by-operator',
      'signal fixture',
      '--timeout-seconds',
      '30',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  await waitFor(() =>
    existsSync(path.join(root, watchRecordPath(root, runId, invocationId)))
      ? readFileSync(
          path.join(root, watchRecordPath(root, runId, invocationId)),
          'utf8',
        ).includes('"armed"')
      : false,
  )

  return child
}

test('AC-005: signal closure', async (t) => {
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    await t.test(signal, async () => {
      const { root, state, invocationId } = preparedRun()
      const child = await spawnWatchingChild(root, state.run_id, invocationId)

      child.kill(signal)

      const [code, caught] = (await once(child, 'exit')) as [
        number | null,
        string | null,
      ]

      assert.equal(code, null, 'the watch dies by the signal itself')
      assert.equal(caught, signal)

      const entries = readWatchRecord(root, state.run_id, invocationId)
      const terminal = entries.filter(
        (entry) => entry.terminal_state !== undefined,
      )

      assert.equal(terminal.length, 1, 'one terminal wake closes the session')
      assert.equal(terminal[0]?.terminal_state, 'interrupted')
      assert.equal(terminal[0]?.interrupted_reason, signal)
      assert.equal(
        terminal[0]?.terminal_basis,
        undefined,
        'an interruption never fabricates a completion basis',
      )
      assert.equal(
        terminal[0]?.observation,
        undefined,
        'an interruption fabricates no observation',
      )
      assert.ok(terminal[0]?.watch_session_id, 'the wake names its session')
      assert.equal(
        existsSync(
          path.join(root, watchLockPath(root, state.run_id, invocationId)),
        ),
        false,
        'the interrupted watch releases its ownership lock',
      )
    })
  }
})

test('AC-006: orphan restart', async (t) => {
  await t.test('legacy history without session identity', async () => {
    const { root, state, invocationId } = preparedRun()

    // A pre-session-identity ledger: an arming with no wake and no close.
    seedLedger(root, state.run_id, invocationId, [
      ledgerEntry(
        root === '' ? '' : state.run_id,
        invocationId,
        'armed',
        '2026-09-20T10:00:00.000Z',
        {
          wake: 1,
          wake_due_at: '2026-09-20T10:01:00.000Z',
        },
      ),
    ])
    fillPreparedOutput(root, state)

    const evidence = writeAgentStateEvidence(root, state, invocationId)

    await watchInvocation(root, state.run_id, {
      agentState: 'completed',
      agentStateEvidence: evidence,
    })

    const gaps = readWatchRecord(root, state.run_id, invocationId).filter(
      (entry) => entry.event === 'gap',
    )

    assert.equal(gaps.length, 1)
    assert.equal(gaps[0]?.gap?.reason, 'legacy_unclassified')
    assert.equal(gaps[0]?.gap?.from, '2026-09-20T10:00:00.000Z')
  })

  await t.test(
    'a killed watcher leaves one deduplicated orphan gap',
    async () => {
      const { root, state, invocationId } = preparedRun()
      const child = await spawnWatchingChild(root, state.run_id, invocationId)

      // SIGKILL runs no cleanup: the session stays open and the lock stale.
      child.kill('SIGKILL')
      await once(child, 'exit')

      fillPreparedOutput(root, state)

      const evidence = writeAgentStateEvidence(root, state, invocationId)

      await watchInvocation(root, state.run_id, {
        agentState: 'completed',
        agentStateEvidence: evidence,
      })

      const entries = readWatchRecord(root, state.run_id, invocationId)
      const gaps = entries.filter((entry) => entry.event === 'gap')

      assert.equal(gaps.length, 1)
      assert.equal(gaps[0]?.gap?.reason, 'orphan_session')
      assert.ok((gaps[0]?.gap?.seconds ?? 0) > 0)

      // The deduplication key keeps a repeated detection from repeating the gap.
      const duplicate = appendSessionGap(
        root,
        state.run_id,
        invocationId,
        gaps[0]?.gap as NonNullable<WatchRecordEntry['gap']>,
        60,
      )

      assert.equal(duplicate, null)
      assert.equal(
        readWatchRecord(root, state.run_id, invocationId).filter(
          (entry) => entry.event === 'gap',
        ).length,
        1,
      )

      // A further restart finds the last session closed and records nothing.
      await watchInvocation(root, state.run_id, {
        agentState: 'completed',
        agentStateEvidence: evidence,
      })
      assert.equal(
        readWatchRecord(root, state.run_id, invocationId).filter(
          (entry) => entry.event === 'gap',
        ).length,
        1,
      )
    },
  )

  await t.test(
    'restart after SIGTERM records one gap from the interrupted wake',
    async () => {
      const { root, state, invocationId } = preparedRun()

      // The shape a signal leaves: a clean session whose last real wake is
      // followed by the one interrupted wake the handler appends.
      seedLedger(root, state.run_id, invocationId, [
        ledgerEntry(
          state.run_id,
          invocationId,
          'session_started',
          '2026-09-22T10:00:00.000Z',
          { watch_session_id: 'signalled-session' },
        ),
        ledgerEntry(
          state.run_id,
          invocationId,
          'wake',
          '2026-09-22T10:01:00.000Z',
          { wake: 1, watch_session_id: 'signalled-session' },
        ),
        ledgerEntry(
          state.run_id,
          invocationId,
          'wake',
          '2026-09-22T10:01:30.000Z',
          {
            wake: 2,
            watch_session_id: 'signalled-session',
            terminal_state: 'interrupted',
            interrupted_reason: 'SIGTERM',
          },
        ),
      ])
      fillPreparedOutput(root, state)

      const evidence = writeAgentStateEvidence(root, state, invocationId)
      const result = await watchInvocation(root, state.run_id, {
        agentState: 'completed',
        agentStateEvidence: evidence,
      })

      assert.equal(result.gaps.length, 1)
      assert.equal(result.gaps[0]?.reason, 'interrupted')
      assert.equal(result.gaps[0]?.from, '2026-09-22T10:01:00.000Z')
      assert.equal(
        readWatchRecord(root, state.run_id, invocationId).filter(
          (entry) => entry.event === 'gap',
        ).length,
        1,
      )
    },
  )
})

test('AC-007: gap first line', async (t) => {
  const orphanFixture = (): ReturnType<typeof preparedRun> => {
    const fixture = preparedRun()

    seedLedger(fixture.root, fixture.state.run_id, fixture.invocationId, [
      ledgerEntry(
        fixture.state.run_id,
        fixture.invocationId,
        'session_started',
        '2026-09-22T10:00:00.000Z',
        {
          watch_session_id: 'dead-session',
        },
      ),
      ledgerEntry(
        fixture.state.run_id,
        fixture.invocationId,
        'armed',
        '2026-09-22T10:00:01.000Z',
        {
          wake: 1,
          wake_due_at: '2026-09-22T10:01:01.000Z',
          watch_session_id: 'dead-session',
        },
      ),
    ])
    fillPreparedOutput(fixture.root, fixture.state)

    return fixture
  }

  await t.test('the gap notice precedes the new arming', async () => {
    const { root, state, invocationId } = orphanFixture()
    const evidence = writeAgentStateEvidence(root, state, invocationId)
    const lines: string[] = []

    const result = await watchInvocation(root, state.run_id, {
      agentState: 'completed',
      agentStateEvidence: evidence,
      onGap: (entry) => lines.push(formatGapLine(entry)),
      onSessionStart: (entry) => lines.push(formatSessionStartLine(entry)),
    })

    assert.equal(result.gaps.length, 1)
    assert.equal(lines.length, 2)
    assert.match(lines[0] ?? '', /observation gap/u)
    assert.match(lines[0] ?? '', /orphan_session/u)
    assert.match(lines[0] ?? '', /beyond cadence/u)
    assert.match(lines[1] ?? '', /armed/u)
  })

  await t.test('JSON stdout stays parseable and carries the gap', () => {
    const { root, state, invocationId } = orphanFixture()
    const evidence = writeAgentStateEvidence(root, state, invocationId)
    const result = runCli(root, [
      'watch',
      state.run_id,
      '--invocation',
      invocationId,
      '--agent-state',
      'completed',
      '--agent-state-evidence',
      evidence,
      '--json',
    ])

    assert.equal(result.status, 0, result.stderr)

    const parsed = JSON.parse(result.stdout) as {
      gaps?: Array<{ reason: string; seconds: number }>
    }

    assert.equal(parsed.gaps?.length, 1)
    assert.equal(parsed.gaps?.[0]?.reason, 'orphan_session')
    assert.ok((parsed.gaps?.[0]?.seconds ?? 0) >= 0)
    assert.match(result.stderr.split('\n')[0] ?? '', /observation gap/u)
  })

  await t.test('an agent shell without a terminal sees the gap first', () => {
    const { root, state, invocationId } = orphanFixture()
    const evidence = writeAgentStateEvidence(root, state, invocationId)
    // spawnSync pipes stderr, which is how every agent shell runs the watch.
    const result = runCli(root, [
      'watch',
      state.run_id,
      '--invocation',
      invocationId,
      '--agent-state',
      'completed',
      '--agent-state-evidence',
      evidence,
    ])

    assert.equal(result.status, 0, result.stderr)

    const lines = result.stderr.split('\n').filter((line) => line.length > 0)

    assert.match(lines[0] ?? '', /observation gap/u)
    assert.match(lines[0] ?? '', /orphan_session/u)
    assert.match(lines[1] ?? '', /timeout 3600s \(default bound\)/u)
    assert.match(result.stdout, /1 observation gap recorded/u)
    assert.match(result.stdout, /\(timeout 3600s\)/u)
  })
})

test('AC-012: detached transport', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)

  const evidence = writeAgentStateEvidence(root, state, invocationId)

  // The CLI child runs with piped stdio — no attached terminal, which is
  // exactly how an awaited tool call arrives too.
  const result = runCli(root, [
    'watch',
    state.run_id,
    '--mark-background',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    evidence,
    '--json',
  ])

  assert.equal(result.status, 0, result.stderr)
  JSON.parse(result.stdout)

  const marker = JSON.parse(
    readFileSync(
      path.join(root, backgroundMarkerPath(root, state.run_id, invocationId)),
      'utf8',
    ),
  ) as {
    transport: { stdin_tty: boolean; stdout_tty: boolean; stderr_tty: boolean }
    await_status: string
    unawaited_timer_suspected: boolean
  }

  assert.deepEqual(marker.transport, {
    stdin_tty: false,
    stdout_tty: false,
    stderr_tty: false,
  })
  // Awaitedness is never fabricated from a flag: it stays unknown, and the
  // suspicion is what the record carries.
  assert.equal(marker.await_status, 'unknown')
  assert.equal(marker.unawaited_timer_suspected, true)

  const submitted = submitOutput(root, state.run_id, outputPath)
  const advisory = submitted.advisories.find((item) =>
    item.message.includes(DELEGATION_TIMER_UNAWAITED),
  )

  assert.ok(advisory, 'the suspicion reaches the run advisories')
  assert.equal(advisory.kind, 'delegation_supervision')
})

test('AC-020: sibling handoff', async (t) => {
  await t.test('the handoff and the exact gap are recorded', async () => {
    const { root, targets } = multiplexedTargets(2)
    const moved = targets[1]
    const sibling = targets[0]

    assert.ok(moved && sibling)

    let current = Date.now()
    let wakes = 0
    const result = await watchInvocations(
      root,
      targets.map(({ runId, invocationId }) => ({ runId, invocationId })),
      {
        cadenceSeconds: CADENCE_SECONDS,
        stallWakes: 10,
        timeoutSeconds: 60,
        now: () => current,
        sleep: async (milliseconds) => {
          current += milliseconds
          wakes += 1

          if (wakes === 2) {
            // The moved target completes past one cadence from its launch.
            writeTargetOutputPastCadence(root, moved)
          }
        },
      },
    )

    assert.equal(result.state, 'changed')
    assert.deepEqual(
      result.moved.map((item) => item.invocation_id),
      [moved.invocationId],
    )

    // The sibling's session closed with the recorded handoff.
    const siblingEntries = readWatchRecord(
      root,
      sibling.runId,
      sibling.invocationId,
    )
    const sessionEnd = siblingEntries.find(
      (entry) => entry.event === 'session_ended',
    )

    assert.equal(sessionEnd?.session_end_reason, 'sibling_handoff')

    // Restart the sibling 74 seconds later: the explicit gap lands.
    current += 74_000
    writeTargetOutputPastCadence(root, sibling)

    await watchInvocation(root, sibling.runId, {
      invocationId: sibling.invocationId,
      cadenceSeconds: CADENCE_SECONDS,
      now: () => current,
      sleep: async (milliseconds) => {
        current += milliseconds
      },
    })

    const gaps = readWatchRecord(
      root,
      sibling.runId,
      sibling.invocationId,
    ).filter((entry) => entry.event === 'gap')

    assert.equal(gaps.length, 1)
    assert.equal(gaps[0]?.gap?.reason, 'sibling_handoff')
    assert.ok(
      Math.abs((gaps[0]?.gap?.seconds ?? 0) - 74) < 0.5,
      `the gap is the exact 74-second interval, got ${gaps[0]?.gap?.seconds}`,
    )
    assert.ok(
      (gaps[0]?.gap?.overdue_seconds ?? 0) > 73,
      'the interval beyond the cadence is recorded',
    )
  })

  await t.test(
    'a simultaneous live duplicate is refused without stealing the watch',
    async () => {
      const { root, state, invocationId } = preparedRun()
      const clock = fakeClock()
      let gateOpen = false

      const firstPromise = watchInvocation(root, state.run_id, {
        cadenceSeconds: CADENCE_SECONDS,
        stallWakes: 5,
        timeoutSeconds: 60,
        now: clock.now,
        sleep: async (milliseconds) => {
          if (!gateOpen) {
            await new Promise<void>((resolve) => {
              const poll = (): void => {
                if (gateOpen) {
                  resolve()
                } else {
                  setTimeout(poll, 5)
                }
              }

              poll()
            })
          }

          await clock.sleep(milliseconds)
        },
      })

      // Let the first watch arm and claim the target.
      await waitFor(() =>
        existsSync(
          path.join(root, watchRecordPath(root, state.run_id, invocationId)),
        ),
      )
      await waitFor(() =>
        readWatchRecord(root, state.run_id, invocationId).some(
          (entry) => entry.event === 'armed',
        ),
      )

      const entriesBefore = readWatchRecord(
        root,
        state.run_id,
        invocationId,
      ).length

      await assert.rejects(
        watchInvocation(root, state.run_id, {
          cadenceSeconds: CADENCE_SECONDS,
          timeoutSeconds: 60,
        }),
        (error: unknown) =>
          error instanceof PanError && error.code === 'WATCH_TARGET_BUSY',
      )
      assert.equal(
        readWatchRecord(root, state.run_id, invocationId).length,
        entriesBefore,
        'the refused duplicate wrote nothing',
      )

      // The first watch still owns its session and finishes normally.
      fillPreparedOutput(root, state)

      gateOpen = true

      const first = await firstPromise

      assert.equal(first.state, 'completed')
      assert.ok(
        readWatchRecord(root, state.run_id, invocationId).some(
          (entry) =>
            entry.terminal_state === 'completed' &&
            entry.watch_session_id === first.watch_session_id,
        ),
        'the original watch records its own verdict',
      )
    },
  )
})

test('AC-025: terminal-only multiplex', async () => {
  const { root, targets } = multiplexedTargets(2)
  const completing = targets[1]

  assert.ok(completing)

  let current = Date.now()
  let wakes = 0
  const result = await watchInvocations(
    root,
    targets.map(({ runId, invocationId }) => ({ runId, invocationId })),
    {
      cadenceSeconds: CADENCE_SECONDS,
      stallWakes: 10,
      timeoutSeconds: 60,
      untilTerminal: true,
      now: () => current,
      sleep: async (milliseconds) => {
        current += milliseconds
        wakes += 1

        // Both targets move on every cadence: routine progress that a
        // movement-returning wait would hand back at once.
        for (const target of targets) {
          writeFileSync(
            target.layout.evidence(`${target.invocationId}-progress.log`)
              .absolute,
            `wake ${wakes}\n`,
            'utf8',
          )
        }

        if (wakes === 3) {
          writeTargetOutputPastCadence(root, completing)
        }
      },
    },
  )

  // One awaited watch survived three cadences of intermediate movement and
  // returned when the target reached its terminal state.
  assert.equal(result.state, 'changed')
  assert.equal(result.wakes, 3)
  assert.deepEqual(
    result.moved.map((item) => [item.invocation_id, item.terminal_state]),
    [[completing.invocationId, 'completed']],
  )

  for (const target of targets) {
    const entries = readWatchRecord(root, target.runId, target.invocationId)
    const sessions = entries.filter(
      (entry) => entry.event === 'session_started',
    )
    const recordedWakes = entries.filter((entry) => entry.event === 'wake')

    assert.equal(sessions.length, 1, 'one session survived the whole wait')
    assert.equal(recordedWakes.length, 3, 'every wake is recorded')
  }
})

test('AC-026: compatibility', async (t) => {
  await t.test('a legacy completed ledger still satisfies submission', () => {
    const { root, state, invocationId, outputPath } = preparedRun()

    fillPreparedOutput(root, state)
    // A pre-session-identity ledger: schema 1, no session fields, closed by a
    // completed wake.
    seedLedger(root, state.run_id, invocationId, [
      ledgerEntry(
        state.run_id,
        invocationId,
        'armed',
        '2026-09-20T10:00:00.000Z',
        {
          wake: 1,
          wake_due_at: '2026-09-20T10:01:00.000Z',
        },
      ),
      ledgerEntry(
        state.run_id,
        invocationId,
        'wake',
        '2026-09-20T10:01:00.000Z',
        {
          wake: 1,
          terminal_state: 'completed',
          terminal_basis: 'output_plausible',
        },
      ),
    ])

    const summary = summarizeDelegationWatch(root, state.run_id, invocationId)

    assert.equal(summary.terminal_state, 'completed')
    assert.equal(summary.terminal_basis, 'output_plausible')

    const submitted = submitOutput(root, state.run_id, outputPath)

    assert.equal(
      submitted.record.delegation_observation?.source,
      'watch_completed',
    )
  })

  await t.test(
    'an interrupted watch cannot impersonate a final observation',
    () => {
      const { root, state, invocationId, outputPath } = preparedRun()

      fillPreparedOutput(root, state)
      seedLedger(root, state.run_id, invocationId, [
        ledgerEntry(
          state.run_id,
          invocationId,
          'session_started',
          '2026-09-20T10:00:00.000Z',
          {
            watch_session_id: 'interrupted-session',
          },
        ),
        ledgerEntry(
          state.run_id,
          invocationId,
          'wake',
          '2026-09-20T10:01:00.000Z',
          {
            wake: 1,
            watch_session_id: 'interrupted-session',
            terminal_state: 'interrupted',
            interrupted_reason: 'SIGTERM',
          },
        ),
      ])

      const summary = summarizeDelegationObservation(
        root,
        state.run_id,
        invocationId,
      )

      assert.equal(summary.watch.terminal_state, 'interrupted')
      assert.equal(summary.observed, false)
      assert.throws(
        () => submitOutput(root, state.run_id, outputPath),
        (error: unknown) =>
          error instanceof PanError && error.code === DELEGATION_UNOBSERVED,
      )
    },
  )

  await t.test(
    'a weak held observation cannot impersonate a final one',
    async () => {
      const { root, state, invocationId, outputPath } = preparedRun()

      fillPreparedOutput(root, state)

      // An unsupported completion report holds the finished output for one
      // confirming wake. The watcher dies before that wake runs, which leaves
      // the held wake, with its real terminal observation, last in the ledger.
      let current = Date.now()

      await assert.rejects(
        watchInvocation(root, state.run_id, {
          agentState: 'completed',
          now: () => current,
          sleep: async (milliseconds) => {
            current += milliseconds
            throw new Error('watcher killed before its confirming wake')
          },
        }),
        /watcher killed/u,
      )

      const wakes = readWatchRecord(root, state.run_id, invocationId).filter(
        (entry) => entry.event === 'wake',
      )

      assert.equal(
        wakes.at(-1)?.completion_hold,
        'agent_completion_basis_missing',
      )
      assert.equal(wakes.at(-1)?.terminal_state, undefined)
      assert.equal(wakes.at(-1)?.observation?.output_present, true)

      const summary = summarizeDelegationObservation(
        root,
        state.run_id,
        invocationId,
      )

      assert.equal(summary.watch.last_wake_observed_final_output, false)
      assert.equal(
        summary.watch.last_wake_completion_hold,
        'agent_completion_basis_missing',
      )
      assert.equal(summary.observed, false)
      assert.throws(
        () => submitOutput(root, state.run_id, outputPath),
        (error: unknown) =>
          error instanceof PanError &&
          error.code === DELEGATION_UNOBSERVED &&
          /confirming wake that never ran \(agent_completion_basis_missing\)/u.test(
            error.message,
          ),
      )
    },
  )

  await t.test('the foreground-return route still satisfies submission', () => {
    const { root, state, invocationId, outputPath } = preparedRun()

    fillPreparedOutput(root, state)
    recordForegroundReturn(root, state.run_id, { invocationId })

    const submitted = submitOutput(root, state.run_id, outputPath)

    assert.equal(
      submitted.record.delegation_observation?.source,
      'foreground_return',
    )
  })

  await t.test('every new ledger entry stays schema 1', async () => {
    const { root, state, invocationId } = preparedRun()

    fillPreparedOutput(root, state)

    const evidence = writeAgentStateEvidence(root, state, invocationId)

    await watchInvocation(root, state.run_id, {
      agentState: 'completed',
      agentStateEvidence: evidence,
    })

    const entries = readWatchRecord(root, state.run_id, invocationId)

    assert.ok(entries.length > 0)
    assert.ok(entries.every((entry) => entry.schema_version === 1))
    assert.ok(
      entries.some((entry) => entry.event === 'session_started'),
      'the session opens the ledger',
    )
  })
})
