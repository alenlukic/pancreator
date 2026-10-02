import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

import {
  CLEANUP_ARTIFACT_CLASSES,
  applyCleanup,
  planCleanup,
} from '../../src/lib/cleanup.js'
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
  assert.equal(byName.get('shell-logs')?.compact_after_days, 7)
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

const SHELL_NOW = new Date('2026-10-01T12:00:00.000Z')

function writeShellRecord(
  root: string,
  name: string,
  files: Record<string, string>,
): string {
  const recordDir = path.join(root, 'runtime', 'logs', 'shell', name)

  mkdirSync(recordDir, { recursive: true })

  for (const [file, contents] of Object.entries(files)) {
    writeFileSync(path.join(recordDir, file), contents)
  }

  return recordDir
}

test('shell-logs planning gzips logs older than 7 days and deletes records older than 30 days', () => {
  const root = createTestTempDirectory('cleanup-shell-compact-')
  const compactName = '20260921T120000Z-midlife-aaaaaaaa'
  const deleteName = '20260831T120000Z-expired-aaaaaaaa'
  const youngName = '20260928T120000Z-young-aaaaaaaa'
  const compactedName = '20260920T120000Z-already-aaaaaaaa'

  writeShellRecord(root, compactName, {
    'record.json': '{}\n',
    'output.log': 'keep me gzipped\n',
  })
  writeShellRecord(root, deleteName, {
    'record.json': '{}\n',
    'heartbeat.json': '{}\n',
    'output.log.gz': 'already compacted\n',
  })
  writeShellRecord(root, youngName, {
    'record.json': '{}\n',
    'output.log': 'still fresh\n',
  })
  writeShellRecord(root, compactedName, {
    'record.json': '{}\n',
    'output.log.gz': 'no raw log left\n',
  })

  const plan = planCleanup(root, {
    classes: ['shell-logs'],
    now: SHELL_NOW,
  })

  assert.deepEqual(
    plan.actions.map((action) => [action.action, action.path, action.age_days]),
    [
      ['delete', `runtime/logs/shell/${deleteName}`, 31],
      ['compact', `runtime/logs/shell/${compactName}`, 10],
    ],
  )
  assert.equal(
    plan.actions.some((action) => action.path.endsWith(youngName)),
    false,
  )
  assert.equal(
    plan.actions.some((action) => action.path.endsWith(compactedName)),
    false,
  )
})

test('shell-logs apply gzips logs in place and keeps record metadata', () => {
  const root = createTestTempDirectory('cleanup-shell-apply-')
  const compactName = '20260921T120000Z-midlife-aaaaaaaa'
  const recordDir = writeShellRecord(root, compactName, {
    'record.json': '{"ended_at":"2026-09-21T12:00:01.000Z"}\n',
    'heartbeat.json': '{"log_bytes":12}\n',
    'output.log': 'payload to compress\n',
  })

  const result = applyCleanup(root, {
    classes: ['shell-logs'],
    now: SHELL_NOW,
  })

  assert.equal(result.status, 'applied')
  assert.equal(existsSync(path.join(recordDir, 'output.log')), false)
  assert.equal(existsSync(path.join(recordDir, 'output.log.gz')), true)
  assert.equal(existsSync(path.join(recordDir, 'record.json')), true)
  assert.equal(existsSync(path.join(recordDir, 'heartbeat.json')), true)
  assert.equal(
    gunzipSync(readFileSync(path.join(recordDir, 'output.log.gz'))).toString(
      'utf8',
    ),
    'payload to compress\n',
  )
})

test('shell-logs planning holds a live wrapper past the compact age', () => {
  const root = createTestTempDirectory('cleanup-shell-live-')
  const liveName = '20260921T120000Z-running-aaaaaaaa'

  writeShellRecord(root, liveName, {
    'record.json': JSON.stringify({
      ended_at: null,
      wrapper_pid: process.pid,
    }),
    'output.log': 'still streaming\n',
  })

  const plan = planCleanup(root, {
    classes: ['shell-logs'],
    now: SHELL_NOW,
  })

  assert.deepEqual(plan.actions, [])
  assert.match(
    plan.skipped.find((entry) => entry.path.endsWith(liveName))?.reason ?? '',
    /wrapper process .* is still running/u,
  )
})

test('shell-logs planning holds a wrapper still streaming after the command exited', () => {
  const root = createTestTempDirectory('cleanup-shell-streaming-')
  const name = '20260921T120000Z-streaming-aaaaaaaa'

  writeShellRecord(root, name, {
    'record.json': JSON.stringify({
      ended_at: '2026-09-21T12:00:05.000Z',
      exit_code: 0,
      output_drained: false,
      wrapper_pid: process.pid,
    }),
    'output.log': 'a background process still writes\n',
  })

  const plan = planCleanup(root, {
    classes: ['shell-logs'],
    now: SHELL_NOW,
  })

  assert.deepEqual(plan.actions, [])
  assert.match(
    plan.skipped.find((entry) => entry.path.endsWith(name))?.reason ?? '',
    /wrapper process .* is still running/u,
  )
})

test('shell-logs planning deletes rather than compacting when the retention window is at most 7 days', () => {
  const root = createTestTempDirectory('cleanup-shell-short-window-')
  const name = '20260921T120000Z-midlife-aaaaaaaa'

  writeShellRecord(root, name, {
    'record.json': '{}\n',
    'output.log': 'too close to deletion\n',
  })

  const plan = planCleanup(root, {
    classes: ['shell-logs'],
    days: 7,
    now: SHELL_NOW,
  })

  assert.deepEqual(
    plan.actions.map((action) => [action.action, action.path]),
    [['delete', `runtime/logs/shell/${name}`]],
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
