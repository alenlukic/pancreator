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

import { operationMutexPath } from '../../src/lib/state.js'
import {
  DEFAULT_WATCH_CADENCE_SECONDS,
  backgroundMarkerPath,
  blockedOutputSnapshotPath,
  observeInvocation,
  parseCadenceSeconds,
  readLaunchRecord,
  readWatchRecord,
  recordInvocationLaunch,
  summarizeDelegationWatch,
  watchInvocation,
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
  writeAgentStateEvidence,
  writeStageOutput,
} from './watch-helpers.js'

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
    agentStateEvidence: writeAgentStateEvidence(root, state, invocationId),
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
  const evidence = writeAgentStateEvidence(root, state, invocationId)

  await watchInvocation(root, state.run_id, {
    agentState: 'completed',
    agentStateEvidence: evidence,
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
    agentStateEvidence: evidence,
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

  const old = preparedRun()
  const armedMs = Date.now() - 300_000

  recordInvocationLaunch(old.root, old.state.run_id, old.invocationId, {
    defaultLaunchedAtMs: armedMs,
    defaultSource: 'watch_arm',
  })
  writeStageOutput(old.root, old.state)
  await watchInvocation(old.root, old.state.run_id, {
    markBackground: true,
    agentState: 'completed',
    agentStateEvidence: writeAgentStateEvidence(
      old.root,
      old.state,
      old.invocationId,
    ),
  })

  const lateMarker = JSON.parse(
    readFileSync(
      path.join(
        old.root,
        backgroundMarkerPath(old.root, old.state.run_id, old.invocationId),
      ),
      'utf8',
    ),
  ) as {
    mark_delay_seconds: number
    mark_delay_basis: string
    late: boolean
  }

  // Without an evidenced platform return the delay stays a labeled numerical
  // fallback: launch latency and supervisor delay cannot be separated, so the
  // number is recorded and no lateness is attributed.
  assert.ok(lateMarker.mark_delay_seconds >= 300)
  assert.equal(lateMarker.mark_delay_basis, 'launch_unattributed')
  assert.equal(lateMarker.late, false)
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
    agentStateEvidence: writeAgentStateEvidence(root, state, invocationId),
  })

  const record = readLaunchRecord(root, state.run_id, invocationId)

  assert.equal(record?.launched_at, launchedAt)
  assert.equal(record?.launched_at_source, 'supervisor')
  assert.equal(record?.launch_mode, 'background')

  const summary = summarizeDelegationWatch(root, state.run_id, invocationId)

  // The launch-relative delay is still recorded, but with no evidenced
  // platform return it cannot be attributed: the platform's own launch
  // latency is not the supervisor's delay.
  assert.equal(summary.background_watch_late, false)
  assert.equal(summary.background_mark_delay_basis, 'launch_unattributed')
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
  const authority = 'operator directed a fast cadence for this repair'

  assert.equal(parseCadenceSeconds('0.1', authority), 0.1)
  assert.equal(parseCadenceSeconds('90', authority), 90)
  assert.equal(parseCadenceSeconds(null), DEFAULT_WATCH_CADENCE_SECONDS)
  assert.throws(() => parseCadenceSeconds('0', authority), /at least/u)
  assert.throws(() => parseCadenceSeconds('abc', authority), /number/u)
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
    agentStateEvidence: writeAgentStateEvidence(root, state, invocationId),
  })

  assert.equal(result.state, 'completed')
  assert.equal(result.cadence_seconds, 60)
  assert.equal(
    readWatchRecord(root, state.run_id, invocationId).at(-1)?.cadence_seconds,
    60,
  )
})
