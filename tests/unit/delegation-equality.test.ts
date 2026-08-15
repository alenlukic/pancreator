import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateDelegationMarkdown } from '../../src/lib/validation.js'

// Byte fixtures preserved from audited run 63327_Aug-13-0394_5de7203f: the
// 13_intake-1 delivery prompt and the delegation artifact the supervisor
// persisted. They differ only by one trailing blank line, which failed the
// audited equality check and forced a needless re-delivery.
function fixture(name: string): string {
  return readFileSync(
    path.join(process.cwd(), 'tests', 'fixtures', 'harness-repair', name),
    'utf8',
  )
}

test('the audited delivery and delegation byte pair now matches', () => {
  const result = validateDelegationMarkdown(
    fixture('intake-1-delivery.md'),
    fixture('intake-1-delegation.md'),
    'referenced',
  )

  assert.equal(result.passed, true)
})

test('a non-whitespace byte difference still fails the equality check', () => {
  const delegation = fixture('intake-1-delegation.md').replace(
    'invocation',
    'inv0cation',
  )
  const result = validateDelegationMarkdown(
    fixture('intake-1-delivery.md'),
    delegation,
    'referenced',
  )

  assert.equal(result.passed, false)
})
