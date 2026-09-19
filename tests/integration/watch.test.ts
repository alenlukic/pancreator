import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { submitOutput } from '../../src/lib/engine.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import { operationMutexPath } from '../../src/lib/state.js'
import {
  DEFAULT_STALL_TIMEOUT_SECONDS,
  DEFAULT_WATCH_CADENCE_SECONDS,
  DELEGATION_UNOBSERVED,
  WATCH_EXIT_CODES,
  backgroundMarkerPath,
  blockedOutputSnapshotPath,
  completionEvidenceForObservation,
  isTerminalObservation,
  markDelegationBackground,
  observeInvocation,
  parseCadenceSeconds,
  readLaunchRecord,
  readWatchRecord,
  recordInvocationLaunch,
  summarizeDelegationObservation,
  summarizeDelegationWatch,
  watchInvocation,
  watchRecordPath,
} from '../../src/lib/watch.js'
import { delegationPath } from '../../src/lib/validation.js'
import { read, writeCanonicalDelegation } from '../helpers.js'
import {
  CADENCE_SECONDS,
  blockedSnapshotEvents,
  currentInvocation,
  fakeClock,
  fillPreparedOutput,
  preparedRun,
  stillWritingClock,
  writeStageOutput,
} from './watch-helpers.js'

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
  // Whole milliseconds on the fake clock: 300 ms, not 0.1 * 3 in floating point.
  assert.ok(result.elapsed_seconds >= 0.3)
})

// An output present before the watch even arms is the weakest evidence there
// is: it landed inside one cadence of the launch, so it is a draft as often as
// a finished stage. The watch spends one confirming wake on it rather than
// either trusting it or spending the whole timeout.
test('watch completes an already-present output after one confirming wake and stays idempotent', async () => {
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const first = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
  })
  const second = await watchInvocation(root, state.run_id, {
    invocationId,
    cadenceSeconds: CADENCE_SECONDS,
  })

  assert.equal(first.state, 'completed')
  assert.equal(first.wakes, 1, 'exactly one confirming wake, never more')
  assert.equal(second.state, 'completed')

  const entries = readWatchRecord(root, state.run_id, invocationId)
  const terminal = entries.filter((entry) => entry.terminal_state !== undefined)

  assert.equal(terminal.length, 2, 'each watch records one terminal verdict')
  assert.ok(terminal.every((entry) => entry.terminal_state === 'completed'))
  assert.ok(
    terminal.every((entry) => entry.terminal_basis === 'confirming_wake'),
  )
  assert.equal(
    entries[0]?.completion_hold,
    'output_younger_than_cadence',
    'the held observation names why it was held',
  )
})

test('a mark-background re-arm preserves the existing launch clock', async () => {
  const { root, state, invocationId } = preparedRun()
  const launchedAt = new Date(Date.now() - 120_000).toISOString()

  recordInvocationLaunch(root, state.run_id, invocationId, {
    launchedAt,
    defaultLaunchedAtMs: Date.now(),
    defaultSource: 'watch_arm',
    launchMode: 'foreground',
  })
  writeStageOutput(root, state)

  const watched = await watchInvocation(root, state.run_id, {
    markBackground: true,
    agentState: 'completed',
  })
  const launch = readLaunchRecord(root, state.run_id, invocationId)

  assert.equal(watched.state, 'completed')
  assert.equal(launch?.launched_at, launchedAt)
  assert.equal(launch?.launched_at_source, 'supervisor')
  assert.equal(launch?.launch_mode, 'background')
})

