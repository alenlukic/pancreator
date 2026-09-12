import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  abandonBestOfNCandidate,
  bestOfNMutexPath,
  bestOfNStatus,
  cleanBestOfN,
  consolidateBestOfN,
  initBestOfN,
} from '../../src/lib/best-of-n.js'
import { withOperationMutex } from '../../src/lib/io.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { createFixture, writeJson } from '../helpers.js'

import {
  CONFIGS,
  EXCLUSION_NOTE,
  bestOfNCheckpoint,
  sessionIdFromFailure,
} from './best-of-n-helpers.js'

test('a failed init leaves a session the lifecycle commands can recover', () => {
  const root = createFixture()

  writeJson(path.join(root, 'best-of-n-config.json'), {
    ...CONFIGS,
    setup: ['node -e "process.exit(7)"'],
  })

  let failure: unknown

  try {
    initBestOfN(root, {
      requestPath: 'request.md',
      configsPath: 'best-of-n-config.json',
    })
  } catch (error) {
    failure = error
  }

  assert.ok(failure, 'a failed setup command fails init')
  assert.match(
    failure instanceof Error ? failure.message : String(failure),
    /Setup command failed for candidate 'alpha'/u,
  )

  const bonId = sessionIdFromFailure(failure)
  const status = bestOfNStatus(root, bonId)

  // The worktree exists but its run does not, so the session is discoverable
  // rather than an orphan the commands cannot name.
  assert.equal(status.session_status, 'initializing')
  assert.equal(status.candidates.length, 0)
  assert.deepEqual(
    status.incomplete.map((entry) => entry.slot),
    ['alpha'],
  )
  assert.equal(status.consolidation_ready, false)
  assert.equal(status.recovery_command, `./bin/pan best-of-n clean ${bonId}`)

  assert.throws(
    () => consolidateBestOfN(root, bonId),
    /did not finish initialization/u,
  )

  const worktree = path.join(root, status.incomplete[0].worktree_path)

  assert.equal(existsSync(worktree), true)

  const cleaned = cleanBestOfN(root, bonId)

  assert.deepEqual(cleaned.removed_worktrees, [
    status.incomplete[0].worktree_path,
  ])
  assert.equal(existsSync(worktree), false)
})

test('one command at a time may mutate a session record', () => {
  const { root, session } = bestOfNCheckpoint('ready')
  const candidate = session.candidates[0]
  const mutex = bestOfNMutexPath(root, session.bon_id)

  withOperationMutex(mutex, () => {
    const mutations = [
      () =>
        abandonBestOfNCandidate(
          root,
          session.bon_id,
          candidate.run_id,
          EXCLUSION_NOTE,
        ),
      () => consolidateBestOfN(root, session.bon_id),
      () => cleanBestOfN(root, session.bon_id, { force: true }),
    ]

    for (const mutation of mutations) {
      assert.throws(mutation, /Another Pancreator command is updating/u)
    }
  })

  // Every refusal happened before its mutation, so nothing partial was written.
  assert.equal(
    bestOfNStatus(root, session.bon_id).candidates[0].abandoned,
    undefined,
  )

  abandonBestOfNCandidate(
    root,
    session.bon_id,
    candidate.run_id,
    EXCLUSION_NOTE,
  )

  assert.ok(bestOfNStatus(root, session.bon_id).candidates[0].abandoned)
  // The mutation released the mutex it took, so the next command is not
  // refused by a file the last one left behind.
  assert.equal(existsSync(mutex), false)
})

test('status surfaces invalid candidate state', () => {
  const { root, session } = bestOfNCheckpoint('ready')
  const candidate = session.candidates[0]
  const statePath = resolveRunLayout(root, candidate.run_id).state.absolute

  writeJson(statePath, { schema_version: 1 })

  assert.throws(
    () => bestOfNStatus(root, session.bon_id),
    /state\.json\.run_id MUST be a non-empty string/u,
  )
})
