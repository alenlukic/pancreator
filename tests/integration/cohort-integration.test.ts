import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonChunk,
  cohortStatus,
  initCohortSession,
  integrateCohort,
  loadCohortState,
  startCohort,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import { prepareInvocation } from '../../src/lib/engine.js'
import { loadState } from '../../src/lib/state.js'
import { recordWorkspaceAttribution } from '../../src/lib/workspace-attribution.js'
import { readWorktreeIndex } from '../../src/lib/worktrees.js'
import { attestRunCard, createFixture } from '../helpers.js'
import {
  commitInChunk,
  git,
  markSucceeded,
  ratifiedPlanRun,
} from './cohort-helpers.js'

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

test('an attributed read-only input blocks no integration and joins no harness commit, and an unattributed path in the integration checkout still blocks', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  const chunkWorkspace = loadState(
    root,
    started.chunks[0].run_id,
  ).workspace_root
  const chunkPath = path.join(root, chunkWorkspace)

  commitInChunk(root, chunkWorkspace, 'alpha')
  markSucceeded(root, started.chunks[0].run_id)
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: cohort fixture baseline'])

  // The operator exported a design source into the chunk worktree and
  // recorded it as a read-only input. The unit also left an unattributed
  // file behind, which is its own deliverable and travels with the unit.
  const design = 'design-source.svg'
  const deliverable = 'alpha-notes.txt'

  writeFileSync(path.join(chunkPath, design), '<svg/>\n')
  writeFileSync(path.join(chunkPath, deliverable), 'notes\n')
  recordWorkspaceAttribution(root, {
    workspacePath: root,
    runId: planRunId,
    actingRole: 'operator',
    directive: 'Keep the design source I exported available to every chunk.',
    disposition: 'read-only-input',
    paths: [design],
    artifactPath: `runtime/logs/workflows/${planRunId}/agent/evidence/workspace-directive-1.md`,
  })

  // The chunk worktree is clean state apart from its deliverable, but the
  // checkout that receives the merge holds work nothing accounts for, and
  // that still refuses.
  writeFileSync(path.join(root, 'unfinished.ts'), 'export const a = 1\n')
  assert.throws(
    () => integrateCohort(root, session.cohort_id),
    (error: unknown) => {
      assert.ok(error instanceof PanError)
      assert.equal(error.code, 'COHORT_INTEGRATION_INCOMPLETE')
      assert.match(error.message, /- `unfinished\.ts` — no attribution record/u)
      assert.doesNotMatch(error.message, /design-source\.svg/u)

      return true
    },
  )
  rmSync(path.join(root, 'unfinished.ts'))

  // The refused attempt already committed the unit. The deliverable is in
  // that commit; the read-only input is not, and it is still on disk.
  const unitCommitFiles = git(chunkPath, [
    'show',
    '--name-only',
    '--pretty=format:',
    'HEAD',
  ])

  assert.match(unitCommitFiles, /alpha-notes\.txt/u)
  assert.doesNotMatch(unitCommitFiles, /design-source\.svg/u)
  assert.equal(existsSync(path.join(chunkPath, design)), true)

  // One record covers every checkout of the repository, so the same export
  // placed in the base checkout needs no second attribution.
  writeFileSync(path.join(root, design), '<svg/>\n')

  const integration = integrateCohort(root, session.cohort_id)

  assert.deepEqual(integration.merged_chunks, ['alpha'])
  assert.ok(existsSync(path.join(root, integration.evidence_path)))
  assert.equal(
    existsSync(path.join(root, design)),
    true,
    'the merge never consumed or moved the operator input',
  )
  assert.equal(
    existsSync(path.join(root, deliverable)),
    true,
    'the unit deliverable landed through the merge',
  )
  assert.doesNotMatch(
    git(root, ['log', '--name-only', '--pretty=format:']),
    /design-source\.svg/u,
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
  // deadlock: it still offers the command that records satisfaction without a
  // merge. HR3-010: that command is no longer advertised as an integration,
  // because an abandoned-only cohort has no branch to merge.
  const offered = cohortStatus(root, session.cohort_id)

  assert.equal(offered.integrate_command, null)
  assert.equal(
    offered.record_abandoned_cohort_command,
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
