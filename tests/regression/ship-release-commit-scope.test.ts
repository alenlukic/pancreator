/**
 * Six delivery runs failed `scope.no_unapproved_changes` at ship and closed
 * only through an operator waiver. Each one had performed the release commit
 * its own stage contract mandates, and the scope comparison read every
 * committed path as a change because a commit removes the path from
 * `git status`. The sixth added the shared-worktree variant: the checkpoint
 * committed a sibling chunk run's uncommitted verified files.
 *
 * Verification then found the same failure one step further along the
 * mandated procedure: the release sync also fetches main and rebases onto it,
 * and a comparison window opened at a base the rebase had moved read every
 * path the upstream advance carried as contamination.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createFixture, fixtureGit } from '../fixture-template.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import type {
  RunState,
  StageDefinition,
  StageHistoryItem,
} from '../../src/lib/types.js'

const RUN_ID = '63297_Sep-12-0875_t2-verdicts'
const SIBLING_RUN_ID = '63297_Sep-12-0874_t1-verdicts'

function shipStage(): StageDefinition {
  return {
    slug: 'ship',
    title: 'Release preparation',
    persona: 'release-steward',
    workspace_policy: 'release_metadata_only',
    gate: 'next_stage',
    context: { inputs: [] },
    criteria: [],
    transitions: { success: 'succeeded' },
  } as unknown as StageDefinition
}

/** Record one successful stage output that claims `changedFiles`. */
function claimStage(
  root: string,
  runId: string,
  stage: string,
  changedFiles: string[],
): StageHistoryItem {
  const relative = path.posix.join(
    'runtime',
    'logs',
    'workflows',
    runId,
    'agent',
    'outputs',
    `00_${stage}-1.json`,
  )

  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  writeFileSync(
    path.join(root, relative),
    `${JSON.stringify(
      {
        schema_version: 1,
        invocation_id: `00_${stage}-1`,
        result: 'success',
        data: { implementation: { changed_files: changedFiles } },
      },
      null,
      2,
    )}\n`,
  )

  return {
    stage,
    attempt: 1,
    invocation_id: `00_${stage}-1`,
    output_path: relative,
    outcome: 'success',
    submitted_at: '2026-09-12T00:00:00.000Z',
    workspace_fingerprint: 'fp-implement',
    validation_errors: [],
    deterministic: [],
  }
}

function shipRunState(
  runId: string,
  history: StageHistoryItem[],
  worktreeName?: string,
): RunState {
  return {
    schema_version: 2,
    run_id: runId,
    workflow_slug: 'delivery',
    title: 'Release',
    status: 'awaiting_agent',
    current_stage: 'ship',
    workspace_root: '.',
    pending_action: { kind: 'prepare' },
    attempts: { ship: 1 },
    transition_count: 1,
    consecutive_failures: 0,
    revision: 1,
    created_at: '2026-09-12T00:00:00.000Z',
    updated_at: '2026-09-12T00:00:00.000Z',
    stage_history: history,
    ...(worktreeName === undefined
      ? {}
      : {
          managed_worktree: {
            name: worktreeName,
            path: `worktrees/operator/${worktreeName}`,
            branch: worktreeName,
          },
        }),
  } as unknown as RunState
}

function commitAll(root: string, message: string): void {
  fixtureGit(['add', '-A'], { cwd: root, encoding: 'utf8' })
  fixtureGit(['commit', '-qm', message], { cwd: root, encoding: 'utf8' })
}

const UPSTREAM_BRANCH = 'stand-in-main'

/**
 * Put two commits' worth of upstream work on a second branch and return to
 * the working branch, which is the state a fetch of an advanced main leaves.
 */
function advanceUpstream(root: string): void {
  const working = fixtureGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()

  fixtureGit(['checkout', '-q', '-b', UPSTREAM_BRANCH], {
    cwd: root,
    encoding: 'utf8',
  })
  writeFileSync(
    path.join(root, 'src', 'upstream-feature.ts'),
    'export const u = 1\n',
  )
  commitAll(root, 'upstream: add the feature')
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'upstream-note.md'), 'upstream\n')
  commitAll(root, 'upstream: note the feature')
  fixtureGit(['checkout', '-q', working], { cwd: root, encoding: 'utf8' })
}

function rebaseOntoUpstream(root: string): void {
  fixtureGit(['rebase', '-q', UPSTREAM_BRANCH], { cwd: root, encoding: 'utf8' })
}

function scopeResult(
  root: string,
  state: RunState,
  before: ReturnType<typeof gitWorkspaceSnapshot>,
) {
  const { results } = evaluateDeterministicCriteria(
    root,
    path.join(root, 'runtime', 'logs', 'workflows', state.run_id),
    state,
    shipStage(),
    before,
    root,
  )
  const scope = results.find(
    (result) => result.id === 'scope.no_unapproved_changes',
  )

  assert.ok(scope, 'the scope criterion must be evaluated')

  return scope
}

