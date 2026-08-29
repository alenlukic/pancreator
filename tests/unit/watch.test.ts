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

  const watched = await watchInvocation(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
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
  assert.equal(second.declarations.length, 2)
  assert.deepEqual(
    second.declarations.map((item) => item.occasion),
    ['pan-start', 'pan-resume'],
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
    2,
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
