import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  decideRun,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import {
  listWorkflowSlugs,
  loadWorkflow,
  stageBySlug,
} from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

test('new runs suppress briefs while explicit run and stage requests enable them', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const suppressed = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const suppressedInvocation = prepareInvocation(
    root,
    suppressed.run_id,
  ).invocation

  assert.ok(suppressedInvocation)
  assert.deepEqual(suppressed.operator_artifacts, {
    mode: 'suppressed',
    requested_stages: [],
  })
  assert.equal(suppressedInvocation.output.operator_brief, undefined)
  assert.equal(
    suppressedInvocation.requirements?.validation_requirements.some(
      (requirement) =>
        requirement.registry_id === 'OPERATOR-ARTIFACT-VALIDATE-001' ||
        requirement.registry_id === 'SIMPLIFIED-ENGLISH-VALIDATE-001',
    ),
    false,
  )

  const output = makeOutput(
    root,
    suppressedInvocation,
    stageBySlug(workflow, 'intake'),
  )

  assert.deepEqual(output.artifacts, [])

  const runRequested = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    operatorArtifacts: true,
  })
  const runInvocation = prepareInvocation(root, runRequested.run_id).invocation

  assert.ok(runInvocation?.output.operator_brief)
  assert.equal(runRequested.operator_artifacts?.mode, 'requested')

  const stageRequested = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const stagePrepared = prepareInvocation(root, stageRequested.run_id, {
    operatorArtifacts: true,
  })

  assert.ok(stagePrepared.invocation?.output.operator_brief)
  assert.deepEqual(stagePrepared.state.operator_artifacts, {
    mode: 'suppressed',
    requested_stages: ['intake'],
  })

  const stageInvocation = stagePrepared.invocation

  assert.ok(stageInvocation)

  const stageOutput = makeOutput(
    root,
    stageInvocation,
    stageBySlug(workflow, 'intake'),
  )

  writeJson(path.join(root, stageInvocation.output.path), stageOutput)
  writeCanonicalDelegation(root, stageInvocation)
  submitOutput(root, stageRequested.run_id, stageInvocation.output.path)
  decideRun(root, stageRequested.run_id, 'approve')

  const laterInvocation = prepareInvocation(
    root,
    stageRequested.run_id,
  ).invocation

  assert.ok(laterInvocation)
  assert.equal(laterInvocation.stage.slug, 'plan')
  assert.equal(laterInvocation.output.operator_brief, undefined)
})

test('legacy run state without artifact selection keeps briefs enabled', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const layout = resolveRunLayout(root, state.run_id)
  const legacy = { ...state } as Record<string, unknown>

  delete legacy.operator_artifacts
  writeJson(layout.state.absolute, legacy)

  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation?.output.operator_brief)
})

test('a stage artifact request is rejected after invocation preparation', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })

  prepareInvocation(root, state.run_id)

  assert.throws(
    () =>
      prepareInvocation(root, state.run_id, {
        operatorArtifacts: true,
      }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      (error as Error & { code: string }).code ===
        'OPERATOR_ARTIFACT_REQUEST_TOO_LATE',
  )
})

test('every workflow slug prepares without a brief by default', () => {
  const root = createFixture()

  for (const workflowSlug of listWorkflowSlugs(root)) {
    const state = createRun(root, {
      workflowSlug,
      requestPath: 'request.md',
    })
    const invocation = prepareInvocation(root, state.run_id).invocation

    assert.ok(invocation)
    assert.equal(
      invocation.output.operator_brief,
      undefined,
      `${workflowSlug} defaults to suppressed artifacts`,
    )
  }
})

test('submission rerenders the invocation-declared HTML brief from JSON', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    operatorArtifacts: true,
  })
  const prepared = prepareInvocation(root, state.run_id)
  const invocation = prepared.invocation

  assert.ok(invocation)
  const brief = invocation.output.operator_brief

  assert.ok(brief)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'intake'))
  const htmlPath = path.join(root, brief.rendered_path)

  rmSync(htmlPath)
  assert.equal(existsSync(htmlPath), false)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, state.run_id, invocation.output.path)

  assert.equal(existsSync(htmlPath), true)
  assert.match(readFileSync(htmlPath, 'utf8'), /class="pc-brief"/u)
  assert.equal(submitted.record.evaluation.validation_errors.length, 0)
})
