import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { writeJson } from '../helpers.js'
import {
  checkpoint,
  checksVariant,
  PASS,
  submitStageOutput,
} from './delivery-helpers.js'

const GREEN_CHECKS = checksVariant('checks=green', {
  static: { probes: [], commands: [PASS] },
  fast: { probes: [], commands: [PASS] },
  full: { probes: [], commands: [`node -e "process.exit(0) /* full */"`] },
  configuration: { probes: [], commands: [PASS] },
})

test('a missing baseline artifact pauses the run before delegation', () => {
  const { root, runId, state } = checkpoint(
    'delivery@implement-baselined',
    GREEN_CHECKS,
  )
  const baseline = state.repository_check_baselines?.static

  assert.ok(baseline)
  rmSync(path.join(root, baseline.artifact_path))

  setRunStage(root, runId, 'implement', 'Re-enter implementation without one.')

  const prepared = prepareInvocation(root, runId)

  // The worker cannot influence a missing baseline, so the run pauses and
  // does not spend the stage attempt.
  assert.equal(prepared.invocation, null)
  assert.equal(prepared.state.status, 'paused')
  assert.equal(prepared.state.pending_action.type, 'operator_decision')
  assert.match(prepared.state.pause_reason ?? '', /cannot be delegated/u)
  assert.match(prepared.state.pause_reason ?? '', /implement\.lint/u)
  assert.match(
    prepared.state.pause_reason ?? '',
    /baseline artifact is missing/u,
  )
})

test('a wiped baseline map degrades gates to absolute judgment without recapture', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-baselined',
    GREEN_CHECKS,
  )
  const implementStage = stageBySlug(workflow, 'implement')
  const statePath = resolveRunLayout(root, runId).state.absolute
  const damagedState = JSON.parse(readFileSync(statePath, 'utf8')) as Record<
    string,
    unknown
  >

  damagedState.repository_check_baselines = {}
  writeJson(statePath, damagedState)
  setRunStage(root, runId, 'implement', 'Re-enter with no baseline pointers.')

  // The run captures no baseline after implementation. An absent pointer
  // degrades the gate to its own result instead of a closed failure.
  const submitted = submitStageOutput(root, runId, implementStage, 'success')
  const staticResult = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(staticResult?.passed, true)
  assert.equal(staticResult?.baseline_evidence_path, undefined)
  assert.deepEqual(getRunState(root, runId).repository_check_baselines, {})
})

test('a repository-check gate fails closed when its baseline disappears', () => {
  const { root, runId, state, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=green-static-fast', {
      static: { probes: [], commands: [PASS] },
      fast: { probes: [], commands: [PASS] },
    }),
  )
  const baseline = state.repository_check_baselines?.static

  assert.ok(baseline)
  rmSync(path.join(root, baseline.artifact_path))

  const submitted = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'implement'),
    'success',
  )
  const staticResult = submitted.record.evaluation.deterministic.find(
    (result) => result.id === 'implement.lint',
  )

  // A green exit code is not proof of parity when the gate cannot compare.
  assert.equal(staticResult?.passed, false)
  assert.match(staticResult?.explanation ?? '', /baseline artifact is missing/u)
  assert.equal(submitted.record.outcome, 'failure')
})

test('an incompatible baseline artifact pauses the run before delegation', () => {
  const { root, runId, state } = checkpoint(
    'delivery@implement-baselined',
    GREEN_CHECKS,
  )
  const baseline = state.repository_check_baselines?.static

  assert.ok(baseline)
  writeJson(path.join(root, baseline.artifact_path), {
    schema_version: 1,
    profile: 'static',
    result: { status: 'failed' },
  })

  setRunStage(root, runId, 'implement', 'Re-enter implementation.')

  const prepared = prepareInvocation(root, runId)

  assert.equal(prepared.invocation, null)
  assert.equal(prepared.state.status, 'paused')
  assert.match(prepared.state.pause_reason ?? '', /incompatible with its gate/u)
})
