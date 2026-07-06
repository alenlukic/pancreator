import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { buildInvocationInputs } from '../../src/lib/context.js'
import type {
  OperatorGateWaiver,
  RunState,
  StageHistoryItem,
} from '../../src/lib/types.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'

function historyItem(
  stage: string,
  invocationId: string,
  outcome: StageHistoryItem['outcome'],
  fingerprint = 'fp-current',
): StageHistoryItem {
  return {
    stage,
    attempt: 1,
    invocation_id: invocationId,
    output_path: `runtime/logs/workflows/run/outputs/${invocationId}.json`,
    outcome,
    submitted_at: '2026-06-26T00:00:00.000Z',
    workspace_fingerprint: fingerprint,
    validation_errors: [],
    deterministic: [],
    record_path: `runtime/logs/workflows/run/artifacts/json/${invocationId}.json`,
  }
}

function stateWith(history: StageHistoryItem[]): RunState {
  return {
    schema_version: 1,
    run_id: 'run',
    workflow_slug: 'dev',
    workflow_snapshot: {
      path: 'runtime/logs/workflows/run/workflow.snapshot.json',
      sha256: 'workflow-sha',
    },
    workspace_root: '.',
    title: 'Context fixture',
    status: 'running',
    current_stage: 'ship',
    pending_action: { type: 'prepare_invocation' },
    current_invocation: null,
    request: {
      source_path: 'request.md',
      stored_path: 'runtime/logs/workflows/run/request.md',
      sha256: 'request-sha',
    },
    limits: {
      max_total_transitions: 18,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    attempts: { ship: 0 },
    transition_count: 10,
    consecutive_failures: 0,
    stage_history: history,
    revision: 1,
    created_at: '2026-06-26T00:00:00.000Z',
    updated_at: '2026-06-26T00:00:00.000Z',
  }
}

function waiverFor(item: StageHistoryItem, suffix: string): OperatorGateWaiver {
  return {
    waiver_id: `waiver-${suffix}`,
    stage: item.stage,
    source_invocation_id: item.invocation_id,
    source_attempt: item.attempt,
    source_evidence_path: item.record_path ?? item.output_path,
    criterion_ids: ['review.acceptance_met'],
    workspace_fingerprint: item.workspace_fingerprint,
    note: 'Operator accepted bounded residual risk.',
    artifact_path: `runtime/logs/workflows/run/artifacts/markdown/waiver-${suffix}.md`,
    deferred_acceptance_criteria: [],
    timestamp: '2026-06-26T00:00:00.000Z',
  }
}

test('ship context selects effective records and indexes superseded history', () => {
  const root = createFixture()
  const intakeOld = historyItem('intake', 'intake-1', 'success')
  const intakeCurrent = historyItem('intake', 'intake-2', 'success')
  const planFailed = historyItem('plan', 'plan-1', 'failure')
  const planCurrent = historyItem('plan', 'plan-2', 'success')
  const implementOld = historyItem('implement', 'implement-1', 'success')
  const reviewOld = historyItem('review', 'review-1', 'failure')
  const implementCurrent = historyItem('implement', 'implement-2', 'success')
  const reviewCurrent = historyItem('review', 'review-2', 'failure')
  const testCurrent = historyItem('test', 'test-1', 'success')
  const history = [
    intakeOld,
    intakeCurrent,
    planFailed,
    planCurrent,
    implementOld,
    reviewOld,
    implementCurrent,
    reviewCurrent,
    testCurrent,
  ]
  const state = stateWith(history)
  state.governance_artifact_issues_path =
    'runtime/logs/workflows/run/artifacts/json/governance-artifact-issues.json'
  state.operator_feedback = [
    {
      decision: 'resume',
      from_stage: 'review',
      to_stage: 'implement',
      attempt: 1,
      note: 'Old remediation note.',
      path: 'runtime/logs/workflows/run/artifacts/markdown/feedback-old.md',
      timestamp: '2026-06-25T00:00:00.000Z',
    },
    {
      decision: 'set-stage',
      from_stage: 'test',
      to_stage: 'ship',
      attempt: 1,
      note: 'Current ship repair.',
      path: 'runtime/logs/workflows/run/artifacts/markdown/feedback-current.md',
      timestamp: '2026-06-26T00:00:00.000Z',
    },
  ]
  state.operator_gate_waivers = [
    waiverFor(reviewOld, 'old'),
    waiverFor(reviewCurrent, 'current'),
  ]
  state.operator_workspace_ratifications = [
    {
      ratification_id: 'ratification-current',
      stage: 'ship',
      workspace_fingerprint: 'fp-current',
      changed_paths: [],
      deleted_paths: [],
      note: 'Current workspace accepted.',
      artifact_path:
        'runtime/logs/workflows/run/artifacts/markdown/ratification-current.md',
      timestamp: '2026-06-26T00:00:00.000Z',
    },
  ]

  const stage = stageBySlug(loadWorkflow(root, 'dev'), 'ship')
  const inputs = buildInvocationInputs({
    root,
    state,
    stage,
    attempt: 1,
    invocationId: 'ship-1',
    workspaceFingerprint: 'fp-current',
  })
  const byPath = new Map(inputs.references.map((item) => [item.path, item]))

  for (const item of [
    intakeCurrent,
    planCurrent,
    implementCurrent,
    reviewCurrent,
    testCurrent,
  ]) {
    assert.equal(byPath.get(item.output_path)?.retrieval, 'required')
    assert.equal(byPath.get(item.record_path ?? '')?.retrieval, 'conditional')
  }

  for (const item of [intakeOld, planFailed, implementOld, reviewOld]) {
    assert.equal(byPath.has(item.output_path), false)
  }

  assert.equal(byPath.get(state.request.stored_path)?.retrieval, 'conditional')
  assert.equal(
    byPath.get(
      'runtime/logs/workflows/run/artifacts/markdown/feedback-current.md',
    )?.retrieval,
    'required',
  )
  assert.equal(
    byPath.has('runtime/logs/workflows/run/artifacts/markdown/feedback-old.md'),
    false,
  )
  assert.equal(
    byPath.get(
      'runtime/logs/workflows/run/artifacts/markdown/waiver-current.md',
    )?.retrieval,
    'required',
  )
  assert.equal(
    byPath.has('runtime/logs/workflows/run/artifacts/markdown/waiver-old.md'),
    false,
  )

  const manifest = inputs.references.find(
    (item) => item.retrieval === 'index_only',
  )
  assert.ok(manifest)
  assert.equal(existsSync(path.join(root, manifest.path)), true)

  const manifestValue = JSON.parse(
    readFileSync(path.join(root, manifest.path), 'utf8'),
  ) as { omitted: Array<{ path: string }> }
  assert.equal(
    manifestValue.omitted.some((item) => item.path === planFailed.output_path),
    true,
  )
  assert.deepEqual(inputs.missing_required, undefined)
  assert.equal(byPath.get('VERSION')?.retrieval, 'required')
  assert.equal(byPath.get('release/index.json')?.retrieval, 'required')
})

test('embedded ship context omits Pancreator self-development release metadata', () => {
  const root = createFixture()
  const configPath = path.join(root, 'project.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const inputs = buildInvocationInputs({
    root,
    state: stateWith([]),
    stage: stageBySlug(loadWorkflow(root, 'dev'), 'ship'),
    attempt: 1,
    invocationId: 'ship-embedded',
    workspaceFingerprint: 'fp-current',
  })

  assert.equal(
    inputs.references.some((item) => item.path === 'VERSION'),
    false,
  )
  assert.equal(
    inputs.references.some((item) => item.path === 'release/index.json'),
    false,
  )
})

