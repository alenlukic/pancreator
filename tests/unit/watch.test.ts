import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation, submitOutput } from '../../src/lib/engine.js'
import { loadState } from '../../src/lib/state.js'
import type { RunState, TaskRecord } from '../../src/lib/types.js'
import {
  DELEGATION_UNOBSERVED,
  backgroundMarkerPath,
  delegationUnobservedMessage,
  foregroundReturnRecordPath,
  markDelegationBackground,
  parseCadenceSeconds,
  readAuthorityOrder,
  readForegroundReturn,
  readWatchRecord,
  recordForegroundReturn,
  redlineRecordPath,
  summarizeDelegationObservation,
  summarizeDelegationWatch,
  watchInvocation,
  watchRecordPath,
  writeRedlineRecord,
} from '../../src/lib/watch.js'
import { delegationExecutionPath } from '../../src/lib/validation.js'
import { loadWorkflowFile, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  createRun,
  makeOutput,
  read,
  writeCanonicalDelegation,
} from '../helpers.js'

// Cadence short enough for a unit test yet above the module floor.
const CADENCE_SECONDS = 0.05

function preparedRun(): {
  root: string
  state: RunState
  invocationId: string
  outputPath: string
} {
  const root = createFixture()
  const created = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const prepared = prepareInvocation(root, created.run_id)

  assert.ok(prepared.invocation)

  return {
    root,
    state: prepared.state,
    invocationId: prepared.invocation.invocation_id,
    outputPath: prepared.invocation.output.path,
  }
}

function writeStageOutput(root: string, state: RunState): void {
  const invocation = read(
    path.join(root, state.current_invocation!.json_path),
  ) as Parameters<typeof makeOutput>[1]
  const workflow = loadWorkflowFile(
    root,
    path.join(root, state.workflow_snapshot.path),
  )
  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, invocation.stage.slug),
    'success',
    state,
  )

  writeFileSync(
    path.join(root, invocation.output.path),
    `${JSON.stringify(output, null, 2)}\n`,
  )
}

test('watch completes when the invocation output appears and records every arming and wake', async () => {
  const { root, state, invocationId } = preparedRun()

  // The output lands after the second wake, so the record shows one unchanged
  // wake before the completing one.
  setTimeout(
    () => writeStageOutput(root, state),
    CADENCE_SECONDS * 2 * 1000 + 20,
  )

  const result = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    stallWakes: 10,
    timeoutSeconds: 5,
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
  let tick = 0
  const churn = setInterval(() => {
    tick += 1
    writeFileSync(
      path.join(evidenceDir, `${state.current_invocation!.id}-progress.log`),
      `tick ${tick}\n`.repeat(tick),
    )
  }, 10)

  try {
    const result = await watchInvocation(root, state.run_id, {
      cadenceSeconds: CADENCE_SECONDS,
      stallWakes: 2,
      timeoutSeconds: CADENCE_SECONDS * 3,
    })

    assert.equal(result.state, 'timed_out')
    assert.ok(result.wakes >= 3)
    assert.ok(result.elapsed_seconds >= CADENCE_SECONDS * 3)
  } finally {
    clearInterval(churn)
  }
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

/** Fill the prepared invocation's output and delegation artifact, unsubmitted. */
function fillPreparedOutput(root: string, state: RunState): string {
  const invocation = read(
    path.join(root, state.current_invocation!.json_path),
  ) as Parameters<typeof makeOutput>[1]

  writeStageOutput(root, state)
  writeCanonicalDelegation(root, invocation)

  return invocation.output.path
}

test('submit refuses with DELEGATION_UNOBSERVED when neither a watch record nor a foreground attestation exists', () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)

  const observation = summarizeDelegationObservation(
    root,
    state.run_id,
    invocationId,
  )

  assert.equal(observation.observed, false)
  assert.equal(observation.source, null)
  assert.throws(
    () => submitOutput(root, state.run_id, outputPath),
    (error: unknown) => {
      const failure = error as { code?: string; message: string }

      assert.equal(failure.code, DELEGATION_UNOBSERVED)
      assert.match(failure.message, /^DELEGATION_UNOBSERVED: invocation /u)
      assert.match(failure.message, /no watch record exists at /u)
      assert.match(failure.message, /--foreground-returned --invocation /u)

      return true
    },
  )

  // A supervisor-owned precondition rejects outright; no attempt is spent.
  const after = loadState(root, state.run_id)

  assert.equal(after.status, 'running')
  assert.equal(after.stage_history.length, 0)
  assert.equal(after.current_invocation?.id, invocationId)
})

