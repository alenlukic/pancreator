import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../helpers.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { resolveRoots } from '../../src/lib/workspace/roots.js'
import type { RunState, StageDefinition } from '../../src/lib/types.js'

function stage(): StageDefinition {
  return {
    slug: 'ship',
    title: 'Release preparation',
    persona: 'release-steward',
    workspace_policy: 'release_metadata_only',
    gate: 'operator',
    context: { request: 'omit' },
    criteria: [],
    transitions: {
      success: 'succeeded',
      failure: 'implement',
      blocked: 'paused',
    },
  }
}

function evaluate(root: string, mutate: () => void) {
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const before = gitWorkspaceSnapshot(roots.workspace_root)
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'scope')

  mkdirSync(runDirectory, { recursive: true })
  mutate()

  return evaluateDeterministicCriteria(
    root,
    runDirectory,
    {
      run_id: 'scope',
      workspace_root: root,
      state_root: roots.state_root,
      stage_history: [],
      gate_overrides: {},
    } as unknown as RunState,
    stage(),
    before,
    root,
  ).results.find((result) => result.id === 'scope.no_unapproved_changes')
}

test('self-development release metadata policy permits bounded docs changes', () => {
  const root = createFixture()
  const result = evaluate(root, () => {
    const readmePath = path.join(root, 'README.md')

    writeFileSync(readmePath, `${readFileSync(readmePath, 'utf8')}\n`)
  })

  assert.ok(result)
  assert.equal(result.passed, true)
  assert.match(result.explanation ?? '', /permitted release metadata/u)
})

test('self-development release metadata policy rejects source changes', () => {
  const root = createFixture()
  const result = evaluate(root, () => {
    writeFileSync(
      path.join(root, 'src', 'base.ts'),
      'export const base = false\n',
    )
  })

  assert.ok(result)
  assert.equal(result.passed, false)
  assert.match(result.explanation ?? '', /src\/base\.ts/u)
})

test('embedded release metadata policy remains read-only', () => {
  const root = createFixture()
  const projectPath = path.join(root, 'project.json')
  const project = JSON.parse(readFileSync(projectPath, 'utf8')) as Record<
    string,
    unknown
  >

  project.installation_mode = 'embedded'
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`)

  const result = evaluate(root, () => {
    const readmePath = path.join(root, 'README.md')

    writeFileSync(readmePath, `${readFileSync(readmePath, 'utf8')}\n`)
  })

  assert.ok(result)
  assert.equal(result.passed, false)
  assert.match(result.explanation ?? '', /README\.md/u)
})

test('ship prior-gates stays current across release-metadata-only ship retries', () => {
  const root = createFixture()
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'retry')

  mkdirSync(runDirectory, { recursive: true })

  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    "export const base = 'reviewed'\n",
  )

  const reviewed = gitWorkspaceSnapshot(roots.workspace_root)
  const shipStage = stage()

  shipStage.criteria = [
    {
      id: 'ship.prior_gates_current',
      type: 'state',
      hard: true,
      statement:
        'Review and QA passed against the current workspace fingerprint.',
    },
  ]

  const state = {
    run_id: 'retry',
    workspace_root: root,
    state_root: roots.state_root,
    stage_history: [
      {
        stage: 'review',
        attempt: 1,
        invocation_id: 'review-1',
        output_path: 'outputs/review-1.json',
        outcome: 'success',
        submitted_at: '2026-07-20T00:00:00.000Z',
        workspace_fingerprint: reviewed.fingerprint,
        validation_errors: [],
        deterministic: [],
      },
      {
        stage: 'test',
        attempt: 1,
        invocation_id: 'test-1',
        output_path: 'outputs/test-1.json',
        outcome: 'success',
        submitted_at: '2026-07-20T00:01:00.000Z',
        workspace_fingerprint: reviewed.fingerprint,
        validation_errors: [],
        deterministic: [],
      },
      {
        stage: 'ship',
        attempt: 1,
        invocation_id: 'ship-1',
        output_path: 'outputs/ship-1.json',
        outcome: 'failure',
        submitted_at: '2026-07-20T00:02:00.000Z',
        workspace_fingerprint: 'ship-1-after-metadata',
        validation_errors: ['packet shape'],
        deterministic: [],
      },
    ],
    gate_overrides: {},
  } as unknown as RunState

  // Simulate ship attempt 1 already having rewritten release metadata, then a
  // retry whose before-snapshot is no longer the QA fingerprint.
  writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')
  writeFileSync(
    path.join(root, 'README.md'),
    `${readFileSync(path.join(root, 'README.md'), 'utf8')}\n`,
  )

  const beforeRetry = gitWorkspaceSnapshot(roots.workspace_root)

  writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [9.9.9]\n')

  const results = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    shipStage,
    beforeRetry,
    root,
  ).results
  const priorGates = results.find(
    (result) => result.id === 'ship.prior_gates_current',
  )

  assert.ok(priorGates)
  assert.equal(priorGates.passed, true)
  assert.match(
    priorGates.explanation ?? '',
    /do not invalidate the reviewed implementation fingerprint/u,
  )
})

test('ship prior-gates still fails when non-metadata files change after QA', () => {
  const root = createFixture()
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'drift')

  mkdirSync(runDirectory, { recursive: true })

  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    "export const base = 'reviewed'\n",
  )

  const reviewed = gitWorkspaceSnapshot(roots.workspace_root)
  const shipStage = stage()

  shipStage.criteria = [
    {
      id: 'ship.prior_gates_current',
      type: 'state',
      hard: true,
      statement:
        'Review and QA passed against the current workspace fingerprint.',
    },
  ]

  const state = {
    run_id: 'drift',
    workspace_root: root,
    state_root: roots.state_root,
    stage_history: [
      {
        stage: 'review',
        attempt: 1,
        invocation_id: 'review-1',
        output_path: 'outputs/review-1.json',
        outcome: 'success',
        submitted_at: '2026-07-20T00:00:00.000Z',
        workspace_fingerprint: reviewed.fingerprint,
        validation_errors: [],
        deterministic: [],
      },
      {
        stage: 'test',
        attempt: 1,
        invocation_id: 'test-1',
        output_path: 'outputs/test-1.json',
        outcome: 'success',
        submitted_at: '2026-07-20T00:01:00.000Z',
        workspace_fingerprint: reviewed.fingerprint,
        validation_errors: [],
        deterministic: [],
      },
    ],
    gate_overrides: {},
  } as unknown as RunState

  writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')
  const beforeRetry = gitWorkspaceSnapshot(roots.workspace_root)

  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    "export const base = 'drifted'\n",
  )

  const priorGates = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    shipStage,
    beforeRetry,
    root,
  ).results.find((result) => result.id === 'ship.prior_gates_current')

  assert.ok(priorGates)
  assert.equal(priorGates.passed, false)
})
