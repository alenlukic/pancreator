import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { finalizePlanningReferences } from '../../src/lib/cohorts/specifications.js'
import { materializeOutputSubmission } from '../../src/lib/engine/submit-helpers.js'
import { isRecord, readJson } from '../../src/lib/io.js'
import {
  planningCorrectionBundle,
  planningCorrectionErrors,
} from '../../src/lib/render/contract.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import type { Invocation, RunState } from '../../src/lib/types.js'
import { originatingItemId } from '../../src/lib/validators/cohort-plan.js'
import { sharedFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'
import { baseInvocation } from '../unit/render-helpers.js'

function fixture(name = 'three') {
  const retained = readJson(
    path.join(
      process.cwd(),
      `tests/fixtures/g01-planning/${name}-repairs.json`,
    ),
  )
  assert.ok(
    isRecord(retained) &&
      isRecord(retained.data) &&
      isRecord(retained.initial_product_spec) &&
      isRecord(retained.specifications),
  )
  const root = createTestTempDirectory(`g01-revision-${name}-`)
  const data = { ...retained.data, product_spec: retained.initial_product_spec }
  assert.ok(
    isRecord(data.product_spec) && Array.isArray(data.product_spec.constraints),
  )
  assert.ok(isRecord(retained.data.cohort_plan))
  const cohort = retained.data.cohort_plan
  assert.equal(typeof cohort.parent_spec_path, 'string')
  const parentPath = String(cohort.parent_spec_path)
  const runId = parentPath.split('/')[3]
  for (const [file, content] of Object.entries(retained.specifications)) {
    assert.equal(typeof content, 'string')
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), String(content))
  }
  const invocation: Invocation = baseInvocation(
    sharedFixture(),
    'planning',
    'plan',
  )
  invocation.run_id = runId
  invocation.attempt = 2
  invocation.invocation_id = 'plan-2-g01'
  invocation.output.path = `runtime/logs/workflows/${runId}/agent/outputs/current.json`
  const priorPath = `runtime/logs/workflows/${runId}/agent/outputs/prior.json`
  mkdirSync(path.dirname(path.join(root, priorPath)), { recursive: true })
  const prior = { invocation_id: 'plan-1-g01', result: 'failure', data }
  writeFileSync(path.join(root, priorPath), JSON.stringify(prior))
  assert.ok(Array.isArray(retained.data.acceptance_criteria))
  const criterion = retained.data.acceptance_criteria.find(
    (entry) =>
      isRecord(entry) &&
      Array.isArray(entry.maps_to) &&
      entry.maps_to.some((id) => typeof id === 'string' && id.startsWith('C-')),
  )
  assert.ok(isRecord(criterion) && Array.isArray(criterion.maps_to))
  const id = criterion.maps_to.find(
    (entry) => typeof entry === 'string' && entry.startsWith('C-'),
  )
  invocation.prior_failure = {
    stage: 'plan',
    attempt: 1,
    invocation_id: prior.invocation_id,
    outcome: 'failure',
    output_path: priorPath,
    failed_hard_criteria: [],
    failed_deterministic: [],
    governance_artifact_warnings: [],
    validation_errors: [
      `[plan.maps_to_unknown] Criterion ${criterion.id} maps_to references unknown registry id ${id}`,
    ],
  }
  const state: RunState = {
    schema_version: 1,
    run_id: runId,
    workflow_slug: 'planning',
    workflow_snapshot: { path: 'snapshot.json', sha256: 'fixture' },
    workspace_root: '.',
    title: 'G01 revision replay',
    status: 'running',
    current_stage: 'plan',
    pending_action: {
      type: 'invoke_agent',
      persona: 'planner',
      path: 'card.md',
    },
    current_invocation: {
      id: invocation.invocation_id,
      json_path: 'card.json',
      markdown_path: 'card.md',
      output_path: invocation.output.path,
    },
    request: {
      source_path: 'request.md',
      stored_path: 'request.md',
      sha256: 'fixture',
    },
    limits: {
      max_total_transitions: 20,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    attempts: { plan: 2 },
    transition_count: 1,
    consecutive_failures: 1,
    stage_history: [
      {
        stage: 'plan',
        attempt: 1,
        invocation_id: prior.invocation_id,
        output_path: priorPath,
        outcome: 'failure',
        submitted_at: '2026-10-15T00:00:00Z',
        workspace_fingerprint: 'fixture',
        validation_errors: invocation.prior_failure.validation_errors,
        deterministic: [],
      },
    ],
    revision: 1,
    created_at: '2026-10-15T00:00:00Z',
    updated_at: '2026-10-15T00:00:00Z',
  }
  const constraints = data.product_spec.constraints.map((entry) => ({
    id: originatingItemId(entry),
    statement: entry,
  }))
  const patch = {
    invocation_id: invocation.invocation_id,
    result: 'success',
    data: {
      product_spec: { constraints },
      planning_correction: { mode: 'mechanical' },
    },
  }
  return {
    root,
    invocation,
    state,
    prior,
    patch,
    parentPath,
    retained: { data: retained.data, specifications: retained.specifications },
  }
}

