import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { renderPolicyCursorRule } from '../../src/lib/cursor-content.js'
import { submitOutput } from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { policyInstructionAppliesToCard } from '../../src/lib/policy-instructions.js'
import { renderSupervisorProcedureMarkdown } from '../../src/lib/render.js'
import type { Invocation } from '../../src/lib/types.js'
import {
  DELEGATION_CADENCE_EXTENDED,
  DELEGATION_TIMER_UNAWAITED,
  DELEGATION_UNOBSERVED,
  DELEGATION_WATCH_LATE,
  DELEGATION_WATCH_LOW_COVERAGE,
  appendSessionGap,
  backgroundMarkerPath,
  formatGapLine,
  formatSessionStartLine,
  markDelegationBackground,
  readLaunchRecord,
  readWatchRecord,
  recordForegroundReturn,
  recordInvocationLaunch,
  summarizeDelegationObservation,
  summarizeDelegationWatch,
  watchInvocation,
  watchInvocations,
  watchLockPath,
  watchRecordPath,
  type WatchRecordEntry,
} from '../../src/lib/watch.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import { read } from '../helpers.js'
import {
  CADENCE_SECONDS,
  currentInvocation,
  fakeClock,
  fillPreparedOutput,
  multiplexedTargets,
  preparedRun,
  stillWritingClock,
  writeAgentStateEvidence,
  writeTargetOutputPastCadence,
} from './watch-helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

/** Run the real CLI against a fixture root and capture both channels. */
function runCli(
  root: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  })

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

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

/** Write one seeded ledger beside the invocation. */
function seedLedger(
  root: string,
  runId: string,
  invocationId: string,
  entries: Array<Record<string, unknown>>,
): void {
  const ledger = path.join(root, watchRecordPath(root, runId, invocationId))

  mkdirSync(path.dirname(ledger), { recursive: true })
  writeFileSync(
    ledger,
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  )
}

/** One schema-1 ledger entry with the fields every reader needs. */
function ledgerEntry(
  runId: string,
  invocationId: string,
  event: string,
  recordedAt: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    event,
    run_id: runId,
    invocation_id: invocationId,
    recorded_at: recordedAt,
    cadence_seconds: 60,
    wake: 0,
    ...extra,
  }
}

test('AC-001: cadence authority', () => {
  // The default needs no authority and resolves to the one 60-second cadence.
  const defaultRun = preparedRun()

  fillPreparedOutput(defaultRun.root, defaultRun.state)

  const defaultEvidence = writeAgentStateEvidence(
    defaultRun.root,
    defaultRun.state,
    defaultRun.invocationId,
  )
  const defaultResult = runCli(defaultRun.root, [
    'watch',
    defaultRun.state.run_id,
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    defaultEvidence,
    '--json',
  ])

  assert.equal(defaultResult.status, 0, defaultResult.stderr)
  assert.equal(
    readWatchRecord(
      defaultRun.root,
      defaultRun.state.run_id,
      defaultRun.invocationId,
    )[0]?.cadence_seconds,
    60,
  )

  // An undirected exception is refused before anything is written.
  const undirected = preparedRun()
  const refused = runCli(undirected.root, [
    'watch',
    undirected.state.run_id,
    '--cadence-seconds',
    '300',
    '--json',
  ])

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /WATCH_CADENCE_UNAUTHORIZED/u)
  assert.equal(
    existsSync(
      path.join(
        undirected.root,
        watchRecordPath(
          undirected.root,
          undirected.state.run_id,
          undirected.invocationId,
        ),
      ),
    ),
    false,
    'a refused cadence writes no ledger',
  )

  // An empty reason is no authority.
  const empty = preparedRun()
  const emptyResult = runCli(empty.root, [
    'watch',
    empty.state.run_id,
    '--cadence-seconds',
    '300',
    '--cadence-directed-by-operator',
    '   ',
    '--json',
  ])

  assert.notEqual(emptyResult.status, 0)
  assert.match(emptyResult.stderr, /WATCH_CADENCE_UNAUTHORIZED/u)

  // A directed exception is recorded on the session it authorizes.
  const directed = preparedRun()

  fillPreparedOutput(directed.root, directed.state)

  const directedEvidence = writeAgentStateEvidence(
    directed.root,
    directed.state,
    directed.invocationId,
  )
  const directedResult = runCli(directed.root, [
    'watch',
    directed.state.run_id,
    '--cadence-seconds',
    '300',
    '--cadence-directed-by-operator',
    'operator directed 300s for the slow suite',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    directedEvidence,
    '--json',
  ])

  assert.equal(directedResult.status, 0, directedResult.stderr)

  const sessionStart = readWatchRecord(
    directed.root,
    directed.state.run_id,
    directed.invocationId,
  ).find((entry) => entry.event === 'session_started')

  assert.equal(sessionStart?.cadence_seconds, 300)
  assert.equal(
    sessionStart?.cadence_authority,
    'operator directed 300s for the slow suite',
  )
})

