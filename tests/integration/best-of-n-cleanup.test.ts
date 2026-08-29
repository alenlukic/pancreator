import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonBestOfNCandidate,
  bestOfNStatus,
  cleanBestOfN,
  consolidateBestOfN,
  initBestOfN,
  pruneBestOfN,
} from '../../src/lib/best-of-n.js'
import { createFixture, writeJson } from '../helpers.js'

import {
  CLI,
  CONFIGS,
  bestOfNCheckpoint,
  git,
  initSession,
  readSessionState,
  sessionStatePath,
  terminateRun,
} from './best-of-n-helpers.js'

test('consolidation refuses a session no candidate finished', () => {
  const { root, session } = bestOfNCheckpoint('ready')

  for (const candidate of session.candidates) {
    abandonBestOfNCandidate(
      root,
      session.bon_id,
      candidate.run_id,
      'Operator stopped this candidate.',
    )
  }

  assert.throws(
    () => consolidateBestOfN(root, session.bon_id),
    /no successful candidate/u,
  )
})

test('clean refuses to discard uncommitted candidate work without force', () => {
  const { root, session } = bestOfNCheckpoint('ready')
  const candidate = session.candidates.at(-1)

  assert.ok(candidate)

  // Fresh candidate runs are still in flight with clean worktrees, which is
  // exactly the state a dirtiness-only preflight would remove.
  assert.throws(
    () => cleanBestOfN(root, session.bon_id),
    /Finish or abort the run first/u,
  )

  for (const entry of session.candidates) {
    assert.equal(existsSync(path.join(root, entry.worktree_path)), true)
  }

  // Terminal runs put the dirtiness refusal — not the liveness refusal — under
  // test.
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
  // The candidate worktrees are the consolidation run's declared inputs and
  // its agent variants gate every later engine operation on the run.
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

test('an interrupted candidate handoff is adopted from the run state', () => {
  const { root, session } = bestOfNCheckpoint('ready')
  const [alpha, beta] = session.candidates

  // Reproduce a process killed between createRun and the session-record write:
  // the beta run exists durably while the session still shows a pending slot.
  writeJson(sessionStatePath(root, session.bon_id), {
    ...session,
    status: 'initializing',
    candidates: [alpha],
    pending: [
      {
        slot: beta.slot,
        worktree_path: beta.worktree_path,
        agent_suffix: beta.agent_suffix,
      },
    ],
  })

  const status = bestOfNStatus(root, session.bon_id)

  assert.equal(status.session_status, 'ready')
  assert.deepEqual(status.incomplete, [])
  assert.deepEqual(
    status.candidates.map((entry) => entry.run_id).sort(),
    [alpha.run_id, beta.run_id].sort(),
  )

  // Cleanup must reconcile before it decides which worktrees and live runs the
  // session owns. Terminal runs make the non-forced cleanup safe.
  terminateRun(root, alpha.run_id)
  terminateRun(root, beta.run_id)

  const cleaned = cleanBestOfN(root, session.bon_id)

  const persisted = readSessionState(root, session.bon_id)

  assert.deepEqual(
    cleaned.removed_worktrees,
    [alpha.worktree_path, beta.worktree_path].sort(),
  )
  assert.equal(persisted.status, 'ready')
  assert.deepEqual(persisted.pending, [])
  assert.deepEqual(
    persisted.candidates.map((entry) => entry.run_id).sort(),
    [alpha.run_id, beta.run_id].sort(),
  )
})

test('an interrupted consolidation handoff cannot start a second consolidation run', () => {
  const { root, session } = bestOfNCheckpoint('consolidated')
  const consolidationRunId = session.consolidation?.run_id

  assert.ok(consolidationRunId)

  // Reproduce a process killed between createRun and the session-record write:
  // the consolidation run exists durably while the session records none.
  const { consolidation: _consolidation, ...withoutConsolidation } = session

  writeJson(sessionStatePath(root, session.bon_id), withoutConsolidation)

  // A retry adopts the existing run instead of creating a duplicate against
  // the same workspace.
  assert.throws(
    () => consolidateBestOfN(root, session.bon_id),
    /already started consolidation run/u,
  )

  const persisted = readSessionState(root, session.bon_id)

  assert.equal(persisted.consolidation?.run_id, consolidationRunId)
  assert.equal(
    bestOfNStatus(root, session.bon_id).consolidation?.run_id,
    consolidationRunId,
  )
})

test('init validates the consolidation config before any candidate runs', () => {
  const root = createFixture()

  writeJson(path.join(root, 'best-of-n.json'), {
    ...CONFIGS,
    candidates: [
      { name: 'alpha', personas: { codeer: 'gpt-5.4' } },
      CONFIGS.candidates[1],
    ],
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n.json',
      }),
    /Candidate 'alpha' maps unknown persona 'codeer'/u,
  )

  writeJson(path.join(root, 'best-of-n.json'), {
    ...CONFIGS,
    consolidation: { personas: { metacritick: 'gpt-5.4' } },
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n.json',
      }),
    /Consolidation config 'consolidation' maps unknown persona 'metacritick'/u,
  )

  // A consolidation persona with neither a mapping nor a default fails at
  // init, not after N candidate runs completed.
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
  }

  delete config.defaults.metacritic
  writeJson(configPath, config)
  writeJson(path.join(root, 'best-of-n.json'), {
    ...CONFIGS,
    consolidation: { personas: { reviewer: 'gpt-5.4' } },
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n.json',
      }),
    /maps no model for persona 'metacritic'/u,
  )

  // Nothing was created for any rejected config.
  assert.equal(existsSync(path.join(root, 'worktrees')), false)
  assert.equal(existsSync(path.join(root, 'runtime', 'worktrees')), false)
})

test('consolidate refuses a stored configs file that drifted since init', () => {
  const { root, session } = bestOfNCheckpoint('ready')
  const storedConfigs = path.join(
    root,
    'runtime',
    'logs',
    'best-of-n',
    session.bon_id,
    'configs.json',
  )

  writeFileSync(storedConfigs, `${readFileSync(storedConfigs, 'utf8')}\n`)

  assert.throws(
    () => consolidateBestOfN(root, session.bon_id),
    /no longer match the digest recorded at initialization/u,
  )
})
