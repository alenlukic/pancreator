import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  cohortDir,
  cohortStatus,
  initCohortSession,
  integrateCohort,
  loadCohortState,
  releaseCohort,
  startCohort,
} from '../../src/lib/cohorts.js'
import { PanError } from '../../src/lib/errors.js'
import { prepareInvocation } from '../../src/lib/engine.js'
import { eventPath, loadState, statePath } from '../../src/lib/state.js'
import { buildInvocationInputs } from '../../src/lib/context.js'
import { renderStatus } from '../../src/lib/render.js'
import { loadRepositoryChecks } from '../../src/lib/repository-checks.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import { readWorktreeIndex } from '../../src/lib/worktrees.js'
import { attestRunCard, createFixture, writeJson } from '../helpers.js'
import {
  CLI,
  commitInChunk,
  finalCohortReadyToIntegrate,
  git,
  markEmbedded,
  markSucceeded,
  ratifiedPlanRun,
  releaseRuns,
} from './cohort-helpers.js'

test('a single-chunk merge conflict is aborted and leaves the base checkout clean', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)
  const workspace = loadState(root, started.chunks[0].run_id).workspace_root

  // A single-chunk fan-out starts one run in one worktree and blocks nothing.
  assert.equal(started.chunks.length, 1)
  assert.equal(cohortStatus(root, session.cohort_id).blocked_cohort_index, null)

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
