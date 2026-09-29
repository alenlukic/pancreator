import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { sha256 } from '../../src/lib/io.js'
import { resolveAwayModeConfig } from '../../src/lib/project-config.js'
import type { AwayModeConfig } from '../../src/lib/types.js'
import { sharedFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

const ROOT = sharedFixture()

test('profile away-mode settings replace project settings and own the digest', () => {
  const profile: AwayModeConfig = {
    enabled: true,
    guardrails: {
      allowed_actions: ['approve', 'resume'],
    },
  }
  const resolved = resolveAwayModeConfig(ROOT, profile)

  assert.deepEqual(resolved, {
    enabled: true,
    guardrails: {
      allowed_actions: ['approve', 'resume'],
    },
    source_sha256: sha256(profile),
  })
})

test('project config refuses an away action outside the away vocabulary', () => {
  const root = createTestTempDirectory('pan-away-config-')

  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify({
      schema_version: 1,
      away_mode: { enabled: true, guardrails: { allowed_actions: ['push'] } },
    })}\n`,
  )

  assert.throws(
    () => resolveAwayModeConfig(root),
    (error: unknown) =>
      error instanceof Error &&
      (error as { code?: unknown }).code === 'INVALID_PROJECT_CONFIG' &&
      /allowed_actions MUST contain only/u.test(error.message),
  )
})

test('an absent profile block preserves project away-mode resolution', () => {
  const resolved = resolveAwayModeConfig(ROOT)

  assert.equal(resolved.enabled, false)
  assert.deepEqual(resolved.guardrails.allowed_actions, [
    'approve',
    'reject',
    'revise',
    'resume',
    'set-stage',
    'waive-gate',
  ])
  assert.equal(resolved.source_sha256, sha256({ enabled: false }))
})