test('AC-002: cadence floor', () => {
  const authority = ['--cadence-directed-by-operator', 'floor probe']

  for (const [value, code] of [
    ['0', 'WATCH_CADENCE_BELOW_MINIMUM'],
    ['-1', 'WATCH_CADENCE_BELOW_MINIMUM'],
    ['0.049', 'WATCH_CADENCE_BELOW_MINIMUM'],
    ['Infinity', 'WATCH_CADENCE_BELOW_MINIMUM'],
    ['NaN', 'INVALID_ARGUMENT'],
  ] as const) {
    const { root, state } = preparedRun()
    const result = runCli(root, [
      'watch',
      state.run_id,
      '--cadence-seconds',
      value,
      ...authority,
      '--json',
    ])

    assert.notEqual(result.status, 0, `${value} must be refused`)
    assert.match(result.stderr, new RegExp(code), value)
  }

  // The floor itself is accepted with its authority, with no test-only bypass.
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const evidence = writeAgentStateEvidence(root, state, invocationId)
  const accepted = runCli(root, [
    'watch',
    state.run_id,
    '--cadence-seconds',
    '0.05',
    ...authority,
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    evidence,
    '--json',
  ])

  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(JSON.parse(accepted.stdout).cadence_seconds, 0.05)
})

test('AC-003: submitted cadence', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)

  const evidence = writeAgentStateEvidence(root, state, invocationId)

  // A 60-second session, then a directed 300-second session: the submitted
  // record must retain the exception rather than the ledger's first cadence.
  await watchInvocation(root, state.run_id, {
    agentState: 'completed',
    agentStateEvidence: evidence,
  })
  await watchInvocation(root, state.run_id, {
    cadenceSeconds: 300,
    cadenceAuthority: 'operator directed 300s for the slow suite',
    agentState: 'completed',
    agentStateEvidence: evidence,
  })

  const submitted = submitOutput(root, state.run_id, outputPath)
  const watch = submitted.record.delegation_observation?.watch

  assert.ok(watch)
  assert.deepEqual(watch.cadence_exceptions, [
    {
      cadence_seconds: 300,
      authority: 'operator directed 300s for the slow suite',
    },
  ])

  const advisory = submitted.advisories.find((item) =>
    item.message.includes(DELEGATION_CADENCE_EXTENDED),
  )

  assert.ok(advisory, 'an extended cadence is advised even when directed')
  assert.match(advisory.message, /300s/u)
  assert.match(advisory.message, /operator directed 300s/u)
  assert.match(advisory.message, new RegExp(state.run_id, 'u'))
  assert.match(advisory.message, new RegExp(invocationId, 'u'))
})

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

test('AC-008: timeout bounds', () => {
  // A true short timeout is refused on a pending fixture, before observation.
  const pending = preparedRun()
  const shortPending = runCli(pending.root, [
    'watch',
    pending.state.run_id,
    '--timeout-seconds',
    '30',
    '--json',
  ])

  assert.notEqual(shortPending.status, 0)
  assert.match(shortPending.stderr, /WATCH_TIMEOUT_BELOW_CADENCE/u)
  assert.equal(
    existsSync(
      path.join(
        pending.root,
        watchRecordPath(
          pending.root,
          pending.state.run_id,
          pending.invocationId,
        ),
      ),
    ),
    false,
    'a refused bound appends no wake',
  )

  // The already-complete fixture takes the same refusal: no initial-output
  // shortcut skips the bound check.
  const complete = preparedRun()

  fillPreparedOutput(complete.root, complete.state)

  const completeEvidence = writeAgentStateEvidence(
    complete.root,
    complete.state,
    complete.invocationId,
  )
  const shortComplete = runCli(complete.root, [
    'watch',
    complete.state.run_id,
    '--timeout-seconds',
    '30',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    completeEvidence,
    '--json',
  ])

  assert.notEqual(shortComplete.status, 0)
  assert.match(shortComplete.stderr, /WATCH_TIMEOUT_BELOW_CADENCE/u)

  // The intake's genuine counterexample: a directed 5-second cadence with a
  // 4-second timeout is a true short bound.
  const directed = preparedRun()

  fillPreparedOutput(directed.root, directed.state)

  const directedEvidence = writeAgentStateEvidence(
    directed.root,
    directed.state,
    directed.invocationId,
  )
  const shortDirected = runCli(directed.root, [
    'watch',
    directed.state.run_id,
    '--cadence-seconds',
    '5',
    '--cadence-directed-by-operator',
    'fast fixture',
    '--timeout-seconds',
    '4',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    directedEvidence,
    '--json',
  ])

  assert.notEqual(shortDirected.status, 0)
  assert.match(shortDirected.stderr, /WATCH_TIMEOUT_BELOW_CADENCE/u)

  // The intake's original 5/6 case fails on cadence authority, not on the
  // bound: six exceeds five, so the timeout itself is valid.
  const undirected = preparedRun()
  const undirectedResult = runCli(undirected.root, [
    'watch',
    undirected.state.run_id,
    '--cadence-seconds',
    '5',
    '--timeout-seconds',
    '6',
    '--json',
  ])

  assert.notEqual(undirectedResult.status, 0)
  assert.match(undirectedResult.stderr, /WATCH_CADENCE_UNAUTHORIZED/u)

  // Equality passes the bound validation.
  const equal = preparedRun()

  fillPreparedOutput(equal.root, equal.state)

  const equalEvidence = writeAgentStateEvidence(
    equal.root,
    equal.state,
    equal.invocationId,
  )
  const equalResult = runCli(equal.root, [
    'watch',
    equal.state.run_id,
    '--timeout-seconds',
    '60',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    equalEvidence,
    '--json',
  ])

  assert.equal(equalResult.status, 0, equalResult.stderr)
})