test('missing required stage outputs are explicit instead of triggering broad scans', () => {
  const root = createFixture()
  const state = stateWith([])
  state.current_stage = 'review'
  const stage = stageBySlug(loadWorkflow(root, 'dev'), 'review')

  const inputs = buildInvocationInputs({
    root,
    state,
    stage,
    attempt: 1,
    invocationId: 'review-1',
    workspaceFingerprint: 'fp-current',
  })

  assert.deepEqual(inputs.missing_required, [
    "latest success output for stage 'plan'",
    "latest output for stage 'implement'",
  ])
  assert.equal(
    inputs.references.some((item) => item.path === state.request.stored_path),
    false,
  )
  assert.equal(
    inputs.references.some((item) => item.retrieval === 'index_only'),
    true,
  )
})

test('legacy workflow snapshots preserve all-history reference behavior', () => {
  const root = createFixture()
  const history = [
    historyItem('intake', 'intake-1', 'success'),
    historyItem('plan', 'plan-1', 'failure'),
  ]
  const state = stateWith(history)
  const stage = {
    ...stageBySlug(loadWorkflow(root, 'dev'), 'ship'),
    context: { request: 'required' as const, legacy_full_history: true },
  }

  const inputs = buildInvocationInputs({
    root,
    state,
    stage,
    attempt: 1,
    invocationId: 'ship-legacy',
    workspaceFingerprint: 'fp-current',
  })

  assert.equal(
    inputs.references.every((item) => item.retrieval === 'required'),
    true,
  )
  assert.equal(
    inputs.references.some((item) => item.path === history[1].output_path),
    true,
  )
  assert.equal(
    inputs.references.some((item) => item.retrieval === 'index_only'),
    false,
  )
})
