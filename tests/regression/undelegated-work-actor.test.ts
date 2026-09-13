import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abortRun,
  getRunState,
  pauseRun,
  resumeRun,
} from '../../src/lib/engine.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'

// A supervisor whose launch failed did the implementation itself and paused
// the run to do it. The pause and the resulting ratification both read as the
// operator's work, so the record named an actor who never touched the tree.
test('a pause taken because delegation is impossible records the acting agent', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  const paused = pauseRun(
    root,
    run.run_id,
    'The worker launch failed twice; the supervisor is doing the work.',
    { actor: 'supervisor' },
  )

  assert.equal(paused.operator_pause?.actor, 'supervisor')
  assert.match(
    readFileSync(path.join(root, paused.last_decision_path!), 'utf8'),
    /supervisor paused the workflow/iu,
  )

  // The edit arrives after the failed launch, under the pause the supervisor
  // took. It is the supervisor's change, and the run record must say so.
  writeFileSync(
    path.join(root, 'src', 'undelegated.ts'),
    'export const a = 1\n',
  )

  const resumed = resumeRun(root, run.run_id)
  const ratification = (resumed.operator_workspace_ratifications ?? []).at(-1)

  assert.ok(ratification, 'the delta is recorded rather than absorbed')
  assert.equal(ratification.actor, 'supervisor')
  assert.ok(ratification.changed_paths.includes('src/undelegated.ts'))
  assert.match(
    readFileSync(path.join(root, ratification.artifact_path), 'utf8'),
    /Acting agent.*supervisor/u,
  )
})

test('an operator pause keeps recording the operator as the actor', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  pauseRun(root, run.run_id, 'Operator is editing the request.')
  writeFileSync(
    path.join(root, 'src', 'operator-edit.ts'),
    'export const b = 2\n',
  )

  const resumed = resumeRun(root, run.run_id)
  const ratification = (resumed.operator_workspace_ratifications ?? []).at(-1)

  assert.ok(ratification)
  assert.equal(ratification.actor, 'operator')
  assert.match(
    readFileSync(path.join(root, ratification.artifact_path), 'utf8'),
    /operator explicitly paused/u,
  )
})

// A canceled run stops watching its workspace, so anything still uncommitted
// belongs to nobody and the next run in the same tree inherits it silently.
test('a run that ends while its workspace is dirty reports what it left behind', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  writeFileSync(
    path.join(root, 'src', 'left-behind.ts'),
    'export const c = 3\n',
  )

  const aborted = abortRun(root, run.run_id, 'Abandoned for a better plan.')

  assert.equal(aborted.status, 'canceled')
  assert.ok(aborted.dirty_exit)
  assert.ok(aborted.dirty_exit.changed_paths.includes('src/left-behind.ts'))
  assert.equal(aborted.dirty_exit.worktree, run.managed_worktree?.name ?? null)
  assert.equal(aborted.dirty_exit.workspace_root, run.workspace_root || '.')
  assert.deepEqual(
    getRunState(root, run.run_id).dirty_exit,
    aborted.dirty_exit,
    'the durable record carries the same report the command returned',
  )
})

test('a run that ends clean reports nothing left behind', () => {
  const root = createFixture()
  const run = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
  })

  assert.equal(
    abortRun(root, run.run_id, 'Nothing to keep.').dirty_exit,
    undefined,
  )
})