// The recorded symptom was a lateness advisory measured from the re-arming
// rather than the launch. The clock an arming records itself must survive a
// later detach for the same reason a supervisor-supplied one does.
test('a mark-background re-arm preserves a clock the first arming recorded', async () => {
  const { root, state, invocationId } = preparedRun()
  const armedMs = Date.now() - 300_000

  recordInvocationLaunch(root, state.run_id, invocationId, {
    defaultLaunchedAtMs: armedMs,
    defaultSource: 'watch_arm',
  })

  const armed = readLaunchRecord(root, state.run_id, invocationId)

  writeStageOutput(root, state)
  await watchInvocation(root, state.run_id, {
    markBackground: true,
    agentState: 'completed',
  })

  const launch = readLaunchRecord(root, state.run_id, invocationId)

  assert.equal(launch?.launched_at, armed?.launched_at)
  assert.equal(launch?.launched_at_source, 'watch_arm')

  // The detach is therefore measured from the launch rather than from the
  // re-arming. This launch is 300 seconds old, so the mark is correctly
  // late; measured from the re-arming it would have read as immediate,
  // which is the reading the preserved clock exists to prevent.
  const marker = JSON.parse(
    readFileSync(
      path.join(root, backgroundMarkerPath(root, state.run_id, invocationId)),
      'utf8',
    ),
  ) as { launched_at: string; mark_delay_seconds: number; late: boolean }

  assert.equal(marker.launched_at, armed?.launched_at)
  assert.ok(marker.mark_delay_seconds >= 300)
  assert.equal(marker.late, true)
})

test('watch --mark-background writes the background marker beside the record', async () => {
  const { root, state, invocationId } = preparedRun()

  writeStageOutput(root, state)

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    markBackground: true,
  })

  assert.equal(
    result.background_marker_path,
    backgroundMarkerPath(root, state.run_id, invocationId),
  )

  assert.ok(result.background_marker_path)

  const marker = read(path.join(root, result.background_marker_path)) as {
    launch_mode: string
    watch_record_path: string
  }

  assert.equal(marker.launch_mode, 'background')
  assert.equal(marker.watch_record_path, result.record_path)
})

// HR4-001: `launched_at` came from the delegation artifact's mtime, which
// `pan prepare` writes. Seven of the eight Phase 3 lateness advisories were
// verify stages whose supervisor read a long implement output before it
// launched anything, so the advisory measured reading and called it
// lateness. The arming is the earliest launch the harness itself witnesses.
test('the first watch arming records the launch time and never resets it', async () => {
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const armedAtLeast = Date.now()

  await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  const first = readLaunchRecord(root, state.run_id, invocationId)

  assert.ok(first)
  assert.equal(first.launched_at_source, 'watch_arm')
  assert.equal(first.launch_mode, 'unknown')
  assert.equal(first.worker_handle, null, 'an absent handle is recorded')
  assert.ok(Date.parse(first.launched_at) >= armedAtLeast)
  assert.ok(
    Date.parse(first.launched_at) <=
      Date.parse(
        readWatchRecord(root, state.run_id, invocationId)[0].recorded_at,
      ),
    'the launch is recorded no later than the wake it precedes',
  )

  // Re-arming is more supervision of the same launch, not a new one.
  await watchInvocation(root, state.run_id, {
    invocationId,
    cadenceSeconds: CADENCE_SECONDS,
    markBackground: true,
    agentState: 'completed',
  })

  const second = readLaunchRecord(root, state.run_id, invocationId)

  assert.equal(second?.launched_at, first.launched_at)
  assert.equal(second?.launched_at_source, 'watch_arm')
  assert.equal(
    second?.launch_mode,
    'background',
    'a mode learned later fills a gap without moving the clock',
  )
  const marker = read(
    path.join(root, backgroundMarkerPath(root, state.run_id, invocationId)),
  ) as { launched_at: string; redline_category: string }

  assert.equal(marker.launched_at, first.launched_at)
  assert.equal(marker.redline_category, 'platform_initiated_detach')
})

// The supervisor is the only party that knows when it made the call, so its
// own time overrides a default the harness inferred. That is what makes a
// late arming measurable at all now that no artifact mtime stands in for it.
test('a supervisor-supplied launch time overrides the arming default on the background path', async () => {
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const launchedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    markBackground: true,
    launchedAt,
    agentState: 'completed',
  })

  const record = readLaunchRecord(root, state.run_id, invocationId)

  assert.equal(record?.launched_at, launchedAt)
  assert.equal(record?.launched_at_source, 'supervisor')
  assert.equal(record?.launch_mode, 'background')

  const summary = summarizeDelegationWatch(root, state.run_id, invocationId)

  assert.equal(summary.background_watch_late, true)
  assert.ok((summary.background_mark_delay_seconds ?? 0) > 60)
})

