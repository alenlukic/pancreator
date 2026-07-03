import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, makeOutput, writeJson } from '../helpers.js'

test('submission rerenders the invocation-declared HTML brief from JSON', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const prepared = prepareInvocation(root, state.run_id)
  const invocation = prepared.invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'intake'))
  const htmlPath = path.join(
    root,
    invocation.output.operator_brief.rendered_path,
  )

  rmSync(htmlPath)
  assert.equal(existsSync(htmlPath), false)

  writeJson(path.join(root, invocation.output.path), output)
  const submitted = submitOutput(root, state.run_id, invocation.output.path)

  assert.equal(existsSync(htmlPath), true)
  assert.match(readFileSync(htmlPath, 'utf8'), /class="pc-brief"/u)
  assert.equal(submitted.record.evaluation.validation_errors.length, 0)
})
