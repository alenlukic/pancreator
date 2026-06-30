import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  assessStage,
  createRun,
  decideRun,
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

function makeNestedRepo(root: string, relative: string): string {
  const repo = path.join(root, relative)

  mkdirSync(repo, { recursive: true })
  appendFileSync(path.join(root, '.gitignore'), `${relative}/\n`)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], {
    cwd: repo,
  })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: repo })
  writeFileSync(path.join(repo, 'README.md'), '# deliverable\n')
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'init capsule'], { cwd: repo })

  return repo
}

test('init --workspace records the deliverable repo and surfaces it on the card', () => {
  const root = createFixture()

  makeNestedRepo(root, 'nested/project')

  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Targeted run',
    workspace: 'nested/project',
  })

  assert.equal(state.workspace_root, 'nested/project')

  const prepared = prepareInvocation(root, state.run_id)

  assert.ok(prepared.invocation)
  assert.equal(prepared.invocation.workspace_root, 'nested/project')
})

test('gate overrides replace and disable deterministic shell gates', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')

  writeJson(path.join(root, 'gates.json'), {
    'implement.lint': 'true',
    'implement.unit_tests': false,
  })

  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Gate override run',
    gatesPath: 'gates.json',
  })
  const runId = state.run_id

  assert.deepEqual(state.gate_overrides, {
    'implement.lint': 'true',
    'implement.unit_tests': false,
  })

  for (const stageSlug of ['intake', 'plan', 'implement']) {
    const prepared = prepareInvocation(root, runId)
    const invocation = prepared.invocation

    assert.ok(invocation)

    const stage = stageBySlug(workflow, stageSlug)
    const output = makeOutput(root, invocation, stage)

    writeJson(path.join(root, invocation.output.path), output)

    if (stage.persona !== 'orchestrator') {
      writeCanonicalDelegation(root, invocation)
    }

    const submitted = submitOutput(root, runId, invocation.output.path)

    if (stageSlug === 'intake') {
      decideRun(root, runId, 'approve', 'fixture approval')
    } else if (stageSlug === 'plan') {
      if (submitted.state.pending_action.type !== 'supervisor_assessment') {
        throw new Error('Expected supervisor assessment action')
      }

      const assessmentPath = submitted.state.pending_action.output_path

      writeJson(path.join(root, assessmentPath), {
        schema_version: 1,
        assessment_id: 'assessment-override',
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
    } else {
      const overridden = submitted.record.evaluation.deterministic.find(
        (item) => item.id === 'implement.lint',
      )
      const disabled = submitted.record.evaluation.deterministic.find(
        (item) => item.id === 'implement.unit_tests',
      )

      assert.ok(overridden)
      assert.equal(overridden.overridden, true)
      assert.equal(overridden.command, 'true')
      assert.ok(disabled)
      assert.equal(disabled.disabled, true)
      assert.equal(disabled.passed, true)
      assert.equal(submitted.record.outcome, 'success')
    }
  }
})

test('scope guard catches edits inside the targeted nested repo during a non-source stage', () => {
  const root = createFixture()
  const repo = makeNestedRepo(root, 'nested/project')
  const workflow = loadWorkflow(root, 'dev')

  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Scope guard run',
    workspace: 'nested/project',
  })
  const runId = state.run_id

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'intake')

  appendFileSync(path.join(repo, 'README.md'), 'unapproved edit\n')

  const stage = stageBySlug(workflow, 'intake')
  const output = makeOutput(root, invocation, stage)

  writeJson(path.join(root, invocation.output.path), output)

  const submitted = submitOutput(root, runId, invocation.output.path)
  const scope = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )

  assert.ok(scope)
  assert.equal(scope.passed, false)
  assert.equal(submitted.record.outcome, 'failure')
})