// HR4-002: the watch fingerprinted the delegation artifact, which is the
// worker's input. A supervisor re-rendering the card counted as the worker
// producing, so the stall count reset and a confirming wake was spent on an
// idle worker.
test('touching the delegation artifact is not progress the watch counts', async () => {
  const { root, state, invocationId } = preparedRun()
  const delegationAbsolute = path.join(
    root,
    delegationPath(state.run_id, invocationId, root),
  )
  const invocation = currentInvocation(root, state)

  writeCanonicalDelegation(root, invocation)

  const before = observeInvocation(root, invocation)
  const touched = new Date(Date.now() + 60_000)

  utimesSync(delegationAbsolute, touched, touched)

  const after = observeInvocation(root, invocation)

  assert.equal(after.fingerprint, before.fingerprint)
  assert.ok(
    after.watched_paths.every((item) => !item.path.endsWith('.delegation.md')),
    'the delegation artifact is no longer a watched path',
  )

  // The same artifact touched on every wake must still leave a stall.
  const clock = fakeClock()
  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 2,
    timeoutSeconds: CADENCE_SECONDS * 10,
    ...clock,
    onWake: () => {
      const stamp = new Date(Date.now() + 120_000)

      utimesSync(delegationAbsolute, stamp, stamp)
    },
  })

  assert.equal(
    result.state,
    'stalled',
    'the touches never look like the worker producing',
  )

  const wakes = readWatchRecord(root, state.run_id, invocationId).filter(
    (entry) => entry.event === 'wake',
  )

  assert.deepEqual(
    wakes.map((entry) => entry.unchanged_wakes),
    [1, 2],
    'a touched delegation artifact leaves the unchanged-wake count alone',
  )
})

