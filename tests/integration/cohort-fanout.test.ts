import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonChunk,
  cleanCohortSession,
  cohortStatus,
  initCohortSession,
  integrateCohort,
  loadCohortState,
  maybeAutostartCohort,
  startCohort,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import { prepareInvocation } from '../../src/lib/engine.js'
import { loadState, statePath } from '../../src/lib/state.js'
import { readWorktreeIndex } from '../../src/lib/worktrees.js'
import {
  attestRunCard,
  createFixture,
  createRun,
  writeJson,
} from '../helpers.js'

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

interface ChunkSpec {
  id: string
  cohort_index: number
  depends_on?: string[]
}

/**
 * Stand up a planning run whose ratified plan stage output holds `chunks`.
 *
 * The cohort lifecycle reads the ratified plan through the run's own durable
 * records, so the fixture writes those records rather than a plan object the
 * commands would have to be told about.
 */
function ratifiedPlanRun(root: string, chunks: ChunkSpec[]): string {
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime', 'specs', 'parent-specification.md'),
    '# Parent specification\n\nThe complete record of the request.\n',
  )

  for (const chunk of chunks) {
    writeFileSync(
      path.join(root, 'runtime', 'specs', `${chunk.id}.md`),
      `# Chunk ${chunk.id}\n\nOne unit of work.\n`,
    )
  }

  writeFileSync(
    path.join(root, 'planning-request.md'),
    '# Request\n\nCarve one ratified plan into cohorts.\n',
  )

  const run = createRun(root, {
    workflowSlug: 'planning',
    requestPath: 'planning-request.md',
  })
  const outputPath = `runtime/logs/workflows/${run.run_id}/agent/outputs/plan-1.json`
  const indexes = [...new Set(chunks.map((chunk) => chunk.cohort_index))].sort()

  writeJson(path.join(root, outputPath), {
    schema_version: 1,
    result: 'success',
    data: {
      cohort_plan: {
        parent_spec_path: 'runtime/specs/parent-specification.md',
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          title: `Outcome ${chunk.id}`,
          cohort_index: chunk.cohort_index,
          child_spec_path: `runtime/specs/${chunk.id}.md`,
          depends_on: chunk.depends_on ?? [],
        })),
        edges: chunks.flatMap((chunk) =>
          (chunk.depends_on ?? []).map((from) => ({ from, to: chunk.id })),
        ),
        cohorts: indexes.map((index) => ({
          index,
          chunks: chunks
            .filter((chunk) => chunk.cohort_index === index)
            .map((chunk) => chunk.id),
        })),
      },
    },
  })

  writeJson(statePath(root, run.run_id), {
    ...loadState(root, run.run_id),
    status: 'succeeded',
    current_stage: null,
    stage_history: [
      {
        stage: 'plan',
        attempt: 1,
        outcome: 'success',
        invocation_id: 'plan-1',
        output_path: outputPath,
        recorded_at: '2026-09-02T00:00:00.000Z',
      },
    ],
  })

  return run.run_id
}

function markSucceeded(root: string, runId: string): void {
  writeJson(statePath(root, runId), {
    ...loadState(root, runId),
    status: 'succeeded',
    current_stage: null,
  })
}

function commitInChunk(root: string, workspace: string, chunk: string): void {
  const absolute = path.join(root, workspace)

  writeFileSync(path.join(absolute, `${chunk}.txt`), `${chunk} landed\n`)
  git(absolute, ['add', `${chunk}.txt`])
  git(absolute, ['commit', '-m', `feat: ${chunk}`])
}

/**
 * Re-declare the fixture as an embedded harness. Integration resolves the
 * repository from `workspace_root`, which stays the fixture root, so only the
 * emitted pan entrypoint changes.
 */
function markEmbedded(root: string): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  writeJson(configPath, { ...config, installation_mode: 'embedded' })
}

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
    assert.equal(run.cohort?.cohort_id, session.cohort_id)
    assert.equal(run.cohort?.cohort_index, 1)
    assert.equal(run.cohort?.chunk, chunk.chunk)
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
  // autostart reports the batch that already exists.
  const planState = loadState(root, planRunId)
  const autostart = maybeAutostartCohort(
    root,
    { ...planState, autostart_cohort: true },
    { actor: 'operator', action: 'approve' },
  )

  assert.equal(autostart?.status, 'already_started')
  assert.deepEqual(
    autostart?.status === 'already_started' ? autostart.deferred_chunks : [],
    ['d', 'e'],
  )
})

