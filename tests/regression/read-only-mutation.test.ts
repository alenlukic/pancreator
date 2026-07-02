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
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

test('read-only stage fails when a source workspace change is unattributed', () => {
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
  const artifact = `runtime/logs/workflows/${state.run_id}/artifacts/markdown/inspect.md`

  writeFileSync(path.join(root, artifact), '# inspect\n')

  const output = {
    ...makeOutput(root, invocation, stage),
    data: { inspection: { findings: [], verdict: 'pass' } },
  }

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, state.run_id, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')
  assert.ok(
    submitted.record.evaluation.deterministic.some(
      (item) => item.id === 'scope.no_unapproved_changes' && !item.passed,
    ),
  )
  assert.equal(submitted.state.status, 'failed')
})

test('read-only stage allows changes traced to the active agent', () => {
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
  const output = {
    ...makeOutput(root, invocation, stage),
    workspace_changes: {
      attribution: 'internal',
      paths: ['src/base.ts'],
      explanation:
        'The active inspector changed this file while producing the stage output.',
    },
    data: { inspection: { findings: [], verdict: 'pass' } },
  }

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, state.run_id, invocation.output.path)
  const cleanliness = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )

  assert.equal(cleanliness?.passed, true)
  assert.match(cleanliness?.explanation ?? '', /no external contamination/u)
})
