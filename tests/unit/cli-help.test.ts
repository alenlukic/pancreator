import assert from 'node:assert/strict'
import test from 'node:test'

import { HELP_BODY } from '../../src/cli.js'

// Run 63311 F-5: the displayed form omitted --invocation, and the command
// failed until the supervisor supplied it. The help line is the contract.
test('pan output validate help names the required --invocation argument', () => {
  const usage = HELP_BODY.split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('pan output validate'))

  assert.ok(usage, HELP_BODY)
  assert.ok(usage.includes('--invocation'), usage)
})

// Both flags exist so a caller can opt out of a deferral the harness
// otherwise performs for it. An undocumented opt-out is not an opt-out.
test('help documents the critical-path deferral opt-out flags', () => {
  for (const option of ['--harness-initiated', '--await-probe']) {
    assert.ok(HELP_BODY.includes(option), option)
  }
})
