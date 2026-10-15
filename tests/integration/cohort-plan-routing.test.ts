import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { readAwayDecisionLedger } from '../../src/lib/away-mode.js'
import {
  cohortSessionIds,
  cohortStatus,
  maybeStartDelivery,
  parseCohortPlan,
  retryDeliveryRoute,
  type DeliveryAutostartResult,
} from '../../src/lib/cohorts.js'
import {
  eventPath,
  listRunStates,
  loadState,
  statePath,
} from '../../src/lib/state.js'
import type { StageOutput } from '../../src/lib/types.js'
import { renderStatus } from '../../src/lib/render.js'
import { createWorktree, readWorktreeIndex } from '../../src/lib/worktrees.js'
import { createFixture } from '../fixture-template.js'
import { writeJson } from '../helpers.js'
import { CLI, git, ratifiedPlanRun } from './cohort-helpers.js'
import { AWAY_ALL, checkpoint } from './delivery-helpers.js'

for (const actor of ['operator', 'away'] as const) {
  for (const dirty of [false, true]) {
    test(`pan ${actor === 'away' ? 'away ' : ''}decide approves a worktree-bound multi-chunk plan and reuses its cohort${dirty ? ' after committing dirty work' : ''}`, () => {
      const { root, runId, state } = checkpoint(
        'planning@plan-awaiting-operator',
        AWAY_ALL,
      )
      const worktree = createWorktree(root, 'planning-selected')
      const outputPath = state.stage_history.find(
        (item) => item.stage === 'plan' && item.outcome === 'success',
      )?.output_path

      assert.ok(outputPath)

      const output = JSON.parse(
        readFileSync(path.join(root, outputPath), 'utf8'),
      ) as StageOutput
      const plan = parseCohortPlan(
        output.data.cohort_plan,
        'checkpoint cohort plan',
      )
      const child = plan.chunks[0]

      assert.ok(child)

      const specificationDirectory = path.dirname(child.child_spec_path)
      const childSpecification = readFileSync(
        path.join(root, child.child_spec_path),
        'utf8',
      )

      for (const id of ['alpha', 'beta', 'gamma']) {
        writeFileSync(
          path.join(root, specificationDirectory, `${id}.md`),
          childSpecification,
        )
      }

      output.data.cohort_plan = {
        parent_spec_path: plan.parent_spec_path,
        chunks: [
          {
            id: 'alpha',
            title: 'Alpha',
            cohort_index: 1,
            child_spec_path: path.join(specificationDirectory, 'alpha.md'),
            depends_on: [],
          },
          {
            id: 'beta',
            title: 'Beta',
            cohort_index: 1,
            child_spec_path: path.join(specificationDirectory, 'beta.md'),
            depends_on: [],
          },
          {
            id: 'gamma',
            title: 'Gamma',
            cohort_index: 2,
            child_spec_path: path.join(specificationDirectory, 'gamma.md'),
            depends_on: ['alpha', 'beta'],
          },
        ],
        edges: [
          { from: 'alpha', to: 'gamma' },
          { from: 'beta', to: 'gamma' },
        ],
        cohorts: [
          { index: 1, chunks: ['alpha', 'beta'] },
          { index: 2, chunks: ['gamma'] },
        ],
      }
      writeJson(path.join(root, outputPath), output)
      writeJson(statePath(root, runId), {
        ...state,
        workspace_root: worktree.path,
        managed_worktree: {
          name: worktree.name,
          path: worktree.path,
          branch: worktree.branch,
        },
      })

      const planningPath = path.join(root, worktree.path)

      if (dirty) {
        writeFileSync(
          path.join(planningPath, 'plan-work.txt'),
          'planned work\n',
        )
      }

      const approval = spawnSync(
        process.execPath,
        [
          CLI,
          ...(actor === 'away'
            ? ['away', 'decide', runId, '--action', 'approve']
            : ['decide', runId, 'approve']),
          '--note',
          'Approve the multi-chunk plan.',
          '--worktree',
          worktree.name,
        ],
        { cwd: root, encoding: 'utf8' },
      )

      assert.equal(approval.status, 0, approval.stderr)

      const response = JSON.parse(approval.stdout) as {
        autostart: DeliveryAutostartResult
      }
      let started = response.autostart

      if (dirty) {
        assert.ok(started.status === 'failed' && started.kind === 'cohort')
        assert.match(started.error, /plan-work\.txt/u)
        assert.deepEqual(started.manual_commands, [
          `./bin/pan cohort route --plan-run ${runId}`,
        ])
        assert.equal(loadState(root, runId).status, 'succeeded')
        assert.equal(loadState(root, runId).delivery_handoff?.kind, 'failed')
        assert.deepEqual(cohortSessionIds(root), [])
        assert.equal(listRunStates(root).length, 1)
        assert.equal(readWorktreeIndex(root).worktrees.length, 1)

        const approvedEvent = readFileSync(eventPath(root, runId), 'utf8')
          .trim()
          .split('\n')
          .map(
            (line) => JSON.parse(line) as { decision?: string; actor?: string },
          )
          .filter((event) => event.decision === 'approve')

        assert.deepEqual(
          approvedEvent.map((event) => event.actor),
          [actor],
        )
        git(planningPath, ['add', 'plan-work.txt'])
        git(planningPath, ['commit', '-q', '-m', 'chore: commit planning work'])

        const recovered = spawnSync(
          process.execPath,
          [
            CLI,
            'cohort',
            'route',
            '--plan-run',
            runId,
            '--worktree',
            worktree.name,
          ],
          { cwd: root, encoding: 'utf8' },
        )

        assert.equal(recovered.status, 0, recovered.stderr)
        started = JSON.parse(recovered.stdout) as DeliveryAutostartResult
        const recoveredEvents = readFileSync(eventPath(root, runId), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { decision?: string })
          .filter((event) => event.decision === 'approve')

        assert.deepEqual(recoveredEvents, approvedEvent)
      }

      assert.ok(
        started.status === 'started' && started.kind === 'cohort',
        approval.stdout,
      )
      assert.equal(started.cohort_index, 1)
      assert.deepEqual(
        started.chunks.map((chunk) => chunk.chunk),
        ['alpha', 'beta'],
      )
      assert.equal(
        new Set(started.chunks.map((chunk) => chunk.worktree)).size,
        2,
      )
      assert.ok(
        started.chunks.every((chunk) => chunk.worktree !== worktree.path),
      )
      for (const chunk of started.chunks) {
        const child = loadState(root, chunk.run_id)

        assert.equal(child.workflow_slug, 'delivery-chunk')
        assert.equal(child.workspace_root, chunk.worktree)
        assert.equal(child.managed_worktree?.path, chunk.worktree)

        if (dirty) {
          assert.equal(
            readFileSync(
              path.join(root, chunk.worktree, 'plan-work.txt'),
              'utf8',
            ),
            'planned work\n',
          )
        }
      }
      assert.deepEqual(cohortSessionIds(root), [started.cohort_id])
      assert.equal(listRunStates(root).length, 3)
      assert.equal(readWorktreeIndex(root).worktrees.length, 3)

      const approved = loadState(root, runId)
      const events = readFileSync(eventPath(root, runId), 'utf8')

      assert.equal(approved.status, 'succeeded')
      assert.equal(approved.managed_worktree?.name, worktree.name)
      assert.equal(approved.delivery_handoff?.kind, 'cohort')
      const approvalEvents = events
        .trim()
        .split('\n')
        .map(
          (line) => JSON.parse(line) as { decision?: string; actor?: string },
        )
        .filter((event) => event.decision === 'approve')

      assert.deepEqual(
        approvalEvents.map((event) => event.actor),
        [actor],
      )

      if (actor === 'away') {
        assert.deepEqual(
          readAwayDecisionLedger(root).map((record) => [
            record.action,
            record.result,
          ]),
          [['approve', 'applied']],
        )
      }

      const automatic = maybeStartDelivery(
        root,
        approved,
        { actor, action: 'approve' },
        { worktreeName: worktree.name },
      )
      const retry = spawnSync(
        process.execPath,
        [
          CLI,
          'cohort',
          'route',
          '--plan-run',
          runId,
          '--worktree',
          worktree.name,
        ],
        { cwd: root, encoding: 'utf8' },
      )

      assert.equal(automatic?.status, 'already_started')
      assert.equal(retry.status, 0, retry.stderr)
      assert.deepEqual(JSON.parse(retry.stdout), {
        ...started,
        status: 'already_started',
      })
      assert.deepEqual(cohortSessionIds(root), [started.cohort_id])
      assert.equal(listRunStates(root).length, 3)
      assert.equal(readWorktreeIndex(root).worktrees.length, 3)
      const afterRetry = readFileSync(eventPath(root, runId), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { decision?: string })
        .filter((event) => event.decision === 'approve')

      assert.deepEqual(afterRetry, approvalEvents)
    })
  }
}

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

