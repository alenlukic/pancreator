import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonChunk,
  cleanCohortSession,
  cohortDir,
  cohortSessionIds,
  cohortStatus,
  initCohortSession,
  integrateCohort,
  loadCohortState,
  maybeStartDelivery,
  releaseCohort,
  startCohort,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import { prepareInvocation } from '../../src/lib/engine.js'
import {
  eventPath,
  listRunStates,
  loadState,
  statePath,
} from '../../src/lib/state.js'
import { buildInvocationInputs } from '../../src/lib/context.js'
import { renderStatus } from '../../src/lib/render.js'
import { loadRepositoryChecks } from '../../src/lib/repository-checks.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { readWorktreeIndex } from '../../src/lib/worktrees.js'
import {
  attestRunCard,
  createFixture,
  createRun,
  writeJson,
} from '../helpers.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

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
        // The harness always writes these on a real submission, and the
        // handoff the approval records persists through the same path.
        validation_errors: [],
        deterministic: [],
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

  // A multi-chunk cohort merges through the reconcile ledger, but the durable
  // merge proof COHORT-001 requires is the per-cohort record, the same one a
  // single-chunk cohort writes. The shared ledger is referenced from it.
  const recordPath = `runtime/logs/cohorts/${session.cohort_id}/integration-1.json`

  assert.equal(integration.evidence_path, recordPath)
  assert.equal(satisfaction[0].evidence_path, recordPath)

  const record = JSON.parse(
    readFileSync(path.join(root, recordPath), 'utf8'),
  ) as {
    cohort_index: number
    integration_branch: string
    merged_branches: string[]
    merged_chunks: Array<{ chunk: string; run_id: string; branch: string }>
    base_commit_before_merge: string
    merge_commit: string
    reconcile_evidence_path: string
    recorded_at: string
  }
  const chunkState = loadCohortState(root, session.cohort_id).chunks

  assert.equal(record.cohort_index, 1)
  assert.equal(record.integration_branch, integration.integration_branch)
  assert.equal(record.merge_commit, integration.merge_commit)
  assert.equal(record.merge_commit, git(root, ['rev-parse', 'HEAD']).trim())
  assert.notEqual(record.base_commit_before_merge, record.merge_commit)
  assert.deepEqual(record.merged_chunks.map((chunk) => chunk.chunk).sort(), [
    'alpha',
    'beta',
  ])
  assert.deepEqual(
    record.merged_branches.sort(),
    chunkState
      .filter((chunk) => chunk.cohort_index === 1)
      .map((chunk) => chunk.branch)
      .sort(),
  )

  for (const merged of record.merged_chunks) {
    const chunk = chunkState.find((entry) => entry.id === merged.chunk)

    assert.equal(merged.run_id, chunk?.run_id)
    assert.equal(merged.branch, chunk?.branch)
  }

  assert.equal(
    record.reconcile_evidence_path,
    'runtime/logs/worktrees/reconcile.jsonl',
  )
  assert.ok(existsSync(path.join(root, record.reconcile_evidence_path)))
  assert.ok(!Number.isNaN(Date.parse(record.recorded_at)))

  // Both chunk commits are now reachable from the base branch, which is what
  // the next cohort branches from.
  const merged = git(root, ['log', '--name-only', '--pretty=format:'])

  assert.match(merged, /alpha\.txt/u)
  assert.match(merged, /beta\.txt/u)

  const status = cohortStatus(root, session.cohort_id)

  assert.deepEqual(status.satisfied_cohort_indexes, [1])
  assert.equal(status.active_cohort_index, 2)
  assert.equal(status.blocked_cohort_index, null)

  // The merge proof of a non-final cohort starts the next cohort itself, so
  // the operator no longer types `cohort start` between cohorts and status
  // has nothing left to offer.
  const next = integration.autostart

  assert.equal(next.status, 'started')
  assert.equal(next.kind, 'cohort')

  if (next.status !== 'started' || next.kind !== 'cohort') {
    return
  }

  assert.deepEqual(
    next.chunks.map((chunk) => chunk.chunk),
    ['gamma'],
  )
  assert.equal(next.cohort_index, 2)
  assert.equal(status.start_command, null)
  assert.equal(status.release_run_id, null, 'a cohort is still open')
  assert.throws(
    () => startCohort(root, session.cohort_id),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_ALREADY_STARTED',
  )

  // Gamma branches from the merged result.
  const gammaWorkspace = loadState(root, next.chunks[0].run_id).workspace_root

  assert.ok(existsSync(path.join(root, gammaWorkspace, 'alpha.txt')))
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