test('AC-009: stall bound', async () => {
  // A wake count of 1 is refused by name, in the focused form.
  const one = preparedRun()
  const refused = runCli(one.root, [
    'watch',
    one.state.run_id,
    '--stall-wakes',
    '1',
    '--json',
  ])

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /WATCH_STALL_WAKES_TOO_SMALL/u)

  // ... and in the multiplexed form.
  const multi = multiplexedTargets(2)
  const targetArgument = multi.targets
    .map((target) => `${target.runId}:${target.invocationId}`)
    .join(',')
  const refusedMulti = runCli(multi.root, [
    'watch',
    '--targets',
    targetArgument,
    '--stall-wakes',
    '1',
    '--json',
  ])

  assert.notEqual(refusedMulti.status, 0)
  assert.match(refusedMulti.stderr, /WATCH_STALL_WAKES_TOO_SMALL/u)

  // Malformed and conflicting forms are argument errors.
  const malformed = runCli(one.root, [
    'watch',
    one.state.run_id,
    '--stall-wakes',
    'abc',
    '--json',
  ])

  assert.notEqual(malformed.status, 0)
  assert.match(malformed.stderr, /INVALID_ARGUMENT/u)

  const conflict = runCli(one.root, [
    'watch',
    one.state.run_id,
    '--stall-wakes',
    '2',
    '--stall-timeout-seconds',
    '5',
    '--json',
  ])

  assert.notEqual(conflict.status, 0)
  assert.match(conflict.stderr, /INVALID_ARGUMENT/u)

  // A supported count converts to a duration against the resolved cadence.
  const converted = preparedRun()

  fillPreparedOutput(converted.root, converted.state)

  const convertedEvidence = writeAgentStateEvidence(
    converted.root,
    converted.state,
    converted.invocationId,
  )
  const accepted = runCli(converted.root, [
    'watch',
    converted.state.run_id,
    '--stall-wakes',
    '2',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    convertedEvidence,
    '--json',
  ])

  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(JSON.parse(accepted.stdout).stall_timeout_seconds, 120)

  // No flag keeps the five-minute default.
  const defaulted = preparedRun()

  fillPreparedOutput(defaulted.root, defaulted.state)

  const defaultedEvidence = writeAgentStateEvidence(
    defaulted.root,
    defaulted.state,
    defaulted.invocationId,
  )
  const defaultResult = runCli(defaulted.root, [
    'watch',
    defaulted.state.run_id,
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    defaultedEvidence,
    '--json',
  ])

  assert.equal(defaultResult.status, 0, defaultResult.stderr)
  assert.equal(JSON.parse(defaultResult.stdout).stall_timeout_seconds, 300)
})

/** Seed a launch record and a one- or two-session ledger for coverage cases. */
function seedCoverageFixture(options: {
  lifetimeSeconds: number
  sessions: Array<{ startOffsetSeconds: number; lengthSeconds: number }>
  withLaunchRecord: boolean
}): ReturnType<typeof preparedRun> {
  const fixture = preparedRun()

  fillPreparedOutput(fixture.root, fixture.state)

  const outputMtime = Date.now()
  const outputAbsolute = path.join(fixture.root, fixture.outputPath)

  utimesSync(outputAbsolute, new Date(outputMtime), new Date(outputMtime))

  if (options.withLaunchRecord) {
    recordInvocationLaunch(
      fixture.root,
      fixture.state.run_id,
      fixture.invocationId,
      {
        launchedAt: new Date(
          outputMtime - options.lifetimeSeconds * 1000,
        ).toISOString(),
        defaultLaunchedAtMs: outputMtime,
        defaultSource: 'watch_arm',
      },
    )
  }

  const entries: Array<Record<string, unknown>> = []

  options.sessions.forEach((session, index) => {
    const sessionId = `session-${index + 1}`
    const start = new Date(
      outputMtime -
        options.lifetimeSeconds * 1000 +
        session.startOffsetSeconds * 1000,
    ).toISOString()
    const lastWake = new Date(
      outputMtime -
        options.lifetimeSeconds * 1000 +
        (session.startOffsetSeconds + session.lengthSeconds) * 1000,
    ).toISOString()

    entries.push(
      ledgerEntry(
        fixture.state.run_id,
        fixture.invocationId,
        'session_started',
        start,
        {
          watch_session_id: sessionId,
        },
      ),
      ledgerEntry(fixture.state.run_id, fixture.invocationId, 'armed', start, {
        wake: 1,
        watch_session_id: sessionId,
      }),
      ledgerEntry(
        fixture.state.run_id,
        fixture.invocationId,
        'wake',
        lastWake,
        {
          wake: 1,
          watch_session_id: sessionId,
          terminal_state:
            index === options.sessions.length - 1 ? 'completed' : undefined,
          terminal_basis:
            index === options.sessions.length - 1
              ? 'output_plausible'
              : undefined,
        },
      ),
    )
  })

  seedLedger(fixture.root, fixture.state.run_id, fixture.invocationId, entries)

  return fixture
}

