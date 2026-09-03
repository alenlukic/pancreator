import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  prepareInvocation,
  validateOutputForSubmission,
} from '../../src/lib/engine.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { createFixture, createRun, makeOutput, writeJson } from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

const SPOTFIX_OUTCOME = `# Spotfix outcome

Validation cycle 1 completed with npm run lint.
`

test('requirements run selects required SPOT-001 binding for SPOTFIX-VALIDATE-001', () => {
  const root = createFixture()
  const targetPath = 'runtime/inbox/spotfix-outcome.md'

  writeFileSync(path.join(root, targetPath), SPOTFIX_OUTCOME)

  const stdout = execFileSync(
    process.execPath,
    [
      CLI,
      'requirements',
      'run',
      '--persona',
      'spotfixer',
      '--workflow',
      'standalone',
      '--stage',
      'spotfix',
      '--kind',
      'spotfix',
      '--registry',
      'SPOTFIX-VALIDATE-001',
      '--target',
      targetPath,
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  const result = JSON.parse(stdout) as {
    status: string
    exit_code: number
    policy_id: string
    requirement_id: string
  }

  assert.equal(result.status, 'passed')
  assert.equal(result.exit_code, 0)
  assert.equal(result.policy_id, 'SPOT-001')
  assert.equal(result.requirement_id, 'spotfix-validate')
})

test('requirements run preserves ambiguity when duplicate required bindings remain', () => {
  const root = createFixture()
  const targetPath = 'runtime/inbox/spotfix-outcome.md'
  const engPolicyPath = path.join(root, 'governance/policies/ENG-001.json')

  writeFileSync(path.join(root, targetPath), SPOTFIX_OUTCOME)

  const engPolicy = JSON.parse(readFileSync(engPolicyPath, 'utf8')) as {
    requirements: Array<{ enforcement: string }>
  }

  engPolicy.requirements[0].enforcement = 'required'
  writeFileSync(engPolicyPath, `${JSON.stringify(engPolicy, null, 2)}\n`)

  assert.equal(
    resolveRequirements(root, {
      persona: 'spotfixer',
      workflow: 'standalone',
      stage: 'spotfix',
      invocation_kind: 'spotfix',
      invocation: { output_path: targetPath, artifact_paths: [targetPath] },
    }).validation_requirements.filter(
      (item) =>
        item.registry_id === 'SPOTFIX-VALIDATE-001' &&
        item.enforcement === 'required',
    ).length,
    2,
  )

  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          CLI,
          'requirements',
          'run',
          '--persona',
          'spotfixer',
          '--workflow',
          'standalone',
          '--stage',
          'spotfix',
          '--kind',
          'spotfix',
          '--registry',
          'SPOTFIX-VALIDATE-001',
          '--target',
          targetPath,
          '--json',
        ],
        { cwd: root, encoding: 'utf8', stdio: 'pipe' },
      ),
    /resolved more than once/u,
  )
})

test('output validate mirrors the deterministic submission checks', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'request.md',
    title: 'Output validation submission mirror fixture',
  })
  const workflow = loadWorkflow(root, 'planning')
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'plan'))
  const invocationRelative = resolveRunLayout(root, state.run_id).invocation(
    invocation.invocation_id,
    '.json',
  ).relative

  writeJson(path.join(root, invocation.output.path), output)

  // The stage resolves no agent-owned validator requirement, so results is
  // empty.
  const stdout = execFileSync(
    process.execPath,
    [
      CLI,
      'output',
      'validate',
      state.run_id,
      '--file',
      invocation.output.path,
      '--invocation',
      invocationRelative,
      '--json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  const result = JSON.parse(stdout) as {
    passed: boolean
    submission_checks: Array<{ id: string; passed: boolean }>
    results: unknown[]
  }

  assert.equal(result.passed, true)
  assert.ok(result.submission_checks.length > 0)
  assert.equal(result.results.length, 0)

  const corrupted = structuredClone(output) as unknown as Record<
    string,
    unknown
  >
  const attestation = corrupted.invocation_attestation as Record<
    string,
    unknown
  >

  attestation.model = 'wrong-model'
  writeJson(path.join(root, invocation.output.path), corrupted)

  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          CLI,
          'output',
          'validate',
          state.run_id,
          '--file',
          invocation.output.path,
          '--invocation',
          invocationRelative,
        ],
        { cwd: root, encoding: 'utf8' },
      ),
    (error: unknown) => {
      const failure = error as { status?: number; stdout?: string }

      assert.equal(failure.status, 1)
      assert.match(String(failure.stdout), /attestation\.model: FAIL/u)

      return true
    },
  )
})

// The harness renders the operator brief during submission, so the mirror must
// not report its absence as a defect.
test('output validate exempts the unrendered operator brief but not other missing artifacts', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Output validation operator brief fixture',
    involvement: 'standard',
    operatorArtifacts: true,
  })
  const workflow = loadWorkflow(root, 'delivery')
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)

  const brief = invocation.output.operator_brief

  assert.ok(brief)

  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, invocation.stage.slug),
  )

  assert.ok(
    output.artifacts.some((artifact) => artifact.path === brief.rendered_path),
  )
  rmSync(path.join(root, brief.rendered_path))

  const beforeRender = validateOutputForSubmission(
    root,
    state.run_id,
    invocation,
    output,
  )

  assert.equal(
    beforeRender.passed,
    true,
    JSON.stringify(beforeRender.checks, null, 2),
  )

  const withMissingArtifact = {
    ...output,
    artifacts: [
      ...output.artifacts,
      {
        path: 'runtime/inbox/never-written.md',
        description: 'Fixture artifact that was never written',
      },
    ],
  }
  const missing = validateOutputForSubmission(
    root,
    state.run_id,
    invocation,
    withMissingArtifact,
  )

  assert.equal(missing.passed, false)
  assert.ok(
    missing.checks.some(
      (check) =>
        !check.passed &&
        check.message ===
          'artifact does not exist: runtime/inbox/never-written.md',
    ),
  )
  assert.ok(
    missing.checks.every(
      (check) => check.passed || !check.message.includes(brief.rendered_path),
    ),
  )
})
