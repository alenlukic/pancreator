import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import { BRIEFS, checkpoint } from './delivery-helpers.js'

test('new runs suppress briefs while explicit run and stage requests enable them', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const suppressed = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const suppressedInvocation = prepareInvocation(
    root,
    suppressed.run_id,
  ).invocation

  assert.ok(suppressedInvocation)

  assert.throws(
    () =>
      prepareInvocation(root, suppressed.run_id, {
        operatorArtifacts: true,
      }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      (error as Error & { code: string }).code ===
        'OPERATOR_ARTIFACT_REQUEST_TOO_LATE',
  )
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
    stageBySlug(workflow, 'implement'),
  )

  assert.deepEqual(output.artifacts, [])

  const runRequested = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    operatorArtifacts: true,
  })
  const runInvocation = prepareInvocation(root, runRequested.run_id).invocation

  assert.ok(runInvocation?.output.operator_brief)
  assert.equal(runRequested.operator_artifacts?.mode, 'requested')

  const stageRequested = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })
  const stagePrepared = prepareInvocation(root, stageRequested.run_id, {
    operatorArtifacts: true,
  })

  assert.ok(stagePrepared.invocation?.output.operator_brief)
  assert.deepEqual(stagePrepared.state.operator_artifacts, {
    mode: 'suppressed',
    requested_stages: ['implement'],
  })

  const stageInvocation = stagePrepared.invocation

  assert.ok(stageInvocation)

  const stageOutput = makeOutput(
    root,
    stageInvocation,
    stageBySlug(workflow, 'implement'),
  )

  writeJson(path.join(root, stageInvocation.output.path), stageOutput)
  writeCanonicalDelegation(root, stageInvocation)
  submitAsSupervisor(root, stageRequested.run_id, stageInvocation.output.path)

  const laterInvocation = prepareInvocation(
    root,
    stageRequested.run_id,
  ).invocation

  assert.ok(laterInvocation)
  assert.equal(laterInvocation.stage.slug, 'verify')
  assert.equal(laterInvocation.output.operator_brief, undefined)
})

test('submission rerenders the invocation-declared HTML brief from JSON', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'planning@plan-prepared',
    BRIEFS,
  )

  assert.ok(invocation)
  const brief = invocation.output.operator_brief

  assert.ok(brief)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'plan'))
  const htmlPath = path.join(root, brief.rendered_path)

  rmSync(htmlPath)
  assert.equal(existsSync(htmlPath), false)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(existsSync(htmlPath), true)
  assert.match(readFileSync(htmlPath, 'utf8'), /class="pc-brief"/u)
  assert.equal(submitted.record.evaluation.validation_errors.length, 0)
})
