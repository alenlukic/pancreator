import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../fixture-template.js'
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
  const projectPath = path.join(root, 'config.json')
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

const PRIOR_GATES_CRITERION = {
  id: 'ship.prior_gates_current',
  type: 'state',
  hard: true,
  statement: 'Review and QA passed against the current workspace fingerprint.',
} as const

function shipStageWithPriorGates(): StageDefinition {
  const shipStage = stage()

  shipStage.criteria = [{ ...PRIOR_GATES_CRITERION }]

  return shipStage
}

function priorGatesState(options: {
  runId: string
  root: string
  stateRoot: string
  qaFingerprint: string
  shipAttempts: Array<{
    before: string
    after: string
    scopePassed?: boolean
  }>
  directives?: Array<{
    before: string
    after: string
    changedPaths: string[]
    timestamp: string
  }>
}): RunState {
  return {
    workspace_directives: (options.directives ?? []).map(
      (directive, index) => ({
        directive_id: `directive-${index + 1}`,
        acting_role: 'operator',
        directive: 'Version-sync the release metadata before ship re-entry.',
        stage: 'ship',
        changed_paths: directive.changedPaths,
        workspace_before_fingerprint: directive.before,
        workspace_fingerprint: directive.after,
        artifact_path: `evidence/workspace-directive-${index + 1}.md`,
        timestamp: directive.timestamp,
      }),
    ),
    run_id: options.runId,
    workspace_root: options.root,
    state_root: options.stateRoot,
    stage_history: [
      {
        stage: 'review',
        attempt: 1,
        invocation_id: 'review-1',
        output_path: 'outputs/review-1.json',
        outcome: 'success',
        submitted_at: '2026-07-20T00:00:00.000Z',
        workspace_fingerprint: options.qaFingerprint,
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
        workspace_fingerprint: options.qaFingerprint,
        validation_errors: [],
        deterministic: [],
      },
      ...options.shipAttempts.map((attempt, index) => ({
        stage: 'ship',
        attempt: index + 1,
        invocation_id: `ship-${index + 1}`,
        output_path: `outputs/ship-${index + 1}.json`,
        outcome: 'failure',
        submitted_at: `2026-07-20T00:0${index + 2}:00.000Z`,
        workspace_before_fingerprint: attempt.before,
        workspace_fingerprint: attempt.after,
        validation_errors: ['packet shape'],
        deterministic: [
          {
            id: 'scope.no_unapproved_changes',
            type: 'state',
            hard: true,
            passed: attempt.scopePassed ?? true,
            workspace_fingerprint: attempt.after,
          },
        ],
      })),
    ],
    gate_overrides: {},
  } as unknown as RunState
}

test('release metadata scope detects a ship edit to an already-dirty docs file', () => {
  const root = createFixture()
  const docsPath = path.join(root, 'docs', 'embedded-installation.md')

  // Feature work leaves the doc dirty before the stage starts, so its Git
  // status entry never changes when ship version-syncs the same file.
  writeFileSync(docsPath, '# Installation\n\nFeature content.\n')

  const result = evaluate(root, () => {
    writeFileSync(
      docsPath,
      '# Installation\n\nFeature content. Version 9.9.9\n',
    )
  })

  assert.ok(result)
  assert.equal(result.passed, true)
  assert.match(result.explanation ?? '', /docs\/embedded-installation\.md/u)
})

