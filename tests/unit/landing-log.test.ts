import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  latestFailedSession,
  latestLandedSession,
  readLandingSessions,
} from '../../src/lib/landing-log.js'
import { createTestTempDirectory } from '../temp.js'

function logRoot(lines: Array<Record<string, unknown> | string>): string {
  const root = createTestTempDirectory('landing-log-')

  mkdirSync(path.join(root, 'runtime', 'release'), { recursive: true })
  writeFileSync(
    path.join(root, 'runtime', 'release', 'landing.jsonl'),
    `${lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n')}\n`,
  )

  return root
}

const RUN = 'run-1'
const WORKTREE = 'wt'

// The shape of the log before step events carried a token or a run id: only
// `acquired` names the run, so the block rule attributes every step.
const LEGACY = [
  {
    event: 'acquired',
    token: 't1',
    worktree: WORKTREE,
    run_id: RUN,
    timestamp: '2026-01-01T00:00:00Z',
  },
  {
    event: 'step',
    step: 'tip_read',
    at: '2026-01-01T00:00:01Z',
    tip_commit: 'a',
  },
  {
    event: 'step',
    step: 'finalize',
    at: '2026-01-01T00:00:02Z',
    release_commit: 'r1',
    index_commit: 'i1',
  },
  {
    event: 'step',
    step: 'verify',
    at: '2026-01-01T00:00:03Z',
    profile: 'full',
    outcome: 'failed',
  },
  { event: 'released', token: 't1' },
  {
    event: 'acquired',
    token: 't2',
    worktree: WORKTREE,
    run_id: RUN,
    timestamp: '2026-01-01T01:00:00Z',
  },
  {
    event: 'step',
    step: 'finalize',
    at: '2026-01-01T01:00:02Z',
    release_commit: 'r1',
    index_commit: 'i1',
  },
  { event: 'reclaimed', dead_holder: { token: 't2' } },
  {
    event: 'acquired',
    token: 't3',
    worktree: WORKTREE,
    run_id: RUN,
    timestamp: '2026-01-01T02:00:00Z',
  },
  {
    event: 'step',
    step: 'finalize',
    at: '2026-01-01T02:00:02Z',
    release_commit: 'r1',
    index_commit: 'i1',
  },
  {
    event: 'step',
    step: 'verify',
    at: '2026-01-01T02:00:03Z',
    profile: 'static',
    outcome: 'passed',
  },
  {
    event: 'step',
    step: 'fast_forward',
    at: '2026-01-01T02:00:04Z',
    tip_before: 'a',
    tip_after: 'i1',
    version: '7.0.0',
  },
  { event: 'released', token: 't3' },
]

test('sessions bracket from acquired to released or reclaimed and skip torn lines', () => {
  const root = logRoot(['{ torn', ...LEGACY])
  const sessions = readLandingSessions(root)

  assert.deepEqual(
    sessions.map((session) => [
      session.token,
      session.ended,
      session.steps.length,
    ]),
    [
      ['t1', 'released', 3],
      ['t2', 'reclaimed', 1],
      ['t3', 'released', 3],
    ],
  )
})

test('the latest landed session carries the commits, verified profiles, and basis', () => {
  const landed = latestLandedSession(logRoot(LEGACY), RUN, WORKTREE)

  assert.equal(landed?.token, 't3')
  assert.equal(landed?.version, '7.0.0')
  assert.equal(landed?.tip_after, 'i1')
  assert.equal(landed?.release_commit, 'r1')
  assert.deepEqual(landed?.verified_profiles, ['static'])
  assert.equal(landed?.verification_basis, 'unrecorded')
  assert.equal(latestLandedSession(logRoot(LEGACY), 'other', WORKTREE), null)
  assert.equal(latestLandedSession(logRoot(LEGACY), RUN, 'other'), null)
})

test('the latest failed session names the release pair the failed land finalized', () => {
  const failed = latestFailedSession(logRoot(LEGACY), RUN, WORKTREE)

  assert.equal(failed?.token, 't1')
  assert.equal(failed?.release_commit, 'r1')
  assert.equal(failed?.index_commit, 'i1')
})

test('explicit token and run id on a step win over the block rule', () => {
  const root = logRoot([
    { event: 'acquired', token: 'x', worktree: WORKTREE, run_id: RUN },
    { event: 'acquired', token: 'y', worktree: WORKTREE, run_id: 'other' },
    { event: 'step', step: 'tip_read', token: 'x', run_id: RUN, at: 't' },
  ])
  const [first, second] = readLandingSessions(root)

  assert.equal(first?.steps.length, 1)
  assert.equal(second?.steps.length, 0)
})