// HR4-010: the 3b coder's contract-conflict diagnosis was the best worker
// output of its phase and the artifact an operator decision rested on. The
// supervisor resolved the block without submitting, the relaunched worker
// rewrote the same path, and the run record kept nothing.
test('a blocked output is preserved beside its invocation and named in the event log', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)

  const blocked = read(path.join(root, outputPath)) as Record<string, unknown>

  writeFileSync(
    path.join(root, outputPath),
    `${JSON.stringify({ ...blocked, result: 'blocked', summary: 'The plan names a gate no permitted action can pass.' }, null, 2)}\n`,
  )

  await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  const first = blockedOutputSnapshotPath(root, state.run_id, invocationId, 1)
  const preserved = read(path.join(root, first)) as Record<string, unknown>

  assert.equal(preserved.result, 'blocked')
  assert.match(
    String(preserved.summary),
    /no permitted action can pass/u,
    'the preserved copy carries the diagnosis, not a stub',
  )
  const events = blockedSnapshotEvents(root, state.run_id)

  assert.equal(events.length, 1)
  assert.ok(
    events[0].includes(first),
    'the event names the snapshot it preserved',
  )

  // The same blocked output seen again on a later wake is already preserved.
  await watchInvocation(root, state.run_id, {
    invocationId,
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  assert.equal(
    existsSync(
      path.join(
        root,
        blockedOutputSnapshotPath(root, state.run_id, invocationId, 2),
      ),
    ),
    false,
  )

  // A second, different blocked output takes the next ordinal and leaves
  // the first snapshot exactly as it was.
  writeFileSync(
    path.join(root, outputPath),
    `${JSON.stringify({ ...blocked, result: 'blocked', summary: 'A second precondition is missing.' }, null, 2)}\n`,
  )

  await watchInvocation(root, state.run_id, {
    invocationId,
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  const second = read(
    path.join(
      root,
      blockedOutputSnapshotPath(root, state.run_id, invocationId, 2),
    ),
  ) as Record<string, unknown>

  assert.match(String(second.summary), /A second precondition is missing/u)
  assert.match(
    String((read(path.join(root, first)) as Record<string, unknown>).summary),
    /no permitted action can pass/u,
    'the first snapshot is never overwritten',
  )
})

// R-2. The snapshot's event write took the run mutex with no wait budget from
// inside the watch loop, so a concurrent `pan` command ended supervision with
// RUN_OPERATION_IN_PROGRESS. The watched worker runs `./bin/pan` by design,
// which is the contention source. The loss was also not self-healing: the
// later observation found a snapshot with a matching digest and returned
// before writing anything.
test('a contended event write leaves the watch running and lands on a later wake', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)

  const blocked = read(path.join(root, outputPath)) as Record<string, unknown>

  writeFileSync(
    path.join(root, outputPath),
    `${JSON.stringify({ ...blocked, result: 'blocked', summary: 'The gate cannot pass before the stage it guards.' }, null, 2)}\n`,
  )

  const mutex = operationMutexPath(root, state.run_id)

  mkdirSync(path.dirname(mutex), { recursive: true })
  // Our own pid, so the mutex reads as held by a live process rather than as
  // stale. A stale one is cleared and the contention never happens.
  writeFileSync(mutex, `${process.pid}\n`)

  const contended = await watchInvocation(root, state.run_id, {
    invocationId,
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  assert.equal(
    contended.state,
    'completed',
    'contention on the event write does not end supervision',
  )

  const snapshot = blockedOutputSnapshotPath(
    root,
    state.run_id,
    invocationId,
    1,
  )

  assert.equal(
    existsSync(path.join(root, snapshot)),
    true,
    'the preservation is written before the event that can fail',
  )
  assert.deepEqual(
    blockedSnapshotEvents(root, state.run_id),
    [],
    'the contended event is the only thing lost',
  )

  rmSync(mutex, { force: true })

  await watchInvocation(root, state.run_id, {
    invocationId,
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  const events = blockedSnapshotEvents(root, state.run_id)

  assert.equal(events.length, 1, 'the skipped event lands exactly once')
  assert.ok(
    events[0].includes(snapshot),
    'the recovered event names the snapshot it preserved',
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        blockedOutputSnapshotPath(root, state.run_id, invocationId, 2),
      ),
    ),
    false,
    'the later wake writes the missing event, not a second snapshot',
  )
})

test('cadence accepts fractional seconds and rejects a busy loop', () => {
  assert.equal(parseCadenceSeconds('0.1'), 0.1)
  assert.equal(parseCadenceSeconds('90'), 90)
  assert.equal(parseCadenceSeconds(null), DEFAULT_WATCH_CADENCE_SECONDS)
  assert.throws(() => parseCadenceSeconds('0'), /at least/u)
  assert.throws(() => parseCadenceSeconds('abc'), /at least/u)
})

// DELEGATE-001 now names one cadence for every worker, so an unspecified
// cadence must resolve to 60 seconds rather than to a length chosen from the
// expected run time. An already-present output plus an attested agent state
// reaches the record without spending a cadence on a sleep.
test('an unspecified cadence watches at the one universal 60-second cadence', async () => {
  assert.equal(DEFAULT_WATCH_CADENCE_SECONDS, 60)

  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const result = await watchInvocation(root, state.run_id, {
    agentState: 'completed',
  })

  assert.equal(result.state, 'completed')
  assert.equal(result.cadence_seconds, 60)
  assert.equal(
    readWatchRecord(root, state.run_id, invocationId).at(-1)?.cadence_seconds,
    60,
  )
})

// launch and kept rewriting it for another seven minutes. `pan watch` read the
// file, called it terminal, and returned with no armings, so the supervisor
// submitted a stage whose worker was still running. Presence is not
// completion. The watch now holds that observation for one confirming wake:
// a worker still writing moves the output across it, and a finished one does
// not, which is an answer the harness can get without the supervisor.
test('a background launch whose output lands too soon is held for one confirming wake', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)
  markDelegationBackground(root, state.run_id, invocationId)

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
  })

  assert.equal(watched.state, 'completed')
  assert.equal(watched.armings, 1, 'the held observation armed a real timer')

  const entries = readWatchRecord(root, state.run_id, invocationId)

  assert.equal(entries[0]?.terminal_state, undefined)
  assert.equal(entries[0]?.completion_hold, 'output_younger_than_cadence')
  assert.equal(entries.at(-1)?.terminal_state, 'completed')
  assert.equal(entries.at(-1)?.terminal_basis, 'confirming_wake')
  // The confirming wake is an observation, so the submission it permits is
  // the same one a plain completed watch permits.
  assert.doesNotThrow(() => submitOutput(root, state.run_id, outputPath))
})

