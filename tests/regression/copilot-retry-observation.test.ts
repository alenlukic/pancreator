import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { assertWorkerNotStillActive } from '../../src/lib/engine/submit-checks.js'
import {
  delegationLivePaths,
  delegationCustodyDirectory,
  type DelegationLiveRecord,
} from '../../src/lib/executors/delegation-live.js'
import {
  readJson,
  readText,
  writeJsonAtomic,
  writeTextAtomic,
  fileExists,
} from '../../src/lib/io.js'
import { loadState } from '../../src/lib/state.js'
import type { Invocation, StageDefinition } from '../../src/lib/types.js'
import { delegationExecutionPath } from '../../src/lib/validation/artifacts.js'
import { executorProcessActivity } from '../../src/lib/watch/executor-process.js'
import {
  readLaunchRecord,
  recordInvocationLaunch,
} from '../../src/lib/watch/launch.js'
import { multiplexedTargets } from '../integration/watch-helpers.js'

function fixture(
  options: { declared?: boolean; ended?: boolean; closedWatch?: boolean } = {},
) {
  const { root, targets } = multiplexedTargets(1)
  const target = targets[0]!
  const invocationPath = target.layout.invocation(
    target.invocationId,
    '.json',
  ).absolute
  const invocation = readJson(invocationPath) as Invocation
  const base = Date.now() - 20_000
  const iso = (offset: number) => new Date(base + offset).toISOString()
  invocation.created_at = iso(-1000)
  invocation.stage.persona_executor = 'copilot'
  writeJsonAtomic(invocationPath, invocation)
  const prior: DelegationLiveRecord = {
    schema_version: 1,
    executor: 'copilot',
    run_id: invocation.run_id,
    invocation_id: invocation.invocation_id,
    role: 'stage',
    attempt: invocation.attempt,
    launch_id: 'prior-launch',
    launched_at: iso(0),
    heartbeat_at: iso(1000),
    relay_pid: process.pid,
    relay_start_identity: null,
    child_pid: process.pid,
    child_start_identity: null,
    sequence: 1,
    stream_sequences: { stdout: 1, stderr: 0 },
    truncated: false,
    session_id: 'prior-session',
    ...(options.ended === false
      ? {}
      : { child_ended_at: iso(1000), ended_at: iso(1000), exit_code: 1 }),
  }
  const retry: DelegationLiveRecord = {
    ...prior,
    launch_id: 'retry-launch',
    launched_at: iso(3000),
    heartbeat_at: iso(4000),
    child_ended_at: iso(4000),
    ended_at: iso(4000),
    exit_code: 0,
    session_id: 'retry-session',
  }
  const authorityDirectory = delegationCustodyDirectory(root, {
    run_id: invocation.run_id,
    invocation_id: invocation.invocation_id,
  })

  for (const live of [prior, retry]) {
    const publicPath = delegationLivePaths(root, live).record
    writeJsonAtomic(publicPath, live)
    writeJsonAtomic(
      path.join(authorityDirectory, path.basename(publicPath)),
      live,
    )
  }
  const state = loadState(root, invocation.run_id)
  const first = {
    invocation_id: invocation.invocation_id,
    role: 'worker',
    attempt: 1,
    handle: 'host-prior',
    launched_at: iso(0),
    launch_mode: 'background' as const,
    declared_paths: [invocation.output.path],
  }
  state.delegated_workers = [
    first,
    ...(options.declared === false
      ? []
      : [
          {
            ...first,
            attempt: 2,
            handle: 'host-retry',
            launched_at: iso(3000),
          },
        ]),
  ]
  writeJsonAtomic(target.layout.state.absolute, state)
  const launchPath = target.layout.evidence(
    `${invocation.invocation_id}-launch.json`,
  ).absolute
  writeJsonAtomic(launchPath, {
    schema_version: 1,
    run_id: invocation.run_id,
    invocation_id: invocation.invocation_id,
    launch_mode: 'background',
    launched_at: iso(0),
    launched_at_source: 'watch_arm',
    worker_handle: 'host-prior',
    executor_launch_id: prior.launch_id,
    recorded_at: iso(0),
  })
  const ledger = target.layout.evidence(
    `${invocation.invocation_id}-watch.jsonl`,
  ).absolute
  writeTextAtomic(
    ledger,
    `${JSON.stringify({ schema_version: 1, event: 'wake', terminal_state: options.closedWatch === false ? undefined : 'unverified' })}\n`,
  )
  writeJsonAtomic(
    path.join(
      root,
      delegationExecutionPath(
        invocation.run_id,
        invocation.invocation_id,
        root,
      ),
    ),
    {
      schema_version: 1,
      run_id: invocation.run_id,
      invocation_id: invocation.invocation_id,
      stage: invocation.stage.slug,
      executor: 'copilot',
      exit_code: 0,
      timed_out: false,
      is_error: false,
      session_id: retry.session_id,
      recorded_at: iso(5000),
    },
  )
  return { root, target, invocation, prior, retry, ledger, iso }
}

