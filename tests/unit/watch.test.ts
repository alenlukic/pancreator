import assert from 'node:assert/strict'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { submitOutput } from '../../src/lib/engine.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import {
  DELEGATION_UNOBSERVED,
  backgroundMarkerPath,
  isTerminalObservation,
  markDelegationBackground,
  observeInvocation,
  parseCadenceSeconds,
  readWatchRecord,
  summarizeDelegationObservation,
  summarizeDelegationWatch,
  watchInvocation,
  watchRecordPath,
} from '../../src/lib/watch.js'
import { delegationPath } from '../../src/lib/validation.js'
import { read, writeCanonicalDelegation } from '../helpers.js'
import {
  CADENCE_SECONDS,
  fakeClock,
  fillPreparedOutput,
  preparedRun,
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
  // Whole milliseconds on the fake clock: 300 ms, not 0.1 * 3 in floating point.
  assert.ok(result.elapsed_seconds >= 0.3)
})

test('watch returns completed at once for an output already present and stays idempotent', async () => {
  const { root, state, invocationId } = preparedRun()

  writeStageOutput(root, state)

  const first = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
  })
  const second = await watchInvocation(root, state.run_id, {
    invocationId,
    cadenceSeconds: CADENCE_SECONDS,
  })

  assert.equal(first.state, 'completed')
  assert.equal(first.wakes, 0)
  assert.equal(second.state, 'completed')

  const entries = readWatchRecord(root, state.run_id, invocationId)

  assert.equal(entries.length, 2)
  assert.ok(entries.every((entry) => entry.terminal_state === 'completed'))
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

  const marker = read(path.join(root, result.background_marker_path!)) as {
    launch_mode: string
    watch_record_path: string
  }

  assert.equal(marker.launch_mode, 'background')
  assert.equal(marker.watch_record_path, result.record_path)
})

test('cadence accepts fractional seconds and rejects a busy loop', () => {
  assert.equal(parseCadenceSeconds('0.1'), 0.1)
  assert.equal(parseCadenceSeconds('300'), 300)
  assert.equal(parseCadenceSeconds(null), 120)
  assert.throws(() => parseCadenceSeconds('0'), /at least/u)
  assert.throws(() => parseCadenceSeconds('abc'), /at least/u)
})

// launch and kept rewriting it for another seven minutes. `pan watch` read the
// file, called it terminal, and returned with no armings, so the supervisor
// submitted a stage whose worker was still running. Presence is not
// completion, and only the supervisor can see the agent behind the file.
test('a background launch whose output lands too soon after it records unverified', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)
  markDelegationBackground(root, state.run_id, invocationId)

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
  })

  assert.equal(watched.state, 'unverified')
  assert.equal(watched.armings, 0)

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
  const invocation = read(
    path.join(root, state.current_invocation!.json_path),
  ) as Parameters<typeof scaffoldStageOutput>[1]

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
  const invocation = read(
    path.join(root, state.current_invocation!.json_path),
  ) as Parameters<typeof scaffoldStageOutput>[1]

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

  const marker = path.join(
    root,
    markDelegationBackground(root, state.run_id, invocationId),
  )
  const record = read(marker) as {
    launched_at: string | null
    mark_delay_seconds: number | null
    late: boolean
  }

  assert.equal(typeof record.launched_at, 'string')
  assert.equal(typeof record.mark_delay_seconds, 'number')
  assert.equal(record.late, false, 'a mark taken at once is not late')

  // Backdate the launch so the same mark reads as a minute-plus late arming.
  const backdated = new Date(Date.parse(record.launched_at!) - 10 * 60 * 1000)

  utimesSync(
    path.join(root, delegationPath(state.run_id, invocationId, root)),
    backdated,
    backdated,
  )
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
    read(
      path.join(inferred.root, inferred.state.current_invocation!.json_path),
    ) as Parameters<typeof scaffoldStageOutput>[1],
  )
  writeStageOutput(inferred.root, inferred.state)

  // Backdate the launch so the output reads as landing well after it, which
  // is the case where files alone are allowed to produce a verdict.
  const launched = new Date(Date.now() - 10_000)

  utimesSync(
    path.join(
      inferred.root,
      delegationPath(
        inferred.state.run_id,
        inferred.invocationId,
        inferred.root,
      ),
    ),
    launched,
    launched,
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
