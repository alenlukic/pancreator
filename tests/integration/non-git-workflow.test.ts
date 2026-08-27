import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  decideRun,
  getRunState,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { syncCursorProjection } from '../../src/lib/projection.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

test('delivery workflow runs to completion without a Git repository', () => {
  const root = createFixture()
  const projectPath = path.join(root, 'config.json')
  const project = JSON.parse(readFileSync(projectPath, 'utf8')) as Record<
    string,
    unknown
  >

  project.installation_mode = 'embedded'
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`)
  syncCursorProjection(root, { write: true })

  rmSync(path.join(root, '.git'), { recursive: true, force: true })

  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Non-git run',
  })
  const runId = state.run_id

  for (const stageSlug of ['plan', 'implement', 'verify', 'ship']) {
    const prepared = prepareInvocation(root, runId)

    const invocation = prepared.invocation

    assert.ok(invocation)
    assert.equal(invocation.stage.slug, stageSlug)

    const stage = stageBySlug(workflow, stageSlug)
    const output = makeOutput(
      root,
      invocation,
      stage,
      'success',
      getRunState(root, runId),
    )

    writeJson(path.join(root, invocation.output.path), output)

    if (stage.persona !== 'orchestrator') {
      writeCanonicalDelegation(root, invocation)
    }

    const submitted = submitOutput(root, runId, invocation.output.path)

    assert.equal(
      submitted.record.outcome,
      'success',
      `${stageSlug}: ${JSON.stringify(submitted.record.evaluation)}`,
    )

    if (stageSlug === 'plan' || stageSlug === 'ship') {
      decideRun(root, runId, 'approve', 'fixture approval')
    }
  }

  const final = getRunState(root, runId)

  assert.equal(final.status, 'succeeded')
  assert.ok(final.state_root)
})