test('approving a multi-chunk plan starts cohort 1', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])

  // The fixture's planning run carries the routing default `pan init` records.
  assert.equal(loadState(root, planRunId).autostart_delivery, true)

  const started = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.ok(started)
  assert.equal(started.status, 'started')
  assert.equal(started.kind, 'cohort')

  if (started.status !== 'started' || started.kind !== 'cohort') {
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

  // The plan run records where its plan went, so status on it names the
  // session.
  assert.deepEqual(
    { ...loadState(root, planRunId).delivery_handoff, recorded_at: 'x' },
    { kind: 'cohort', cohort_id: started.cohort_id, recorded_at: 'x' },
  )

  // Approving again is idempotent: the hook reuses the session this run opened
  // rather than fanning the same plan out twice, and it reports the existing
  // chunk runs instead of a failure, because nothing failed.
  const again = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.equal(again?.status, 'already_started')
  assert.equal(again?.kind, 'cohort')

  if (again?.status === 'already_started' && again.kind === 'cohort') {
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

  // The direct merge writes the same record shape as the reconcile path.
  const record = JSON.parse(
    readFileSync(path.join(root, integration.evidence_path), 'utf8'),
  ) as {
    merged_branches: string[]
    merged_chunks: Array<{ chunk: string; run_id: string }>
    merge_commit: string
    reconcile_evidence_path?: string
  }

  assert.deepEqual(record.merged_branches, [
    loadCohortState(root, session.cohort_id).chunks[0].branch,
  ])
  assert.deepEqual(record.merged_chunks, [
    {
      ...record.merged_chunks[0],
      chunk: 'alpha',
      run_id: started.chunks[0].run_id,
    },
  ])
  assert.equal(record.merge_commit, integration.merge_commit)
  assert.equal(record.reconcile_evidence_path, undefined)
  assert.match(
    git(root, ['log', '--name-only', '--pretty=format:']),
    /alpha\.txt/u,
  )
  assert.deepEqual(
    cohortStatus(root, session.cohort_id).satisfied_cohort_indexes,
    [1],
  )
  assert.equal(integration.autostart.status, 'started')
  assert.equal(integration.autostart.kind, 'cohort')
})

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

  const next = integration.autostart

  assert.equal(next.status, 'started')
  assert.equal(next.kind, 'cohort')

  if (next.status !== 'started' || next.kind !== 'cohort') {
    return
  }

  assert.equal(next.cohort_index, 2)
  assert.deepEqual(
    next.chunks.map((chunk) => chunk.chunk),
    ['gamma'],
  )
  assert.equal(readWorktreeIndex(root).worktrees.length, 1)
})