test('an opted-out multi-chunk plan retains its planning worktree without starting delivery', () => {
  const root = createFixture()
  const worktree = createWorktree(root, 'planning-opt-out')
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
  ])
  const state = loadState(root, planRunId)

  writeJson(statePath(root, planRunId), {
    ...state,
    autostart_delivery: false,
    workspace_root: worktree.path,
    managed_worktree: {
      name: worktree.name,
      path: worktree.path,
      branch: worktree.branch,
    },
  })

  const result = maybeStartDelivery(
    root,
    loadState(root, planRunId),
    { actor: 'operator', action: 'approve' },
    { worktreeName: worktree.name },
  )

  assert.equal(result, null)
  assert.equal(loadState(root, planRunId).status, 'succeeded')
  assert.equal(loadState(root, planRunId).managed_worktree?.name, worktree.name)
  assert.equal(loadState(root, planRunId).delivery_handoff, undefined)
  assert.deepEqual(cohortSessionIds(root), [])
  assert.equal(listRunStates(root).length, 1)
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
  assert.match(started.worktree, /worktrees\/operator\/delivery-/u)
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

test('a single-chunk route preserves the planning involvement profile', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(
    root,
    [{ id: 'alpha', cohort_index: 1 }],
    'long-horizon',
  )
  const started = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'operator',
    action: 'approve',
  })

  assert.ok(started?.status === 'started' && started.kind === 'delivery')
  assert.equal(
    loadState(root, started.run_id).operator_involvement?.profile,
    'long-horizon',
  )
  assert.deepEqual(
    loadState(root, started.run_id).operator_involvement?.contracts,
    ['long_horizon'],
  )
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

