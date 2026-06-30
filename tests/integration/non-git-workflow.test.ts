import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import { syncCursorProjection } from '../../src/lib/projection.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

test('dev workflow runs to completion without a Git repository', () => {
  const root = createFixture()
  const projectPath = path.join(root, 'project.json')
  const project = JSON.parse(readFileSync(projectPath, 'utf8')) as Record<
    string,
    unknown
  >

  project.installation_mode = 'embedded'
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`)
  syncCursorProjection(root, { write: true })

  rmSync(path.join(root, '.git'), { recursive: true, force: true })

  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Non-git run',
  })
  const runId = state.run_id

  for (const stageSlug of [
    'intake',
    'plan',
    'implement',
    'review',
    'test',
    'validate-changes',
    'ship',
  ]) {
    const prepared = prepareInvocation(root, runId)

    if (stageSlug === 'validate-changes') {
      assert.equal(prepared.invocation, null)
      continue
    }

    const invocation = prepared.invocation

    assert.ok(invocation)
    assert.equal(invocation.stage.slug, stageSlug)

    const stage = stageBySlug(workflow, stageSlug)
    const output = makeOutput(root, invocation, stage)

    writeJson(path.join(root, invocation.output.path), output)

    if (stage.persona !== 'orchestrator') {
      writeCanonicalDelegation(root, invocation)
    }

    const submitted = submitOutput(root, runId, invocation.output.path)

    if (stageSlug === 'intake' || stageSlug === 'ship') {
      decideRun(root, runId, 'approve', 'fixture approval')
      continue
    }

    if (stageSlug === 'plan') {
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
  const stateRoot = final.state_root

  assert.equal(final.status, 'succeeded')
  assert.ok(stateRoot)
  assert.equal(
    existsSync(path.join(stateRoot, 'workflows', runId, 'baseline.json')),
    true,
  )
  assert.equal(
    existsSync(
      path.join(stateRoot, 'workflows', runId, 'ledger-validation.json'),
    ),
    true,
  )
})
