import assert from 'node:assert/strict'
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
import { repositoryChecksConfigDigest } from '../../src/lib/gate-cache.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { loadState } from '../../src/lib/state.js'
import { readWorktreeIndex } from '../../src/lib/worktrees.js'
import { attestRunCard, createFixture, writeJson } from '../helpers.js'
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

test('one cohort status read carries the bootstrap command set of every live chunk run', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
    { id: 'gamma', cohort_index: 1 },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  assert.equal(started.chunks.length, 3)

  // Twelve hand-built commands across three runs, read from one record.
  const bootstrap = cohortStatus(root, session.cohort_id).bootstrap

  assert.deepEqual(bootstrap.map((entry) => entry.chunk).sort(), [
    'alpha',
    'beta',
    'gamma',
  ])

  for (const entry of bootstrap) {
    const chunk = started.chunks.find((item) => item.chunk === entry.chunk)

    assert.ok(chunk)
    assert.equal(entry.run_id, chunk.run_id)
    assert.equal(entry.worktree, path.basename(chunk.worktree))
    assert.ok(
      entry.governance_card_command.endsWith(
        `governance card --mode supervisor --run ${entry.run_id}`,
      ),
      entry.governance_card_command,
    )
    assert.ok(
      entry.attest_command.includes(
        `governance attest-supervisor ${entry.run_id} --sha256 `,
      ),
      entry.attest_command,
    )
    assert.ok(
      entry.redline_command.endsWith(
        `status ${entry.run_id} --redline --occasion pan-cohort`,
      ),
      entry.redline_command,
    )
    assert.ok(
      entry.model_evidence_command.includes(
        `models evidence --run ${entry.run_id} --role supervisor`,
      ),
      entry.model_evidence_command,
    )
    assert.equal(entry.attested, false)
  }

  // The facts move with the run: an attested card is reported attested, and
  // its attest command carries the digest the operator would have to look up.
  const first = bootstrap[0]

  attestRunCard(root, first.run_id)

  const attested = cohortStatus(root, session.cohort_id).bootstrap.find(
    (entry) => entry.run_id === first.run_id,
  )

  assert.ok(attested)
  assert.ok(attested.card_sha256)
  assert.equal(attested.attested, true)
  assert.equal(attested.redline_current, true)
  assert.ok(attested.attest_command.endsWith(attested.card_sha256))

  // A run the session no longer supervises owes no bootstrap.
  markSucceeded(root, first.run_id)
  abandonChunk(root, session.cohort_id, 'beta', 'superseded by alpha')

  assert.deepEqual(
    cohortStatus(root, session.cohort_id).bootstrap.map((entry) => entry.chunk),
    ['gamma'],
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

  const alphaWorkspace = loadState(root, alpha).workspace_root

  assert.notEqual(alphaWorkspace, root, 'the chunk run owns its own worktree')

  for (const pointer of Object.values(alphaBaselines)) {
    assert.ok(pointer)
    assert.ok(
      pointer.artifact_path.startsWith(`${baselineDirectory}/`),
      pointer.artifact_path,
    )
    assert.ok(existsSync(path.join(root, pointer.artifact_path)))
    assert.equal(pointer.shared_from_cohort, undefined)
    // The capture names the tree it observed. A shared baseline is read by
    // runs that observed a different tree, and without this the reader
    // cannot tell a host failure of the capturing tree from a regression.
    assert.equal(pointer.capture_workspace_path, alphaWorkspace)

    const artifact = JSON.parse(
      readFileSync(path.join(root, pointer.artifact_path), 'utf8'),
    ) as { capture_workspace_path?: string }

    assert.equal(
      artifact.capture_workspace_path,
      alphaWorkspace,
      'the durable artifact carries the capture path, not only the pointer',
    )
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

  // Beta adopts evidence from alpha's worktree, and its record says so before
  // any gate reports a diagnostic the baseline does not carry. `DEV-001`
  // forbids a second capture, so naming the divergence is the whole remedy:
  // the adopting run keeps the shared baseline and knows where to reproduce.
  const betaWorkspace = loadState(root, beta).workspace_root

  assert.notEqual(betaWorkspace, alphaWorkspace)
  assert.equal(betaBaselines.fast.capture_workspace_path, alphaWorkspace)

  const adoption = (betaPrepared.state.advisories ?? []).filter(
    (advisory) => advisory.kind === 'baseline_adoption',
  )

  assert.deepEqual(
    adoption.map((advisory) => advisory.source),
    ['prepare', 'prepare'],
    'one advisory per adopted interior gate profile',
  )

  for (const profile of ['fast', 'static']) {
    const advisory = adoption.find((item) =>
      item.message.includes(`'${profile}' baseline`),
    )

    assert.ok(advisory, `the ${profile} adoption is named`)
    assert.ok(advisory.message.includes(alphaWorkspace), advisory.message)
    assert.ok(advisory.message.includes(betaWorkspace), advisory.message)
  }

  // Alpha captured in its own workspace, so it carries no divergence to name.
  assert.deepEqual(
    (alphaPrepared.state.advisories ?? []).filter(
      (advisory) => advisory.kind === 'baseline_adoption',
    ),
    [],
  )
})

// Every cohort baseline artifact recorded before the capture path existed
// names no workspace. The run that claims the cohort capture may adopt one,
// and the pointer it builds is what every sibling run reads.
test('a baseline artifact that names no capture workspace is adopted without one', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)
  const [alpha, beta] = started.chunks.map((chunk) => chunk.run_id)

  assert.ok(alpha && beta)

  const alphaWorkspace = loadState(root, alpha).workspace_root
  const legacyDirectory = 'runtime/logs/cohorts/cohort-legacy/baselines'

  for (const profile of ['fast', 'static']) {
    writeJson(
      path.join(root, legacyDirectory, `pre-implementation-${profile}.json`),
      {
        schema_version: 1,
        run_id: '63308_Sep-01-0001_legacy',
        stage: 'implement',
        profile,
        workspace_fingerprint: gitWorkspaceSnapshot(
          path.join(root, alphaWorkspace),
        ).fingerprint,
        checks_config_sha256: repositoryChecksConfigDigest(root),
        recorded_at: '2026-09-01T00:00:00.000Z',
        result: {
          profile,
          status: 'passed',
          config_path: 'runtime/repository-checks.json',
          workspace_root: '.',
          timeout_ms: 60_000,
          results: [],
          total_duration_ms: 0,
          advisories: [],
        },
      },
    )
  }

  attestRunCard(root, alpha)

  const alphaBaselines = prepareInvocation(root, alpha).state
    .repository_check_baselines

  assert.ok(alphaBaselines?.fast)
  assert.equal(
    alphaBaselines.fast.artifact_path,
    `${legacyDirectory}/pre-implementation-fast.json`,
    'the recorded artifact was adopted rather than recaptured',
  )

  for (const pointer of Object.values(alphaBaselines)) {
    assert.ok(pointer)
    // The adopting run is not the tree the capture observed, and the
    // artifact names none, so the pointer asserts nothing about where the
    // evidence was produced.
    assert.equal(
      Object.keys(pointer).includes('capture_workspace_path'),
      false,
      pointer.profile,
    )
  }

  const shared = loadCohortState(
    root,
    session.cohort_id,
  ).repository_check_baselines

  assert.ok(shared?.fast)
  assert.equal(shared.fast.capture_workspace_path, undefined)

  // The sibling reads that shared pointer from its own worktree. A pointer
  // carrying the adopting run's workspace would name alpha's tree here, and
  // the divergence would send this run to reproduce a failure in a workspace
  // the capture never touched.
  attestRunCard(root, beta)

  const betaPrepared = prepareInvocation(root, beta)

  assert.notEqual(loadState(root, beta).workspace_root, alphaWorkspace)
  assert.equal(
    betaPrepared.state.repository_check_baselines?.fast?.shared_from_cohort,
    session.cohort_id,
  )
  assert.deepEqual(
    (betaPrepared.state.advisories ?? []).filter(
      (advisory) => advisory.kind === 'baseline_adoption',
    ),
    [],
    'an unknown capture workspace diverges from nothing',
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
