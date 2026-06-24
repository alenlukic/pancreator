import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  assessStage,
  createRun,
  decideRun,
  getRunState,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, makeOutput, writeJson } from '../helpers.js'

test('full dev workflow persists gates and reaches operator-approved success', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Fixture run',
  })
  const runId = state.run_id

  assert.equal(state.pipeline_config?.name, 'default')
  assert.match(
    state.pipeline_config?.path ?? '',
    /pipeline-config\.snapshot\.json$/u,
  )

  for (const stageSlug of [
    'intake',
    'plan',
    'implement',
    'review',
    'test',
    'ship',
  ]) {
    const prepared = prepareInvocation(root, runId)
    const invocation = prepared.invocation

    assert.ok(invocation)
    assert.equal(invocation.stage.slug, stageSlug)
    assert.equal(invocation.stage.model_config, 'default')
    assert.ok(invocation.stage.model.length > 0)

    const stage = stageBySlug(workflow, stageSlug)
    const output = makeOutput(root, invocation, stage)

    writeJson(path.join(root, invocation.output.path), output)

    const submitted = submitOutput(root, runId, invocation.output.path)

    assert.equal(submitted.record.outcome, 'success')

    if (stageSlug === 'intake') {
      const repeated = submitOutput(root, runId, invocation.output.path)

      assert.equal(repeated.idempotent, true)
      assert.equal(repeated.record.invocation_id, invocation.invocation_id)
    }

    if (stageSlug === 'intake' || stageSlug === 'ship') {
      assert.equal(submitted.state.status, 'awaiting_operator')
      decideRun(root, runId, 'approve', 'fixture approval')
    } else if (stageSlug === 'plan') {
      assert.equal(submitted.state.status, 'awaiting_supervisor')
      assert.equal(submitted.state.pending_action.type, 'supervisor_assessment')

      if (submitted.state.pending_action.type !== 'supervisor_assessment') {
        throw new Error('Expected supervisor assessment action')
      }

      const assessmentPath = submitted.state.pending_action.output_path

      writeJson(path.join(root, assessmentPath), {
        schema_version: 1,
        assessment_id: randomUUID(),
        invocation_id: invocation.invocation_id,
        verdict: 'pass',
        summary: 'Plan is implementation-ready.',
        criteria: stage.criteria.map((criterion) => ({
          id: criterion.id,
          result: 'pass',
          evidence: [invocation.output.path],
          explanation: 'Fixture evidence',
        })),
      })
      assessStage(root, runId, assessmentPath)
    }
  }

  const final = getRunState(root, runId)

  assert.equal(final.status, 'succeeded')
  assert.equal(final.current_stage, null)
  assert.equal(final.stage_history.length, 6)
  assert.ok(final.stage_history.every((item) => item.record_path))
})

test('run preparation rejects live pipeline-config drift from its snapshot', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const configPath = path.join(root, 'pipeline.config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    active_config: string
  }

  config.active_config = 'fable'
  writeJson(configPath, config)

  assert.throws(
    () => prepareInvocation(root, state.run_id),
    /live active mapping has changed/u,
  )
})
