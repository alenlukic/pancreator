import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { createFixture, fixtureGit } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'
import type {
  RunState,
  StageDefinition,
  WorkspaceSnapshot,
} from '../../src/lib/types.js'

function shipStage(): StageDefinition {
  return {
    slug: 'ship',
    title: 'Release preparation',
    persona: 'release-steward',
    workspace_policy: 'read_only',
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

/** A Git workspace outside the harness checkout, as a worktree or eval run has. */
function separateWorkspace(): string {
  const workspace = createTestTempDirectory('pan-scope-workspace-')

  writeFileSync(path.join(workspace, 'feature.ts'), 'export const a = 1\n')
  fixtureGit(['init', '-q'], { cwd: workspace, encoding: 'utf8' })
  fixtureGit(['config', 'user.email', 'fixture@example.com'], {
    cwd: workspace,
    encoding: 'utf8',
  })
  fixtureGit(['config', 'user.name', 'Fixture'], {
    cwd: workspace,
    encoding: 'utf8',
  })
  fixtureGit(['add', '.'], { cwd: workspace, encoding: 'utf8' })
  fixtureGit(['commit', '-qm', 'workspace'], {
    cwd: workspace,
    encoding: 'utf8',
  })

  return workspace
}

function verifyStage(): StageDefinition {
  return { ...shipStage(), slug: 'verify', title: 'Verification' }
}

function scopeResult(
  root: string,
  workspaceDir: string,
  harnessBefore: WorkspaceSnapshot | undefined,
  mutate: () => void,
  stage: StageDefinition = shipStage(),
) {
  const before = gitWorkspaceSnapshot(workspaceDir)
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', 'scope')

  mkdirSync(runDirectory, { recursive: true })
  mutate()

  return evaluateDeterministicCriteria(
    root,
    runDirectory,
    {
      run_id: 'scope',
      workspace_root: workspaceDir,
      state_root: 'runtime',
      stage_history: [],
      gate_overrides: {},
    } as unknown as RunState,
    stage,
    before,
    workspaceDir,
    {},
    stage.slug,
    undefined,
    undefined,
    null,
    gitWorkspaceSnapshot(workspaceDir, { commitBase: before.head }),
    {},
    harnessBefore,
  ).results.find((result) => result.id === 'scope.no_unapproved_changes')
}

// Eval run 63310_Aug-30-1404: the workers stayed inside the run workspace
// through implement and verify, then the release steward edited VERSION,
// CHANGELOG.md, and four more files in the real harness working tree. The
// scope criterion passed, because it inspects the run workspace alone, and
// the one tree the run may not write is the one it could not see.
test('a run with its own workspace fails the scope gate on a harness-root write', () => {
  const root = createFixture()
  const workspace = separateWorkspace()
  const harnessBefore = gitWorkspaceSnapshot(root)
  const result = scopeResult(root, workspace, harnessBefore, () => {
    writeFileSync(
      path.join(root, 'src', 'base.ts'),
      'export const base = false\n',
    )
  })

  assert.ok(result)
  assert.equal(result.passed, false)
  assert.match(result.explanation ?? '', /harness root/u)
  assert.match(result.explanation ?? '', /src\/base\.ts/u)
})

test('a run with its own workspace passes when it writes only that workspace', () => {
  const root = createFixture()
  const workspace = separateWorkspace()
  const harnessBefore = gitWorkspaceSnapshot(root)
  const result = scopeResult(root, workspace, harnessBefore, () => {
    // The harness writes run state under runtime/ for every run; that is the
    // harness's own bookkeeping, not a write into its source.
    writeFileSync(
      path.join(root, 'runtime', 'logs', 'workflows', 'scope', 'note.md'),
      'run state\n',
    )
  })

  assert.ok(result)
  assert.equal(result.passed, true)
})

// HR4-004 ships one mechanism: the release landing moves after submit rather
// than becoming an exception here. A ship stage that still moves the harness
// root to its own release commit therefore fails, exactly as any other
// harness-root delta does, and the failure names where the step belongs.
test('a ship stage that lands its own release on the harness root still fails', () => {
  const root = createFixture()
  const workspace = separateWorkspace()
  const harnessBefore = gitWorkspaceSnapshot(root)
  const result = scopeResult(root, workspace, harnessBefore, () => {
    writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')
    fixtureGit(['add', '-A'], { cwd: root, encoding: 'utf8' })
    fixtureGit(['commit', '-qm', 'release: prepare v9.9.9'], {
      cwd: root,
      encoding: 'utf8',
    })
  })

  assert.ok(result)
  assert.equal(result.passed, false)
  assert.match(result.explanation ?? '', /VERSION/u)
  assert.match(result.explanation ?? '', /operator step after submit/u)
})

test('a stage outside the release lane is not told to land after submit', () => {
  const root = createFixture()
  const workspace = separateWorkspace()
  const harnessBefore = gitWorkspaceSnapshot(root)
  const result = scopeResult(
    root,
    workspace,
    harnessBefore,
    () => {
      writeFileSync(
        path.join(root, 'src', 'base.ts'),
        'export const base = false\n',
      )
    },
    verifyStage(),
  )

  assert.ok(result)
  assert.equal(result.passed, false)
  assert.match(result.explanation ?? '', /src\/base\.ts/u)
  assert.doesNotMatch(result.explanation ?? '', /after submit/u)
})

test('a run whose workspace is the harness root keeps its existing verdict', () => {
  const root = createFixture()
  const clean = scopeResult(root, root, undefined, () => {})

  assert.ok(clean)
  assert.equal(clean.passed, true)

  const contaminated = scopeResult(root, root, undefined, () => {
    writeFileSync(
      path.join(root, 'src', 'base.ts'),
      'export const base = false\n',
    )
  })

  assert.ok(contaminated)
  assert.equal(contaminated.passed, false)
  assert.match(contaminated.explanation ?? '', /Workspace contamination/u)
  assert.doesNotMatch(contaminated.explanation ?? '', /harness root/u)
})