test('submit refuses a background-marked launch whose watch never completed', () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)
  markDelegationBackground(root, state.run_id, invocationId)

  assert.throws(
    () => submitOutput(root, state.run_id, outputPath),
    (error: unknown) => {
      const failure = error as { code?: string; message: string }

      assert.equal(failure.code, DELEGATION_UNOBSERVED)
      assert.match(failure.message, /marked as a background subagent/u)

      return true
    },
  )
})

test('a foreground-return attestation records launch and return times and satisfies submit', () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)

  const record = recordForegroundReturn(root, state.run_id, {
    invocationId,
  })

  assert.equal(record.launch_mode, 'foreground')
  assert.equal(record.launched_at_source, 'delegation_artifact')
  assert.ok(Date.parse(record.launched_at) <= Date.parse(record.returned_at))
  assert.ok(record.elapsed_seconds >= 0)
  assert.equal(record.observation.output_present, true)
  assert.equal(record.observation.output_matches_invocation, true)
  assert.ok(
    existsSync(
      path.join(
        root,
        foregroundReturnRecordPath(root, state.run_id, invocationId),
      ),
    ),
  )
  assert.deepEqual(
    readForegroundReturn(root, state.run_id, invocationId),
    record,
  )

  const submitted = submitOutput(root, state.run_id, outputPath)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(
    submitted.record.delegation_observation?.source,
    'foreground_return',
  )
  assert.equal(
    submitted.record.delegation_observation?.foreground_return?.launched_at,
    record.launched_at,
  )
  assert.equal(
    submitted.record.delegation_observation?.foreground_return?.returned_at,
    record.returned_at,
  )
  assert.equal(submitted.record.delegation_observation?.watch, undefined)

  const persisted = read(
    path.join(
      root,
      loadState(root, state.run_id).stage_history[0].record_path!,
    ),
  ) as TaskRecord

  assert.equal(persisted.delegation_observation?.source, 'foreground_return')
})

test('a foreground-return attestation accepts a supervisor-recorded launch time and rejects one after the return', () => {
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const launchedAt = '2026-08-29T00:00:00.000Z'
  const record = recordForegroundReturn(root, state.run_id, {
    invocationId,
    launchedAt,
  })

  assert.equal(record.launched_at, launchedAt)
  assert.equal(record.launched_at_source, 'supervisor')
  assert.ok(record.elapsed_seconds > 0)
  assert.throws(
    () =>
      recordForegroundReturn(root, state.run_id, {
        invocationId,
        launchedAt: '2999-01-01T00:00:00.000Z',
      }),
    /is after the return time/u,
  )
  assert.throws(
    () =>
      recordForegroundReturn(root, state.run_id, {
        invocationId,
        launchedAt: 'yesterday',
      }),
    /--launched-at MUST be an ISO-8601 wall-clock time/u,
  )
})

test('submit carries a completed watch record into the stage record without an attestation', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)
  markDelegationBackground(root, state.run_id, invocationId)

  // The output lands in the same instant as the launch, so the completion is
  // only credible because the supervisor inspected the agent behind it.
  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  assert.equal(watched.state, 'completed')

  const submitted = submitOutput(root, state.run_id, outputPath)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(
    submitted.record.delegation_observation?.source,
    'watch_completed',
  )
  assert.equal(
    submitted.record.delegation_observation?.watch?.terminal_state,
    'completed',
  )
  assert.equal(
    submitted.record.delegation_observation?.watch?.background_marked,
    true,
  )
  assert.equal(
    submitted.record.delegation_observation?.foreground_return,
    undefined,
  )

  const persisted = read(
    path.join(
      root,
      loadState(root, state.run_id).stage_history[0].record_path!,
    ),
  ) as TaskRecord

  assert.equal(
    persisted.delegation_observation?.watch?.terminal_state,
    'completed',
  )
})