test('AC-010: watch coverage', async (t) => {
  await t.test('five seconds over twenty minutes is advised', () => {
    const fixture = seedCoverageFixture({
      lifetimeSeconds: 1200,
      sessions: [{ startOffsetSeconds: 600, lengthSeconds: 5 }],
      withLaunchRecord: true,
    })
    const submitted = submitOutput(
      fixture.root,
      fixture.state.run_id,
      fixture.outputPath,
    )
    const advisory = submitted.advisories.find((item) =>
      item.message.includes(DELEGATION_WATCH_LOW_COVERAGE),
    )

    assert.ok(advisory, 'thin coverage with a trustworthy clock is advised')
    assert.match(advisory.message, /ratio 0\.00/u)
    assert.match(advisory.message, /1200\.0s/u)

    const watch = submitted.record.delegation_observation?.watch

    assert.equal(watch?.coverage_basis, 'launch_record')
    assert.ok((watch?.coverage_ratio ?? 1) < 0.5)
  })

  await t.test('separated sessions keep raw span and union apart', () => {
    const fixture = seedCoverageFixture({
      lifetimeSeconds: 1200,
      sessions: [
        { startOffsetSeconds: 100, lengthSeconds: 5 },
        { startOffsetSeconds: 700, lengthSeconds: 5 },
      ],
      withLaunchRecord: true,
    })
    const summary = summarizeDelegationWatch(
      fixture.root,
      fixture.state.run_id,
      fixture.invocationId,
    )

    // The raw span reaches across the gap; the union covers only the two
    // five-second sessions.
    assert.ok((summary.raw_span_seconds ?? 0) > 600)
    assert.ok((summary.covered_seconds ?? 0) <= 11)

    const submitted = submitOutput(
      fixture.root,
      fixture.state.run_id,
      fixture.outputPath,
    )

    assert.ok(
      submitted.advisories.some((item) =>
        item.message.includes(DELEGATION_WATCH_LOW_COVERAGE),
      ),
    )
  })

  await t.test(
    'exactly half, a quick lifetime, and a missing clock are not advised',
    () => {
      const half = seedCoverageFixture({
        lifetimeSeconds: 1200,
        sessions: [{ startOffsetSeconds: 100, lengthSeconds: 600 }],
        withLaunchRecord: true,
      })
      const halfSummary = summarizeDelegationWatch(
        half.root,
        half.state.run_id,
        half.invocationId,
      )

      assert.equal(halfSummary.coverage_ratio, 0.5)

      const halfSubmit = submitOutput(
        half.root,
        half.state.run_id,
        half.outputPath,
      )

      assert.equal(
        halfSubmit.advisories.some((item) =>
          item.message.includes(DELEGATION_WATCH_LOW_COVERAGE),
        ),
        false,
        'the threshold is strictly below one half',
      )

      const quick = seedCoverageFixture({
        lifetimeSeconds: 30,
        sessions: [{ startOffsetSeconds: 0, lengthSeconds: 5 }],
        withLaunchRecord: true,
      })
      const quickSubmit = submitOutput(
        quick.root,
        quick.state.run_id,
        quick.outputPath,
      )

      assert.equal(
        quickSubmit.advisories.some((item) =>
          item.message.includes(DELEGATION_WATCH_LOW_COVERAGE),
        ),
        false,
        'a lifetime within one cadence keeps its fast-worker reading',
      )

      const missing = seedCoverageFixture({
        lifetimeSeconds: 1200,
        sessions: [{ startOffsetSeconds: 100, lengthSeconds: 5 }],
        withLaunchRecord: false,
      })
      const missingSummary = summarizeDelegationWatch(
        missing.root,
        missing.state.run_id,
        missing.invocationId,
      )

      assert.equal(missingSummary.coverage_basis, 'unknown')
      assert.equal(missingSummary.coverage_ratio, null)

      const missingSubmit = submitOutput(
        missing.root,
        missing.state.run_id,
        missing.outputPath,
      )

      assert.equal(
        missingSubmit.advisories.some((item) =>
          item.message.includes(DELEGATION_WATCH_LOW_COVERAGE),
        ),
        false,
        'a missing clock is reported as unknown, never as a numerical pass',
      )
    },
  )
})