test('integration merges a finished cohort and unblocks the next one', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  for (const chunk of started.chunks) {
    commitInChunk(
      root,
      loadState(root, chunk.run_id).workspace_root,
      chunk.chunk,
    )
  }

  // A chunk run that has not succeeded blocks the merge, so the next cohort
  // never branches from work that has not been verified.
  assert.throws(
    () => integrateCohort(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_INTEGRATION_INCOMPLETE',
  )
  assert.deepEqual(
    cohortStatus(root, session.cohort_id).satisfied_cohort_indexes,
    [],
  )

  for (const chunk of started.chunks) {
    markSucceeded(root, chunk.run_id)
  }

  // Integration merges inside the checkout that holds the base branch, so that
  // checkout has to be clean first.
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: cohort fixture baseline'])

  assert.equal(
    cohortStatus(root, session.cohort_id).integrate_command,
    `./bin/pan cohort integrate ${session.cohort_id}`,
  )

  const integration = integrateCohort(root, session.cohort_id)

  assert.equal(integration.cohort_index, 1)
  assert.deepEqual(integration.merged_chunks.sort(), ['alpha', 'beta'])
  assert.equal(
    integration.base_branch,
    loadCohortState(root, session.cohort_id).base_branch,
  )

  const satisfaction = loadCohortState(root, session.cohort_id).satisfaction

  assert.equal(satisfaction.length, 1)
  assert.equal(satisfaction[0].cohort_index, 1)
  assert.ok(satisfaction[0].merge_commit.length > 0)

  // Both chunk commits are now reachable from the base branch, which is what
  // the next cohort branches from.
  const merged = git(root, ['log', '--name-only', '--pretty=format:'])

  assert.match(merged, /alpha\.txt/u)
  assert.match(merged, /beta\.txt/u)

  const status = cohortStatus(root, session.cohort_id)

  assert.deepEqual(status.satisfied_cohort_indexes, [1])
  assert.equal(status.active_cohort_index, 2)
  assert.equal(status.blocked_cohort_index, null)
  assert.equal(
    status.start_command,
    `./bin/pan cohort start ${session.cohort_id}`,
  )

  const next = startCohort(root, session.cohort_id)

  assert.deepEqual(
    next.chunks.map((chunk) => chunk.chunk),
    ['gamma'],
  )
  assert.equal(next.cohort_index, 2)
  attestRunCard(root, next.chunks[0].run_id)
  assert.doesNotThrow(() => prepareInvocation(root, next.chunks[0].run_id))
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

test('approving an autostart planning run starts cohort 1', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])

  writeJson(statePath(root, planRunId), {
    ...loadState(root, planRunId),
    autostart_cohort: true,
  })

  const started = maybeAutostartCohort(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.ok(started)
  assert.equal(started.status, 'started')

  if (started.status !== 'started') {
    return
  }

  assert.equal(started.cohort_index, 1)
  assert.deepEqual(
    started.chunks.map((chunk) => chunk.chunk),
    ['alpha'],
  )

  const status = cohortStatus(root, started.cohort_id)

  assert.equal(status.plan_run_id, planRunId)
  assert.equal(status.active_cohort_index, 1)
  assert.equal(status.blocked_cohort_index, 2)

  // Approving again is idempotent: the hook reuses the session this run opened
  // rather than fanning the same plan out twice, and it reports the existing
  // chunk runs instead of a failure, because nothing failed.
  const again = maybeAutostartCohort(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.equal(again?.status, 'already_started')

  if (again?.status === 'already_started') {
    assert.equal(again.cohort_id, started.cohort_id)
    assert.deepEqual(again.chunks, started.chunks)
  }

  assert.equal(cohortStatus(root, started.cohort_id).chunks.length, 2)
  assert.equal(readWorktreeIndex(root).worktrees.length, 1)
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

test('a single-chunk cohort integrates through a direct merge', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  commitInChunk(
    root,
    loadState(root, started.chunks[0].run_id).workspace_root,
    'alpha',
  )
  markSucceeded(root, started.chunks[0].run_id)
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: cohort fixture baseline'])

  const integration = integrateCohort(root, session.cohort_id)

  assert.deepEqual(integration.merged_chunks, ['alpha'])
  assert.equal(
    integration.merge_commit,
    git(root, ['rev-parse', 'HEAD']).trim(),
  )
  assert.equal(
    integration.evidence_path,
    `runtime/logs/cohorts/${session.cohort_id}/integration-1.json`,
  )
  assert.ok(existsSync(path.join(root, integration.evidence_path)))
  assert.match(
    git(root, ['log', '--name-only', '--pretty=format:']),
    /alpha\.txt/u,
  )
  assert.deepEqual(
    cohortStatus(root, session.cohort_id).satisfied_cohort_indexes,
    [1],
  )
})

test('a single-chunk merge conflict is aborted and leaves the base checkout clean', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)
  const workspace = loadState(root, started.chunks[0].run_id).workspace_root

  // Both sides write the same path with different content.
  writeFileSync(path.join(root, workspace, 'shared.txt'), 'chunk side\n')
  git(path.join(root, workspace), ['add', 'shared.txt'])
  git(path.join(root, workspace), ['commit', '-m', 'feat: chunk side'])
  markSucceeded(root, started.chunks[0].run_id)

  writeFileSync(path.join(root, 'shared.txt'), 'base side\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: base side'])

  const baseBefore = git(root, ['rev-parse', 'HEAD']).trim()

  assert.throws(
    () => integrateCohort(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_INTEGRATION_INCOMPLETE' &&
      error.message.includes('shared.txt') &&
      error.message.includes('aborted'),
  )

  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), baseBefore)
  assert.equal(git(root, ['status', '--porcelain']).trim(), '')
  assert.deepEqual(
    cohortStatus(root, session.cohort_id).satisfied_cohort_indexes,
    [],
  )
})

