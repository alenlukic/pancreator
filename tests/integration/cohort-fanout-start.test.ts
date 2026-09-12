import assert from 'node:assert/strict'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonChunk,
  cleanCohortSession,
  cohortBaselineDirectory,
  cohortStatus,
  initCohortSession,
  loadCohortState,
  maybeStartDelivery,
  startCohort,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import { prepareInvocation } from '../../src/lib/engine.js'
import { loadState } from '../../src/lib/state.js'
import { readWorktreeIndex } from '../../src/lib/worktrees.js'
import { attestRunCard, createFixture } from '../helpers.js'
import { git, markSucceeded, ratifiedPlanRun } from './cohort-helpers.js'

test('starting a cohort fans out one worktree and one run per chunk', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const session = initCohortSession(root, { planRunId })

  // Init records the carve-up and creates no workspace, so the operator can
  // read the plan before anything exists.
  assert.equal(session.plan_run_id, planRunId)
  assert.equal(session.chunks.length, 3)
  assert.equal(readWorktreeIndex(root).worktrees.length, 0)

  const started = startCohort(root, session.cohort_id)

  assert.equal(started.cohort_index, 1)
  assert.deepEqual(started.chunks.map((chunk) => chunk.chunk).sort(), [
    'alpha',
    'beta',
  ])

  const index = readWorktreeIndex(root)

  assert.equal(index.worktrees.length, 2, 'cohort 2 gains no worktree yet')

  const roots = started.chunks.map(
    (chunk) => loadState(root, chunk.run_id).workspace_root,
  )

  assert.equal(new Set(roots).size, 2, 'chunk workspace roots are distinct')

  for (const chunk of started.chunks) {
    const run = loadState(root, chunk.run_id)

    assert.equal(
      run.workflow_slug,
      'delivery-chunk',
      'a chunk run ends at verified implementation and carries no ship stage',
    )
    assert.deepEqual(run.cohort, {
      cohort_id: session.cohort_id,
      cohort_index: 1,
      chunk: chunk.chunk,
    })
    assert.equal(
      run.request.source_path,
      `runtime/specs/${chunk.chunk}.md`,
      'the chunk run is requested against its own child specification',
    )
    assert.equal(
      run.request.context_reference?.source_path,
      'runtime/specs/parent-specification.md',
      'the parent specification arrives as an audited reference',
    )
    assert.equal(chunk.resume_command, `/pan-resume ${chunk.run_id}`)
    // Bound like `pan init --worktree`, so the `--worktree <name>` option the
    // cohort supervisor passes on every lifecycle command is accepted.
    assert.equal(run.managed_worktree?.path, chunk.worktree)
    assert.equal(run.managed_worktree?.path, run.workspace_root)
    assert.equal(run.managed_worktree?.name, path.basename(chunk.worktree))
    assert.equal(typeof run.managed_worktree?.branch, 'string')
  }

  // The durable record alone answers what is running and what comes next.
  const status = cohortStatus(root, session.cohort_id)

  assert.equal(status.active_cohort_index, 1)
  assert.equal(status.blocked_cohort_index, 2)
  assert.equal(status.blocking_predecessor_index, 1)
  assert.deepEqual(status.satisfied_cohort_indexes, [])
  assert.equal(status.integrate_command, null)
  assert.deepEqual(
    status.chunks.filter((chunk) => chunk.run_id).map((chunk) => chunk.status),
    ['running', 'running'],
  )

  // Cohort 2 stays refused at the lifecycle boundary a stage worker uses.
  const blocked = loadCohortState(root, session.cohort_id)

  assert.equal(
    blocked.chunks.find((chunk) => chunk.id === 'gamma')?.run_id,
    undefined,
  )
  assert.throws(
    () => startCohort(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_ALREADY_STARTED',
  )
})

test('a cohort captures one shared pre-implementation baseline that every chunk run adopts', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)
  const [alpha, beta] = started.chunks.map((chunk) => chunk.run_id)

  assert.ok(alpha && beta)
  assert.equal(
    loadCohortState(root, session.cohort_id).repository_check_baselines,
    undefined,
  )

  // The first chunk run to prepare captures the baseline into the session.
  attestRunCard(root, alpha)
  const alphaPrepared = prepareInvocation(root, alpha)

  assert.equal(alphaPrepared.invocation?.stage.slug, 'implement')

  const alphaBaselines = alphaPrepared.state.repository_check_baselines
  const baselineDirectory = cohortBaselineDirectory(root, session.cohort_id)

  assert.ok(alphaBaselines?.fast)
  assert.ok(alphaBaselines.static)
  assert.equal(alphaBaselines.full, undefined)
  assert.equal(
    baselineDirectory,
    `runtime/logs/cohorts/${session.cohort_id}/baselines`,
  )

  for (const pointer of Object.values(alphaBaselines)) {
    assert.ok(pointer)
    assert.ok(
      pointer.artifact_path.startsWith(`${baselineDirectory}/`),
      pointer.artifact_path,
    )
    assert.ok(existsSync(path.join(root, pointer.artifact_path)))
    assert.equal(pointer.shared_from_cohort, undefined)
  }

  const recorded = loadCohortState(
    root,
    session.cohort_id,
  ).repository_check_baselines

  assert.ok(recorded)
  assert.deepEqual(Object.keys(recorded).sort(), ['fast', 'static'])
  assert.equal(recorded.fast?.captured_by_run_id, alpha)
  assert.equal(recorded.fast?.artifact_path, alphaBaselines.fast.artifact_path)
  assert.equal(
    loadCohortState(root, session.cohort_id).repository_check_baseline_capture,
    undefined,
  )

  // The second chunk run adopts the recorded baseline instead of capturing.
  attestRunCard(root, beta)
  const betaPrepared = prepareInvocation(root, beta)

  assert.equal(betaPrepared.invocation?.stage.slug, 'implement')

  const betaBaselines = betaPrepared.state.repository_check_baselines

  assert.ok(betaBaselines?.fast)
  assert.equal(betaBaselines.fast.shared_from_cohort, session.cohort_id)
  assert.equal(betaBaselines.fast.captured_by_run_id, alpha)
  assert.equal(
    betaBaselines.fast.artifact_path,
    alphaBaselines.fast.artifact_path,
  )
  assert.equal(
    betaBaselines.static?.artifact_path,
    alphaBaselines.static.artifact_path,
  )
  // Beta wrote no baseline artifact of its own.
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows', beta, 'agent', 'evidence'),
    ) &&
      readdirSync(
        path.join(root, 'runtime/logs/workflows', beta, 'agent', 'evidence'),
      ).some((name) => name.startsWith('pre-implementation-')),
    false,
  )
})

