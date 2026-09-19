import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { setRunStage } from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { Invocation, RunState } from '../../src/lib/types.js'
import {
  delegationUnobservedMessage,
  readLaunchRecord,
  summarizeDelegationObservation,
} from '../../src/lib/watch.js'
import { loadWorkflowFile, stageBySlug } from '../../src/lib/workflow.js'
import { makeOutput, read, writeCanonicalDelegation } from '../helpers.js'
import { checkpoint, prepareCheckpointRun } from './delivery-helpers.js'

// Cadence short enough for a unit test yet above the module floor.
// Each wake observes the run tree and the workspace Git state, which costs a
// few tens of milliseconds, so the cadence leaves room for that inside a wake.
export const CADENCE_SECONDS = 0.1

/**
 * Deterministic clock for the watch loop: `sleep` advances it instead of
 * waiting, so a wake happens exactly when it is due whatever the load.
 */
export function fakeClock(): {
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
} {
  let current = Date.now()

  return {
    now: () => current,
    sleep: async (milliseconds) => {
      current += milliseconds
    },
  }
}

/**
 * A fake clock whose sleep rewrites the stage output, so every observation
 * sees an output that moved since the last one. That is a worker still
 * writing, which is exactly what a confirming wake exists to detect.
 *
 * Each rewrite pins the output one millisecond further past the recorded
 * launch. Left at wall-clock now, the output ages past one cadence while the
 * launch record keeps its original time, so `launchToOutputSeconds` grows
 * with however long the host took rather than with anything the worker did,
 * and the watch completes on `output_plausible`. Pinning holds both
 * conditions this fixture owes at once: the evidence stays weak because the
 * output is younger than one cadence, and the signature still moves because
 * the time still advances.
 */
export function stillWritingClock(
  root: string,
  state: RunState,
): { now: () => number; sleep: (milliseconds: number) => Promise<void> } {
  const clock = fakeClock()
  let sinceLaunchMs = 0

  return {
    now: clock.now,
    sleep: async (milliseconds) => {
      await clock.sleep(milliseconds)
      writeStageOutput(root, state)
      sinceLaunchMs += 1
      pinOutputPastLaunch(root, state, sinceLaunchMs)
    },
  }
}

/**
 * Set the stage output's modification time to the recorded launch time plus
 * `sinceLaunchMs`, which MUST stay under one cadence and MUST grow on every
 * call. The watch writes the launch record when it arms, so this runs from
 * the first sleep onward.
 */
function pinOutputPastLaunch(
  root: string,
  state: RunState,
  sinceLaunchMs: number,
): void {
  assert.ok(
    sinceLaunchMs < CADENCE_SECONDS * 1000,
    'a still-writing output must stay younger than one cadence',
  )

  const invocation = state.current_invocation

  assert.ok(invocation, 'the run stands at a prepared invocation')

  const launch = readLaunchRecord(root, state.run_id, invocation.id)

  assert.ok(launch, 'the watch records the launch when it arms')

  const pinned = new Date(Date.parse(launch.launched_at) + sinceLaunchMs)

  utimesSync(path.join(root, invocation.output_path), pinned, pinned)
}

export function preparedRun(): {
  root: string
  state: RunState
  invocationId: string
  outputPath: string
} {
  const prepared = checkpoint('delivery@implement-prepared')

  assert.ok(prepared.invocation)

  return {
    root: prepared.root,
    state: prepared.state,
    invocationId: prepared.invocation.invocation_id,
    outputPath: prepared.invocation.output.path,
  }
}

/**
 * A prepared run standing at verify, the stage that declares evidence
 * workers. The stage worker's own role cannot express an evidence worker's
 * declared paths, so a contract about those paths needs this run.
 */
export function preparedVerifyRun(): {
  root: string
  state: RunState
  invocation: Invocation
} {
  const created = checkpoint('delivery@created')

  setRunStage(
    created.root,
    created.runId,
    'verify',
    'Verify the current workspace.',
  )

  const prepared = prepareCheckpointRun(created.root, created.runId)

  assert.ok(prepared.invocation)
  assert.ok((prepared.invocation.evidence_workers ?? []).length > 0)

  return {
    root: created.root,
    state: prepared.state,
    invocation: prepared.invocation,
  }
}

export interface MultiplexedTarget {
  runId: string
  invocationId: string
  layout: ReturnType<typeof resolveRunLayout>
}