test('ship prior-gates stays current when ship version-syncs a feature-dirty doc', () => {
  const root = createFixture()
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'retry')
  const docsPath = path.join(root, 'docs', 'embedded-installation.md')

  mkdirSync(runDirectory, { recursive: true })

  // Post-QA state: feature work dirtied both source and a durable doc that
  // VERSION-001 later version-syncs. Subtracting release-metadata paths from
  // the live tree would strip these feature bytes out of the reconstruction.
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    "export const base = 'reviewed'\n",
  )
  writeFileSync(docsPath, '# Installation\n\nFeature content.\n')

  const qa = gitWorkspaceSnapshot(roots.workspace_root)

  // Ship attempt 1 writes release metadata, including a version sync into the
  // already-dirty doc.
  writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')
  writeFileSync(docsPath, '# Installation\n\nFeature content. Version 9.9.9\n')

  const afterAttemptOne = gitWorkspaceSnapshot(roots.workspace_root)
  const state = priorGatesState({
    runId: 'retry',
    root,
    stateRoot: roots.state_root,
    qaFingerprint: qa.fingerprint,
    shipAttempts: [
      { before: qa.fingerprint, after: afterAttemptOne.fingerprint },
    ],
  })

  writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [9.9.9]\n')

  const priorGates = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    shipStageWithPriorGates(),
    afterAttemptOne,
    root,
  ).results.find((result) => result.id === 'ship.prior_gates_current')

  assert.ok(priorGates)
  assert.equal(priorGates.passed, true)
  assert.match(
    priorGates.explanation ?? '',
    /chains back to the QA fingerprint/u,
  )
})

test('ship prior-gates fails when the attempt chain skips a workspace edit', () => {
  const root = createFixture()
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'gap')
  const sourcePath = path.join(root, 'src', 'base.ts')

  mkdirSync(runDirectory, { recursive: true })
  writeFileSync(sourcePath, "export const base = 'reviewed'\n")

  const qa = gitWorkspaceSnapshot(roots.workspace_root)

  writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')

  const afterAttemptOne = gitWorkspaceSnapshot(roots.workspace_root)

  // Between the two ship attempts, an already-dirty product file changes. No
  // stage window covers that edit, so the chain must break.
  writeFileSync(sourcePath, "export const base = 'drifted'\n")

  const beforeAttemptTwo = gitWorkspaceSnapshot(roots.workspace_root)
  const state = priorGatesState({
    runId: 'gap',
    root,
    stateRoot: roots.state_root,
    qaFingerprint: qa.fingerprint,
    shipAttempts: [
      { before: qa.fingerprint, after: afterAttemptOne.fingerprint },
    ],
  })

  writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [9.9.9]\n')

  const priorGates = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    shipStageWithPriorGates(),
    beforeAttemptTwo,
    root,
  ).results.find((result) => result.id === 'ship.prior_gates_current')

  assert.ok(priorGates)
  assert.equal(priorGates.passed, false)
})

test('ship prior-gates fails when an earlier ship attempt failed its scope window', () => {
  const root = createFixture()
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'scoped')

  mkdirSync(runDirectory, { recursive: true })
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    "export const base = 'reviewed'\n",
  )

  const qa = gitWorkspaceSnapshot(roots.workspace_root)

  writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')

  const afterAttemptOne = gitWorkspaceSnapshot(roots.workspace_root)
  const state = priorGatesState({
    runId: 'scoped',
    root,
    stateRoot: roots.state_root,
    qaFingerprint: qa.fingerprint,
    shipAttempts: [
      {
        before: qa.fingerprint,
        after: afterAttemptOne.fingerprint,
        scopePassed: false,
      },
    ],
  })

  writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [9.9.9]\n')

  const priorGates = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    shipStageWithPriorGates(),
    afterAttemptOne,
    root,
  ).results.find((result) => result.id === 'ship.prior_gates_current')

  assert.ok(priorGates)
  assert.equal(priorGates.passed, false)
})

/** The release-metadata surface VERSION-001 version-syncs, in one window. */
const RELEASE_METADATA_SYNC = [
  ['CHANGELOG.md', '# Changelog\n\n## [9.9.9]\n'],
  ['README.md', '# Pancreator\n\nVersion 9.9.9\n'],
  ['VERSION', '9.9.9\n'],
  ['package.json', '{\n  "name": "pancreator",\n  "version": "9.9.9"\n}\n'],
  ['package-lock.json', '{\n  "version": "9.9.9"\n}\n'],
  ['docs/embedded-installation.md', '# Installation\n\nVersion 9.9.9\n'],
] as const