test('the parallelism limit starts a wide cohort in batches', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'a', cohort_index: 1 },
    { id: 'b', cohort_index: 1 },
    { id: 'c', cohort_index: 1 },
    { id: 'd', cohort_index: 1 },
    { id: 'e', cohort_index: 1 },
  ])
  const session = initCohortSession(root, { planRunId, maxParallel: 2 })

  assert.equal(session.max_parallel, 2)

  const first = startCohort(root, session.cohort_id)

  assert.deepEqual(
    first.chunks.map((chunk) => chunk.chunk),
    ['a', 'b'],
    'only as many chunks start as the limit allows',
  )
  assert.deepEqual(first.deferred_chunks, ['c', 'd', 'e'])
  assert.equal(readWorktreeIndex(root).worktrees.length, 2)

  // Every slot is taken, so a second start is refused rather than ignored,
  // and the refusal names the waiting chunks.
  assert.throws(
    () => startCohort(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_PARALLELISM_LIMIT',
  )

  const full = cohortStatus(root, session.cohort_id)

  assert.equal(full.max_parallel, 2)
  assert.equal(full.live_chunk_runs, 2)
  assert.equal(full.start_command, null, 'no slot is free')

  // A terminal run frees exactly one slot.
  markSucceeded(root, first.chunks[0].run_id)

  const freed = cohortStatus(root, session.cohort_id)

  assert.equal(freed.live_chunk_runs, 1)
  assert.equal(
    freed.start_command,
    `./bin/pan cohort start ${session.cohort_id}`,
  )

  const second = startCohort(root, session.cohort_id)

  assert.deepEqual(
    second.chunks.map((chunk) => chunk.chunk),
    ['c'],
  )
  assert.deepEqual(second.deferred_chunks, ['d', 'e'])

  // Re-approving the plan run must not start beyond the limit either: the
  // route reports the batch that already exists.
  const autostart = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.equal(autostart?.status, 'already_started')
  assert.equal(autostart?.kind, 'cohort')
  assert.deepEqual(
    autostart?.status === 'already_started' && autostart.kind === 'cohort'
      ? autostart.deferred_chunks
      : [],
    ['d', 'e'],
  )
})

test('cleaning a session removes its chunk worktrees and keeps the branches', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)
  const workspaces = started.chunks.map(
    (chunk) => loadState(root, chunk.run_id).workspace_root,
  )

  // A live chunk run is refused, and the refusal removes nothing.
  assert.throws(
    () => cleanCohortSession(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_RUN_ACTIVE',
  )
  assert.equal(readWorktreeIndex(root).worktrees.length, 2)

  for (const chunk of started.chunks) {
    markSucceeded(root, chunk.run_id)
  }

  // A dirty worktree is refused before any sibling is removed.
  writeFileSync(path.join(root, workspaces[1], 'scratch.txt'), 'wip\n')
  assert.throws(
    () => cleanCohortSession(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_WORKTREE_DIRTY',
  )
  assert.equal(readWorktreeIndex(root).worktrees.length, 2)
  assert.ok(existsSync(path.join(root, workspaces[0])))

  rmSync(path.join(root, workspaces[1], 'scratch.txt'))

  const cleaned = cleanCohortSession(root, session.cohort_id)
  const branches = git(root, ['branch', '--format=%(refname:short)'])

  assert.equal(cleaned.removed_worktrees.length, 2)
  assert.equal(readWorktreeIndex(root).worktrees.length, 0)

  for (const workspace of workspaces) {
    assert.equal(existsSync(path.join(root, workspace)), false)
  }

  for (const name of cleaned.removed_worktrees) {
    assert.match(branches, new RegExp(`^${name}$`, 'mu'))
  }

  // Cleaning again finds nothing left and stays a no-op.
  assert.deepEqual(
    cleanCohortSession(root, session.cohort_id).removed_worktrees,
    [],
  )
})

test('a chunk abandoned before it started receives no worktree and no run', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const session = initCohortSession(root, { planRunId })

  abandonChunk(root, session.cohort_id, 'beta', 'Superseded by alpha.')

  const started = startCohort(root, session.cohort_id)

  assert.deepEqual(
    started.chunks.map((chunk) => chunk.chunk),
    ['alpha'],
  )
  assert.equal(readWorktreeIndex(root).worktrees.length, 1)

  const beta = loadCohortState(root, session.cohort_id).chunks.find(
    (chunk) => chunk.id === 'beta',
  )

  assert.equal(beta?.run_id, undefined)
  assert.equal(beta?.worktree, undefined)

  // Nothing is left to start in cohort 1, and the status view agrees.
  assert.equal(cohortStatus(root, session.cohort_id).start_command, null)
  assert.throws(
    () => startCohort(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_ALREADY_STARTED',
  )
})
