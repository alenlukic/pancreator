import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { cliEntrypointMatches, HELP_BODY } from '../../src/cli.js'
import { PanError } from '../../src/lib/errors.js'

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

// AC-004. The positional run-id slot and the `--run` alias are both in the
// displayed form, because a supervisor reading only this line wrote
// `--run <id>` and got an unknown-run error from a command that never
// mentioned the alias.
test('pan output validate help names both run-id spellings', () => {
  const usage = HELP_BODY.split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('pan output validate'))

  assert.ok(usage, HELP_BODY)
  assert.ok(usage.includes('--run <run-id>'), usage)
  assert.ok(usage.includes('<run-id>'), usage)
})

// AC-013 and AC-023 add an operator flag each. A flag the help never shows is
// a flag the operator never finds.
test('help documents the verification confirmation and the route worktree', () => {
  const lineFor = (prefix: string) =>
    HELP_BODY.split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith(prefix))

  assert.match(lineFor('pan verification <run-id> set') ?? '', /--confirm/u)
  assert.match(lineFor('pan decide') ?? '', /--worktree <name>/u)
  assert.match(lineFor('pan cohort route') ?? '', /--worktree <name>/u)
  assert.match(lineFor('pan inbox restore') ?? '', /<inbox-file>/u)
})

// AC-012. A guard that cannot read the filesystem answered "not the
// entrypoint", so the CLI exited 0 having run no command at all.
test('the entrypoint guard reports a read it could not perform', () => {
  // A readable path that is not the CLI answers the question it was asked.
  assert.equal(cliEntrypointMatches(fileURLToPath(import.meta.url)), false)
  assert.throws(
    () => cliEntrypointMatches('/nonexistent/pan-entrypoint-probe.js'),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'ENTRYPOINT_PATH_UNREADABLE' &&
      error.message.includes('/nonexistent/pan-entrypoint-probe.js'),
  )
})
