import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { prepareInvocation } from '../../src/lib/engine.js'
import type { RunState } from '../../src/lib/types.js'
import {
  delegationUnobservedMessage,
  summarizeDelegationObservation,
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

export function preparedRun(): {
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

export function writeStageOutput(root: string, state: RunState): void {
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

/** Fill the prepared invocation's output and delegation artifact, unsubmitted. */
export function fillPreparedOutput(root: string, state: RunState): string {
  const invocation = read(
    path.join(root, state.current_invocation!.json_path),
  ) as Parameters<typeof makeOutput>[1]

  writeStageOutput(root, state)
  writeCanonicalDelegation(root, invocation)

  return invocation.output.path
}

export function await_message(
  observation: ReturnType<typeof summarizeDelegationObservation>,
): string {
  return delegationUnobservedMessage(observation, 'pan', 'run', 'invocation')
}