// AC-007. `pan release sync` runs between the verification evidence and ship
// re-entry, so the workspace it leaves is attributed to an out-of-stage record
// rather than to a ship attempt. The chain read only ship attempts, so a run
// that had never submitted ship could not prove currency and the gate refused
// the entry it was meant to allow.
test('ship prior-gates accepts an out-of-stage release-metadata attribution as a chain link', () => {
  const root = createFixture()
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'attrib')

  mkdirSync(runDirectory, { recursive: true })
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    "export const base = 'reviewed'\n",
  )

  const qa = gitWorkspaceSnapshot(roots.workspace_root)

  for (const [relativePath, contents] of RELEASE_METADATA_SYNC) {
    writeFileSync(path.join(root, relativePath), contents)
  }

  const afterDirective = gitWorkspaceSnapshot(roots.workspace_root)
  const state = priorGatesState({
    runId: 'attrib',
    root,
    stateRoot: roots.state_root,
    qaFingerprint: qa.fingerprint,
    shipAttempts: [],
    directives: [
      {
        before: qa.fingerprint,
        after: afterDirective.fingerprint,
        changedPaths: RELEASE_METADATA_SYNC.map(
          ([relativePath]) => relativePath,
        ),
        timestamp: '2026-07-20T00:05:00.000Z',
      },
    ],
  })

  const priorGates = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    shipStageWithPriorGates(),
    afterDirective,
    root,
  ).results.find((result) => result.id === 'ship.prior_gates_current')

  assert.ok(priorGates)
  assert.equal(priorGates.passed, true)
  assert.match(
    priorGates.explanation ?? '',
    /1 same-run release-metadata attribution record since QA chains back to the QA fingerprint/u,
  )
})

// AC-008. The attribution record is only as good as the window it adjudicates,
// so a record that reaches outside the release-metadata surface must not stand
// in for the review the product change never received.
test('ship prior-gates rejects an attribution that names a path outside release metadata', () => {
  const root = createFixture()
  const roots = resolveRoots({
    installation_root: root,
    workspace_root: root,
    state_root: 'runtime',
  })
  const runDirectory = path.join(
    root,
    'runtime',
    'logs',
    'workflows',
    'outside',
  )

  mkdirSync(runDirectory, { recursive: true })

  const qa = gitWorkspaceSnapshot(roots.workspace_root)

  writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    "export const base = 'directed'\n",
  )

  const afterDirective = gitWorkspaceSnapshot(roots.workspace_root)
  const state = priorGatesState({
    runId: 'outside',
    root,
    stateRoot: roots.state_root,
    qaFingerprint: qa.fingerprint,
    shipAttempts: [],
    directives: [
      {
        before: qa.fingerprint,
        after: afterDirective.fingerprint,
        changedPaths: ['VERSION', 'src/base.ts'],
        timestamp: '2026-07-20T00:05:00.000Z',
      },
    ],
  })

  const priorGates = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    shipStageWithPriorGates(),
    afterDirective,
    root,
  ).results.find((result) => result.id === 'ship.prior_gates_current')

  assert.ok(priorGates)
  assert.equal(priorGates.passed, false)
})

test('ship prior-gates still fails when non-metadata files change during the attempt', () => {
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

  const qa = gitWorkspaceSnapshot(roots.workspace_root)

  writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')

  const afterAttemptOne = gitWorkspaceSnapshot(roots.workspace_root)
  const state = priorGatesState({
    runId: 'drift',
    root,
    stateRoot: roots.state_root,
    qaFingerprint: qa.fingerprint,
    shipAttempts: [
      { before: qa.fingerprint, after: afterAttemptOne.fingerprint },
    ],
  })

  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    "export const base = 'drifted'\n",
  )

  const priorGates = evaluateDeterministicCriteria(
    root,
    runDirectory,
    state,
    shipStageWithPriorGates(),
    afterAttemptOne,
    root,
  ).results.find((result) => result.id === 'ship.prior_gates_current')

  assert.ok(priorGates)
  assert.equal(priorGates.passed, false)
})
