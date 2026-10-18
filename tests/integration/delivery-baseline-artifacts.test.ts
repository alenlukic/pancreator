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

  // VERIFY-001: a missing baseline is unavailable evidence. The run records
  // the gap as an advisory and delegates the stage instead of pausing.
  assert.notEqual(prepared.invocation, null)
  assert.notEqual(prepared.state.status, 'paused')
  assert.ok(
    (prepared.state.advisories ?? []).some(
      (advisory) =>
        advisory.kind === 'evidence_gap' &&
        /baseline artifact is missing/u.test(advisory.message),
    ),
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

test('a repository-check gate records a gap and passes when its baseline disappears', () => {
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

  // VERIFY-001: a missing baseline cannot show a regression, so the gate
  // records the gap and the stage proceeds.
  assert.equal(staticResult?.passed, true)
  assert.match(
    staticResult?.evidence_gap ?? '',
    /baseline artifact is missing/u,
  )
  assert.equal(submitted.record.outcome, 'success')
})

test('an incompatible baseline artifact is recorded as a gap and the stage still delegates', () => {
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

  assert.notEqual(prepared.invocation, null)
  assert.notEqual(prepared.state.status, 'paused')
  assert.ok(
    (prepared.state.advisories ?? []).some(
      (advisory) =>
        advisory.kind === 'evidence_gap' &&
        /incompatible with its gate/u.test(advisory.message),
    ),
  )
})

test('a declared failure whose acceptance results are only evidence gaps does not fail the stage', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-prepared',
    GREEN_CHECKS,
  )

  const submitted = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'implement'),
    'failure',
    [],
    (output) => {
      const data = output.data as { acceptance_results?: unknown[] }

      data.acceptance_results = (data.acceptance_results ?? []).map((item) => ({
        ...(item as Record<string, unknown>),
        result: 'evidence_unavailable',
        gap_reason: 'collector aborted before launch',
      }))
    },
  )

  assert.equal(submitted.record.outcome, 'success')
  assert.notEqual(getRunState(root, runId).current_stage, 'implement')
  assert.ok(
    (getRunState(root, runId).advisories ?? []).some(
      (advisory) => advisory.kind === 'evidence_gap',
    ),
  )
})

test('a declared failure that cites a failed acceptance criterion still fails', () => {
  const { root, runId, workflow } = checkpoint(
    'delivery@implement-prepared',
    GREEN_CHECKS,
  )

  const submitted = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'implement'),
    'failure',
    [],
    (output) => {
      const data = output.data as { acceptance_results?: unknown[] }

      data.acceptance_results = (data.acceptance_results ?? []).map(
        (item, index) => ({
          ...(item as Record<string, unknown>),
          result: index === 0 ? 'fail' : 'evidence_unavailable',
        }),
      )
    },
  )

  assert.equal(submitted.record.outcome, 'failure')
})