// The held observation is a question, not a verdict. A watch that runs out of
// time before the confirming wake answers it reports that it could not tell,
// and the submission still routes the supervisor to the agent itself.
test('a hold the watch never confirms ends unverified rather than timed out', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    timeoutSeconds: CADENCE_SECONDS,
    ...stillWritingClock(root, state),
  })

  assert.equal(watched.state, 'unverified')

  const entries = readWatchRecord(root, state.run_id, invocationId)

  assert.equal(entries.at(-1)?.terminal_state, 'unverified')
  assert.throws(
    () => submitOutput(root, state.run_id, outputPath),
    (error: unknown) => {
      const failure = error as { code?: string; message: string }

      assert.equal(failure.code, DELEGATION_UNOBSERVED)
      assert.match(failure.message, /ends unverified/u)
      assert.match(failure.message, /--agent-state completed/u)

      return true
    },
  )
})

test('an agent the supervisor saw still running keeps the watch on its cadence', async () => {
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)
  markDelegationBackground(root, state.run_id, invocationId)

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'running',
  })

  // A supervisor that says the agent is still running never gets the instant
  // verdict: the timer arms and the record carries a real arming, which is
  // the whole difference between a watch and a file stat.
  assert.ok(watched.armings >= 1, 'running MUST suppress the short-circuit')

  const entries = readWatchRecord(root, state.run_id, invocationId)

  assert.ok(entries.some((entry) => entry.event === 'armed'))
  assert.notEqual(entries[0]?.terminal_state, 'completed')
  assert.equal(entries[0]?.completion_hold, 'agent_reported_running')
})

// A supervisor's `running` report and a complete-looking output disagree.
// The watch used to end on whichever it read first; now the disagreement
// itself is the weak evidence that buys one more observation.
//
// The hold reason is asserted on every wake, not only the first. A fixture
// repair once cost this case its premise: with only the first wake pinned,
// the `agent_reported_running` branch could stop firing after wake 1 and the
// case still passed, so it no longer discriminated the branch it is named
// for. Nothing here measures elapsed time.
test('a plausible output under a running agent report ends no wake of its own', async () => {
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    timeoutSeconds: CADENCE_SECONDS * 3,
    agentState: 'running',
    ...stillWritingClock(root, state),
  })

  const wakes = readWatchRecord(root, state.run_id, invocationId).filter(
    (entry) => entry.event === 'wake',
  )

  assert.ok(wakes.length >= 3, 'the hold must survive more than one wake')
  assert.ok(
    wakes.every((entry) => entry.terminal_state !== 'completed'),
    'no wake completes while the worker keeps writing under a running report',
  )
  assert.deepEqual(
    wakes.map((entry) => entry.completion_hold),
    wakes.map(() => 'agent_reported_running'),
    'every wake names the running report as the reason it held',
  )
  assert.equal(watched.state, 'unverified')
})

// A stage output that parses and is not a scaffold can still be a document
// mid-assembly. The fields its own invocation declares required are the
// cheapest test of that, and `result` is written last by contract.
test('an output missing a field its invocation declares required is not terminal', async () => {
  const { root, state } = preparedRun()
  const invocation = currentInvocation(root, state)

  writeStageOutput(root, state)

  const complete = read(path.join(root, invocation.output.path)) as Record<
    string,
    unknown
  >

  assert.equal(isTerminalObservation(observeInvocation(root, invocation)), true)

  const { result: _result, ...withoutResult } = complete

  writeFileSync(
    path.join(root, invocation.output.path),
    `${JSON.stringify(withoutResult, null, 2)}\n`,
  )

  const observed = observeInvocation(root, invocation)

  assert.equal(observed.output_parses, true)
  assert.equal(observed.output_is_scaffold, false)
  assert.deepEqual(observed.output_missing_required_fields, ['result'])
  assert.equal(isTerminalObservation(observed), false)

  const declared = Object.keys(invocation.output.required_data ?? {})

  assert.ok(declared.length > 0, 'the fixture stage declares required data')

  const [firstDeclared] = declared
  const withoutDeclared = {
    ...complete,
    data: Object.fromEntries(
      Object.entries((complete.data ?? {}) as Record<string, unknown>).filter(
        ([key]) => key !== firstDeclared?.split('.')[0],
      ),
    ),
  }

  writeFileSync(
    path.join(root, invocation.output.path),
    `${JSON.stringify(withoutDeclared, null, 2)}\n`,
  )

  const missingDeclared = observeInvocation(root, invocation)

  assert.ok(
    missingDeclared.output_missing_required_fields.includes(
      `data.${firstDeclared}`,
    ),
    'the observation names the declared field that is missing',
  )
  assert.equal(isTerminalObservation(missingDeclared), false)
})

