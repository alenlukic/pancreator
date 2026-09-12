import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  cohortStatus,
  initCohortSession,
  integrateCohort,
  loadCohortState,
  startCohort,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import { loadState } from '../../src/lib/state.js'
import { createFixture } from '../fixture-template.js'
import {
  commitInChunk,
  git,
  markEmbedded,
  markSucceeded,
  ratifiedPlanRun,
} from './cohort-helpers.js'

test('--into-branch integrates past a dirty base checkout and retargets later cohorts', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha', 'beta'] },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  for (const chunk of started.chunks) {
    commitInChunk(
      root,
      loadState(root, chunk.run_id).workspace_root,
      chunk.chunk,
    )
    markSucceeded(root, chunk.run_id)
  }

  // The operator's own checkout keeps unrelated uncommitted work throughout.
  writeFileSync(path.join(root, 'README.md'), 'operator work in progress\n')

  const dirtyBefore = git(root, ['status', '--porcelain'])
  const baseHead = git(root, ['rev-parse', 'HEAD']).trim()

  assert.throws(
    () => integrateCohort(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError && error.code === 'WORKTREE_DIRTY',
  )
  assert.throws(
    () =>
      integrateCohort(root, session.cohort_id, {
        intoBranch: 'not a branch',
      }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'INVALID_ARGUMENT',
  )

  const first = integrateCohort(root, session.cohort_id, {
    intoBranch: 'cohort-integration',
  })

  assert.equal(first.integration_branch, 'cohort-integration')
  assert.equal(first.base_branch, session.base_branch)
  assert.deepEqual(first.merged_chunks.sort(), ['alpha', 'beta'])
  assert.equal(
    loadCohortState(root, session.cohort_id).integration_branch,
    'cohort-integration',
  )
  assert.equal(
    loadCohortState(root, session.cohort_id).satisfaction[0].integration_branch,
    'cohort-integration',
  )

  const landed = git(root, ['ls-tree', '--name-only', 'cohort-integration'])

  assert.match(landed, /alpha\.txt/u)
  assert.match(landed, /beta\.txt/u)
  // The base branch and the operator's checkout are untouched.
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), baseHead)
  assert.equal(git(root, ['status', '--porcelain']), dirtyBefore)

  const status = cohortStatus(root, session.cohort_id)

  assert.equal(status.integration_branch, 'cohort-integration')
  assert.deepEqual(status.satisfied_cohort_indexes, [1])
  assert.equal(status.active_cohort_index, 2)

  // The next cohort, started by the integration itself, branches from the
  // integration branch, so it sees the work cohort 1 landed even though the
  // base branch does not carry it.
  const next = first.autostart

  assert.equal(next.status, 'started')
  assert.equal(next.kind, 'cohort')

  if (next.status !== 'started' || next.kind !== 'cohort') {
    return
  }

  const gammaWorkspace = loadState(root, next.chunks[0].run_id).workspace_root

  assert.ok(existsSync(path.join(root, gammaWorkspace, 'alpha.txt')))
  assert.ok(existsSync(path.join(root, gammaWorkspace, 'beta.txt')))

  commitInChunk(root, gammaWorkspace, 'gamma')
  markSucceeded(root, next.chunks[0].run_id)

  // A single-chunk cohort merges into the recorded branch without the option.
  const second = integrateCohort(root, session.cohort_id)

  assert.equal(second.integration_branch, 'cohort-integration')
  assert.deepEqual(second.merged_chunks, ['gamma'])
  assert.equal(
    second.merge_commit,
    git(root, ['rev-parse', 'cohort-integration']).trim(),
  )
  assert.match(
    git(root, ['ls-tree', '--name-only', 'cohort-integration']),
    /gamma\.txt/u,
  )
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), baseHead)
  assert.equal(git(root, ['status', '--porcelain']), dirtyBefore)
  assert.deepEqual(
    cohortStatus(root, session.cohort_id).satisfied_cohort_indexes,
    [1, 2],
  )

  // The last integration starts the release run: one `delivery` run at
  // `verify`, bound to the worktree that holds the integration branch, so
  // release preparation happens once on the integrated result and the
  // operator's dirty checkout is never its workspace.
  const release = second.autostart

  assert.equal(release.status, 'started')
  assert.equal(release.kind, 'release')

  if (release.status !== 'started' || release.kind !== 'release') {
    return
  }

  const releaseState = loadState(root, release.run_id)

  assert.equal(releaseState.workflow_slug, 'delivery')
  assert.equal(releaseState.current_stage, 'verify')
  assert.equal(releaseState.pending_action.type, 'prepare_invocation')
  assert.equal(releaseState.managed_worktree?.branch, 'cohort-integration')
  assert.equal(releaseState.workspace_root, release.worktree)
  assert.ok(
    existsSync(path.join(root, releaseState.workspace_root, 'gamma.txt')),
  )
  assert.equal(
    releaseState.request.context_reference?.source_path,
    'runtime/specs/parent-specification.md',
  )
  assert.equal(
    releaseState.request.source_path,
    loadState(root, planRunId).request.stored_path,
  )
  assert.equal(release.resume_command, `/pan-resume ${release.run_id}`)

  const finished = cohortStatus(root, session.cohort_id)

  assert.equal(finished.release_run_id, release.run_id)
  assert.equal(finished.release_resume_command, release.resume_command)
  assert.equal(
    loadCohortState(root, session.cohort_id).release_run_id,
    release.run_id,
  )

  // Retargeting onto a branch that lacks the integration head is refused.
  git(root, ['branch', 'stale-branch', baseHead])
  assert.throws(
    () =>
      integrateCohort(root, session.cohort_id, { intoBranch: 'stale-branch' }),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_INTEGRATION_TARGET_DIVERGED',
  )
})

test('a dirty chunk worktree leaves the cohort unsatisfied', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)
  const workspace = loadState(root, started.chunks[0].run_id).workspace_root

  commitInChunk(root, workspace, 'alpha')
  markSucceeded(root, started.chunks[0].run_id)
  writeFileSync(path.join(root, workspace, 'alpha.txt'), 'uncommitted\n')
  markEmbedded(root)

  assert.throws(
    () => integrateCohort(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_INTEGRATION_INCOMPLETE' &&
      error.message.includes('uncommitted work') &&
      error.message.includes(
        `'./.pancreator/bin/pan cohort integrate ${session.cohort_id}' again`,
      ),
  )
  assert.deepEqual(
    cohortStatus(root, session.cohort_id).satisfied_cohort_indexes,
    [],
  )
})
