import assert from 'node:assert/strict'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { submitOutput } from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import {
  DELEGATION_WATCH_LATE,
  DELEGATION_WATCH_LOW_COVERAGE,
  backgroundMarkerPath,
  markDelegationBackground,
  readLaunchRecord,
  readWatchRecord,
  recordInvocationLaunch,
  summarizeDelegationWatch,
  watchInvocation,
  watchRecordPath,
} from '../../src/lib/watch.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import { read } from '../helpers.js'
import {
  CADENCE_SECONDS,
  currentInvocation,
  fakeClock,
  fillPreparedOutput,
  preparedRun,
  stillWritingClock,
  writeAgentStateEvidence,
} from './watch-helpers.js'
import { ledgerEntry, seedLedger } from './watch-repair-helpers.js'

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