for (const name of ['three', 'seven']) {
  test(`G01 ${name}-repair scaffold prepares precise context and existing merge patch preserves facts`, () => {
    const value = fixture(name)
    const bundle = planningCorrectionBundle(value.root, value.invocation)
    assert.equal(bundle.mode, 'mechanical', bundle.reason)
    assert.deepEqual(bundle.permitted_fields, ['data.product_spec.constraints'])
    assert.deepEqual(
      bundle.current_values['data.product_spec.constraints'],
      value.prior.data.product_spec.constraints,
    )
    assert.equal(bundle.specifications.length, name === 'three' ? 4 : 8)
    assert.match(bundle.derived_views.acceptance_criteria, /AC-\d+ \[proof:/u)
    const scaffold = scaffoldStageOutput(
      value.root,
      value.invocation,
      value.invocation.output.path,
    )
    assert.equal(scaffold.status, 'scaffolded')
    const submitted = { revises: value.prior.invocation_id, patch: value.patch }
    const materialized = materializeOutputSubmission(
      value.root,
      value.state,
      submitted,
      value.invocation.invocation_id,
    )
    assert.equal(
      materialized.revisedFrom?.invocation_id,
      value.prior.invocation_id,
    )
    assert.ok(isRecord(materialized.value) && isRecord(materialized.value.data))
    assert.deepEqual(
      planningCorrectionErrors(
        value.root,
        value.invocation,
        materialized.value.data,
      ),
      [],
    )
    assert.deepEqual(
      materialized.value.data.acceptance_criteria,
      value.retained.data.acceptance_criteria,
    )
    assert.deepEqual(
      materialized.value.data.cohort_plan,
      value.retained.data.cohort_plan,
    )
    assert.deepEqual(
      materialized.value.data.engineering_plan,
      value.retained.data.engineering_plan,
    )
    for (const [file, content] of Object.entries(
      value.retained.specifications,
    )) {
      const authored = (text: string) =>
        text.replace(
          /^\s*-\s+(?:Content digest|Reference status):.*$/gmu,
          '- Reference metadata: <harness>',
        )
      assert.equal(
        authored(readFileSync(path.join(value.root, file), 'utf8')),
        authored(String(content)),
      )
    }
    const full = materializeOutputSubmission(
      value.root,
      value.state,
      materialized.value,
      value.invocation.invocation_id,
    )
    assert.deepEqual(full.value, materialized.value)
  })
}

test('G01 mechanical mode rejects replaced arrays, null deletion, changed narrative, ownership, proof, and migration facts after materialization', () => {
  const value = fixture()
  const criteria = value.retained.data.acceptance_criteria
  assert.ok(Array.isArray(criteria))
  scaffoldStageOutput(
    value.root,
    value.invocation,
    value.invocation.output.path,
  )
  for (const mutation of [
    { acceptance_criteria: [] },
    { acceptance_criteria: null },
    {
      acceptance_criteria: criteria.map((criterion) =>
        isRecord(criterion) ? { ...criterion, proof: 'review' } : criterion,
      ),
    },
    { product_spec: { summary: 'A new product scope.' } },
    { cohort_plan: { chunks: [] } },
    { engineering_plan: { migration: 'Remove the compatibility limit.' } },
    {
      product_spec: {
        constraints: [{ id: 'C-01', statement: 'Changed narrative.' }],
      },
    },
    { product_spec: { out_of_scope: [] } },
  ]) {
    const patch = { ...value.patch, data: { ...value.patch.data, ...mutation } }
    // Exercise RFC 7386 without a cohort finalization error obscuring the preservation verdict.
    const state = { ...value.state, workflow_slug: 'delivery' }
    const result = materializeOutputSubmission(
      value.root,
      state,
      { revises: value.prior.invocation_id, patch },
      value.invocation.invocation_id,
    )
    assert.ok(isRecord(result.value) && isRecord(result.value.data))
    assert.notDeepEqual(
      planningCorrectionErrors(value.root, value.invocation, result.value.data),
      [],
      JSON.stringify(mutation),
    )
  }
  writeFileSync(
    path.join(value.root, value.parentPath),
    '# Changed parent facts\n',
  )
  const data = {
    ...value.prior.data,
    product_spec: {
      ...value.prior.data.product_spec,
      constraints: value.patch.data.product_spec.constraints,
    },
    planning_correction: { mode: 'mechanical' },
  }
  assert.match(
    planningCorrectionErrors(value.root, value.invocation, data).join(' '),
    /Specification bytes changed/u,
  )
})

test('G01 scope, proof, ownership, migration feedback and missing preservation restore ordinary scrutiny', () => {
  for (const diagnostic of [
    'Scope must include another product behavior.',
    'Proof AC-01 must be live.',
    'Owner of US-01 must change.',
    'Migration requires another supported version.',
    '[plan.maps_to_unknown] Unknown field without a precise identifier.',
  ]) {
    const value = fixture()
    assert.ok(value.invocation.prior_failure)
    value.invocation.prior_failure.validation_errors.push(diagnostic)
    assert.equal(
      planningCorrectionBundle(value.root, value.invocation).mode,
      'ordinary',
    )
    assert.deepEqual(
      planningCorrectionErrors(value.root, value.invocation, value.prior.data),
      [],
    )
    assert.notDeepEqual(
      planningCorrectionErrors(value.root, value.invocation, {
        ...value.prior.data,
        planning_correction: { mode: 'mechanical' },
      }),
      [],
    )
  }
  const value = fixture()
  assert.ok(value.invocation.prior_failure)
  const diagnostic = value.invocation.prior_failure.validation_errors[0]
  value.invocation.prior_failure.validation_errors = [
    `${diagnostic}; also change scope`,
  ]
  assert.equal(
    planningCorrectionBundle(value.root, value.invocation).mode,
    'ordinary',
  )
  value.invocation.prior_failure.validation_errors = [diagnostic]
  const withoutOwners = {
    ...value.prior,
    data: { ...value.prior.data, cohort_plan: null },
  }
  writeFileSync(
    path.join(value.root, value.invocation.prior_failure?.output_path ?? ''),
    JSON.stringify(withoutOwners),
  )
  assert.equal(
    planningCorrectionBundle(value.root, value.invocation).mode,
    'ordinary',
  )
  writeFileSync(
    path.join(value.root, value.invocation.prior_failure?.output_path ?? ''),
    JSON.stringify({ invocation_id: value.prior.invocation_id, data: {} }),
  )
  assert.equal(
    planningCorrectionBundle(value.root, value.invocation).mode,
    'ordinary',
  )
  assert.notDeepEqual(
    planningCorrectionErrors(value.root, value.invocation, {
      planning_correction: { mode: 'mechanical' },
    }),
    [],
  )
})

test('G01 stale and absent harness bundles cannot authorize a mechanical correction', () => {
  const value = fixture()
  const data = {
    ...value.prior.data,
    planning_correction: { mode: 'mechanical' },
  }
  assert.match(
    planningCorrectionErrors(value.root, value.invocation, data).join(' '),
    /unavailable/u,
  )
  scaffoldStageOutput(
    value.root,
    value.invocation,
    value.invocation.output.path,
  )
  assert.ok(value.invocation.prior_failure)
  value.invocation.prior_failure.validation_errors[0] += ' changed feedback'
  assert.notDeepEqual(
    planningCorrectionErrors(value.root, value.invocation, data),
    [],
  )
})

test('G01 draft finalization refreshes references only and completed plans remain pinned', () => {
  const value = fixture()
  const output = {
    ...value.prior,
    invocation_id: value.invocation.invocation_id,
    result: 'success',
  }
  const before = structuredClone(output)
  const parent = readFileSync(path.join(value.root, value.parentPath), 'utf8')
  writeFileSync(
    path.join(value.root, value.parentPath),
    `${parent}\nDraft clarification.\n`,
  )
  finalizePlanningReferences(
    value.root,
    value.state,
    output,
    value.invocation.invocation_id,
  )
  assert.deepEqual(output, before)
  assert.ok(
    isRecord(value.retained.data.cohort_plan) &&
      Array.isArray(value.retained.data.cohort_plan.chunks),
  )
  const chunks = value.retained.data.cohort_plan.chunks
  const snapshot = chunks.map((chunk) => {
    assert.ok(isRecord(chunk) && typeof chunk.child_spec_path === 'string')
    const content = readFileSync(
      path.join(value.root, chunk.child_spec_path),
      'utf8',
    )
    const original = value.retained.specifications[chunk.child_spec_path]
    assert.equal(typeof original, 'string')
    assert.equal(
      content
        .replace(/sha256:[0-9a-f]{64}/gu, '<digest>')
        .replace(
          /^\s*-\s+Reference status:.*$/gmu,
          '- Reference status: <metadata>',
        ),
      String(original)
        .replace(/sha256:[0-9a-f]{64}/gu, '<digest>')
        .replace(
          /^\s*-\s+Reference status:.*$/gmu,
          '- Reference status: <metadata>',
        ),
    )
    return content
  })
  writeFileSync(
    path.join(value.root, value.parentPath),
    `${parent}\nLater authored change.\n`,
  )
  finalizePlanningReferences(
    value.root,
    { ...value.state, current_invocation: null },
    output,
    null,
  )
  assert.deepEqual(
    chunks.map((chunk) => {
      assert.ok(isRecord(chunk) && typeof chunk.child_spec_path === 'string')
      return readFileSync(path.join(value.root, chunk.child_spec_path), 'utf8')
    }),
    snapshot,
  )
})
