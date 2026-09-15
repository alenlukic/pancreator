import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  STAGE_WORKER_ROLE,
  armWorkerWatch,
  describeDelegatedWorkers,
  getRunState,
  recordDelegatedWorker,
} from '../../src/lib/engine.js'
import { readLaunchRecord } from '../../src/lib/watch.js'
import {
  CADENCE_SECONDS,
  fillPreparedOutput,
  preparedRun,
  preparedVerifyRun,
  writeStageOutput,
} from './watch-helpers.js'

test('a delegated worker launch records the handle the platform returned', () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  const launch = recordDelegatedWorker(root, state.run_id, {
    handle: 'bc-7f21c0',
    agent: 'pan-coder',
    model: 'claude-opus-5',
    launchMode: 'background',
  })

  assert.equal(launch.record.invocation_id, invocationId)
  assert.equal(launch.record.role, STAGE_WORKER_ROLE)
  assert.equal(launch.record.attempt, 1)
  assert.equal(launch.record.handle, 'bc-7f21c0')
  assert.equal(launch.record.agent, 'pan-coder')
  assert.equal(launch.record.launch_mode, 'background')
  assert.deepEqual(launch.record.declared_paths, [outputPath])

  assert.deepEqual(getRunState(root, state.run_id).delegated_workers, [
    launch.record,
  ])
})

// Q-006: `pan worker record` was a separate command a supervisor had to
// remember, and across Phase 3 not one run recorded a handle, so no
// disappeared worker could be named. Arming the watch is the step the
// supervisor already takes, so the handle now rides along with it.
test('arming the watch with a platform handle records the delegated worker', async () => {
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  await armWorkerWatch(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
    workerHandle: 'bc-3fa91b',
    workerAgent: 'pan-coder',
    workerModel: 'claude-opus-5',
    launchedAt: new Date(Date.now() - 30_000).toISOString(),
  })

  const [recorded] = getRunState(root, state.run_id).delegated_workers ?? []

  assert.equal(recorded?.handle, 'bc-3fa91b')
  assert.equal(recorded?.agent, 'pan-coder')
  assert.equal(recorded?.invocation_id, invocationId)

  // The launch record carries the handle too, so the launch time and the
  // worker that consumed it are one fact rather than two.
  assert.equal(
    readLaunchRecord(root, state.run_id, invocationId)?.worker_handle,
    'bc-3fa91b',
  )

  // Re-arming the same watch is more supervision of one launch. A second
  // record would read as a second worker and make `wrote_nothing` lie.
  await armWorkerWatch(root, state.run_id, {
    invocationId,
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
    workerHandle: 'bc-3fa91b',
  })

  assert.equal(
    (getRunState(root, state.run_id).delegated_workers ?? []).length,
    1,
  )
})

// The handle stays optional: a platform that returns none must not cost the
// supervisor its watch.
test('arming the watch without a handle still records the launch', async () => {
  const { root, state, invocationId } = preparedRun()

  fillPreparedOutput(root, state)

  const watched = await armWorkerWatch(root, state.run_id, {
    cadenceSeconds: CADENCE_SECONDS,
    agentState: 'completed',
  })

  assert.equal(watched.state, 'completed')
  assert.deepEqual(
    getRunState(root, state.run_id).delegated_workers ?? [],
    [],
    'no handle records no worker rather than an empty one',
  )
  assert.equal(
    readLaunchRecord(root, state.run_id, invocationId)?.worker_handle,
    null,
  )
})

test('worker state reports a worker that crashed before writing anything', () => {
  const { root, state, invocationId, outputPath } = preparedRun()

  recordDelegatedWorker(root, state.run_id, { handle: 'bc-dead01' })

  const [crashed] = describeDelegatedWorkers(root, state.run_id)

  assert.ok(crashed)
  assert.equal(crashed.invocation_id, invocationId)
  assert.equal(crashed.handle, 'bc-dead01')
  assert.ok(crashed.launched_at)
  assert.ok(crashed.seconds_since_launch >= 0)
  // The state a supervisor cannot otherwise get: the launch happened, and the
  // worker has written nothing since. Reported, not raised as an error.
  assert.equal(crashed.wrote_nothing, true)
  assert.deepEqual(crashed.declared_paths, [
    {
      path: outputPath,
      producer: 'worker',
      exists: false,
      size: null,
      modified_at: null,
    },
  ])

  writeStageOutput(root, state)

  const [wrote] = describeDelegatedWorkers(root, state.run_id)

  assert.ok(wrote)
  assert.equal(wrote.wrote_nothing, false)
  assert.equal(wrote.declared_paths[0]?.exists, true)
  assert.ok((wrote.declared_paths[0]?.size ?? 0) > 0)
})

// The stage worker declares only its output, so the role the whole surface
// exists for is the evidence worker: the harness writes that worker's brief
// in the same call that records the launch, and a report nobody has written
// must still read as nothing written.
test('worker state reports an evidence worker that crashed before its report', () => {
  const { root, state, invocation } = preparedVerifyRun()
  const role = (invocation.evidence_workers ?? [])[0].role
  const launch = recordDelegatedWorker(root, state.run_id, {
    handle: 'bc-evidence-dead',
    invocationId: invocation.invocation_id,
    role,
  })

  assert.ok(launch.evidence_attempt)

  const { brief_path, evidence_path } = launch.evidence_attempt
  const [crashed] = describeDelegatedWorkers(root, state.run_id, { role })

  assert.ok(crashed)
  assert.equal(crashed.handle, 'bc-evidence-dead')
  // The brief stays in the report as a diagnostic, named as the harness's own
  // writing, so the declared-path list never gets narrower than before.
  assert.deepEqual(
    crashed.declared_paths.map((item) => ({
      path: item.path,
      producer: item.producer,
      exists: item.exists,
    })),
    [
      { path: brief_path, producer: 'harness', exists: true },
      { path: evidence_path, producer: 'worker', exists: false },
    ],
  )
  assert.equal(crashed.wrote_nothing, true)

  writeFileSync(path.join(root, evidence_path), '# Review evidence\n')

  const [wrote] = describeDelegatedWorkers(root, state.run_id, { role })

  assert.ok(wrote)
  assert.equal(wrote.wrote_nothing, false)
})

test('worker state reports no worker rather than failing when none was recorded', () => {
  const { root, state } = preparedRun()

  assert.deepEqual(describeDelegatedWorkers(root, state.run_id), [])
})
