import assert from 'node:assert/strict'
import test from 'node:test'

import { sha256 } from '../../src/lib/io.js'
import { resolveAwayModeConfig } from '../../src/lib/project-config.js'
import type { AwayModeConfig } from '../../src/lib/types.js'
import { sharedFixture } from '../fixture-template.js'

const ROOT = sharedFixture()

test('profile away-mode settings replace project settings and own the digest', () => {
  const profile: AwayModeConfig = {
    enabled: true,
    guardrails: {
      allowed_actions: ['approve', 'resume'],
      max_decisions_per_run: 7,
      max_remediation_attempts_per_agent: 5,
    },
  }
  const resolved = resolveAwayModeConfig(ROOT, profile)

  assert.deepEqual(resolved, {
    enabled: true,
    guardrails: {
      allowed_actions: ['approve', 'resume'],
      max_decisions_per_run: 7,
      max_remediation_attempts_per_agent: 5,
    },
    source_sha256: sha256(profile),
  })
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
