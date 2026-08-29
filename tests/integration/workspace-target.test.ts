import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  getRunState,
  prepareInvocation,
  setRunStage,
  submitOutput,
} from '../../src/lib/engine.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { runRepositoryCheck } from '../../src/lib/repository-checks.js'
import { runDir } from '../../src/lib/state.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

import { worktreeCheckpoint } from './worktree-helpers.js'

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

test('repository checks run in an explicitly targeted workspace', () => {
  const { root, worktrees } = worktreeCheckpoint('single')
  const worktree = worktrees.alpha

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      fast: { probes: [], commands: ['node -e "process.exit(0)"'] },
    },
  })

  const check = runRepositoryCheck(root, 'fast', { workspace: worktree.path })

  assert.equal(check.status, 'passed')
  assert.equal(
    realpathSync(check.workspace_root),
    realpathSync(path.join(root, worktree.path)),
  )
})

test('pre-implementation baselines use the run workspace', () => {
  const { root, worktrees } = worktreeCheckpoint('single')
  const worktree = worktrees.alpha
  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Worktree baseline run',
    workspace: worktree.path,
  })

  writeJson(path.join(root, 'runtime/repository-checks.json'), {
    schema_version: 1,
    profiles: {
      static: { probes: [], commands: ['node -e "0 // static"'] },
      fast: { probes: [], commands: ['node -e "0 // fast"'] },
      full: { probes: [], commands: ['node -e "0 // full"'] },
      configuration: { probes: [], commands: ['node -e "0 // configuration"'] },
    },
  })

  setRunStage(root, state.run_id, 'implement', 'Capture worktree baselines.')

  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)

  const baseline = getRunState(root, state.run_id).repository_check_baselines
    ?.static

  assert.ok(baseline)

  const baselineArtifact = JSON.parse(
    readFileSync(path.join(root, baseline.artifact_path), 'utf8'),
  ) as {
    result: { workspace_root: string }
  }

  assert.equal(
    realpathSync(baselineArtifact.result.workspace_root),
    realpathSync(path.join(root, worktree.path)),
  )
})

// createRun snapshots the override file into state; the gate evaluator then
// decides per shell criterion, so the evaluator is exercised directly on the
// implement stage instead of through a plan and an implement submission.
test('gate overrides replace and disable deterministic shell gates', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')

  writeJson(path.join(root, 'gates.json'), {
    'implement.lint': 'true',
    'implement.unit_tests': false,
  })

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Gate override run',
    gatesPath: 'gates.json',
  })

  assert.deepEqual(state.gate_overrides, {
    'implement.lint': 'true',
    'implement.unit_tests': false,
  })

  const stage = stageBySlug(workflow, 'implement')
  const { results } = evaluateDeterministicCriteria(
    root,
    runDir(root, state.run_id),
    state,
    stage,
    gitWorkspaceSnapshot(root),
    root,
    state.gate_overrides ?? {},
  )
  const overridden = results.find((item) => item.id === 'implement.lint')
  const disabled = results.find((item) => item.id === 'implement.unit_tests')

  assert.ok(overridden)
  assert.equal(overridden.overridden, true)
  assert.equal(overridden.command, 'true')
  assert.equal(overridden.passed, true)
  assert.ok(disabled)
  assert.equal(disabled.disabled, true)
  assert.equal(disabled.passed, true)
  assert.ok(results.every((item) => item.passed))
})

test('scope guard catches edits inside the targeted nested repo during a non-source stage', () => {
  const root = createFixture()
  const repo = makeNestedRepo(root, 'nested/project')
  const workflow = loadWorkflow(root, 'delivery')

  const state = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Scope guard run',
    workspace: 'nested/project',
  })
  const runId = state.run_id

  // init --workspace records the deliverable repo and surfaces it on the card.
  assert.equal(state.workspace_root, 'nested/project')

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'plan')
  assert.equal(invocation.workspace_root, 'nested/project')

  appendFileSync(path.join(repo, 'README.md'), 'unapproved edit\n')

  const stage = stageBySlug(workflow, 'plan')
  const output = makeOutput(root, invocation, stage)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitOutput(root, runId, invocation.output.path)
  const scope = submitted.record.evaluation.deterministic.find(
    (item) => item.id === 'scope.no_unapproved_changes',
  )

  assert.ok(scope)
  assert.equal(scope.passed, false)
  assert.equal(submitted.record.outcome, 'failure')
})