test('the mandated release commit passes the ship scope criterion', () => {
  const root = createFixture()

  // The verified change set the implement stage produced, still uncommitted
  // when the release steward enters ship.
  writeFileSync(path.join(root, 'src', 'shipped.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')

  const before = gitWorkspaceSnapshot(root)
  const state = shipRunState(RUN_ID, [
    claimStage(root, RUN_ID, 'implement', ['src/shipped.ts']),
  ])

  commitAll(root, 'release: v9.9.9')

  const scope = scopeResult(root, state, before)

  assert.equal(scope.passed, true)
  assert.match(scope.explanation ?? '', /this run/u)
  assert.doesNotMatch(scope.explanation ?? '', /contamination is external/u)
})

test('an external edit during the ship window still fails the scope criterion', () => {
  const root = createFixture()

  writeFileSync(path.join(root, 'src', 'shipped.ts'), 'export const a = 1\n')

  const before = gitWorkspaceSnapshot(root)
  const state = shipRunState(RUN_ID, [
    claimStage(root, RUN_ID, 'implement', ['src/shipped.ts']),
  ])

  commitAll(root, 'release: v9.9.9')
  // Somebody else edits the tree after the release commit.
  writeFileSync(path.join(root, 'src', 'outside.ts'), 'export const b = 2\n')

  const scope = scopeResult(root, state, before)

  assert.equal(scope.passed, false)
  assert.match(scope.explanation ?? '', /src\/outside\.ts/u)
})

test('a commit of content the stage itself changed still fails', () => {
  const root = createFixture()

  const before = gitWorkspaceSnapshot(root)
  const state = shipRunState(RUN_ID, [
    claimStage(root, RUN_ID, 'implement', ['src/shipped.ts']),
  ])

  // The path is claimed, but it appeared after the ship window opened, so the
  // commit carries content the stage produced rather than content it held.
  writeFileSync(path.join(root, 'src', 'shipped.ts'), 'export const a = 1\n')
  commitAll(root, 'release: v9.9.9')

  const scope = scopeResult(root, state, before)

  assert.equal(scope.passed, false)
  assert.match(scope.explanation ?? '', /src\/shipped\.ts/u)
})

test("a ship checkpoint absorbs a sibling run's verified files and names it", () => {
  const root = createFixture()
  const worktree = '20260911-tuning-run'

  // Two sequential chunk runs share one worktree. The earlier run left its
  // verified files uncommitted; the later run's checkpoint commits them.
  writeFileSync(path.join(root, 'src', 'sibling.ts'), 'export const s = 1\n')

  const siblingStatePath = path.join(
    root,
    'runtime',
    'logs',
    'workflows',
    SIBLING_RUN_ID,
    'agent',
    'state.json',
  )

  mkdirSync(path.dirname(siblingStatePath), { recursive: true })
  writeFileSync(
    siblingStatePath,
    `${JSON.stringify(
      shipRunState(
        SIBLING_RUN_ID,
        [claimStage(root, SIBLING_RUN_ID, 'implement', ['src/sibling.ts'])],
        worktree,
      ),
      null,
      2,
    )}\n`,
  )

  const before = gitWorkspaceSnapshot(root)
  const state = shipRunState(RUN_ID, [], worktree)

  commitAll(root, 'checkpoint before release')

  const scope = scopeResult(root, state, before)

  assert.equal(scope.passed, true)
  assert.match(
    scope.explanation ?? '',
    new RegExp(`run ${SIBLING_RUN_ID}`, 'u'),
    'the evaluation must name the run the absorbed paths belong to',
  )
})

test('the mandated release sync passes the scope criterion across a rebase', () => {
  const root = createFixture()

  advanceUpstream(root)

  writeFileSync(path.join(root, 'src', 'shipped.ts'), 'export const a = 1\n')
  writeFileSync(path.join(root, 'VERSION'), '9.9.9\n')

  const before = gitWorkspaceSnapshot(root)
  const state = shipRunState(RUN_ID, [
    claimStage(root, RUN_ID, 'implement', ['src/shipped.ts']),
  ])

  // The whole shape of `pan release sync`: checkpoint the verified tree, then
  // rebase onto the main the fetch advanced.
  commitAll(root, 'release: v9.9.9')
  rebaseOntoUpstream(root)

  const scope = scopeResult(root, state, before)

  assert.equal(scope.passed, true)
  assert.doesNotMatch(
    scope.explanation ?? '',
    /upstream/u,
    'a path the upstream advance carried is not this stage to account for',
  )
})

test('an upstream advance does not launder an external edit across the rebase', () => {
  const root = createFixture()

  advanceUpstream(root)

  writeFileSync(path.join(root, 'src', 'shipped.ts'), 'export const a = 1\n')

  const before = gitWorkspaceSnapshot(root)
  const state = shipRunState(RUN_ID, [
    claimStage(root, RUN_ID, 'implement', ['src/shipped.ts']),
  ])

  // Somebody else edits the tree after the ship window opens, and the
  // checkpoint carries that edit into the same commit range as the rebase.
  writeFileSync(path.join(root, 'src', 'outside.ts'), 'export const b = 2\n')
  commitAll(root, 'release: v9.9.9')
  rebaseOntoUpstream(root)

  const scope = scopeResult(root, state, before)

  assert.equal(scope.passed, false)
  assert.match(scope.explanation ?? '', /src\/outside\.ts/u)
})

test('a genuinely unattributable pre-existing path still fails', () => {
  const root = createFixture()

  // Same shape as the shared-worktree case, without any run that claims the
  // path. The rule attributes; it does not exempt.
  writeFileSync(path.join(root, 'src', 'orphan.ts'), 'export const o = 1\n')

  const before = gitWorkspaceSnapshot(root)
  const state = shipRunState(RUN_ID, [], '20260911-tuning-run')

  commitAll(root, 'checkpoint before release')

  const scope = scopeResult(root, state, before)

  assert.equal(scope.passed, false)
  assert.match(scope.explanation ?? '', /src\/orphan\.ts/u)
})