// AC-022. The routed run works somewhere the operator did not choose, so the
// response has to say where. A pinned field keeps it from being dropped as
// incidental detail in a later refactor of the handoff shape.
// AC-023. An operator who already prepared a worktree — a rebased branch, a
// warmed install — had no way to say so and got a second checkout beside the
// one they meant the run to use.
test('an explicit worktree is accepted for a single-chunk route and the run occupies it', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])
  const prepared = createWorktree(root, 'operator-prepared', {
    description: 'Prepared by the operator before the plan was approved.',
  })
  // The away route is the one that runs unattended, so the explicit value is
  // proven on that actor; `pan decide` and `pan away decide` both hand the
  // same parsed option to this function.
  const started = maybeStartDelivery(
    root,
    loadState(root, planRunId),
    { actor: 'away', action: 'approve' },
    { worktreeName: prepared.name },
  )

  assert.ok(started?.status === 'started' && started.kind === 'delivery')
  assert.equal(started.worktree, prepared.path)

  const state = loadState(root, started.run_id)

  assert.equal(state.workspace_root, prepared.path)
  assert.equal(state.managed_worktree?.name, prepared.name)
  // No second checkout was created beside the one the operator named.
  assert.equal(readWorktreeIndex(root).worktrees.length, 1)
})

test('a single-chunk route inherits the planning worktree and carries dirty work in place', () => {
  const root = createFixture()
  const worktree = createWorktree(root, 'planning-selected', {
    description: 'Worktree selected for planning and routed delivery.',
  })
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])
  const plan = loadState(root, planRunId)

  writeJson(statePath(root, planRunId), {
    ...plan,
    workspace_root: worktree.path,
    managed_worktree: {
      name: worktree.name,
      path: worktree.path,
      branch: worktree.branch,
    },
  })
  writeFileSync(
    path.join(root, worktree.path, 'operator-plan-work.txt'),
    'keep me\n',
  )

  const started = maybeStartDelivery(root, loadState(root, planRunId), {
    actor: 'away',
    action: 'approve',
  })

  assert.ok(started?.status === 'started' && started.kind === 'delivery')
  assert.equal(started.worktree, worktree.path)
  assert.equal(readWorktreeIndex(root).worktrees.length, 1)
  assert.equal(
    readFileSync(
      path.join(root, worktree.path, 'operator-plan-work.txt'),
      'utf8',
    ),
    'keep me\n',
  )
  assert.equal(
    loadState(root, started.run_id).managed_worktree?.name,
    worktree.name,
  )
})