test('approving a single-chunk plan starts one delivery run and no fan-out', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])

  // Away mode approves on the operator's behalf through the same hook, so the
  // first approval here is the away-mode one.
  const started = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'away',
    action: 'approve',
  })

  assert.ok(started)
  assert.equal(started.status, 'started')
  assert.equal(started.kind, 'delivery')

  if (started.status !== 'started' || started.kind !== 'delivery') {
    return
  }

  const state = loadState(root, started.run_id)

  assert.equal(state.workflow_slug, 'delivery')
  assert.equal(state.current_stage, 'implement')
  assert.equal(state.pending_action.type, 'prepare_invocation')
  assert.equal(state.workspace_root, started.worktree)
  assert.ok(state.managed_worktree, 'the run is bound to a fresh worktree')
  assert.equal(state.managed_worktree?.path, started.worktree)
  assert.equal(
    state.request.context_reference?.source_path,
    'runtime/specs/parent-specification.md',
  )
  assert.equal(state.request.source_path, 'runtime/specs/alpha.md')
  assert.equal(started.resume_command, `/pan-resume ${started.run_id}`)
  assert.equal(state.autostart_delivery, undefined)

  // The worktree is a real checkout of the base branch, recorded like a chunk's.
  const index = readWorktreeIndex(root)

  assert.equal(index.worktrees.length, 1)
  assert.equal(index.worktrees[0].path, started.worktree)
  assert.ok(existsSync(path.join(root, started.worktree, '.git')))

  // No cohort session exists: a single chunk is not a fan-out.
  assert.deepEqual(cohortSessionIds(root), [])

  // The plan run stays succeeded and names the handoff.
  const plan = loadState(root, planRunId)

  assert.equal(plan.status, 'succeeded')
  assert.equal(plan.delivery_handoff?.kind, 'delivery')
  assert.deepEqual(
    { ...plan.delivery_handoff, recorded_at: 'x' },
    {
      kind: 'delivery',
      run_id: started.run_id,
      worktree: started.worktree,
      recorded_at: 'x',
    },
  )

  // The context reference reaches the implement card as a required input; the
  // context-reference unit tests prove that, so no card is prepared here.

  // Approving again (now by the operator) is idempotent and starts nothing new.
  const again = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.equal(again?.status, 'already_started')
  assert.equal(again?.kind, 'delivery')

  if (again?.status === 'already_started' && again.kind === 'delivery') {
    assert.equal(again.run_id, started.run_id)
    assert.equal(again.worktree, started.worktree)
  }

  assert.equal(readWorktreeIndex(root).worktrees.length, 1)
  assert.deepEqual(cohortSessionIds(root), [])
})

test('a single-chunk routing failure leaves the approval and the plan intact', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])

  // The child specification the plan names is gone, so the route cannot start.
  rmSync(path.join(root, 'runtime', 'specs', 'alpha.md'))

  const before = loadState(root, planRunId)
  const result = maybeStartDelivery(root, before, {
    actor: 'operator',
    action: 'approve',
  })

  assert.ok(result)
  assert.equal(result.status, 'failed')

  if (result.status !== 'failed') {
    return
  }

  assert.equal(result.kind, 'delivery')
  assert.match(result.error, /alpha/u)
  // The one manual command is the idempotent retry. A hand-built `pan init`
  // would bind a second run to the derived worktree when the failure struck
  // after run creation, because init has no live-run check.
  assert.deepEqual(result.manual_commands, [
    `./bin/pan cohort route --plan-run ${planRunId}`,
  ])

  // The approval and the plan stand, nothing was created, and the plan run
  // records the failed route so status names it after this output is gone.
  const after = loadState(root, planRunId)

  assert.equal(after.status, 'succeeded')
  assert.deepEqual(after.delivery_handoff, {
    kind: 'failed',
    route: 'delivery',
    error: result.error,
    manual_commands: result.manual_commands,
    recorded_at: after.delivery_handoff?.recorded_at,
  })
  assert.equal(after.revision, before.revision + 1)
  assert.match(
    readFileSync(eventPath(root, planRunId), 'utf8'),
    /"type":"delivery_route_failed"/u,
  )
  assert.equal(readWorktreeIndex(root).worktrees.length, 0)
  assert.deepEqual(cohortSessionIds(root), [])

  // The status text renders the failure and each manual command.
  const status = renderStatus(after)

  assert.match(status, /^Delivery route failed: .*alpha/mu)
  assert.match(status, /^  Manual: \.\/bin\/pan cohort route --plan-run /mu)

  // The same failure is recorded once: a repeated approval appends nothing.
  maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })
  assert.equal(loadState(root, planRunId).revision, before.revision + 1)

  // A successful retry replaces the failed record with the handoff.
  writeFileSync(
    path.join(root, 'runtime', 'specs', 'alpha.md'),
    '# Chunk alpha\n\nRestored.\n',
  )

  const retried = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.equal(retried?.status, 'started')
  assert.equal(loadState(root, planRunId).delivery_handoff?.kind, 'delivery')
})

