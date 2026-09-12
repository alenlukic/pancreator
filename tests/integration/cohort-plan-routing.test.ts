import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  cohortSessionIds,
  cohortStatus,
  maybeStartDelivery,
} from '../../src/lib/cohorts.js'
import { eventPath, loadState } from '../../src/lib/state.js'
import { renderStatus } from '../../src/lib/render.js'
import { readWorktreeIndex } from '../../src/lib/worktrees.js'
import { createFixture } from '../fixture-template.js'
import { CLI, ratifiedPlanRun } from './cohort-helpers.js'

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