// A guard that cannot read its filesystem answer knows less than one that
// can, so it must not report the confident verdict. An unreadable elapsed
// time is the same weak evidence as an output that landed too soon.
test('an unreadable elapsed time holds the observation instead of completing it', () => {
  const { root, state } = preparedRun()
  const invocation = currentInvocation(root, state)

  writeStageOutput(root, state)

  const observed = observeInvocation(root, invocation)

  assert.deepEqual(
    completionEvidenceForObservation(observed, null, CADENCE_SECONDS),
    { strength: 'weak', reason: 'elapsed_time_unreadable' },
  )
  assert.deepEqual(
    completionEvidenceForObservation(
      observed,
      CADENCE_SECONDS * 10,
      CADENCE_SECONDS,
    ),
    { strength: 'strong', basis: 'output_plausible' },
  )
})

// Run 63310 genre-label, post-fix: the supervisor found a `completed` wake,
// opened the output, and discovered it was the scaffold — empty summary,
// attestation `pending`. It recovered, but it had to treat a guaranteed
// condition as a surprise. AUTO-001 makes the worker scaffold its output
// `before_operation`, so every scaffolded stage has a present, parsing,
// invocation-matching output from its first seconds. Presence marks a worker
// that began.
test('the scaffold a worker writes before it starts is not a finished worker', async () => {
  const { root, state, invocationId } = preparedRun()
  const invocation = currentInvocation(root, state)

  writeCanonicalDelegation(root, invocation)
  scaffoldStageOutput(root, invocation, invocation.output.path)

  const scaffolded = observeInvocation(root, invocation)

  assert.equal(scaffolded.output_present, true)
  assert.equal(scaffolded.output_parses, true)
  assert.equal(scaffolded.output_matches_invocation, true)
  assert.equal(scaffolded.output_is_scaffold, true)
  assert.equal(isTerminalObservation(scaffolded), false)

  // Files alone cannot separate a worker still thinking from one that died
  // after scaffolding, so the watch says so instead of guessing either way.
  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallTimeoutSeconds: CADENCE_SECONDS * 2,
  })

  assert.equal(watched.state, 'unverified')
  assert.ok(watched.armings >= 1, 'a scaffold MUST NOT short-circuit the timer')

  const entries = readWatchRecord(root, state.run_id, invocationId)

  assert.ok(
    entries.every((entry) => entry.terminal_state !== 'completed'),
    'no wake over a scaffold may report completed',
  )
})

test('a watch over a scaffold completes once the worker writes its output', async () => {
  const { root, state, invocationId } = preparedRun()
  const invocation = currentInvocation(root, state)

  writeCanonicalDelegation(root, invocation)
  scaffoldStageOutput(root, invocation, invocation.output.path)

  // The worker finishes several cadences in, clear of the window that treats
  // an output landing right after the launch as a draft.
  const finish = setTimeout(
    () => {
      writeStageOutput(root, state)
    },
    CADENCE_SECONDS * 4 * 1000,
  )

  try {
    const watched = await watchInvocation(root, state.run_id, {
      cadenceSeconds: CADENCE_SECONDS,
      // The stall check is exercised separately; this test is about the
      // watch noticing real content replace the scaffold.
      stallWakes: 20,
    })

    assert.equal(watched.state, 'completed')
    assert.ok(watched.wakes >= 1)

    const entries = readWatchRecord(root, state.run_id, invocationId)

    assert.equal(entries.at(-1)?.terminal_state, 'completed')
    assert.equal(entries.at(-1)?.observation?.output_is_scaffold, false)
  } finally {
    clearTimeout(finish)
  }
})

