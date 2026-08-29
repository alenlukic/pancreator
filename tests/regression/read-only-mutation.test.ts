import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
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
  const stage = stageBySlug(workflow, 'inspect')

  const unattributed = createRun(root, {
    workflowSlug: 'preflight',
    requestPath: 'request.md',
  })
  const first = prepareInvocation(root, unattributed.run_id).invocation

  assert.ok(first)

  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = false\n',
  )

  const artifact = resolveRunLayout(root, unattributed.run_id).operatorMarkdown(
    'inspect.md',
  ).absolute

  mkdirSync(path.dirname(artifact), { recursive: true })
  writeFileSync(artifact, '# inspect\n')
  writeJson(path.join(root, first.output.path), {
    ...makeOutput(root, first, stage),
    data: { inspection: { findings: [], verdict: 'pass' } },
  })
  writeCanonicalDelegation(root, first)

  const failed = submitOutput(root, unattributed.run_id, first.output.path)

  assert.equal(failed.record.outcome, 'failure')
  assert.ok(
    failed.record.evaluation.deterministic.some(
      (item) => item.id === 'scope.no_unapproved_changes' && !item.passed,
    ),
  )
  assert.equal(failed.state.status, 'failed')

  const attributed = createRun(root, {
    workflowSlug: 'preflight',
    requestPath: 'request.md',
  })
  const second = prepareInvocation(root, attributed.run_id).invocation

  assert.ok(second)

  writeFileSync(path.join(root, 'src', 'base.ts'), 'export const base = null\n')
  writeJson(path.join(root, second.output.path), {
    ...makeOutput(root, second, stage),
    workspace_changes: {
      attribution: 'internal',
      paths: ['src/base.ts'],
      explanation:
        'The active inspector changed this file while producing the stage output.',
    },
    data: { inspection: { findings: [], verdict: 'pass' } },
  })
  writeCanonicalDelegation(root, second)

  const passed = submitOutput(root, attributed.run_id, second.output.path)
  const cleanliness = passed.record.evaluation.deterministic.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )

  assert.equal(cleanliness?.passed, true)
})
