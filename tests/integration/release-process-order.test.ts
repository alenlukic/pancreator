import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine/prepare.js'
import {
  collectReleaseEvidence,
  readReleaseEvidence,
} from '../../src/lib/release-landing/evidence.js'
import { landRelease } from '../../src/lib/release-landing.js'
import { loadState } from '../../src/lib/state.js'
import { syncCursorProjection } from '../../src/lib/projection.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { readWorktreeIndex } from '../../src/lib/worktrees.js'
import { writeJson } from '../helpers.js'
import { createRun } from '../run-helpers.js'
import { submitStageOutput } from './delivery-helpers.js'
import {
  git,
  landingFixture,
  makeCandidate,
  readLandingLog,
  setProfileCommand,
} from './release-landing-helpers.js'

function shellRun(root: string, workspace = root) {
  const directory = path.join(root, 'library/workflows/release-shell')
  mkdirSync(path.join(directory, 'stages'), { recursive: true })
  mkdirSync(path.join(directory, 'prompts'), { recursive: true })
  const workflow = loadWorkflow(root, 'delivery')
  const verify = stageBySlug(workflow, 'verify')
  const ship = stageBySlug(workflow, 'ship')
  writeJson(path.join(directory, 'workflow.json'), {
    schema_version: 1,
    slug: 'release-shell',
    title: 'Release shell validation',
    start_stage: 'verify',
    limits: workflow.limits,
    stages: ['verify', 'ship'],
  })
  writeFileSync(
    path.join(directory, 'prompts/shell.md'),
    'Run the declared shell checks. This fixture asserts no product acceptance.\n',
  )
  for (const stage of [verify, ship]) {
    writeJson(path.join(directory, 'stages', `${stage.slug}.json`), {
      ...stage,
      persona: 'orchestrator',
      evidence_workers: undefined,
      scoped_return: undefined,
      context: { request: 'omit' },
      prompt_path: 'library/workflows/release-shell/prompts/shell.md',
      workspace_policy: 'read_only',
      required_data: {},
      blocked_required_data: {},
      criteria:
        stage.slug === 'verify'
          ? verify.criteria.filter((item) => item.type === 'shell')
          : [],
      transitions: {
        success: stage.slug === 'verify' ? 'ship' : 'succeeded',
        failure: 'paused',
        blocked: 'paused',
      },
    })
  }
  const lookupPath = path.join(
    root,
    'governance/registries/policy_lookup_table.json',
  )
  const lookup = JSON.parse(readFileSync(lookupPath, 'utf8')) as {
    rows: unknown[]
  }
  lookup.rows.push({
    persona: 'orchestrator',
    workflow: 'release-shell',
    stage: 'verify',
    policies: ['VERIFY-001'],
  })
  lookup.rows.push({
    persona: 'orchestrator',
    workflow: 'release-shell',
    stage: 'ship',
    policies: ['SHIP-001'],
  })
  writeJson(lookupPath, lookup)
  syncCursorProjection(root, { write: true })
  const worktree = readWorktreeIndex(root).worktrees.find(
    (entry) => path.resolve(root, entry.path) === path.resolve(workspace),
  )
  const state = createRun(root, {
    workflowSlug: 'release-shell',
    requestPath: 'request.md',
    workspace,
    ...(worktree ? { worktree } : {}),
  })
  const stage = stageBySlug(loadWorkflow(root, 'release-shell'), 'verify')
  return { state, stage }
}

test('verify runs release checks last and skips them after an earlier failure', () => {
  const root = landingFixture()
  const { state, stage } = shellRun(root)
  setProfileCommand(root, 'configuration', 'node -e "process.exit(1)"')
  setProfileCommand(
    root,
    'full',
    "node -e \"require('node:fs').writeFileSync('release-tests-ran','bad')\"",
  )
  const snapshot = gitWorkspaceSnapshot(root)
  const result = evaluateDeterministicCriteria(
    root,
    path.join(root, 'runtime'),
    state,
    stage,
    snapshot,
    root,
  )
  assert.deepEqual(
    result.results
      .filter((item) => item.type === 'shell')
      .map((item) => item.id),
    ['ship.validate', 'ship.full_suite', 'verify.fast_wall_ceiling'],
  )
  assert.equal(
    result.results.find((item) => item.id === 'ship.validate')?.passed,
    false,
  )
  assert.equal(
    result.results.find((item) => item.id === 'ship.full_suite')?.skipped,
    true,
  )
  assert.equal(
    result.results.find((item) => item.id === 'verify.fast_wall_ceiling')
      ?.skipped,
    true,
  )
  assert.equal(existsSync(path.join(root, 'release-tests-ran')), false)
  for (const name of ['delivery', 'metacritic']) {
    const flow = loadWorkflow(root, name)
    assert.equal(stageBySlug(flow, 'ship').entry_gate, undefined)
    assert.equal(
      stageBySlug(flow, 'ship').criteria.some((item) => item.type === 'shell'),
      false,
    )
    assert.deepEqual(
      stageBySlug(flow, 'verify')
        .criteria.slice(-3)
        .map((item) => item.id),
      ['ship.validate', 'ship.full_suite', 'verify.fast_wall_ceiling'],
    )
  }
})

test('source mutation during the final verify check cannot produce release proof', () => {
  const root = landingFixture()
  const { state, stage } = shellRun(root)
  setProfileCommand(
    root,
    'full',
    "node -e \"require('node:fs').writeFileSync('src/changed-by-check.ts','export const changed = true')\"",
  )
  const snapshot = gitWorkspaceSnapshot(root)
  const result = evaluateDeterministicCriteria(
    root,
    path.join(root, 'runtime'),
    state,
    stage,
    snapshot,
    root,
  )
  const final = result.results.find((item) => item.id === 'ship.full_suite')
  assert.equal(final?.passed, false)
  assert.equal(final?.verified_source, undefined)
  assert.equal(
    result.results.find((item) => item.id === 'verify.fast_wall_ceiling')
      ?.skipped,
    true,
  )
})

