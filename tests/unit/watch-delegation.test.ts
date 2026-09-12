import assert from 'node:assert/strict'
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { submitOutput } from '../../src/lib/engine.js'
import { loadState } from '../../src/lib/state.js'
import type { TaskRecord } from '../../src/lib/types.js'
import {
  DELEGATION_UNOBSERVED,
  foregroundReturnRecordPath,
  markDelegationBackground,
  readForegroundReturn,
  recordForegroundReturn,
  redlineRecordPath,
  summarizeDelegationObservation,
  watchInvocation,
  watchRecordPath,
  writeRedlineRecord,
} from '../../src/lib/watch.js'
import { delegationExecutionPath } from '../../src/lib/validation.js'
import { read } from '../helpers.js'
import {
  CADENCE_SECONDS,
  await_message,
  fillPreparedOutput,
  preparedRun,
} from './watch-helpers.js'

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

  // Marking the launch background reaches the same refusal by the same path
  // and only adds one sentence, so it is an assertion here rather than a run
  // of its own.
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

  // readAuthorityOrder parses the numbered list under this heading and falls
  // back to a built-in order when the heading is absent. The fixture AGENTS.md
  // carries no such section, so an assertion written against the shipped order
  // would pass on the fallback constant without ever reaching the parser. The
  // rows below are deliberately unlike the fallback for that reason.
  appendFileSync(
    path.join(root, 'AGENTS.md'),
    [
      '## Authority and context',
      '',
      '1. A fixture operator directive.',
      '2. The fixture invocation card.',
      '3. The fixture operating card.',
      '4. The fixture run snapshots.',
      '5. The fixture resolved policies.',
      '',
      '## Fixture appendix',
      '',
      '1. A numbered row outside the section MUST NOT join the order.',
      '',
    ].join('\n'),
  )

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
  assert.deepEqual(second.authority_order, [
    'A fixture operator directive.',
    'The fixture invocation card.',
    'The fixture operating card.',
    'The fixture run snapshots.',
    'The fixture resolved policies.',
  ])

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
