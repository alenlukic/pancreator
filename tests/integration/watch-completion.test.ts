import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { submitOutput } from '../../src/lib/engine.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import {
  DELEGATION_UNOBSERVED,
  completionEvidenceForObservation,
  isTerminalObservation,
  markDelegationBackground,
  observeInvocation,
  readWatchRecord,
  recordInvocationLaunch,
  summarizeDelegationObservation,
  watchInvocation,
} from '../../src/lib/watch.js'
import { read, writeCanonicalDelegation } from '../helpers.js'
import {
  CADENCE_SECONDS,
  currentInvocation,
  fillPreparedOutput,
  preparedRun,
  stillWritingClock,
  writeAgentStateEvidence,
  writeStageOutput,
} from './watch-helpers.js'

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
  const wakes = entries.filter((entry) => entry.event === 'wake')
  const terminal = entries.filter((entry) => entry.terminal_state !== undefined)

  assert.equal(terminal.length, 2, 'each watch records one terminal verdict')
  assert.ok(terminal.every((entry) => entry.terminal_state === 'completed'))
  assert.ok(
    terminal.every((entry) => entry.terminal_basis === 'confirming_wake'),
  )
  assert.equal(
    wakes[0]?.completion_hold,
    'output_younger_than_cadence',
    'the held observation names why it was held',
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
  const heldWakes = entries.filter((entry) => entry.event === 'wake')

  assert.equal(heldWakes[0]?.terminal_state, undefined)
  assert.equal(heldWakes[0]?.completion_hold, 'output_younger_than_cadence')
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
  const runningWakes = entries.filter((entry) => entry.event === 'wake')

  assert.ok(entries.some((entry) => entry.event === 'armed'))
  assert.notEqual(runningWakes[0]?.terminal_state, 'completed')
  assert.equal(runningWakes[0]?.completion_hold, 'agent_reported_running')
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
test('the background marker records the supervision delay with its basis', async () => {
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
    mark_delay_basis: string
    late: boolean
  }

  assert.equal(typeof record.launched_at, 'string')
  assert.equal(record.launched_at_source, 'watch_arm')
  assert.equal(typeof record.mark_delay_seconds, 'number')
  assert.equal(record.late, false, 'a mark taken at once is not late')

  // The supervisor names a launch ten minutes back. Without an evidenced
  // platform return the delay stays a labeled fallback: the number is kept,
  // and no lateness is attributed to anyone.
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

  assert.equal(summary.watch.background_watch_late, false)
  assert.equal(summary.watch.background_mark_delay_basis, 'launch_unattributed')
  assert.ok((summary.watch.background_mark_delay_seconds ?? 0) > 60)

  // Unattributed delay still submits — the work was observed — and no
  // lateness advisory fires without the platform's return clock.
  await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
    agentStateEvidence: writeAgentStateEvidence(root, state, invocationId),
  })

  const submitted = submitOutput(root, state.run_id, outputPath)

  assert.equal(
    submitted.advisories.some((item) =>
      item.message.includes('DELEGATION_WATCH_LATE'),
    ),
    false,
    'a launch-only delay is never attributed as late supervision',
  )
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
    {
      cadenceSeconds: CADENCE_SECONDS,
      agentState: 'completed',
      // The attested basis rests on the recorded inspection the supervisor
      // supplies; without it the same report buys a confirming wake.
      agentStateEvidence: writeAgentStateEvidence(
        attested.root,
        attested.state,
        attested.invocationId,
      ),
    },
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
