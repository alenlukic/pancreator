import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  probeRunInvocationModel,
  recordInvocationModelEvidence,
  recordSupervisorModelEvidence,
} from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import { expectedCursorModelForSpec } from '../../src/lib/executors/cursor-probe.js'
import { statePath } from '../../src/lib/state.js'
import { stageBySlug, loadWorkflow } from '../../src/lib/workflow.js'
import { makeOutput, writeCanonicalDelegation, writeJson } from '../helpers.js'
import { submitAsSupervisor } from '../run-helpers.js'
import type { CheckpointVariant } from './delivery-helpers.js'
import {
  MODEL_EVIDENCE_VARIANT,
  preparedRunCheckpoint,
  verifyRun,
  withFakeCursorAgent,
} from './model-evidence-helpers.js'

const CATALOGLESS_MODEL_EVIDENCE_VARIANT: CheckpointVariant = {
  key: 'catalogless-model-evidence',
  fixture: (root) => {
    rmSync(path.join(root, 'governance/registries/cursor_model_catalog.json'), {
      force: true,
    })
  },
  afterCreate: (root, runId) => {
    recordSupervisorModelEvidence(
      root,
      runId,
      'GPT 5.6 Sol',
      'Cursor session metadata',
    )
  },
}

test('manual invocation evidence accepts declared roles and records launch handles', () => {
  const { root, runId, invocation } = verifyRun()
  const stageWorker = recordInvocationModelEvidence(
    root,
    runId,
    invocation.invocation_id,
    'worker',
    'Stage Effective Model',
    'Cursor launch metadata',
    'launch-stage-1',
  )
  const reviewWorker = recordInvocationModelEvidence(
    root,
    runId,
    invocation.invocation_id,
    'review',
    'Review Effective Model',
    'Cursor launch metadata',
    'launch-review-1',
  )

  assert.equal(stageWorker.role, 'worker')
  assert.equal(stageWorker.persona, invocation.stage.persona)
  assert.equal(stageWorker.declared_spec, invocation.stage.model)
  assert.equal(stageWorker.launch_handle, 'launch-stage-1')

  const declaredReview = invocation.evidence_workers?.find(
    (worker) => worker.role === 'review',
  )

  assert.ok(declaredReview)
  assert.equal(reviewWorker.role, 'evidence_worker')
  assert.equal(reviewWorker.worker_role, 'review')
  assert.equal(reviewWorker.persona, declaredReview.persona)
  assert.equal(reviewWorker.declared_spec, declaredReview.model)
  assert.equal(reviewWorker.effective_model, 'Review Effective Model')
  assert.equal(reviewWorker.source, 'Cursor launch metadata')
  assert.equal(reviewWorker.launch_handle, 'launch-review-1')
  assert.equal(
    getRunState(root, runId).model_evidence?.find(
      (item) => item.worker_role === 'review',
    )?.launch_handle,
    'launch-review-1',
  )
  assert.equal(
    (
      JSON.parse(
        readFileSync(path.join(root, reviewWorker.evidence_path), 'utf8'),
      ) as { launch_handle?: string }
    ).launch_handle,
    'launch-review-1',
  )

  assert.throws(
    () =>
      recordInvocationModelEvidence(
        root,
        runId,
        invocation.invocation_id,
        declaredReview.persona,
        'Wrong Role Model',
        'Cursor launch metadata',
        'launch-wrong-1',
      ),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'INVALID_ARGUMENT' &&
      /not declared by invocation/u.test(error.message),
  )

  const invocationPath = getRunState(root, runId).current_invocation?.json_path

  assert.ok(invocationPath)

  const foreignInvocation = JSON.parse(
    readFileSync(path.join(root, invocationPath), 'utf8'),
  ) as Record<string, unknown>

  foreignInvocation.run_id = 'foreign-run'
  writeJson(path.join(root, invocationPath), foreignInvocation)

  assert.throws(
    () =>
      recordInvocationModelEvidence(
        root,
        runId,
        invocation.invocation_id,
        'worker',
        'Wrong Run Model',
        'Cursor launch metadata',
        'launch-wrong-run',
      ),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_INVOCATION',
  )
})