test('happy_path: declared retry retains the prior observation and accepts its own final audit', () => {
  const value = fixture()
  const { root, invocation, target } = value
  const priorLedger = readText(value.ledger)
  const launch = recordInvocationLaunch(
    root,
    invocation.run_id,
    invocation.invocation_id,
    {
      workerHandle: 'host-retry',
      defaultLaunchedAtMs: Date.now(),
      defaultSource: 'watch_arm',
    },
  )
  assert.equal(launch.worker_handle, 'host-retry')
  assert.equal(launch.launched_at, value.iso(3000))
  const archive = target.layout.evidence(
    `${invocation.invocation_id}-worker-attempt-1`,
  ).absolute
  assert.equal(
    readText(path.join(archive, path.basename(value.ledger))),
    priorLedger,
  )
  assert.equal(fileExists(value.ledger), false)
  const archivedLaunch = readJson(
    path.join(archive, `${invocation.invocation_id}-launch.json`),
  )
  assert.ok(
    typeof archivedLaunch === 'object' &&
      archivedLaunch !== null &&
      'executor_launch_id' in archivedLaunch,
  )
  assert.equal(archivedLaunch.executor_launch_id, value.prior.launch_id)
  assert.doesNotThrow(() =>
    assertWorkerNotStillActive(root, invocation, 'copilot', {
      persona: 'coder',
    } as StageDefinition),
  )
  assert.equal(
    readLaunchRecord(root, invocation.run_id, invocation.invocation_id)
      ?.executor_launch_id,
    value.retry.launch_id,
  )
  const rearmed = recordInvocationLaunch(
    root,
    invocation.run_id,
    invocation.invocation_id,
    {
      workerHandle: 'host-retry',
      defaultLaunchedAtMs: Date.now(),
      defaultSource: 'watch_arm',
    },
  )
  assert.equal(rearmed.launched_at, launch.launched_at)
  assert.throws(
    () =>
      recordInvocationLaunch(
        root,
        invocation.run_id,
        invocation.invocation_id,
        {
          workerHandle: 'unregistered-handle',
          defaultLaunchedAtMs: Date.now(),
          defaultSource: 'watch_arm',
        },
      ),
    { code: 'WATCH_LAUNCH_IDENTITY_MISMATCH' },
  )
})

test('hidden_edge_case: submission recovers an already recorded retry without a preceding watch call', () => {
  const { root, invocation } = fixture()
  const activity = executorProcessActivity(root, invocation, Date.now())
  assert.equal(activity?.stop?.status, 'completed')
  assert.equal(
    readLaunchRecord(root, invocation.run_id, invocation.invocation_id)
      ?.worker_handle,
    'host-retry',
  )
})

