import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { CLEANUP_ARTIFACT_CLASSES, planCleanup } from '../../src/lib/cleanup.js'
import {
  resolveRetentionDays,
  retentionDaysFromConfig,
} from '../../src/lib/project-config.js'
import { createTestTempDirectory } from '../temp.js'

test('retention resolver applies defaults and class overrides', () => {
  assert.equal(retentionDaysFromConfig(null, 'worktrees'), 30)
  assert.equal(
    retentionDaysFromConfig(
      { retention: { default_days: 14 } },
      'workflow-runs',
    ),
    14,
  )
  assert.equal(
    retentionDaysFromConfig(
      {
        retention: {
          default_days: 14,
          classes: { worktrees: 7 },
        },
      },
      'worktrees',
    ),
    7,
  )
})

test('retention resolves for a harness root that has no configuration yet', () => {
  // The installer runs runtime maintenance over the new harness directory
  // before it writes config.json, so this root is the install-time state.
  const root = createTestTempDirectory('retention-unconfigured-')

  assert.equal(resolveRetentionDays(root, 'workflow-runs'), 30)
})

test('cleanup artifact table covers ephemeral and retained classes', () => {
  const byName = new Map(
    CLEANUP_ARTIFACT_CLASSES.map((entry) => [entry.name, entry]),
  )

  for (const name of [
    'workflow-runs',
    'standalone-sessions',
    'best-of-n',
    'cohorts',
    'traces',
    'evals',
    'horizon',
    'hypervisor',
    'away-mode',
    'inbox-history',
    'pr-descriptions',
    'research',
    'benchmarks',
    'scratch',
    'worktrees',
    'shell-logs',
    'agent-index',
  ]) {
    assert.ok(byName.has(name), name)
    assert.notEqual(byName.get(name)?.disposal, 'retain')
  }

  assert.equal(byName.get('durable-cache')?.disposal, 'retain')
  assert.equal(byName.get('release-allocations')?.disposal, 'retain')
  assert.equal(byName.get('repository-checks')?.disposal, 'retain')
  assert.ok(
    byName
      .get('release-allocations')
      ?.paths.includes('runtime/release/allocations.jsonl'),
  )
})

test('shell-logs planning skips the latest symlink', () => {
  const root = createTestTempDirectory('cleanup-shell-logs-')
  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const recordName = '20260101T000000Z-oldfinished-aaaaaaaa'
  const recordDir = path.join(shellDir, recordName)

  mkdirSync(recordDir, { recursive: true })
  writeFileSync(path.join(recordDir, 'record.json'), '{}\n')
  symlinkSync(recordName, path.join(shellDir, 'latest'))

  const plan = planCleanup(root, {
    classes: ['shell-logs'],
    // Far enough past any real mtime that the record reads as expired,
    // matching the far-future pattern the landing-lock test below uses.
    now: new Date(Date.now() + 60 * 24 * 60 * 60 * 1_000),
  })

  assert.deepEqual(
    plan.actions.map((action) => [action.action, action.path]),
    [['delete', `runtime/logs/shell/${recordName}`]],
    'only the record directory is planned; the latest symlink is never listed',
  )
})

test('stale landing lock retention plans only reclaimed locks, never the release ledgers or the live lock', () => {
  const root = createTestTempDirectory('cleanup-landing-locks-')
  const release = path.join(root, 'runtime', 'release')
  const staleLock = 'landing.lock.stale-2026-08-01T00-00-00.000Z-deadbeef'

  mkdirSync(path.join(release, 'stale-locks'), { recursive: true })

  for (const name of ['allocations.jsonl', 'landing.jsonl', 'landing.lock']) {
    writeFileSync(path.join(release, name), '{}\n')
  }

  writeFileSync(path.join(release, 'stale-locks', staleLock), '{}\n')

  const plan = planCleanup(root, {
    classes: ['landing-lock-stale'],
    now: new Date(Date.now() + 60 * 24 * 60 * 60 * 1_000),
  })

  assert.deepEqual(
    plan.actions.map((action) => [action.action, action.path]),
    [['delete', `runtime/release/stale-locks/${staleLock}`]],
  )
})
