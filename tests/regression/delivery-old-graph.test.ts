import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  decideRun,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { sha256 } from '../../src/lib/io.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { RunState, StageDefinition } from '../../src/lib/types.js'
import {
  loadStagePrompt,
  loadWorkflow,
  loadWorkflowFile,
  stageBySlug,
} from '../../src/lib/workflow.js'
import {
  createFixture,
  createRun,
  makeOutput,
  submitAsSupervisor,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

/**
 * The delivery workflow now starts at implement and holds no plan stage. A run
 * created before that change carries the old five-stage graph in its own
 * workflow snapshot, and the snapshot is authoritative for that run. This test
 * rebuilds the old graph on a fresh run and drives it to completion against the
 * current harness, so the split cannot strand a run already in flight.
 */
function installOldDeliveryGraph(root: string, runId: string): void {
  const layout = resolveRunLayout(root, runId)
  const snapshotPath = layout.workflowSnapshot.absolute
  const snapshot = loadWorkflowFile(root, snapshotPath)

  // The best-of-N candidate still ships the former delivery plan stage with
  // the delivery plan prompt; the old delivery graph held it behind an
  // operator gate and routed success to implement.
  const candidatePlan = stageBySlug(
    loadWorkflow(root, 'delivery-candidate'),
    'plan',
  )
  const plan: StageDefinition = {
    ...structuredClone(candidatePlan),
    gate: 'operator',
    transitions: { success: 'implement', failure: 'plan', blocked: 'paused' },
  }

  plan.prompt = loadStagePrompt(root, plan)
  plan.prompt_sha256 = sha256(plan.prompt)

  const planSelector = { stage: 'plan', selection: 'latest_success' as const }
  const stages = snapshot.stages.map((stage) => ({
    ...stage,
    context: {
      ...stage.context,
      ...(stage.slug === 'verify' ? { request: 'omit' as const } : {}),
      required_stage_outputs: [
        planSelector,
        ...(stage.context.required_stage_outputs ?? []),
      ],
    },
  }))
  const oldGraph = {
    ...snapshot,
    start_stage: 'plan',
    limits: { ...snapshot.limits, max_total_transitions: 14 },
    stages: [plan, ...stages],
  }

  writeFileSync(snapshotPath, `${JSON.stringify(oldGraph, null, 2)}\n`)

  const statePath = layout.state.absolute
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as RunState

  state.current_stage = 'plan'
  state.workflow_snapshot.sha256 = sha256(JSON.stringify(oldGraph, null, 2))
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

test('a delivery run created under the old five-stage graph still completes', () => {
  const root = createFixture()
  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Old graph delivery run',
  }).run_id

  installOldDeliveryGraph(root, runId)

  const snapshot = loadWorkflowFile(
    root,
    resolveRunLayout(root, runId).workflowSnapshot.absolute,
  )

  assert.equal(snapshot.start_stage, 'plan')
  assert.deepEqual(
    snapshot.stages.map((stage) => stage.slug),
    ['plan', 'implement', 'verify', 'remediate', 'ship'],
  )
  assert.equal(getRunState(root, runId).current_stage, 'plan')

  let planOutputPath: string | null = null

  for (const stageSlug of ['plan', 'implement', 'verify', 'ship']) {
    const invocation = prepareInvocation(root, runId).invocation

    assert.ok(invocation)
    assert.equal(invocation.stage.slug, stageSlug)

    // The run resolves every stage from its own snapshot, including the plan
    // stage the shipped delivery workflow no longer declares.
    assert.equal(invocation.workflow.slug, 'delivery')

    if (stageSlug === 'implement') {
      // The implement card of the old graph still reads the ratified plan
      // output, which the current delivery graph no longer requires.
      assert.ok(planOutputPath)
      assert.equal(invocation.inputs.missing_required, undefined)
      assert.ok(
        invocation.inputs.references.some(
          (reference) => reference.path === planOutputPath,
        ),
        'the old-graph implement card MUST reference the plan output',
      )
    }

    const stage = stageBySlug(snapshot, stageSlug)
    const output = makeOutput(
      root,
      invocation,
      stage,
      'success',
      getRunState(root, runId),
    )

    writeJson(path.join(root, invocation.output.path), output)
    writeCanonicalDelegation(root, invocation)

    const submitted = submitAsSupervisor(root, runId, invocation.output.path)

    assert.equal(
      submitted.record.outcome,
      'success',
      `${stageSlug}: ${JSON.stringify(submitted.record.evaluation)}`,
    )

    if (stageSlug === 'plan') {
      planOutputPath = invocation.output.path
      decideRun(root, runId, 'approve', 'fixture plan approval')
    }

    if (stageSlug === 'ship') {
      decideRun(root, runId, 'approve', 'fixture ship approval')
    }
  }

  const final = getRunState(root, runId)

  assert.equal(final.status, 'succeeded')
  assert.deepEqual(
    final.stage_history.map((item) => item.stage),
    ['plan', 'implement', 'verify', 'ship'],
  )
})