test('critical_unhappy_path: undeclared, running or still-observed predecessors cannot replace a pinned identity', () => {
  for (const options of [
    { declared: false },
    { ended: false },
    { closedWatch: false },
  ]) {
    const { root, invocation, prior, iso } = fixture(options)

    if (options.ended === false) {
      writeJsonAtomic(delegationLivePaths(root, prior).record, {
        ...prior,
        child_ended_at: iso(1000),
        ended_at: iso(1000),
        exit_code: 1,
      })
    }

    assert.throws(
      () =>
        recordInvocationLaunch(
          root,
          invocation.run_id,
          invocation.invocation_id,
          {
            workerHandle: 'host-retry',
            defaultLaunchedAtMs: Date.now(),
            defaultSource: 'watch_arm',
          },
        ),
      { code: 'WATCH_LAUNCH_IDENTITY_MISMATCH' },
    )
    assert.equal(
      executorProcessActivity(root, invocation, Date.now())?.stop ?? null,
      null,
    )
    assert.equal(
      readLaunchRecord(root, invocation.run_id, invocation.invocation_id)
        ?.executor_launch_id,
      prior.launch_id,
    )
  }
})

function controllerFixture(
  options: { ended?: boolean; foreign?: boolean } = {},
) {
  const value = fixture(
    options.ended === false
      ? { declared: false, ended: false }
      : { declared: false },
  )
  const wrapper = 'runtime/logs/shell/20261016T000000Z-copilot-watch'
  value.prior.wrapper_record_path = wrapper
  value.retry.wrapper_record_path = options.foreign
    ? `${wrapper}-other`
    : wrapper
  const authority = delegationCustodyDirectory(value.root, {
    run_id: value.invocation.run_id,
    invocation_id: value.invocation.invocation_id,
  })

  for (const live of [value.prior, value.retry]) {
    const publicPath = delegationLivePaths(value.root, live).record
    writeJsonAtomic(publicPath, live)
    writeJsonAtomic(path.join(authority, path.basename(publicPath)), live)
  }
  return value
}

test('happy_path: protected sequential regrading follows the same controller without replacing its host pin', () => {
  const { root, invocation, prior } = controllerFixture()
  assert.equal(
    executorProcessActivity(root, invocation, Date.now())?.stop?.status,
    'completed',
  )
  assert.equal(
    readLaunchRecord(root, invocation.run_id, invocation.invocation_id)
      ?.executor_launch_id,
    prior.launch_id,
  )
})

test('critical_unhappy_path: controller rollover rejects overlapping children and unrelated wrappers', () => {
  for (const options of [{ ended: false }, { foreign: true }]) {
    const { root, invocation } = controllerFixture(options)
    assert.equal(
      executorProcessActivity(root, invocation, Date.now())?.stop ?? null,
      null,
    )
  }
})

test('hidden_edge_case: a stale audit or changed public mirror cannot complete a protected regrade', () => {
  const stale = controllerFixture()
  writeJsonAtomic(
    path.join(
      stale.root,
      delegationExecutionPath(
        stale.invocation.run_id,
        stale.invocation.invocation_id,
        stale.root,
      ),
    ),
    {
      schema_version: 1,
      run_id: stale.invocation.run_id,
      invocation_id: stale.invocation.invocation_id,
      stage: stale.invocation.stage.slug,
      executor: 'copilot',
      exit_code: 0,
      timed_out: false,
      session_id: stale.prior.session_id,
      recorded_at: stale.iso(1000),
    },
  )
  assert.equal(
    executorProcessActivity(stale.root, stale.invocation, Date.now())?.stop ??
      null,
    null,
  )
  const changed = controllerFixture()
  writeJsonAtomic(delegationLivePaths(changed.root, changed.retry).record, {
    ...changed.retry,
    session_id: 'changed-public-session',
  })
  assert.equal(
    executorProcessActivity(changed.root, changed.invocation, Date.now())
      ?.stop ?? null,
    null,
  )
})