test('the redline record names the non-authoritative categories and the AGENTS.md authority order', () => {
  const { root, state } = preparedRun()

  const first = writeRedlineRecord(root, state.run_id, 'pan-start')
  const second = writeRedlineRecord(root, state.run_id, 'pan-resume')
  const recordPath = redlineRecordPath(root, state.run_id)

  assert.equal(first.record_path, recordPath)
  assert.ok(existsSync(path.join(root, recordPath)))
  // `createRun` wrote the session's first declaration when it attested.
  assert.equal(second.declarations.length, 3)
  assert.deepEqual(
    second.declarations.map((item) => item.occasion),
    ['pan-start', 'pan-start', 'pan-resume'],
  )
  assert.deepEqual(
    second.non_authoritative_guidance.map((item) => item.id),
    [
      'polling_await_background',
      'session_mode',
      'model_tool_suggestions',
      'command_execution_hints',
    ],
  )
  assert.deepEqual(second.policy_basis, [
    'OPERATOR-001',
    'DELEGATE-001',
    'ORCH-001',
  ])
  assert.ok(second.authority_order.length >= 5)
  assert.match(second.authority_order[0], /operator directive/u)

  const events = readFileSync(
    path.join(
      root,
      'runtime',
      'logs',
      'workflows',
      state.run_id,
      'agent',
      'events.jsonl',
    ),
    'utf8',
  )

  assert.equal(
    events
      .split('\n')
      .filter((line) => line.includes('platform_guidance_redline_recorded'))
      .length,
    3,
  )
})

test('the authority order is read from the repository AGENTS.md', () => {
  const order = readAuthorityOrder(process.cwd())

  assert.deepEqual(order, [
    'An explicit operator directive.',
    'The active invocation or standalone governance card.',
    'This operating card.',
    'The run snapshots.',
    'The policies resolved for the active context.',
  ])
})

test('a foreground-return attestation is refused until the output exists, and records a malformed output for submit to judge', () => {
  const { root, state, invocationId, outputPath } = preparedRun()
  const recordPath = path.join(
    root,
    foregroundReturnRecordPath(root, state.run_id, invocationId),
  )

  // Nothing written yet: the launch returned before the output existed.
  assert.throws(
    () => recordForegroundReturn(root, state.run_id, { invocationId }),
    (error: unknown) => {
      const failure = error as { code?: string; message: string }

      assert.equal(failure.code, 'FOREGROUND_RETURN_NOT_TERMINAL')
      assert.match(failure.message, /does not exist/u)
      assert.match(failure.message, /await `pan watch <run-id>` instead/u)

      return true
    },
  )
  assert.equal(existsSync(recordPath), false)

  assert.equal(
    summarizeDelegationObservation(root, state.run_id, invocationId).observed,
    false,
  )

  // A malformed output is still a returned worker. The attestation records
  // what it saw; submit judges the output and can fail it.
  writeFileSync(path.join(root, outputPath), 'not json\n')

  const record = recordForegroundReturn(root, state.run_id, { invocationId })

  assert.equal(record.observation.output_present, true)
  assert.equal(record.observation.output_parses, false)
  assert.equal(record.observation.output_matches_invocation, false)
  assert.equal(existsSync(recordPath), true)
  assert.equal(
    summarizeDelegationObservation(root, state.run_id, invocationId).source,
    'foreground_return',
  )
})

