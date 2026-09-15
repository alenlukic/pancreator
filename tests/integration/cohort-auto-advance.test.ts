import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  cohortStatus,
  initCohortSession,
  integrateCohort,
  loadCohortState,
  maybeAdvanceCohort,
  startCohort,
} from '../../src/lib/cohorts.js'
import { loadState } from '../../src/lib/state.js'
import { createFixture } from '../helpers.js'
import {
  commitInChunk,
  git,
  markSucceeded,
  ratifiedPlanRun,
} from './cohort-helpers.js'

/**
 * Leave uncommitted work in a chunk's own worktree. The automatic advance is
 * what turns it into a commit, so the fixture must not commit it.
 */
function writeInChunk(root: string, runId: string, file: string): string {
  const workspace = loadState(root, runId).workspace_root
  const absolute = path.join(root, workspace)

  writeFileSync(path.join(absolute, file), `${file} landed\n`)

  return absolute
}

/** Fire the hook the lifecycle commands fire, for one chunk run. */
function advance(root: string, runId: string) {
  return maybeAdvanceCohort(root, loadState(root, runId))
}

function runIdOf(root: string, cohortId: string, chunk: string): string {
  const record = loadCohortState(root, cohortId).chunks.find(
    (entry) => entry.id === chunk,
  )

  assert.ok(record?.run_id, `chunk '${chunk}' has no run`)

  return record.run_id
}

/**
 * A session whose group 1 holds two units that both succeeded and both left
 * uncommitted work behind, and whose integration checkout is clean.
 */
function groupOneFinished(
  root: string,
  extraChunks: Array<{
    id: string
    cohort_index: number
    depends_on?: string[]
  }> = [],
): { cohortId: string; chunkRunIds: string[] } {
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
    ...extraChunks,
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  for (const chunk of started.chunks) {
    writeInChunk(root, chunk.run_id, `${chunk.chunk}.txt`)
    markSucceeded(root, chunk.run_id)
  }

  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: cohort fixture baseline'])

  return {
    cohortId: session.cohort_id,
    chunkRunIds: started.chunks.map((chunk) => chunk.run_id),
  }
}

test('a finished group integrates and advances with no operator command', () => {
  const root = createFixture()
  const { cohortId, chunkRunIds } = groupOneFinished(root, [
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])

  // Nothing between the units' success and the merge: the hook the lifecycle
  // command fires is the whole path.
  const advanced = advance(root, chunkRunIds[0])

  assert.equal(advanced?.status, 'integrated')

  const state = loadCohortState(root, cohortId)
  const satisfaction = state.satisfaction.filter(
    (entry) => entry.cohort_index === 1,
  )

  assert.equal(satisfaction.length, 1)
  assert.ok(satisfaction[0].merge_commit.length > 0)
  assert.equal(
    satisfaction[0].merge_commit,
    git(root, ['rev-parse', 'HEAD']).trim(),
  )

  // Both units' files reached the base branch, so the advance really merged.
  const merged = git(root, ['log', '--name-only', '--pretty=format:'])

  assert.match(merged, /alpha\.txt/u)
  assert.match(merged, /beta\.txt/u)

  // `cohort integrate` is a retry, not the path that got here.
  assert.equal(cohortStatus(root, cohortId).integrate_command, null)

  if (advanced?.status !== 'integrated') {
    return
  }

  // The merge proof names the commit the harness created for each unit, so
  // the audit trail says which run produced which commit.
  const record = JSON.parse(
    readFileSync(path.join(root, advanced.evidence_path), 'utf8'),
  ) as {
    merged_chunks: Array<{ chunk: string; run_id: string; unit_commit: string }>
  }

  assert.equal(record.merged_chunks.length, 2)

  for (const merged of record.merged_chunks) {
    assert.ok(
      merged.unit_commit && merged.unit_commit.length > 0,
      `chunk '${merged.chunk}' records no unit commit`,
    )
    assert.equal(
      merged.unit_commit,
      git(path.join(root, loadState(root, merged.run_id).workspace_root), [
        'rev-parse',
        'HEAD',
      ]).trim(),
    )
  }
})