// Run 63310 genre-label: the platform backgrounded three launches, and the
// supervisor armed the watch late twice, each time only after an operator
// reprimand. The marker recorded that a mark happened, never how late, so a
// supervisor that complied and one that had to be told left identical
// evidence. DELEGATE-001 says "immediately"; this is the number that makes
// the word auditable.
test('the background marker records how late supervision was armed', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)
  recordInvocationLaunch(root, state.run_id, invocationId, {
    defaultLaunchedAtMs: Date.now(),
    defaultSource: 'watch_arm',
  })

  const marker = path.join(
    root,
    markDelegationBackground(root, state.run_id, invocationId),
  )
  const record = read(marker) as {
    launched_at: string | null
    launched_at_source: string | null
    mark_delay_seconds: number | null
    late: boolean
  }

  assert.equal(typeof record.launched_at, 'string')
  assert.equal(record.launched_at_source, 'watch_arm')
  assert.equal(typeof record.mark_delay_seconds, 'number')
  assert.equal(record.late, false, 'a mark taken at once is not late')

  // The supervisor names a launch ten minutes back, so the same mark reads
  // as a minute-plus late arming. Only the supervisor can supply that time:
  // the harness never witnessed the launch, which is exactly why it stopped
  // reading a prepare-time artifact's mtime and calling that lateness.
  recordInvocationLaunch(root, state.run_id, invocationId, {
    launchedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    defaultLaunchedAtMs: Date.now(),
    defaultSource: 'watch_arm',
  })
  markDelegationBackground(root, state.run_id, invocationId)

  const summary = summarizeDelegationObservation(
    root,
    state.run_id,
    invocationId,
  )

  assert.equal(summary.watch.background_watch_late, true)
  assert.ok((summary.watch.background_mark_delay_seconds ?? 0) > 60)

  // Late supervision still submits — the work was observed — but the run says so.
  await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  const submitted = submitOutput(root, state.run_id, outputPath)
  const advisory = submitted.advisories.find((item) =>
    item.message.includes('DELEGATION_WATCH_LATE'),
  )

  assert.ok(advisory, 'a late arming MUST be recorded as an advisory')
  assert.equal(advisory.kind, 'delegation_supervision')
  assert.equal(submitted.record.outcome, 'success')
})

// FR-6, run 63310_Aug-30-0872: the implement watch reported `completed` at its
// first wake on a non-scaffold output with no `--agent-state`, while the
// remediation text said completion required one. Files cannot rule out a
// worker still editing, so the record names which of the two a verdict rests
// on instead of presenting both as the same fact.
test('a completed verdict records whether an agent or a file produced it', async () => {
  const inferred = preparedRun()

  writeCanonicalDelegation(
    inferred.root,
    currentInvocation(inferred.root, inferred.state),
  )
  writeStageOutput(inferred.root, inferred.state)

  // A launch ten seconds back makes the output read as landing well after
  // it, which is the case where files alone are allowed to produce a verdict.
  const launched = new Date(Date.now() - 10_000)

  recordInvocationLaunch(
    inferred.root,
    inferred.state.run_id,
    inferred.invocationId,
    {
      launchedAt: launched.toISOString(),
      defaultLaunchedAtMs: Date.now(),
      defaultSource: 'watch_arm',
    },
  )

  const fileVerdict = await watchInvocation(
    inferred.root,
    inferred.state.run_id,
    { cadenceSeconds: CADENCE_SECONDS, stallWakes: 20 },
  )

  assert.equal(fileVerdict.state, 'completed')
  assert.equal(
    readWatchRecord(
      inferred.root,
      inferred.state.run_id,
      inferred.invocationId,
    ).at(-1)?.terminal_basis,
    'output_plausible',
  )

  const attested = preparedRun()

  fillPreparedOutput(attested.root, attested.state)

  const agentVerdict = await watchInvocation(
    attested.root,
    attested.state.run_id,
    { cadenceSeconds: CADENCE_SECONDS, agentState: 'completed' },
  )

  assert.equal(agentVerdict.state, 'completed')
  assert.equal(
    readWatchRecord(
      attested.root,
      attested.state.run_id,
      attested.invocationId,
    ).at(-1)?.terminal_basis,
    'agent_state',
  )
  assert.equal(
    summarizeDelegationObservation(
      attested.root,
      attested.state.run_id,
      attested.invocationId,
    ).watch.terminal_basis,
    'agent_state',
  )
})