test('pan models evidence records every invocation role and rejects undeclared roles', () => {
  const { root, runId, invocation } = verifyRun()
  const cli = path.join(process.cwd(), 'dist', 'src', 'cli.js')
  const invoke = (role: string, launchHandle?: string) =>
    spawnSync(
      process.execPath,
      [
        cli,
        'models',
        'evidence',
        '--run',
        runId,
        '--invocation',
        invocation.invocation_id,
        '--role',
        role,
        '--effective-model',
        `Effective ${role}`,
        '--source',
        'Cursor launch metadata',
        ...(launchHandle ? ['--launch-handle', launchHandle] : []),
        '--json',
      ],
      { cwd: root, encoding: 'utf8' },
    )

  for (const role of ['worker', 'review', 'qa']) {
    const result = invoke(role, `launch-${role}`)

    assert.equal(result.status, 0, result.stderr)
    const evidence = JSON.parse(result.stdout) as {
      role: string
      worker_role?: string
      declared_spec: string
      effective_model: string
      source: string
      launch_handle: string
    }

    assert.equal(evidence.worker_role ?? evidence.role, role)
    assert.equal(evidence.effective_model, `Effective ${role}`)
    assert.equal(evidence.source, 'Cursor launch metadata')
    assert.equal(evidence.launch_handle, `launch-${role}`)
    assert.ok(evidence.declared_spec.length > 0)
  }

  const undeclared = invoke('pan-reviewer', 'launch-persona')

  assert.notEqual(undeclared.status, 0)
  assert.match(undeclared.stderr, /not declared by invocation/u)

  const missingInvocation = spawnSync(
    process.execPath,
    [
      cli,
      'models',
      'evidence',
      '--run',
      runId,
      '--role',
      'worker',
      '--effective-model',
      'Effective worker',
      '--source',
      'Cursor launch metadata',
      '--launch-handle',
      'launch-worker-missing-invocation',
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  )

  assert.notEqual(missingInvocation.status, 0)
  assert.match(missingInvocation.stderr, /--invocation is required/u)
})

// A verify stage runs three models and recorded one. The stage verdict then
// named a model that produced a third of the work behind it.
test('every declared worker carries its own evidence, defaulted then probed', () => {
  const { root, runId, invocation } = verifyRun()
  const recordsFor = (state = getRunState(root, runId)) =>
    (state.model_evidence ?? []).filter(
      (item) => item.invocation_id === invocation.invocation_id,
    )
  const prepared = recordsFor()

  // Prepare records what the run snapshot projects, for every declared spec.
  assert.deepEqual(
    prepared.map((item) => [item.role, item.worker_role ?? null, item.result]),
    [
      ['worker', null, 'default'],
      ['evidence_worker', 'review', 'default'],
      ['evidence_worker', 'qa', 'default'],
    ],
  )
  assert.deepEqual(
    prepared.map((item) => item.effective_model),
    prepared.map((item) => item.declared_spec),
  )
  assert.equal(
    new Set(prepared.map((item) => item.evidence_path)).size,
    3,
    'each role owns its own evidence file',
  )

  // A probe answers each declared role, not the stage persona alone.
  const probed = withFakeCursorAgent(root, 'Probed Variant', () =>
    probeRunInvocationModel(root, runId, invocation.invocation_id),
  )

  assert.deepEqual(
    probed.evidence_workers.map((item) => item.worker_role),
    ['review', 'qa'],
  )
  assert.deepEqual(
    recordsFor().map((item) => [
      item.worker_role ?? null,
      item.effective_model,
      item.source,
    ]),
    [
      [null, 'Probed Variant', 'cursor-agent system/init event'],
      ['review', 'Probed Variant', 'cursor-agent system/init event'],
      ['qa', 'Probed Variant', 'cursor-agent system/init event'],
    ],
  )
})

test('a worker with no evidence earns a named advisory; a defaulted one earns none', () => {
  const { root, runId, invocation } = verifyRun()
  const state = getRunState(root, runId)
  const runStatePath = statePath(root, runId)

  // The gap this criterion names: a declared worker whose evidence never
  // reached run state at all.
  writeJson(runStatePath, {
    ...state,
    model_evidence: (state.model_evidence ?? []).filter(
      (item) => item.worker_role !== 'review',
    ),
  })

  const stage = stageBySlug(loadWorkflow(root, 'delivery'), 'verify')

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage, 'success', getRunState(root, runId)),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const gap = submitted.advisories.filter(
    (advisory) => advisory.kind === 'model_evidence',
  )

  assert.equal(gap.length, 1, 'only the unrecorded role is a gap')
  assert.match(gap[0]?.message ?? '', /evidence worker role 'review'/u)
  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
    'a missing probe never stops a submission',
  )
})

test('submission refuses evidence that contradicts the run snapshot', () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    MODEL_EVIDENCE_VARIANT,
  )

  const probed = withFakeCursorAgent(root, 'Unexpected Model', () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(probed.result, 'mismatch')

  const stage = stageBySlug(
    loadWorkflow(root, 'delivery'),
    invocation.stage.slug,
  )

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )
  writeCanonicalDelegation(root, invocation)

  // The stage ran on a model this run did not declare, so its verdict is not
  // the verdict the run asked for.
  assert.throws(
    () => submitAsSupervisor(root, run.run_id, invocation.output.path),
    (error: unknown) =>
      error instanceof PanError && error.code === 'MODEL_EVIDENCE_MISMATCH',
  )

  // A repaired probe clears the refusal without an operator override.
  const expected = expectedCursorModelForSpec(root, invocation.stage.model)

  assert.ok(expected)
  withFakeCursorAgent(root, expected, () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  const submitted = submitAsSupervisor(root, run.run_id, invocation.output.path)

  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
  )
})

// `bin/install` omits the catalog from a target payload because the catalog
// covers one Cursor account.
test('a bracketed spec without an installed catalog records rather than blocks', () => {
  const { root, run, invocation } = preparedRunCheckpoint(
    CATALOGLESS_MODEL_EVIDENCE_VARIANT,
  )

  assert.ok(
    invocation.stage.model.includes('['),
    `expected a bracketed spec, got '${invocation.stage.model}'`,
  )

  const evidence = withFakeCursorAgent(root, 'GPT-5.6 Sol 272K High', () =>
    probeRunInvocationModel(root, run.run_id, invocation.invocation_id),
  )

  assert.equal(evidence.result, 'recorded')
  assert.equal(evidence.effective_model, 'GPT-5.6 Sol 272K High')
  assert.equal(evidence.error, undefined)

  const stage = stageBySlug(
    loadWorkflow(root, 'delivery'),
    invocation.stage.slug,
  )

  writeJson(
    path.join(root, invocation.output.path),
    makeOutput(root, invocation, stage),
  )
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, run.run_id, invocation.output.path)

  assert.ok(
    submitted.state.stage_history.some(
      (item) => item.invocation_id === invocation.invocation_id,
    ),
  )
  // An absent catalog is not a gap, so it earns no advisory.
  assert.doesNotMatch(
    readFileSync(
      path.join(
        root,
        'runtime/logs/workflows',
        run.run_id,
        'agent/events.jsonl',
      ),
      'utf8',
    ),
    /"type":"model_evidence_advisory"/u,
  )
})
