import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { decideRun, getRunState } from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { checkpoint } from './delivery-helpers.js'

const WORKTREE = 'landed-worktree'
const NOTE = 'Operator directive: removed the stale test and relanded static.'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function shipRun() {
  const fixture = checkpoint('delivery@ship-awaiting-operator')
  const statePath = path.join(
    resolveRunLayout(fixture.root, fixture.runId).events.absolute,
    '..',
    'state.json',
  )
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<
    string,
    unknown
  >

  state.managed_worktree = {
    name: WORKTREE,
    path: `worktrees/operator/${WORKTREE}`,
    branch: WORKTREE,
  }
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)

  return fixture
}

function writeLanding(
  root: string,
  runId: string,
  tipAfter: string,
  profiles: string[] = ['static'],
): void {
  const logPath = path.join(root, 'runtime', 'release', 'landing.jsonl')
  const events: Array<Record<string, unknown>> = [
    { event: 'acquired', token: 'tk', worktree: WORKTREE, run_id: runId },
    { event: 'step', step: 'tip_read', tip_commit: 'a' },
    {
      event: 'step',
      step: 'finalize',
      release_commit: 'r'.repeat(40),
      index_commit: tipAfter,
    },
    ...profiles.map((profile) => ({
      event: 'step',
      step: 'verify',
      profile,
      outcome: 'passed',
      basis: 'operator',
    })),
    {
      event: 'step',
      step: 'fast_forward',
      tip_before: 'a'.repeat(40),
      tip_after: tipAfter,
      version: '7.34.0',
    },
    { event: 'released', token: 'tk' },
  ]

  mkdirSync(path.dirname(logPath), { recursive: true })
  appendFileSync(
    logPath,
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  )
}

function eventTypes(root: string, runId: string): string[] {
  return readFileSync(resolveRunLayout(root, runId).events.absolute, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { type: string }).type)
}

test('decide landed closes a ship run as succeeded and records the landing, profiles, and directive', () => {
  const { root, runId } = shipRun()

  git(root, ['branch', 'pan-dev'])

  const tipAfter = git(root, ['rev-parse', 'pan-dev'])

  writeLanding(root, runId, tipAfter)

  const decided = decideRun(root, runId, 'landed', NOTE)

  assert.equal(decided.status, 'succeeded')
  assert.equal(decided.current_stage, null)
  assert.equal(decided.pending_action.type, 'none')
  assert.equal(decided.release_landing?.version, '7.34.0')
  assert.equal(decided.release_landing?.tip_after, tipAfter)
  assert.deepEqual(decided.release_landing?.verified_profiles, ['static'])
  assert.equal(decided.release_landing?.directive_note, NOTE)
  assert.equal(getRunState(root, runId).status, 'succeeded')

  const types = eventTypes(root, runId)

  assert.ok(types.includes('release_landed'))
  assert.ok(types.includes('operator_decision_recorded'))
})

test('decide landed refuses without a landing, off pan-dev, without a note, or from another stage', () => {
  const { root, runId } = shipRun()

  git(root, ['branch', 'pan-dev'])

  assert.throws(
    () => decideRun(root, runId, 'landed', NOTE),
    (error: { code?: string }) => error.code === 'RELEASE_LANDING_NOT_FOUND',
  )

  const offBranch = git(root, [
    'commit-tree',
    'HEAD^{tree}',
    '-p',
    'HEAD',
    '-m',
    'off pan-dev',
  ])

  writeLanding(root, runId, offBranch)

  assert.throws(
    () => decideRun(root, runId, 'landed', NOTE),
    (error: { code?: string }) =>
      error.code === 'RELEASE_LANDING_NOT_ON_INTEGRATION',
  )
  assert.throws(
    () => decideRun(root, runId, 'landed', '  '),
    (error: { code?: string }) => error.code === 'LANDED_NOTE_REQUIRED',
  )
  assert.equal(getRunState(root, runId).status, 'awaiting_operator')

  const planning = checkpoint('planning@plan-awaiting-operator')

  assert.throws(
    () => decideRun(planning.root, planning.runId, 'landed', NOTE),
    (error: { code?: string }) => error.code === 'LANDED_STAGE_INVALID',
  )
})