test('release consumes one bundle and allocates only after successful verification', () => {
  const root = landingFixture()
  const workspace = makeCandidate(
    root,
    'release-once',
    '### Fixed\n\n- Preserve the verified release sequence.',
  )
  const changelogPath = path.join(workspace, 'CHANGELOG.md')
  writeFileSync(
    changelogPath,
    readFileSync(changelogPath, 'utf8').replace(
      '## [9.9.9] - 2026-09-26',
      '## [Unreleased]',
    ),
  )
  const packagePath = path.join(workspace, 'package.json')
  const candidatePackage = JSON.parse(
    readFileSync(packagePath, 'utf8'),
  ) as Record<string, unknown>
  candidatePackage.description = 'Preserve the verified candidate manifest'
  writeFileSync(packagePath, JSON.stringify(candidatePackage, null, 2) + '\n')
  git(workspace, ['add', 'CHANGELOG.md', 'package.json'])
  git(workspace, ['commit', '-qm', 'docs: checkpoint unnumbered release notes'])
  assert.throws(
    () => landRelease(root, { worktree: 'release-once', bump: 'patch' }),
    /Collect release evidence/u,
  )
  const { state, stage } = shellRun(root, workspace)
  assert.equal(
    readLandingLog(root).some((entry) => entry.step === 'allocate'),
    false,
  )
  const verified = submitStageOutput(root, state.run_id, stage, 'success')
  assert.equal(
    verified.record.outcome,
    'success',
    JSON.stringify(verified.record.evaluation),
  )
  assert.equal(verified.state.current_stage, 'ship')
  assert.ok(
    verified.record.evaluation.deterministic.find(
      (item) => item.id === 'ship.full_suite',
    )?.verified_source,
  )
  const bundle = collectReleaseEvidence(root, 'release-once', state.run_id)
  assert.deepEqual(
    collectReleaseEvidence(root, 'release-once', state.run_id),
    bundle,
  )
  setProfileCommand(root, 'full', 'node -e "process.exit(77)"')
  setProfileCommand(root, 'impacted-release', 'node -e "process.exit(78)"')
  const landed = landRelease(root, {
    worktree: 'release-once',
    runId: state.run_id,
    bump: 'patch',
  })
  assert.equal(landed.status, 'landed')
  assert.deepEqual(landed.verified_profiles, [])
  const steps = landed.steps.map((item) => item.step)
  assert.deepEqual(steps, [
    'tip_read',
    'verify',
    'allocate',
    'metadata_regenerated',
    'finalize',
    'check',
    'fast_forward',
  ])
  assert.equal(steps.filter((item) => item === 'finalize').length, 1)
  assert.equal(git(root, ['rev-parse', 'pan-dev']), landed.index_commit)
  assert.equal(
    (
      JSON.parse(git(root, ['show', 'pan-dev:package.json'])) as Record<
        string,
        unknown
      >
    ).description,
    'Preserve the verified candidate manifest',
  )
  const prepared = prepareInvocation(root, state.run_id).invocation
  assert.ok(prepared)
  assert.equal('pr_description' in prepared.inputs, false)
  assert.equal(
    JSON.stringify(prepared.output).includes('pr_description'),
    false,
  )
})

test('changed source invalidates the bundle before allocation or commits', () => {
  const root = landingFixture()
  const workspace = makeCandidate(
    root,
    'stale-proof',
    '### Fixed\n\n- Refuse stale evidence.',
  )
  const { state, stage } = shellRun(root, workspace)
  const verified = submitStageOutput(root, state.run_id, stage, 'success')
  assert.equal(
    verified.record.outcome,
    'success',
    JSON.stringify(verified.record.evaluation),
  )
  collectReleaseEvidence(root, 'stale-proof', state.run_id)
  const packagePath = path.join(workspace, 'package.json')
  const originalPackage = readFileSync(packagePath, 'utf8')
  const changedPackage = JSON.parse(originalPackage) as Record<string, unknown>
  changedPackage.dependencies = { 'fixture-dependency': '1.0.0' }
  writeFileSync(packagePath, JSON.stringify(changedPackage))
  assert.throws(() => readReleaseEvidence(root, 'stale-proof'), /stale/u)
  writeFileSync(packagePath, originalPackage)
  assert.ok(readReleaseEvidence(root, 'stale-proof'))
  writeFileSync(
    path.join(workspace, 'src/stale-proof.ts'),
    'export const changed = true\n',
  )
  git(workspace, ['add', 'src/stale-proof.ts'])
  git(workspace, ['commit', '-qm', 'fix: change after verify'])
  const head = git(workspace, ['rev-parse', 'HEAD'])
  assert.throws(
    () =>
      landRelease(root, {
        worktree: 'stale-proof',
        runId: state.run_id,
        bump: 'patch',
      }),
    /stale/u,
  )
  assert.equal(git(workspace, ['rev-parse', 'HEAD']), head)
  assert.equal(
    readLandingLog(root).some((entry) => entry.step === 'allocate'),
    false,
  )
  assert.equal(loadState(root, state.run_id).current_stage, 'ship')
  assert.equal(
    readFileSync(path.join(workspace, 'VERSION'), 'utf8'),
    git(workspace, ['show', 'HEAD:VERSION']) + '\n',
  )
})