test('AC-011: completion assertion', async (t) => {
  await t.test(
    'a supported claim records its basis, path, and digest',
    async () => {
      const { root, state, invocationId } = preparedRun()

      fillPreparedOutput(root, state)

      const evidence = writeAgentStateEvidence(root, state, invocationId)
      const result = await watchInvocation(root, state.run_id, {
        agentState: 'completed',
        agentStateEvidence: evidence,
      })

      assert.equal(result.state, 'completed')

      const terminal = readWatchRecord(root, state.run_id, invocationId).find(
        (entry) => entry.terminal_state === 'completed',
      )

      assert.equal(terminal?.terminal_basis, 'agent_state')
      assert.equal(terminal?.agent_state_evidence?.path, evidence)
      assert.equal(
        terminal?.agent_state_evidence?.source,
        'supervisor_assertion',
      )
      assert.match(
        terminal?.agent_state_evidence?.sha256 ?? '',
        /^[0-9a-f]{64}$/u,
      )
    },
  )

  await t.test(
    'an unsupported claim holds through one real cadence',
    async () => {
      const { root, state, invocationId } = preparedRun()

      fillPreparedOutput(root, state)

      const clock = fakeClock()
      const result = await watchInvocation(root, state.run_id, {
        cadenceSeconds: CADENCE_SECONDS,
        agentState: 'completed',
        ...clock,
      })

      assert.equal(result.state, 'completed')

      const wakes = readWatchRecord(root, state.run_id, invocationId).filter(
        (entry) => entry.event === 'wake',
      )

      assert.equal(wakes[0]?.completion_hold, 'agent_completion_basis_missing')
      assert.equal(wakes[0]?.terminal_state, undefined)
      assert.equal(wakes.at(-1)?.terminal_basis, 'confirming_wake')
    },
  )

  await t.test(
    'a moving output never settles the unsupported claim',
    async () => {
      const { root, state } = preparedRun()

      fillPreparedOutput(root, state)

      const result = await watchInvocation(root, state.run_id, {
        cadenceSeconds: CADENCE_SECONDS,
        timeoutSeconds: CADENCE_SECONDS * 3,
        agentState: 'completed',
        ...stillWritingClock(root, state),
      })

      assert.equal(result.state, 'unverified')
    },
  )

  await t.test('invalid evidence is refused before any write', async () => {
    const wrongIdentity = preparedRun()
    const wrongPath = writeAgentStateEvidence(
      wrongIdentity.root,
      wrongIdentity.state,
      'some-other-invocation',
    )

    await assert.rejects(
      watchInvocation(wrongIdentity.root, wrongIdentity.state.run_id, {
        agentState: 'completed',
        agentStateEvidence: wrongPath,
      }),
      (error: unknown) =>
        error instanceof PanError && error.code === 'WATCH_EVIDENCE_INVALID',
    )
    assert.equal(
      existsSync(
        path.join(
          wrongIdentity.root,
          watchRecordPath(
            wrongIdentity.root,
            wrongIdentity.state.run_id,
            wrongIdentity.invocationId,
          ),
        ),
      ),
      false,
      'a refused record leaves no ledger',
    )

    const malformed = preparedRun()
    const malformedPath = path.posix.join(
      'runtime',
      'logs',
      'workflows',
      malformed.state.run_id,
      'agent',
      'evidence',
      'not-json.json',
    )

    mkdirSync(path.dirname(path.join(malformed.root, malformedPath)), {
      recursive: true,
    })
    writeFileSync(
      path.join(malformed.root, malformedPath),
      'not json\n',
      'utf8',
    )
    await assert.rejects(
      watchInvocation(malformed.root, malformed.state.run_id, {
        agentState: 'completed',
        agentStateEvidence: malformedPath,
      }),
      (error: unknown) =>
        error instanceof PanError && error.code === 'WATCH_EVIDENCE_INVALID',
    )

    const future = preparedRun()
    const futurePath = writeAgentStateEvidence(
      future.root,
      future.state,
      future.invocationId,
    )
    const futureRecord = read(path.join(future.root, futurePath)) as Record<
      string,
      unknown
    >

    futureRecord.observed_at = new Date(Date.now() + 3_600_000).toISOString()
    writeFileSync(
      path.join(future.root, futurePath),
      `${JSON.stringify(futureRecord, null, 2)}\n`,
      'utf8',
    )
    await assert.rejects(
      watchInvocation(future.root, future.state.run_id, {
        agentState: 'completed',
        agentStateEvidence: futurePath,
      }),
      (error: unknown) =>
        error instanceof PanError && error.code === 'WATCH_EVIDENCE_INVALID',
    )
  })

  await t.test('evidence never makes a scaffold terminal', async () => {
    const { root, state, invocationId } = preparedRun()
    const invocation = currentInvocation(root, state)

    scaffoldStageOutput(root, invocation, invocation.output.path)

    const evidence = writeAgentStateEvidence(root, state, invocationId)
    const clock = fakeClock()
    const result = await watchInvocation(root, state.run_id, {
      cadenceSeconds: CADENCE_SECONDS,
      stallWakes: 2,
      timeoutSeconds: CADENCE_SECONDS * 10,
      agentState: 'completed',
      agentStateEvidence: evidence,
      ...clock,
    })

    assert.equal(result.state, 'unverified')
    assert.ok(
      readWatchRecord(root, state.run_id, invocationId).every(
        (entry) => entry.terminal_state !== 'completed',
      ),
    )
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

test('AC-014: policy lifetime', () => {
  const root = process.cwd()
  const policy = loadPolicyCatalog(root).get('DELEGATE-001')

  assert.ok(policy)

  const agentText = policy.instructions
    .filter((instruction) =>
      policyInstructionAppliesToCard(instruction, 'agent'),
    )
    .map((instruction) =>
      typeof instruction === 'string' ? instruction : instruction.text,
    )
    .join('\n')
  const supervisorText = policy.instructions
    .filter((instruction) =>
      policyInstructionAppliesToCard(instruction, 'supervisor'),
    )
    .map((instruction) =>
      typeof instruction === 'string' ? instruction : instruction.text,
    )
    .join('\n')
  const guidance = `${agentText}\n${supervisorText}`

  // The full lifetime: the watch loops until a verdict or its bound.
  assert.match(
    guidance,
    /loops on the fixed cadence until a terminal verdict or its bound/u,
  )
  // The default bound is now one hour.
  assert.match(guidance, /one hour \(3600 seconds\)|one hour|3600/u)
  assert.doesNotMatch(guidance, /four hours/u)
  // The fixed cadence survives.
  assert.match(guidance, /60 seconds, fixed, and universal/u)
  // The misleading single-cycle prescription is gone; the prohibition that
  // replaced it stays.
  assert.doesNotMatch(guidance, /MUST be a background shell sleep/u)
  assert.doesNotMatch(guidance, /shell-await turn/u)
  assert.doesNotMatch(guidance, /one cadence per slice/u)
  assert.match(guidance, /MUST NOT hand-arm/u)
})

test('AC-015: platform await guidance', () => {
  const invocation = {
    invocation_id: 'implement-1-fixture',
    run_id: 'run-fixture',
    inputs: { references: [] },
    output: {
      path: 'runtime/logs/workflows/run-fixture/outputs/implement-1-fixture.json',
    },
    delegation: {
      persona: 'coder',
      cursor_agent_path: '.cursor/agents/pan-coder.md',
      canonical_markdown_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.md',
      invocation_validation_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.invocation-validation.json',
      delegation_artifact_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.delegation.md',
      supervisor_procedure_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.supervisor.md',
      submit_command:
        './bin/pan submit run-fixture runtime/logs/workflows/run-fixture/outputs/implement-1-fixture.json',
      mode: 'referenced',
      delivery_prompt_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.delivery.md',
      watch_command:
        './bin/pan watch run-fixture --invocation implement-1-fixture',
      policies: [],
    },
  } as unknown as Invocation

  const procedure = renderSupervisorProcedureMarkdown(invocation)

  // The procedure prescribes a foreground blocking call and --attach on detach.
  assert.match(procedure, /foreground blocking/u)
  assert.match(procedure, /--attach/u)
  assert.doesNotMatch(procedure, /largest wait the platform supports/u)
  assert.doesNotMatch(procedure, /re-await the same command/u)
  // Never call AwaitShell.
  assert.match(procedure, /Never call .AwaitShell/u)
  // No mandate of one model await per cadence, and no duplicate watch.
  assert.doesNotMatch(procedure, /one cadence per slice/u)
  assert.match(procedure, /rather than arming a\s+second watch/u)
})

test('AC-016: arming bound', async () => {
  // The default bound is named as the default.
  const defaulted = preparedRun()

  fillPreparedOutput(defaulted.root, defaulted.state)

  const defaultedEvidence = writeAgentStateEvidence(
    defaulted.root,
    defaulted.state,
    defaulted.invocationId,
  )
  const lines: string[] = []

  await watchInvocation(defaulted.root, defaulted.state.run_id, {
    agentState: 'completed',
    agentStateEvidence: defaultedEvidence,
    onSessionStart: (entry) => lines.push(formatSessionStartLine(entry)),
  })

  assert.equal(lines.length, 1)
  assert.match(lines[0] ?? '', /cadence 60s/u)
  assert.match(lines[0] ?? '', /timeout 3600s \(default bound\)/u)

  // An override names the exact value.
  const custom = preparedRun()

  fillPreparedOutput(custom.root, custom.state)

  const customEvidence = writeAgentStateEvidence(
    custom.root,
    custom.state,
    custom.invocationId,
  )
  const customLines: string[] = []
  const customResult = await watchInvocation(custom.root, custom.state.run_id, {
    agentState: 'completed',
    agentStateEvidence: customEvidence,
    timeoutSeconds: 90,
    onSessionStart: (entry) => customLines.push(formatSessionStartLine(entry)),
  })

  assert.match(customLines[0] ?? '', /timeout 90s/u)
  assert.doesNotMatch(customLines[0] ?? '', /default bound/u)
  // The machine result carries the same resolved bound.
  assert.equal(customResult.timeout_seconds, 90)

  const cli = runCli(custom.root, [
    'watch',
    custom.state.run_id,
    '--timeout-seconds',
    '90',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    customEvidence,
    '--json',
  ])

  assert.equal(cli.status, 0, cli.stderr)
  assert.equal(JSON.parse(cli.stdout).timeout_seconds, 90)

  // The arming line reaches a piped stderr, which is what an agent shell has.
  const piped = runCli(custom.root, [
    'watch',
    custom.state.run_id,
    '--timeout-seconds',
    '90',
    '--agent-state',
    'completed',
    '--agent-state-evidence',
    customEvidence,
  ])

  assert.equal(piped.status, 0, piped.stderr)
  assert.match(
    piped.stderr.split('\n')[0] ?? '',
    /armed at .*: cadence 60s, timeout 90s$/u,
  )
})

test('AC-017: projected lifetime', () => {
  const root = process.cwd()

  // The canonical supervisor procedure.
  const invocation = {
    invocation_id: 'implement-1-fixture',
    run_id: 'run-fixture',
    inputs: { references: [] },
    output: {
      path: 'runtime/logs/workflows/run-fixture/outputs/implement-1-fixture.json',
    },
    delegation: {
      persona: 'coder',
      cursor_agent_path: '.cursor/agents/pan-coder.md',
      canonical_markdown_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.md',
      invocation_validation_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.invocation-validation.json',
      delegation_artifact_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.delegation.md',
      supervisor_procedure_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.supervisor.md',
      submit_command:
        './bin/pan submit run-fixture runtime/logs/workflows/run-fixture/outputs/implement-1-fixture.json',
      mode: 'referenced',
      delivery_prompt_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.delivery.md',
      watch_command:
        './bin/pan watch run-fixture --invocation implement-1-fixture',
      policies: [],
    },
  } as unknown as Invocation
  const procedure = renderSupervisorProcedureMarkdown(invocation)

  // The orchestrator persona.
  const persona = readFileSync(
    path.join(root, 'library/personas/orchestrator.md'),
    'utf8',
  )

  // The CLI help.
  const help = spawnSync(process.execPath, [CLI, 'help'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout

  for (const [surface, text] of [
    ['procedure', procedure],
    ['persona', persona],
    ['help', help],
  ] as const) {
    // Lifetime: the watch loops to a verdict or its bound — one hour now.
    assert.match(
      text,
      /one hour|3600/u,
      `${surface} MUST state the one-hour default bound`,
    )
    assert.doesNotMatch(
      text,
      /four hours|four-hour|14400/u,
      `${surface} MUST NOT contain the retired four-hour default`,
    )
    // The hold semantics survive on every surface.
    assert.match(
      text,
      /confirming wake/u,
      `${surface} MUST state the confirming-wake hold`,
    )
  }

  // The exception semantics: the policy and the CLI both name the authority.
  assert.match(help, /--cadence-directed-by-operator/u)
  assert.match(persona, /--agent-state-evidence/u)

  // A fresh projection of the policy matches the canonical source text.
  const policy = loadPolicyCatalog(root).get('DELEGATE-001')

  assert.ok(policy)

  const projection = renderPolicyCursorRule(policy)

  for (const instruction of policy.instructions) {
    if (policyInstructionAppliesToCard(instruction, 'agent')) {
      const text =
        typeof instruction === 'string' ? instruction : instruction.text

      assert.ok(
        projection.includes(text),
        `the projection MUST carry: ${text.slice(0, 60)}...`,
      )
    }
  }
})

test('AC-018: return clock', async (t) => {
  const fixtureWithReturn = (
    markDelaySeconds: number,
  ): ReturnType<typeof preparedRun> => {
    const fixture = preparedRun()
    const returnedAt = new Date(Date.now() - 200_000)
    const launchedAt = new Date(returnedAt.getTime() - 90_000)

    // The launch lasted ninety seconds before the platform returned control,
    // and the mark lands exactly markDelaySeconds after that return.
    recordInvocationLaunch(
      fixture.root,
      fixture.state.run_id,
      fixture.invocationId,
      {
        launchedAt: launchedAt.toISOString(),
        platformReturnedAt: returnedAt.toISOString(),
        defaultLaunchedAtMs: Date.now(),
        defaultSource: 'watch_arm',
      },
    )
    markDelegationBackground(
      fixture.root,
      fixture.state.run_id,
      fixture.invocationId,
      { markedAtMs: returnedAt.getTime() + markDelaySeconds * 1000 },
    )

    return fixture
  }

  await t.test(
    'marks at 0 and 60 seconds after the return are not late',
    () => {
      for (const delay of [0, 60]) {
        const fixture = preparedRun()
        const returnedAt = new Date(Date.now() - 200_000)
        const launchedAt = new Date(returnedAt.getTime() - 90_000)

        // The launch lasted ninety seconds before the platform returned
        // control; the mark lands exactly `delay` seconds after the return.
        recordInvocationLaunch(
          fixture.root,
          fixture.state.run_id,
          fixture.invocationId,
          {
            launchedAt: launchedAt.toISOString(),
            platformReturnedAt: returnedAt.toISOString(),
            defaultLaunchedAtMs: Date.now(),
            defaultSource: 'watch_arm',
          },
        )
        markDelegationBackground(
          fixture.root,
          fixture.state.run_id,
          fixture.invocationId,
          { markedAtMs: returnedAt.getTime() + delay * 1000 },
        )

        const summary = summarizeDelegationWatch(
          fixture.root,
          fixture.state.run_id,
          fixture.invocationId,
        )

        assert.equal(
          summary.background_watch_late,
          false,
          `a ${delay}s delay from the return is not late`,
        )
        assert.equal(summary.background_mark_delay_basis, 'platform_return')
        assert.equal(
          summary.background_mark_delay_seconds,
          delay,
          'the delay measures from the return, not the launch',
        )
      }
    },
  )

  await t.test(
    'a mark 61 seconds after the return is late, and the basis survives rearm',
    async () => {
      const fixture = fixtureWithReturn(61)

      fillPreparedOutput(fixture.root, fixture.state)

      const marker = read(
        path.join(
          fixture.root,
          backgroundMarkerPath(
            fixture.root,
            fixture.state.run_id,
            fixture.invocationId,
          ),
        ),
      ) as {
        mark_delay_seconds: number
        late: boolean
        mark_delay_basis: string
      }

      assert.equal(marker.mark_delay_basis, 'platform_return')
      assert.ok(marker.mark_delay_seconds > 60)
      assert.equal(marker.late, true)

      // A re-mark preserves the original launch and the first mark.
      const firstLaunch = readLaunchRecord(
        fixture.root,
        fixture.state.run_id,
        fixture.invocationId,
      )

      markDelegationBackground(
        fixture.root,
        fixture.state.run_id,
        fixture.invocationId,
      )

      const secondLaunch = readLaunchRecord(
        fixture.root,
        fixture.state.run_id,
        fixture.invocationId,
      )
      const remarked = read(
        path.join(
          fixture.root,
          backgroundMarkerPath(
            fixture.root,
            fixture.state.run_id,
            fixture.invocationId,
          ),
        ),
      ) as { first_marked_at: string; mark_delay_seconds: number }

      assert.equal(secondLaunch?.launched_at, firstLaunch?.launched_at)
      assert.equal(
        secondLaunch?.platform_returned_at,
        firstLaunch?.platform_returned_at,
      )
      assert.ok(remarked.mark_delay_seconds <= marker.mark_delay_seconds + 1)

      // The submission carries the advisory with the return basis.
      const evidence = writeAgentStateEvidence(
        fixture.root,
        fixture.state,
        fixture.invocationId,
      )

      await watchInvocation(fixture.root, fixture.state.run_id, {
        agentState: 'completed',
        agentStateEvidence: evidence,
      })

      const submitted = submitOutput(
        fixture.root,
        fixture.state.run_id,
        fixture.outputPath,
      )
      const advisory = submitted.advisories.find((item) =>
        item.message.includes(DELEGATION_WATCH_LATE),
      )

      assert.ok(advisory, 'the late arming is advised at submission')
      assert.match(advisory.message, /after the platform returned control/u)
    },
  )

  await t.test('an invalid order is refused before mutation', () => {
    const fixture = preparedRun()
    const launchedAt = new Date(Date.now() - 10_000).toISOString()

    assert.throws(
      () =>
        recordInvocationLaunch(
          fixture.root,
          fixture.state.run_id,
          fixture.invocationId,
          {
            launchedAt,
            // The return predates the launch: impossible.
            platformReturnedAt: new Date(Date.now() - 20_000).toISOString(),
            defaultLaunchedAtMs: Date.now(),
            defaultSource: 'watch_arm',
          },
        ),
      (error: unknown) =>
        error instanceof PanError && error.code === 'INVALID_ARGUMENT',
    )
    assert.equal(
      readLaunchRecord(
        fixture.root,
        fixture.state.run_id,
        fixture.invocationId,
      ),
      null,
      'a refused timestamp never reaches the record',
    )
  })
})

test('AC-019: unknown return', () => {
  const { root, state, invocationId } = preparedRun()

  // An old launch-only record: no platform return clock exists.
  recordInvocationLaunch(root, state.run_id, invocationId, {
    launchedAt: new Date(Date.now() - 90_000).toISOString(),
    defaultLaunchedAtMs: Date.now(),
    defaultSource: 'watch_arm',
  })
  markDelegationBackground(root, state.run_id, invocationId)

  const summary = summarizeDelegationWatch(root, state.run_id, invocationId)

  // The ninety-second launch-to-mark delay stays on the record as a labeled
  // fallback; nothing is attributed, and no timestamp is rewritten.
  assert.equal(summary.background_mark_delay_basis, 'launch_unattributed')
  assert.equal(summary.background_watch_late, false)
  assert.ok((summary.background_mark_delay_seconds ?? 0) >= 90)
  assert.equal(
    readLaunchRecord(root, state.run_id, invocationId)?.platform_returned_at,
    null,
    'no retrospective timestamp is written',
  )
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

test('AC-021: cohort guidance', () => {
  const root = process.cwd()
  const persona = readFileSync(
    path.join(root, 'library/personas/orchestrator.md'),
    'utf8',
  )
  const policy = loadPolicyCatalog(root).get('DELEGATE-001')

  assert.ok(policy)

  const cohortInstruction = policy.instructions
    .map((instruction) =>
      typeof instruction === 'string' ? instruction : instruction.text,
    )
    .find((text) => text.includes('--until-terminal'))

  // The terminal-only option is the documented cohort wait.
  assert.ok(cohortInstruction, 'the policy names the terminal-only option')
  assert.match(cohortInstruction ?? '', /sibling handoff/u)
  assert.match(cohortInstruction ?? '', /MUST rearm siblings promptly/u)
  assert.match(
    cohortInstruction ?? '',
    /without claiming continuous observation/u,
  )
  assert.match(persona, /--until-terminal/u)
  // Resume siblings promptly and reattach rather than duplicate.
  assert.match(persona, /promptly rearm the remainder/u)
  assert.match(persona, /Reattach to an existing watch/u)
  // No continuous-observation claim after a return.
  assert.match(persona, /Never claim continuous sibling observation/u)
})

test('AC-024: universal timer guidance', () => {
  const root = process.cwd()

  // Worker, supervisor, and standalone resolutions all carry the rule.
  for (const context of [
    { persona: 'coder', workflow: 'delivery', stage: 'implement' },
    { persona: 'orchestrator', workflow: 'delivery', stage: 'implement' },
    { persona: 'unbound', workflow: 'standalone', stage: 'unbound' },
  ] as const) {
    const resolved = resolvePolicies(root, context)

    assert.ok(
      resolved.some((policy) => policy.id === 'DELEGATE-001'),
      `${context.persona}/${context.workflow}/${context.stage} MUST resolve DELEGATE-001`,
    )
  }

  const policy = loadPolicyCatalog(root).get('DELEGATE-001')

  assert.ok(policy)

  const agentText = policy.instructions
    .filter((instruction) =>
      policyInstructionAppliesToCard(instruction, 'agent'),
    )
    .map((instruction) =>
      typeof instruction === 'string' ? instruction : instruction.text,
    )
    .join('\n')

  // `pan watch` is the exclusive timer, in and out of runs.
  assert.match(
    agentText,
    /MUST set every observation timer through `pan watch`/u,
  )
  assert.match(agentText, /The process form watches a process/u)
  // The old shell-sleep prescription is gone.
  assert.doesNotMatch(agentText, /background shell sleep/u)
  // AwaitShell is now explicitly banned in the policy.
  assert.match(agentText, /AwaitShell/u)
  assert.match(
    agentText,
    /AWAIT-SHELL-BAN-VALIDATE-001|banned|MUST NOT.*AwaitShell|AwaitShell.*banned/u,
  )
  // Platform awaits prescribe --attach, not reawait.
  assert.match(agentText, /--attach/u)
  assert.doesNotMatch(agentText, /MUST reawait the same watch command/u)
  // The opaque fallback is documented.
  assert.match(agentText, /timer form watches an opaque platform handle/u)

  // The projection carries the same text.
  const projection = renderPolicyCursorRule(policy)

  assert.match(
    projection,
    /MUST set every observation timer through `pan watch`/u,
  )
  assert.doesNotMatch(projection, /background shell sleep/u)
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
