import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { cleanBestOfN, pruneBestOfN } from '../../src/lib/best-of-n.js'
import { createFixture, writeJson } from '../helpers.js'

import {
  CLI,
  bestOfNCheckpoint,
  git,
  initSession,
  terminateRun,
} from './best-of-n-helpers.js'

test('clean refuses to discard uncommitted candidate work without force', () => {
  const { root, session } = bestOfNCheckpoint('ready')
  const candidate = session.candidates.at(-1)

  assert.ok(candidate)

  // Fresh candidate runs are in flight with clean worktrees, so the refusal is
  // about liveness.
  assert.throws(
    () => cleanBestOfN(root, session.bon_id),
    /Finish or abort the run first/u,
  )

  for (const entry of session.candidates) {
    assert.equal(existsSync(path.join(root, entry.worktree_path)), true)
  }

  // Terminal runs put the dirtiness refusal under test, not the liveness one.
  for (const entry of session.candidates) {
    terminateRun(root, entry.run_id)
  }

  writeJson(path.join(root, candidate.worktree_path, 'src', 'candidate.json'), {
    changed: true,
  })

  assert.throws(
    () => cleanBestOfN(root, session.bon_id),
    /Removing it discards that work/u,
  )

  for (const entry of session.candidates) {
    assert.equal(existsSync(path.join(root, entry.worktree_path)), true)
  }

  const result = cleanBestOfN(root, session.bon_id, { force: true })

  assert.deepEqual(
    result.removed_worktrees,
    session.candidates.map((entry) => entry.worktree_path).sort(),
  )
  assert.ok(
    result.removed_agents.some((name) =>
      name.startsWith(`pan-coder--${candidate.agent_suffix}`),
    ),
  )
  assert.equal(existsSync(path.join(root, candidate.worktree_path)), false)
  assert.equal(
    git(root, ['worktree', 'list', '--porcelain']).includes(
      path.join(root, candidate.worktree_path),
    ),
    false,
  )
})

test('clean refuses while the consolidation run is in flight', () => {
  const { root, session } = bestOfNCheckpoint('consolidated')
  const consolidation = session.consolidation

  assert.ok(consolidation)
  // The candidate worktrees are the consolidation run's declared inputs.
  assert.throws(
    () => cleanBestOfN(root, session.bon_id),
    /consolidation run .* is still/u,
  )

  terminateRun(root, consolidation.run_id)

  const result = cleanBestOfN(root, session.bon_id)

  assert.ok(
    result.removed_agents.some((name) =>
      name.includes(consolidation.agent_suffix),
    ),
  )
})

test('prune removes finished and orphaned resources but preserves active runs', () => {
  const root = createFixture()
  const finished = initSession(root)

  for (const candidate of finished.candidates) {
    terminateRun(root, candidate.run_id)
  }

  const active = initSession(root)
  const orphanBonId = '1_Jan-01-2026_deadbeef'
  const orphanWorktree = path.join(
    root,
    'runtime',
    'worktrees',
    orphanBonId,
    'orphan',
  )

  git(root, ['worktree', 'add', '--detach', orphanWorktree, 'HEAD'])

  const orphanAgent = path.join(
    root,
    '.cursor',
    'agents',
    'pan-coder--bondeadbeef-orphan.md',
  )

  writeFileSync(orphanAgent, 'orphan projection\n')

  const result = pruneBestOfN(root)

  assert.ok(
    result.cleaned_sessions.some(
      (session) => session.bon_id === finished.bon_id,
    ),
  )
  assert.ok(
    result.skipped.some(
      (entry) => entry.resource === `session:${active.bon_id}`,
    ),
  )

  for (const candidate of finished.candidates) {
    assert.equal(existsSync(path.join(root, candidate.worktree_path)), false)
  }

  for (const candidate of active.candidates) {
    assert.equal(existsSync(path.join(root, candidate.worktree_path)), true)
  }

  assert.deepEqual(result.removed_orphan_worktrees, [
    `runtime/worktrees/${orphanBonId}/orphan`,
  ])
  assert.ok(result.removed_orphan_agents.includes(path.basename(orphanAgent)))
  assert.equal(existsSync(orphanAgent), false)

  const forced = pruneBestOfN(root, { force: true })

  assert.ok(
    forced.skipped.some(
      (entry) => entry.resource === `session:${active.bon_id}`,
    ),
  )

  for (const candidate of active.candidates) {
    assert.equal(existsSync(path.join(root, candidate.worktree_path)), true)
  }
})

test('best-of-N prune is available through the CLI', () => {
  const root = createFixture()
  const result = JSON.parse(
    execFileSync(process.execPath, [CLI, 'best-of-n', 'prune', '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
    }),
  ) as {
    cleaned_sessions: unknown[]
    removed_orphan_worktrees: unknown[]
    removed_orphan_agents: unknown[]
    skipped: unknown[]
  }

  assert.deepEqual(result, {
    cleaned_sessions: [],
    removed_orphan_worktrees: [],
    removed_orphan_agents: [],
    skipped: [],
  })
})
