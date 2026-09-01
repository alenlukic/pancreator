import assert from 'node:assert/strict'
import test from 'node:test'

import { HELP_BODY } from '../../src/cli.js'

// Run 63311 F-5: the displayed form omitted --invocation, and the command
// failed until the supervisor supplied it. The help line is the contract.
test('pan output validate help names the required --invocation argument', () => {
  for (const usage of [
    'pan output validate <run-id> --file <path> --invocation <path> [--json]',
    'pan tune prepare [--baseline <ref>] [--json]',
    'pan tune finalize --session <id> [--json]',
  ]) {
    assert.ok(
      HELP_BODY.split('\n').some((line) => line.trim() === usage),
      usage,
    )
  }

  for (const option of [
    '--mark-background',
    '--agent-state running|completed',
    'DELEGATION_UNOBSERVED',
    '--operator-artifacts',
    '--run <run-id>',
    '--stage <stage-slug>',
    '--force',
  ]) {
    assert.ok(HELP_BODY.includes(option), option)
  }
})
