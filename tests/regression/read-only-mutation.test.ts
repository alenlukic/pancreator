import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, makeOutput, writeJson } from '../helpers.js'

test('read-only stage fails when the source workspace changes', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'preflight')
  const state = createRun(root, {
    workflowSlug: 'preflight',
    requestPath: 'request.md',
  })
  const prepared = prepareInvocation(root, state.run_id)
  const invocation = prepared.invocation

  assert.ok(invocation)

  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = false\n',
  )

  const stage = stageBySlug(workflow, 'inspect')
  const artifact = `runtime/logs/workflows/${state.run_id}/artifacts/inspect.md`

  writeFileSync(path.join(root, artifact), '# inspect\n')

  const output = {
    ...makeOutput(root, invocation, stage),
    data: { inspection: { findings: [], verdict: 'pass' } },
  }

  writeJson(path.join(root, invocation.output.path), output)

  const submitted = submitOutput(root, state.run_id, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  assert.ok(
    submitted.record.evaluation.deterministic.some(
      (item) => item.id === 'scope.no_unapproved_changes' && !item.passed,
    ),
  )
  assert.equal(submitted.state.status, 'failed')
})