test('the automatic advance starts the next group, and the release run after the last one', () => {
  const root = createFixture()
  const { cohortId, chunkRunIds } = groupOneFinished(root, [
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const first = advance(root, chunkRunIds[1])

  assert.equal(first?.status, 'integrated')

  if (first?.status !== 'integrated') {
    return
  }

  assert.equal(first.autostart.status, 'started')
  assert.equal(first.autostart.kind, 'cohort')

  if (
    first.autostart.status !== 'started' ||
    first.autostart.kind !== 'cohort'
  ) {
    return
  }

  assert.deepEqual(
    first.autostart.chunks.map((chunk) => chunk.chunk),
    ['gamma'],
  )

  for (const chunk of loadCohortState(root, cohortId).chunks) {
    assert.ok(chunk.run_id, `chunk '${chunk.id}' holds no run id`)
  }

  // Finish the last group; the same hook must reach the release run.
  const gammaRunId = runIdOf(root, cohortId, 'gamma')

  writeInChunk(root, gammaRunId, 'gamma.txt')
  markSucceeded(root, gammaRunId)

  const last = advance(root, gammaRunId)

  assert.equal(last?.status, 'integrated')

  if (last?.status !== 'integrated') {
    return
  }

  const release = last.autostart

  assert.equal(release.kind, 'release')
  assert.equal(release.status, 'started')

  if (release.kind !== 'release') {
    return
  }

  assert.ok(release.run_id.length > 0)
  assert.ok(release.worktree.length > 0)
  assert.equal(loadCohortState(root, cohortId).release_run_id, release.run_id)
})

test('each harness unit commit carries only its own worktree and names the unit and run', () => {
  const root = createFixture()
  const { cohortId, chunkRunIds } = groupOneFinished(root)

  // A second file in one unit proves the commit stages the whole unit rather
  // than one path, while still excluding the sibling.
  writeInChunk(root, chunkRunIds[0], 'alpha-notes.txt')

  assert.equal(advance(root, chunkRunIds[0])?.status, 'integrated')

  for (const chunk of loadCohortState(root, cohortId).chunks) {
    const workspace = path.join(
      root,
      loadState(root, chunk.run_id ?? '').workspace_root,
    )
    const message = git(workspace, ['log', '-1', '--pretty=%B'])
    const changed = git(workspace, [
      'show',
      '--name-only',
      '--pretty=format:',
      'HEAD',
    ])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    assert.match(message, new RegExp(chunk.id, 'u'))
    assert.match(message, new RegExp(chunk.run_id ?? 'none', 'u'))

    const sibling = chunk.id === 'alpha' ? 'beta' : 'alpha'

    assert.ok(changed.length > 0, `unit '${chunk.id}' committed nothing`)
    assert.ok(
      changed.every((file) => file.startsWith(chunk.id)),
      `unit '${chunk.id}' committed ${changed.join(', ')}`,
    )
    assert.ok(
      !changed.some((file) => file.startsWith(sibling)),
      `unit '${chunk.id}' carried a file from '${sibling}'`,
    )
  }
})

test('an unsucceeded unit leaves the group unintegrated and the next one blocked', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  for (const chunk of started.chunks) {
    writeInChunk(root, chunk.run_id, `${chunk.chunk}.txt`)
  }

  markSucceeded(root, started.chunks[0].run_id)
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: cohort fixture baseline'])

  // The sibling is still running, so the hook must not advance at all.
  assert.equal(advance(root, started.chunks[0].run_id), null)

  const status = cohortStatus(root, session.cohort_id)

  assert.deepEqual(status.satisfied_cohort_indexes, [])
  assert.equal(status.blocked_cohort_index, 2)
  assert.ok(
    !loadCohortState(root, session.cohort_id).chunks.find(
      (chunk) => chunk.id === 'gamma',
    )?.run_id,
    'the blocked group started anyway',
  )
})

test('a failed automatic advance reports the manual command and the retry completes it', () => {
  const root = createFixture()
  const { cohortId, chunkRunIds } = groupOneFinished(root, [
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])

  // Unrelated uncommitted work in the operator's own checkout. The merge runs
  // there, so it must refuse rather than touch it.
  writeFileSync(path.join(root, 'operator-scratch.txt'), 'unrelated\n')

  const failed = advance(root, chunkRunIds[0])

  assert.equal(failed?.status, 'failed')

  if (failed?.status !== 'failed') {
    return
  }

  assert.equal(failed.cohort_id, cohortId)
  assert.equal(failed.cohort_index, 1)
  assert.ok(failed.error.length > 0)
  assert.deepEqual(failed.manual_commands, [
    `./bin/pan cohort integrate ${cohortId}`,
  ])
  assert.deepEqual(cohortStatus(root, cohortId).satisfied_cohort_indexes, [])
  assert.equal(cohortStatus(root, cohortId).blocked_cohort_index, 2)

  // The named command is the retry, and it finishes the advance.
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: operator scratch'])

  const retried = integrateCohort(root, cohortId)

  assert.equal(retried.cohort_index, 1)
  assert.ok(retried.merge_commit.length > 0)
  assert.equal(
    loadCohortState(root, cohortId).satisfaction.filter(
      (entry) => entry.cohort_index === 1,
    ).length,
    1,
  )
  assert.equal(retried.autostart.status, 'started')
  assert.equal(retried.autostart.kind, 'cohort')
})

test('a merge conflict between two units fails the advance and leaves the group unsatisfied', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)

  // Both units rewrite the same line of the same file, so the second merge
  // cannot apply.
  for (const chunk of started.chunks) {
    const workspace = path.join(
      root,
      loadState(root, chunk.run_id).workspace_root,
    )

    writeFileSync(
      path.join(workspace, 'shared.txt'),
      `${chunk.chunk} owns this line\n`,
    )
    markSucceeded(root, chunk.run_id)
  }

  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: cohort fixture baseline'])

  const failed = advance(root, started.chunks[0].run_id)

  assert.equal(failed?.status, 'failed')

  if (failed?.status !== 'failed') {
    return
  }

  assert.match(failed.error, /conflict/iu)
  assert.deepEqual(failed.manual_commands, [
    `./bin/pan cohort integrate ${session.cohort_id}`,
  ])
  assert.deepEqual(
    cohortStatus(root, session.cohort_id).satisfied_cohort_indexes,
    [],
  )
  assert.equal(cohortStatus(root, session.cohort_id).blocked_cohort_index, 2)
})

