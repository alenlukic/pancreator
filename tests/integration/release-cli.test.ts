import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

import { createFixture } from '../fixture-template.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

interface CliFailure {
  status: number | null
  error: string
  message: string
}

function runRelease(root: string, args: string[]): CliFailure {
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', CLI, 'release', ...args],
    { cwd: root, encoding: 'utf8', timeout: 60_000 },
  )
  const payload = JSON.parse(result.stderr) as {
    error: string
    message: string
  }

  return { status: result.status, ...payload }
}

test('every pan release subcommand names the argument it is missing and exits 1', () => {
  // No test reached this surface, so an argument the handler stopped
  // requiring, or a subcommand it stopped rejecting, changed nothing.
  const root = createFixture()

  const cases: { args: string[]; error: string; message: RegExp }[] = [
    { args: [], error: 'INVALID_ARGUMENT', message: /release subcommand/u },
    {
      args: ['sync'],
      error: 'INVALID_ARGUMENT',
      message: /--worktree is required/u,
    },
    {
      args: ['sync', '--worktree', 'release'],
      error: 'INVALID_ARGUMENT',
      message: /--message is required/u,
    },
    {
      args: ['continue'],
      error: 'INVALID_ARGUMENT',
      message: /--worktree is required/u,
    },
    {
      args: ['finalize'],
      error: 'INVALID_ARGUMENT',
      message: /--worktree is required/u,
    },
    {
      args: ['finalize', '--worktree', 'release'],
      error: 'INVALID_ARGUMENT',
      message: /--fetched-main is required/u,
    },
    {
      args: ['publish', '--worktree', 'release'],
      error: 'UNKNOWN_COMMAND',
      message: /Unknown release subcommand: publish/u,
    },
  ]

  for (const expected of cases) {
    const failure = runRelease(root, expected.args)
    const label = `pan release ${expected.args.join(' ')}`

    assert.equal(failure.status, 1, label)
    assert.equal(failure.error, expected.error, label)
    assert.match(failure.message, expected.message, label)
  }
})