test('a multi-chunk conflict records which chunks already landed', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)
  const byChunk = new Map(
    started.chunks.map((chunk) => [
      chunk.chunk,
      loadState(root, chunk.run_id).workspace_root,
    ]),
  )

  commitInChunk(root, byChunk.get('alpha') as string, 'alpha')

  const betaWorkspace = path.join(root, byChunk.get('beta') as string)

  writeFileSync(path.join(betaWorkspace, 'shared.txt'), 'beta side\n')
  git(betaWorkspace, ['add', 'shared.txt'])
  git(betaWorkspace, ['commit', '-m', 'feat: beta side'])

  for (const chunk of started.chunks) {
    markSucceeded(root, chunk.run_id)
  }

  markEmbedded(root)
  writeFileSync(path.join(root, 'shared.txt'), 'base side\n')
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: base side'])

  const baseBefore = git(root, ['rev-parse', 'HEAD']).trim()
  const recordPath = `runtime/logs/cohorts/${session.cohort_id}/integration-1-incomplete.json`

  // Alpha merges first and lands; beta conflicts. The error and the durable
  // record both say so, because the merge that landed cannot be undone by the
  // harness without rewriting the operator's branch. The retry command names
  // the installed entrypoint the operator can actually run.
  assert.throws(
    () => integrateCohort(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_INTEGRATION_INCOMPLETE' &&
      error.message.includes("conflicted on chunk 'beta'") &&
      error.message.includes('already merged') &&
      error.message.includes('alpha') &&
      error.message.includes(recordPath) &&
      error.message.includes(
        `'./.pancreator/bin/pan cohort integrate ${session.cohort_id}' again`,
      ),
  )

  const record = JSON.parse(
    readFileSync(path.join(root, recordPath), 'utf8'),
  ) as Record<string, unknown>

  assert.equal(record.base_commit_before_merge, baseBefore)
  assert.deepEqual(record.merged_chunks, ['alpha'])
  assert.equal(record.conflicted_chunk, 'beta')
  assert.deepEqual(record.conflicted_paths, ['shared.txt'])
  assert.notEqual(record.base_commit_after_conflict, baseBefore)

  // The base checkout is the operator's own working tree, so the conflicted
  // merge itself is aborted, and no satisfaction entry is written.
  assert.equal(git(root, ['status', '--porcelain']).trim(), '')
  assert.deepEqual(loadCohortState(root, session.cohort_id).satisfaction, [])
})

test('a single-chunk plan produces one run and no fan-out', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  assert.equal(started.chunks.length, 1)
  assert.equal(readWorktreeIndex(root).worktrees.length, 1)
  assert.equal(
    loadCohortState(root, session.cohort_id).chunks.filter(
      (chunk) => chunk.run_id,
    ).length,
    1,
  )
  assert.equal(cohortStatus(root, session.cohort_id).blocked_cohort_index, null)
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

test('a cohort whose every chunk is abandoned integrates as a no-op and unblocks the next one', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const session = initCohortSession(root, { planRunId })

  abandonChunk(root, session.cohort_id, 'alpha', 'Dropped by the operator.')

  // The abandonment is a recorded operator decision, so the session must not
  // deadlock: status offers integration, and integration records satisfaction
  // without a merge because there is nothing to merge.
  assert.equal(
    cohortStatus(root, session.cohort_id).integrate_command,
    `./bin/pan cohort integrate ${session.cohort_id}`,
  )

  const baseHead = git(root, ['rev-parse', 'HEAD']).trim()
  const integration = integrateCohort(root, session.cohort_id)

  assert.equal(integration.cohort_index, 1)
  assert.deepEqual(integration.merged_chunks, [])
  assert.equal(integration.merge_commit, baseHead)
  assert.ok(existsSync(path.join(root, integration.evidence_path)))

  const status = cohortStatus(root, session.cohort_id)

  assert.deepEqual(status.satisfied_cohort_indexes, [1])
  assert.equal(status.active_cohort_index, 2)
  assert.equal(readWorktreeIndex(root).worktrees.length, 0)

  const next = startCohort(root, session.cohort_id)

  assert.equal(next.cohort_index, 2)
  assert.deepEqual(
    next.chunks.map((chunk) => chunk.chunk),
    ['gamma'],
  )
})