test('pan cohort route retries a failed plan route from the command line', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])
  const route = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [CLI, 'cohort', 'route', '--plan-run', planRunId, ...args],
      { cwd: root, encoding: 'utf8' },
    )

  // The approval's route failed: the child specification is missing.
  rmSync(path.join(root, 'runtime', 'specs', 'alpha.md'))

  const failed = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.equal(failed?.status, 'failed')

  // The retry reports the same failure with a non-zero exit while the cause
  // stands.
  const stillFailed = route('--json')

  assert.notEqual(stillFailed.status, 0)
  assert.equal(JSON.parse(stillFailed.stdout).status, 'failed')

  // Once repaired, the command routes the plan and reports the handoff.
  writeFileSync(
    path.join(root, 'runtime', 'specs', 'alpha.md'),
    '# Chunk alpha\n\nRestored.\n',
  )

  const routed = route('--json')

  assert.equal(routed.status, 0, routed.stderr)

  const result = JSON.parse(routed.stdout) as Record<string, unknown>

  assert.equal(result.status, 'started')
  assert.equal(result.kind, 'delivery')
  assert.equal(typeof result.run_id, 'string')
  assert.equal(result.resume_command, `/pan-resume ${String(result.run_id)}`)
  assert.equal(
    loadState(root, planRunId).delivery_handoff?.kind,
    'delivery',
    'a successful retry replaces the failed handoff record',
  )

  // The command is idempotent and the plain form prints the same record.
  const again = route()

  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /already_started/u)
  assert.match(again.stdout, new RegExp(String(result.run_id), 'u'))

  // A run that is not a planning run is refused by name.
  const refused = spawnSync(
    process.execPath,
    [CLI, 'cohort', 'route', '--plan-run', String(result.run_id)],
    { cwd: root, encoding: 'utf8' },
  )

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /COHORT_PLAN_RUN_INVALID/u)

  // The option is required.
  const missing = spawnSync(process.execPath, [CLI, 'cohort', 'route'], {
    cwd: root,
    encoding: 'utf8',
  })

  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /INVALID_ARGUMENT/u)
})

/** A session whose only cohort is committed, succeeded, and ready to integrate. */
function finalCohortReadyToIntegrate(root: string): {
  cohortId: string
  planRunId: string
  chunkRunIds: string[]
} {
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
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

  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: cohort fixture baseline'])

  return {
    cohortId: session.cohort_id,
    planRunId,
    chunkRunIds: started.chunks.map((chunk) => chunk.run_id),
  }
}

function releaseRuns(root: string): string[] {
  return listRunStates(root)
    .filter((run) => run.workflow_slug === 'delivery')
    .map((run) => run.run_id)
}

