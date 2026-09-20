import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  cliEntrypointMatches,
  HELP_BODY,
  requiredPositional,
} from '../../src/cli.js'
import { PanError } from '../../src/lib/errors.js'

test('required positional arguments reject a flag in their slot', () => {
  assert.throws(
    () => requiredPositional('--json', 'cohort-id'),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'INVALID_ARGUMENT' &&
      /cohort-id is required\./u.test(error.message),
  )
})

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
// otherwise performs for it. An undocumented opt-out is not an opt-out, and
// a documented one the dispatcher never reads is not one either. Searching
// the help body for two substrings proved only the first half, and stayed
// green when the flag it named stopped reaching a parser.
test('every option the help documents is one an argv parser reads', () => {
  const documented = new Set(HELP_BODY.match(/--[a-z][a-z0-9-]*/gu))

  for (const optOut of ['--harness-initiated', '--await-probe']) {
    assert.ok(documented.has(optOut), optOut)
  }

  // The help body never quotes a flag, so a quoted occurrence in a parser
  // source is a literal the dispatcher compares against, never help prose.
  const parsers = ['src/cli.ts', 'src/lib/test-impact.ts']
    .map((relative) => readFileSync(path.join(process.cwd(), relative), 'utf8'))
    .join('\n')

  assert.deepEqual(
    [...documented].filter((flag) => !parsers.includes(`'${flag}'`)),
    [],
  )
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

// AC-019. `pan init --help` is where an operator decides whether to pass
// --worktree, and its one-chunk routing sentence described the pre-inheritance
// behavior: a fresh worktree for every single-chunk delivery run.
test('pan init help states what a named worktree binds and how each plan route uses it', () => {
  const lines = HELP_BODY.split('\n').map((line) => line.trim())
  const start = lines.findIndex((line) => line.startsWith('pan init '))
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('pan '),
  )
  const init = lines.slice(start, end).join('\n')

  assert.match(init, /--worktree binds the planning run/u)
  assert.match(init, /single-chunk delivery run inherits that worktree/u)
  assert.match(init, /one isolated worktree per cohort chunk/u)
  assert.match(
    init,
    /refuses while the planning worktree holds uncommitted work/u,
  )
  assert.doesNotMatch(init, /in its own worktree/u)
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
