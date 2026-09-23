import assert from 'node:assert/strict'
import test from 'node:test'

import { CLEANUP_ARTIFACT_CLASSES } from '../../src/lib/cleanup.js'
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