test('an attestation that recorded no output present does not satisfy submit', () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)

  // A hand-written or legacy record whose observation was not terminal.
  writeFileSync(
    path.join(
      root,
      foregroundReturnRecordPath(root, state.run_id, invocationId),
    ),
    JSON.stringify({
      schema_version: 1,
      run_id: state.run_id,
      invocation_id: invocationId,
      launch_mode: 'foreground',
      launched_at: '2026-08-29T00:00:00.000Z',
      launched_at_source: 'supervisor',
      returned_at: '2026-08-29T00:00:01.000Z',
      elapsed_seconds: 1,
      observation: {
        observed_at: '2026-08-29T00:00:01.000Z',
        output_path: outputPath,
        output_present: false,
        output_parses: false,
        output_matches_invocation: false,
        watched_paths: [],
        fingerprint: '',
      },
      watch_record_path: watchRecordPath(root, state.run_id, invocationId),
      recorded_at: '2026-08-29T00:00:01.000Z',
    }),
  )

  const observation = summarizeDelegationObservation(
    root,
    state.run_id,
    invocationId,
  )

  assert.equal(observation.foreground_return.record_present, true)
  assert.equal(observation.foreground_return.output_present_at_return, false)
  assert.equal(observation.observed, false)
  assert.throws(
    () => submitOutput(root, state.run_id, outputPath),
    (error: unknown) => {
      const failure = error as { code?: string; message: string }

      assert.equal(failure.code, DELEGATION_UNOBSERVED)
      assert.match(failure.message, /recorded no output present at return/u)

      return true
    },
  )
})

test('the external-executor exemption requires the delegation-execution record pan delegate writes', () => {
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const without = summarizeDelegationObservation(
    root,
    state.run_id,
    invocationId,
    { externalExecutor: true },
  )

  assert.equal(without.observed, false)
  assert.equal(without.source, null)
  assert.equal(without.execution_record_present, false)
  assert.equal(
    without.execution_record_path,
    delegationExecutionPath(state.run_id, invocationId, root),
  )

  const unobserved = await_message(without)

  assert.match(unobserved, /no execution record exists at /u)
  assert.match(unobserved, /`pan delegate` did not run this worker/u)

  // A record for another invocation does not count.
  const recordPath = path.join(
    root,
    delegationExecutionPath(state.run_id, invocationId, root),
  )

  writeFileSync(
    recordPath,
    JSON.stringify({
      schema_version: 1,
      run_id: state.run_id,
      invocation_id: 'another-invocation',
      stage: 'plan',
      executor: 'claude-code',
      delegation_kind: 'fresh',
      binary: 'claude',
      argv: [],
      exit_code: 0,
      timed_out: false,
      duration_ms: 1,
      stdout_path: 'x',
      stderr_path: 'y',
    }),
  )
  assert.equal(
    summarizeDelegationObservation(root, state.run_id, invocationId, {
      externalExecutor: true,
    }).observed,
    false,
  )

  writeFileSync(
    recordPath,
    JSON.stringify({
      schema_version: 1,
      run_id: state.run_id,
      invocation_id: invocationId,
      stage: 'plan',
      executor: 'claude-code',
      delegation_kind: 'fresh',
      binary: 'claude',
      argv: [],
      exit_code: 0,
      timed_out: false,
      duration_ms: 1,
      stdout_path: 'x',
      stderr_path: 'y',
    }),
  )

  const withRecord = summarizeDelegationObservation(
    root,
    state.run_id,
    invocationId,
    { externalExecutor: true },
  )

  assert.equal(withRecord.observed, true)
  assert.equal(withRecord.source, 'external_executor')
  assert.equal(withRecord.execution_record_present, true)
})

function await_message(
  observation: ReturnType<typeof summarizeDelegationObservation>,
): string {
  return delegationUnobservedMessage(observation, 'pan', 'run', 'invocation')
}

// Run 63310 genre-label: the worker wrote a 2 KB output 35 seconds after
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

test('the supervisor inspecting the agent is what makes an early output submittable', async () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  fillPreparedOutput(root, state)
  markDelegationBackground(root, state.run_id, invocationId)

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  assert.equal(watched.state, 'completed')

  const entries = readWatchRecord(root, state.run_id, invocationId)

  assert.equal(entries.at(-1)?.agent_state, 'completed')
  assert.equal(
    submitOutput(root, state.run_id, outputPath).record.outcome,
    'success',
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

  // The output is present, so the first wake ends it — but it cost an arming,
  // which is the difference between a watch and a file stat.
  assert.equal(watched.state, 'completed')
  assert.ok(watched.armings >= 1)
})