// One pre-integration session carries three scenarios in sequence: a release
// start that fails after the merge landed, the retry that starts the release
// run, and a retry after the session lost the run it started. Each rebuild of
// the session costs about a second, and the scenarios are consecutive states
// of one session anyway.
test('the last integration starts the release run at verify in its own worktree, and every retry completes or adopts it', () => {
  const root = createFixture()
  const { cohortId, planRunId, chunkRunIds } = finalCohortReadyToIntegrate(root)
  const parentSpec = path.join(
    root,
    'runtime',
    'specs',
    'parent-specification.md',
  )
  const parentSpecText = readFileSync(parentSpec, 'utf8')

  // Before the final cohort is integrated, the merge-free release command is
  // refused by name: it never stands in for the operator's merge.
  assert.throws(
    () => releaseCohort(root, cohortId),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'COHORT_NOT_SATISFIED' &&
      error.message.includes(`Cohort 1 of session ${cohortId}`) &&
      error.message.includes(`./bin/pan cohort integrate ${cohortId}`) &&
      (error.details as { unsatisfied_cohort_index: number })
        .unsatisfied_cohort_index === 1,
  )
  assert.deepEqual(releaseRuns(root), [])

  const refused = spawnSync(
    process.execPath,
    [CLI, 'cohort', 'release', cohortId, '--json'],
    { cwd: root, encoding: 'utf8' },
  )

  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /COHORT_NOT_SATISFIED/u)

  // (a) The release run reaches the parent specification by reference, so its
  // absence makes run creation fail after the merge already landed.
  rmSync(parentSpec)

  const failed = integrateCohort(root, cohortId)

  assert.equal(failed.autostart.status, 'failed')
  assert.equal(failed.autostart.kind, 'release')

  if (failed.autostart.status !== 'failed') {
    return
  }

  // The retry is the merge-free release command, not another integrate: the
  // merge is the operator's own action and it already landed. A hand-built
  // `pan init` would carry no start-stage record, so neither command could
  // adopt it and it would start a second release run on the same checkout.
  assert.deepEqual(failed.autostart.manual_commands, [
    `./bin/pan cohort release ${cohortId}`,
  ])
  assert.equal(failed.merge_commit, git(root, ['rev-parse', 'HEAD']).trim())
  assert.ok(existsSync(path.join(root, failed.evidence_path)))

  const afterFailure = cohortStatus(root, cohortId)

  assert.deepEqual(afterFailure.satisfied_cohort_indexes, [1])
  assert.equal(afterFailure.release_run_id, null)
  assert.equal(afterFailure.integrate_command, null)
  assert.equal(afterFailure.start_command, null)
  // Every cohort is satisfied and no release run exists, so status offers the
  // one command that completes the plan.
  assert.equal(
    afterFailure.release_command,
    `./bin/pan cohort release ${cohortId}`,
  )
  assert.deepEqual(releaseRuns(root), [])

  // The release command reports the same failure while the cause stands, and
  // merges nothing while doing so.
  const releaseFailed = releaseCohort(root, cohortId)

  assert.equal(releaseFailed.status, 'failed')
  assert.equal(releaseFailed.kind, 'release')
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), failed.merge_commit)
  assert.deepEqual(releaseRuns(root), [])

  // (b) The merge proof is durable, so the release command starts the release
  // run through the CLI without touching the integration branch.
  writeFileSync(parentSpec, parentSpecText)

  const releasedViaCli = spawnSync(
    process.execPath,
    [CLI, 'cohort', 'release', cohortId, '--json'],
    { cwd: root, encoding: 'utf8' },
  )

  assert.equal(releasedViaCli.status, 0, releasedViaCli.stderr)

  const release = JSON.parse(releasedViaCli.stdout) as ReturnType<
    typeof releaseCohort
  >

  assert.equal(release.status, 'started')
  assert.equal(release.kind, 'release')

  if (release.status !== 'started' || release.kind !== 'release') {
    return
  }

  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), failed.merge_commit)

  // A second release call adopts the run it started instead of starting
  // another.
  const releasedAgain = releaseCohort(root, cohortId)

  assert.equal(releasedAgain.status, 'already_started')
  assert.equal(releasedAgain.kind, 'release')

  if (releasedAgain.status === 'already_started') {
    assert.equal(releasedAgain.run_id, release.run_id)
  }

  // The merge proof the release run stands on is the one the failed integrate
  // recorded: nothing merged again.
  const completed = failed

  // Without `--into-branch` the operator's checkout holds the integration
  // branch, and Git will not check a branch out twice, so the release run
  // gets a managed worktree of its own branched from the integration head:
  // every `pan release` subcommand needs `--worktree`.
  const state = loadState(root, release.run_id)

  assert.equal(state.workflow_slug, 'delivery')
  assert.equal(state.current_stage, 'verify')
  assert.equal(state.pending_action.type, 'prepare_invocation')
  assert.ok(state.managed_worktree, 'the release run is bound to a worktree')
  assert.match(state.managed_worktree?.name ?? '', /^release-[0-9a-f]{6}$/u)
  assert.equal(state.workspace_root, state.managed_worktree?.path)
  assert.equal(state.workspace_root, release.worktree)
  assert.notEqual(
    realpathSync(path.resolve(root, state.workspace_root)),
    realpathSync(root),
  )
  assert.equal(
    git(path.join(root, state.workspace_root), ['rev-parse', 'HEAD']).trim(),
    completed.merge_commit,
    'the release worktree starts at the integration head',
  )
  assert.ok(existsSync(path.join(root, state.workspace_root, 'alpha.txt')))
  assert.ok(existsSync(path.join(root, state.workspace_root, 'beta.txt')))
  assert.equal(
    state.request.context_reference?.source_path,
    'runtime/specs/parent-specification.md',
  )
  assert.equal(
    state.request.source_path,
    loadState(root, planRunId).request.stored_path,
  )
  assert.equal(state.attempts.implement ?? 0, 0)
  assert.deepEqual(state.stage_history, [])
  assert.equal(release.resume_command, `/pan-resume ${release.run_id}`)

  // The run names the session and the final merge proof: the chunk runs that
  // proof lists are its implementation record.
  assert.deepEqual(state.cohort, {
    cohort_id: cohortId,
    role: 'release',
    integration_record: completed.evidence_path,
  })
  assert.equal(
    completed.evidence_path,
    `runtime/logs/cohorts/${cohortId}/integration-1.json`,
  )
  assert.match(
    renderStatus(state),
    new RegExp(`^Release of cohort: ${cohortId}$`, 'mu'),
  )

  // The run record shows the start-stage override, so an auditor can tell
  // this run began at verify by design rather than by a skipped stage.
  const events = readFileSync(eventPath(root, release.run_id), 'utf8')

  assert.match(events, /"start_stage":"verify"/u)

  // The session records the release run, and status offers its resume and no
  // further command.
  const status = cohortStatus(root, cohortId)

  assert.equal(status.release_run_id, release.run_id)
  assert.equal(status.release_resume_command, `/pan-resume ${release.run_id}`)
  assert.deepEqual(status.satisfied_cohort_indexes, [1])
  assert.equal(status.start_command, null)
  assert.equal(status.integrate_command, null)
  assert.equal(status.release_command, null)
  assert.equal(loadCohortState(root, cohortId).release_run_id, release.run_id)
  assert.deepEqual(releaseRuns(root), [release.run_id])

  // The verify card of the release run treats the chunk runs as the
  // implementation record: the integration record is a required input, the
  // absent implement output is not a missing input, and each chunk run's
  // verify output is asked for.
  const inputs = buildInvocationInputs({
    root,
    state,
    stage: stageBySlug(loadWorkflow(root, 'delivery'), 'verify'),
    attempt: 1,
    invocationId: 'verify-1',
    workspaceFingerprint: 'fp-release',
  })
  const required = inputs.references.filter(
    (item) => (item.retrieval ?? 'required') === 'required',
  )

  assert.ok(
    required.some((item) => item.path === completed.evidence_path),
    'the integration record is a required input',
  )
  assert.equal(
    (inputs.missing_required ?? []).some((entry) =>
      entry.includes("stage 'implement'"),
    ),
    false,
    'no implement output is reported missing on a release run',
  )
  // The fixture's chunk runs never wrote a verify output, so each one is a
  // named gap rather than silence.
  for (const chunkRunId of chunkRunIds) {
    assert.ok(
      (inputs.missing_required ?? []).some((entry) =>
        entry.includes(chunkRunId),
      ),
      `the missing verify output of ${chunkRunId} is named`,
    )
  }

  // The release run has no plan output of its own: each chunk's child
  // specification, which holds the acceptance criteria and validation cases,
  // is a required input so the verifier grades against them.
  for (const chunk of ['alpha', 'beta']) {
    const childSpec = required.find(
      (item) => item.path === `runtime/specs/${chunk}.md`,
    )

    assert.ok(childSpec, `the child specification of '${chunk}' is required`)
    assert.equal(
      childSpec.description,
      `Child specification of chunk '${chunk}': the acceptance criteria ` +
        'and validation cases this release verify grades',
    )
  }

  // The release run prepares at verify. Its worktree is fresh, so the
  // target-declared setup commands provision it once before the first stage,
  // although that stage is read-only, and the run records that they ran.
  writeJson(path.join(root, 'runtime', 'repository-checks.json'), {
    ...loadRepositoryChecks(root),
    setup: [
      `node -e "require('node:fs').writeFileSync('workspace-setup-marker.txt', 'provisioned')"`,
    ],
  })
  attestRunCard(root, release.run_id)

  const prepared = prepareInvocation(root, release.run_id)

  assert.equal(prepared.invocation?.stage.slug, 'verify')

  const marker = path.join(
    root,
    state.workspace_root,
    'workspace-setup-marker.txt',
  )

  assert.equal(readFileSync(marker, 'utf8'), 'provisioned')
  assert.equal(
    loadState(root, release.run_id).workspace_setup?.status,
    'passed',
  )
  assert.equal(
    existsSync(path.join(root, 'workspace-setup-marker.txt')),
    false,
    'setup runs in the release worktree, not in the base checkout',
  )

  // The record makes setup a once-per-run action: a later prepare of the same
  // run does not run the commands again.
  rmSync(marker)
  writeJson(statePath(root, release.run_id), {
    ...loadState(root, release.run_id),
    pending_action: { type: 'prepare_invocation' },
    current_invocation: null,
  })

  const reprepared = prepareInvocation(root, release.run_id)

  assert.equal(reprepared.invocation?.stage.slug, 'verify')
  assert.equal(existsSync(marker), false)
  assert.equal(
    loadState(root, release.run_id).workspace_setup?.recorded_at,
    prepared.state.workspace_setup?.recorded_at,
  )

  // With the release run recorded there is nothing left to integrate.
  assert.throws(
    () => integrateCohort(root, cohortId),
    (error: unknown) =>
      error instanceof PanError && error.code === 'COHORT_COMPLETE',
  )

  // (c) Run creation and the session record are two writes. Drop the second
  // one to stand in for a process that died between them: the next integrate
  // adopts the run bound to the release worktree instead of starting another.
  const unrecorded = loadCohortState(root, cohortId)

  delete unrecorded.release_run_id
  writeJson(path.join(cohortDir(root, cohortId), 'state.json'), unrecorded)
  assert.equal(
    cohortStatus(root, cohortId).release_command,
    `./bin/pan cohort release ${cohortId}`,
  )

  const adopted = integrateCohort(root, cohortId)

  assert.equal(adopted.merge_commit, completed.merge_commit)
  assert.equal(adopted.autostart.status, 'already_started')
  assert.equal(adopted.autostart.kind, 'release')

  if (adopted.autostart.status !== 'already_started') {
    return
  }

  assert.equal(adopted.autostart.run_id, release.run_id)
  assert.equal(adopted.autostart.worktree, release.worktree)
  assert.equal(loadCohortState(root, cohortId).release_run_id, release.run_id)
  assert.deepEqual(releaseRuns(root), [release.run_id])
  assert.equal(
    readWorktreeIndex(root).worktrees.filter((entry) =>
      entry.name.startsWith('release-'),
    ).length,
    1,
    'the retry reuses the release worktree',
  )
})