/**
 * Several independent prepared runs, cloned from one prepared fixture.
 *
 * A multiplexed wait needs one live run per target, and each target here
 * carries its own run id, invocation id, and output path. Building each run
 * through the engine instead would cost one full fixture per target.
 */
export function multiplexedTargets(count: number): {
  root: string
  targets: MultiplexedTarget[]
} {
  const { root, state } = preparedRun()
  const original = currentInvocation(root, state)
  const source = resolveRunLayout(root, state.run_id)
  const names = ['multi-one', 'multi-two', 'multi-three']

  assert.ok(count <= names.length, 'the fixture names at most three targets')

  return {
    root,
    targets: names.slice(0, count).map((invocationId, index) => {
      const runId = `${state.run_id}-multiplex-${index + 1}`
      const layout = resolveRunLayout(root, runId)

      cpSync(source.root.absolute, layout.root.absolute, { recursive: true })

      const clonedState = JSON.parse(
        readFileSync(layout.state.absolute, 'utf8'),
      ) as Record<string, unknown>

      clonedState.run_id = runId
      writeFileSync(
        layout.state.absolute,
        `${JSON.stringify(clonedState)}\n`,
        'utf8',
      )
      writeFileSync(
        layout.invocation(invocationId, '.json').absolute,
        `${JSON.stringify({
          ...original,
          run_id: runId,
          invocation_id: invocationId,
          workspace_root: '',
          output: {
            ...original.output,
            path: layout.output(invocationId).relative,
          },
        })}\n`,
        'utf8',
      )

      return { runId, invocationId, layout }
    }),
  }
}

/**
 * Write one multiplexed target's stage output and pin its modification time
 * just past the recorded launch.
 *
 * Pinning is what keeps the completion evidence weak whatever the host does:
 * left at wall-clock now, the output ages past one cadence while the launch
 * record keeps its time, and the watch completes on `output_plausible`
 * instead of taking the confirming wake this fixture is about.
 */
export function writeTargetOutput(
  root: string,
  target: MultiplexedTarget,
  sinceLaunchMs = 1,
): void {
  assert.ok(
    sinceLaunchMs < CADENCE_SECONDS * 1000,
    'a held output must stay younger than one cadence',
  )

  const invocation = read(
    target.layout.invocation(target.invocationId, '.json').absolute,
  ) as Invocation
  const state = read(target.layout.state.absolute) as RunState
  const workflow = loadWorkflowFile(
    root,
    path.join(root, state.workflow_snapshot.path),
  )

  writeFileSync(
    path.join(root, invocation.output.path),
    `${JSON.stringify(
      makeOutput(
        root,
        invocation,
        stageBySlug(workflow, invocation.stage.slug),
        'success',
        state,
      ),
      null,
      2,
    )}\n`,
  )

  const launch = readLaunchRecord(root, target.runId, target.invocationId)

  assert.ok(launch, 'the watch records the launch when it arms')

  const pinned = new Date(Date.parse(launch.launched_at) + sinceLaunchMs)

  utimesSync(path.join(root, invocation.output.path), pinned, pinned)
}

/** The invocation record the run currently stands at. */
export function currentInvocation(root: string, state: RunState): Invocation {
  const pointer = state.current_invocation

  assert.ok(pointer, 'the run stands at a prepared invocation')

  return read(path.join(root, pointer.json_path)) as Invocation
}

export function writeStageOutput(root: string, state: RunState): void {
  const invocation = currentInvocation(root, state)
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

/** Fill the prepared invocation's output and delegation artifact, unsubmitted. */
export function fillPreparedOutput(root: string, state: RunState): string {
  const invocation = currentInvocation(root, state)

  writeStageOutput(root, state)
  writeCanonicalDelegation(root, invocation)

  return invocation.output.path
}

/** The run's `blocked_output_snapshotted` event lines, in order. */
export function blockedSnapshotEvents(root: string, runId: string): string[] {
  const events = path.join(
    root,
    'runtime',
    'logs',
    'workflows',
    runId,
    'agent',
    'events.jsonl',
  )

  return existsSync(events)
    ? readFileSync(events, 'utf8')
        .split('\n')
        .filter((line) => line.includes('blocked_output_snapshotted'))
    : []
}

export function await_message(
  observation: ReturnType<typeof summarizeDelegationObservation>,
): string {
  return delegationUnobservedMessage(observation, 'pan', 'run', 'invocation')
}