// AC-018. A cohort branches every chunk worktree from a committed head, so
// uncommitted work in the planning worktree was left behind silently, and an
// unattended approval is exactly when nobody compares the two trees.
test('a multi-chunk route refuses to branch away from a dirty planning worktree and routes once it is committed', () => {
  const root = createFixture()
  const worktree = createWorktree(root, 'planning-wide', {
    description: 'Worktree selected for a plan of two chunks.',
  })
  const planRunId = ratifiedPlanRun(root, [
    { id: 'alpha', cohort_index: 1 },
    { id: 'beta', cohort_index: 1 },
  ])
  const plan = loadState(root, planRunId)

  writeJson(statePath(root, planRunId), {
    ...plan,
    workspace_root: worktree.path,
    managed_worktree: {
      name: worktree.name,
      path: worktree.path,
      branch: worktree.branch,
    },
  })

  const worktreePath = path.join(root, worktree.path)
  const dirtyPath = path.join(worktreePath, 'operator-plan-work.txt')

  writeFileSync(dirtyPath, 'keep me\n')

  const refused = maybeStartDelivery(
    root,
    loadState(root, planRunId),
    {
      actor: 'away',
      action: 'approve',
    },
    { worktreeName: worktree.name },
  )

  assert.equal(refused?.status, 'failed')
  assert.match(refused?.error ?? '', /planning-wide/u)
  assert.match(refused?.error ?? '', /operator-plan-work\.txt/u)
  assert.match(refused?.error ?? '', /[Cc]ommit/u)
  assert.deepEqual(refused?.manual_commands, [
    `./bin/pan cohort route --plan-run ${planRunId}`,
  ])
  // Nothing branched: the planning worktree is still the only checkout, the
  // work is still where the operator left it, and the plan run names the
  // failed route.
  assert.equal(readWorktreeIndex(root).worktrees.length, 1)
  assert.equal(readFileSync(dirtyPath, 'utf8'), 'keep me\n')
  assert.equal(loadState(root, planRunId).delivery_handoff?.kind, 'failed')
  assert.deepEqual(cohortSessionIds(root), [])

  git(worktreePath, ['add', 'operator-plan-work.txt'])
  git(worktreePath, ['commit', '-q', '-m', 'chore: plan-time work'])

  const routed = retryDeliveryRoute(root, planRunId, {
    worktreeName: worktree.name,
  })

  assert.equal(routed.status, 'started')
  assert.equal(routed.kind, 'cohort')

  if (routed.status !== 'started' || routed.kind !== 'cohort') {
    return
  }

  assert.deepEqual(
    routed.chunks.map((chunk) => chunk.chunk),
    ['alpha', 'beta'],
  )

  // The committed work is on the branch every chunk worktree branched from.
  for (const chunk of routed.chunks) {
    assert.equal(
      readFileSync(
        path.join(root, chunk.worktree, 'operator-plan-work.txt'),
        'utf8',
      ),
      'keep me\n',
    )
  }
})

test('an explicit worktree that does not exist is refused by name', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [{ id: 'alpha', cohort_index: 1 }])
  const result = maybeStartDelivery(
    root,
    loadState(root, planRunId),
    { actor: 'operator', action: 'approve' },
    { worktreeName: 'never-created' },
  )

  assert.equal(result?.status, 'failed')
  assert.match(result?.error ?? '', /Worktree 'never-created' does not exist/u)
  assert.equal(readWorktreeIndex(root).worktrees.length, 0)
})
