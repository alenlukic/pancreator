import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonBestOfNCandidate,
  bestOfNStatus,
  cleanBestOfN,
  consolidateBestOfN,
  initBestOfN,
} from '../../src/lib/best-of-n.js'
import { createFixture, writeJson } from '../helpers.js'

import {
  CONFIGS,
  bestOfNCheckpoint,
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

test('an interrupted candidate handoff is adopted from the run state', () => {
  const { root, session } = bestOfNCheckpoint('ready')
  const [alpha, beta] = session.candidates

  // Reproduce a process killed between createRun and the session-record write.
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

  // Terminal runs make the non-forced cleanup safe.
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

  // Reproduce a process killed between createRun and the session-record write.
  const { consolidation: _consolidation, ...withoutConsolidation } = session

  writeJson(sessionStatePath(root, session.bon_id), withoutConsolidation)

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

  writeJson(path.join(root, 'best-of-n-config.json'), {
    ...CONFIGS,
    candidates: [
      { name: 'alpha', personas: { codeer: 'gpt-5.6-terra' } },
      CONFIGS.candidates[1],
    ],
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n-config.json',
      }),
    /Candidate 'alpha' maps unknown persona 'codeer'/u,
  )

  writeJson(path.join(root, 'best-of-n-config.json'), {
    ...CONFIGS,
    consolidation: { personas: { metacritick: 'gpt-5.6-terra' } },
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n-config.json',
      }),
    /Consolidation config 'consolidation' maps unknown persona 'metacritick'/u,
  )

  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
  }

  delete config.defaults.metacritic
  writeJson(configPath, config)
  writeJson(path.join(root, 'best-of-n-config.json'), {
    ...CONFIGS,
    consolidation: { personas: { reviewer: 'gpt-5.6-terra' } },
  })

  assert.throws(
    () =>
      initBestOfN(root, {
        requestPath: 'request.md',
        configsPath: 'best-of-n-config.json',
      }),
    /maps no model for persona 'metacritic'/u,
  )

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