test('concurrent sibling submissions integrate the group exactly once', async () => {
  const root = createFixture()
  const { cohortId, chunkRunIds } = groupOneFinished(root, [
    { id: 'gamma', cohort_index: 2, depends_on: ['alpha'] },
  ])

  // Both submissions observe their own group finished before either takes the
  // session mutex, which is the race the hook has to survive.
  const results = await Promise.all(
    chunkRunIds.map(async (runId) => advance(root, runId)),
  )
  const integrated = results.filter((result) => result?.status === 'integrated')
  const quiet = results.filter((result) => result === null)

  assert.equal(integrated.length, 1)
  assert.equal(quiet.length, 1)
  assert.equal(
    results.filter((result) => result?.status === 'failed').length,
    0,
  )
  assert.equal(
    loadCohortState(root, cohortId).satisfaction.filter(
      (entry) => entry.cohort_index === 1,
    ).length,
    1,
  )
})

test('a release-bound run never advances a cohort', () => {
  const root = createFixture()
  const { cohortId, chunkRunIds } = groupOneFinished(root)
  const first = advance(root, chunkRunIds[0])

  assert.equal(first?.status, 'integrated')

  const releaseRunId = loadCohortState(root, cohortId).release_run_id

  assert.ok(releaseRunId, 'the last group starts the release run')
  markSucceeded(root, releaseRunId)

  assert.equal(advance(root, releaseRunId), null)
})

test('a committed unit worktree still integrates, because the commit is a no-op', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])
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

  const advanced = advance(root, started.chunks[0].run_id)

  assert.equal(advanced?.status, 'integrated')
  assert.match(
    git(root, ['log', '--name-only', '--pretty=format:']),
    /alpha\.txt/u,
  )
})
